// ─────────────────────────────────────────────
// 통화 세션 저장소 + 상담원이 쓰는 도구(양식 입력, 판정 기록, 접수)
// 판정이 '접수 불가'면 서버가 접수를 거부하므로 AI가 실수해도 접수되지 않습니다.
// ─────────────────────────────────────────────
import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { DEFECT_LABEL } from "../constants";
import { APARTMENTS } from "../mock-data";
import { formatPhone, isValidPhone, nameProblem, normalizeDongHo, normalizeName } from "../normalize";
import { getRepositories } from "../repositories";
import { createComplaint, ServiceError } from "../services/complaint-service";
import type { DefectType, Urgency } from "../types";
import {
  ACCEPTABLE_VERDICTS,
  EMPTY_INTAKE,
  type Awaiting,
  VERDICT_LABEL,
  type CallMessage,
  type CallView,
  type IntakeForm,
  type PolicyDecision,
  type SentSms,
  type SubmittedInfo,
} from "./types";

export interface CallSession {
  id: string;
  engine: "claude" | "scripted" | "dialogue";
  /** engine === "dialogue": Python 대화 엔진의 통화 id, 기다리는 답, LLM 사용 여부 */
  dialogueSessionId?: string;
  dialogueAwaiting?: Awaiting;
  dialogueLlm?: "gemini" | "rules";
  sms?: SentSms | null;
  createdAt: number;
  messages: CallMessage[];
  form: IntakeForm;
  decision: PolicyDecision | null;
  submitted: SubmittedInfo | null;
  notice?: string;
  /** Claude 대화 기록 (thinking·tool 블록 포함, 수정 없이 그대로 다시 보냄) */
  claudeHistory: Anthropic.Beta.Messages.BetaMessageParam[];
  /** 테스트용 상담원 진행 단계 */
  step: "issue" | "cause" | "collect" | "confirm" | "done";
}

const g = globalThis as unknown as { __callSessions?: Map<string, CallSession> };
const sessions = (g.__callSessions ??= new Map());
const TTL = 2 * 60 * 60 * 1000;

export function createSession(engine: CallSession["engine"]): CallSession {
  const now = Date.now();
  for (const [id, s] of sessions) if (now - s.createdAt > TTL) sessions.delete(id);
  const s: CallSession = {
    id: crypto.randomUUID(),
    engine,
    createdAt: now,
    messages: [],
    form: { ...EMPTY_INTAKE },
    decision: null,
    submitted: null,
    claudeHistory: [],
    step: "issue",
  };
  sessions.set(s.id, s);
  return s;
}

export const getSession = (id: string) => sessions.get(id) ?? null;

export function say(s: CallSession, role: CallMessage["role"], text: string) {
  if (text.trim()) s.messages.push({ role, text: text.trim(), at: new Date().toISOString() });
}

/** 지금 민원인에게서 기다리는 답 (양식·판정 상태로 계산 — Claude/테스트 상담원 공통) */
function awaitingOf(s: CallSession): Awaiting {
  if (s.submitted || s.step === "done") return "done";
  if (s.engine === "dialogue") return s.dialogueAwaiting ?? "dongho";
  if (!s.decision || !ACCEPTABLE_VERDICTS.includes(s.decision.verdict)) return s.step === "cause" ? "cause" : "issue";
  const f = s.form;
  if (!f.complainantName) return "name";
  if (!f.phone) return "phone";
  if (!f.apartmentName) return "apartment";
  if (!f.building || !f.unit) return "dongho";
  return "confirm";
}

export function toView(s: CallSession): CallView {
  return {
    sessionId: s.id,
    engine: s.engine,
    llm: s.dialogueLlm,
    messages: s.messages,
    form: s.form,
    decision: s.decision,
    submitted: s.submitted,
    sms: s.sms ?? null,
    awaiting: awaitingOf(s),
    notice: s.notice,
  };
}

// ── 도구 1: 접수 양식 입력 ─────────────────────

export type IntakePatch = Partial<Record<keyof IntakeForm, string | null>>;

const FIELD_LABEL: Record<keyof IntakeForm, string> = {
  complainantName: "이름",
  phone: "연락처",
  apartmentName: "단지명",
  building: "동",
  unit: "호수",
  defectType: "하자 유형",
  urgency: "긴급도",
  description: "하자 내용",
};
const REQUIRED: (keyof IntakeForm)[] = ["complainantName", "phone", "apartmentName", "building", "unit", "defectType", "description"];
const DEFECT_TYPES = Object.keys(DEFECT_LABEL) as DefectType[];
const URGENCIES: Urgency[] = ["EMERGENCY", "HIGH", "NORMAL", "LOW"];

/** 값을 형식에 맞춰 정리해 양식에 넣고, 형식 오류는 넣지 않고 problems로 돌려줌 */
export function updateIntake(s: CallSession, patch: IntakePatch) {
  const problems: string[] = [];
  const f = s.form;
  const v = (k: keyof IntakeForm) => (typeof patch[k] === "string" ? patch[k]!.trim() : "");

  if (v("complainantName")) {
    const name = normalizeName(v("complainantName"));
    const err = nameProblem(name);
    if (err) problems.push(`이름 '${v("complainantName")}': ${err} 한글 이름은 2~4글자(보통 3글자)입니다.`);
    else f.complainantName = name;
  }
  if (v("phone")) {
    const phone = formatPhone(v("phone"));
    if (isValidPhone(phone)) f.phone = phone;
    else problems.push(`연락처 '${v("phone")}': 형식이 올바르지 않습니다. 010-1234-5678 형식의 번호가 필요합니다.`);
  }
  if (v("apartmentName")) {
    const n = v("apartmentName").replace(/\s+/g, "").replace(/아파트$/, "");
    const apt = APARTMENTS.find((a) => n.includes(a.name) || a.name.includes(n));
    if (apt) f.apartmentName = apt.name;
    else problems.push(`단지명 '${v("apartmentName")}': 등록된 단지가 아닙니다. 등록 단지: ${APARTMENTS.map((a) => a.name).join(", ")}`);
  }
  for (const k of ["building", "unit"] as const) {
    if (!v(k)) continue;
    const num = normalizeDongHo(v(k));
    if (/^\d{1,5}$/.test(num) && Number(num) > 0) f[k] = num;
    else problems.push(`${FIELD_LABEL[k]} '${v(k)}': 숫자로 확인되지 않습니다.`);
  }
  if (v("defectType")) {
    if (DEFECT_TYPES.includes(v("defectType") as DefectType)) f.defectType = v("defectType") as DefectType;
    else problems.push(`하자 유형 '${v("defectType")}': 허용 값이 아닙니다.`);
  }
  if (v("urgency") && URGENCIES.includes(v("urgency") as Urgency)) f.urgency = v("urgency") as Urgency;
  if (v("description")) f.description = v("description").slice(0, 800);

  const missing = REQUIRED.filter((k) => !f[k]).map((k) => FIELD_LABEL[k]);
  return { form: { ...f }, problems, missing };
}

// ── 도구 2: 비용부담 판정 기록 ─────────────────

export function recordDecision(s: CallSession, d: PolicyDecision) {
  s.decision = d;
  const accept = ACCEPTABLE_VERDICTS.includes(d.verdict);
  return {
    recorded: VERDICT_LABEL[d.verdict],
    canSubmit: accept,
    instruction: accept
      ? "접수 가능한 건입니다. 민원인 정보를 하나씩 확인해 양식을 채우세요."
      : "접수 불가 건입니다. 접수할 수 없다고 분명히 말하고 근거와 입주자가 할 수 있는 방법을 안내하세요. 개인정보를 묻거나 접수하지 마세요.",
  };
}

// ── 도구 3: 접수 ───────────────────────────────

export async function submitIntake(s: CallSession) {
  if (s.submitted) return { ok: false as const, error: `이미 접수되었습니다. 접수번호 ${s.submitted.receiptNo}` };
  if (!s.decision) return { ok: false as const, error: "비용부담 판정이 아직 없습니다. 먼저 판정하세요." };
  if (!ACCEPTABLE_VERDICTS.includes(s.decision.verdict))
    return { ok: false as const, error: `판정이 '${VERDICT_LABEL[s.decision.verdict]}'이라 접수할 수 없습니다.` };
  const missing = REQUIRED.filter((k) => !s.form[k]).map((k) => FIELD_LABEL[k]);
  if (missing.length) return { ok: false as const, error: `양식에 빠진 항목이 있습니다: ${missing.join(", ")}` };

  const transcript = s.messages.map((m) => `${m.role === "agent" ? "상담원(AI)" : "민원인"}: ${m.text}`).join("\n");
  const d = s.decision;
  try {
    const { complaint, assignment } = await createComplaint({
      complainantName: s.form.complainantName,
      phone: s.form.phone,
      apartmentName: s.form.apartmentName,
      building: s.form.building,
      unit: s.form.unit,
      defectType: s.form.defectType as DefectType,
      urgency: (s.form.urgency || "NORMAL") as Urgency,
      description: s.form.description,
      channel: "PHONE_AI",
      callTranscript: transcript,
      aiSummary: `[${VERDICT_LABEL[d.verdict]}] ${d.item} — 근거: ${d.basis}`,
    });
    const contractor = complaint.contractorId ? await getRepositories().contractors.get(complaint.contractorId) : null;
    s.submitted = {
      complaintId: complaint.id,
      receiptNo: complaint.receiptNo,
      status: complaint.status,
      contractorName: contractor?.name ?? null,
    };
    s.step = "done";
    return {
      ok: true as const,
      receiptNo: complaint.receiptNo,
      assignedContractor: contractor?.name ?? null,
      status: complaint.status === "ASSIGNED" ? "업체 배정 완료" : "담당자 확인 후 업체 배정 예정",
      note: assignment?.reason ?? "",
    };
  } catch (e) {
    return { ok: false as const, error: e instanceof ServiceError ? e.message : "접수 중 오류가 발생했습니다." };
  }
}
