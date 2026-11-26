// ─────────────────────────────────────────────
// HomeCareOn 대화 엔진(Python, backend/server.py) 연동
// 대화 진행·비용부담 판정(수선유지 RAG)은 Python 서버가 하고,
// 이 웹은 화면 표시와 민원 저장·업체 배정을 맡습니다.
// 접수 확정 시 Python 서버가 이 웹의 POST /api/complaints 로 민원을 등록합니다.
// ─────────────────────────────────────────────
import "server-only";
import type { DefectType, Urgency } from "../types";
import type { CallSession } from "./session";
import type { Awaiting, PolicyVerdict } from "./types";

export const DIALOGUE_API_URL = (process.env.DIALOGUE_API_URL ?? "http://127.0.0.1:8100").replace(/\/$/, "");

/** Python 서버가 돌려주는 통화 상태 (backend/server.py 의 _view) */
export interface DialogueView {
  session_id: string;
  engine: "gemini" | "rules";
  state: string;
  awaiting: Awaiting;
  reply: string;
  session: {
    building: string | null;
    unit: string | null;
    resident_name: string | null;
    is_resident_verified: boolean;
    phone: string | null;
    apartment_name: string | null;
    symptom: string | null;
    cause_detail: string | null;
    facility_item_id: string | null;
    facility_name: string | null;
    defect_type: DefectType | null;
    liability_verdict: PolicyVerdict | null;
    liability_party: string | null;
    liability_reason: string | null;
    liability_explanation: string | null;
    ticket_id: string | null;
    complaint_id: string | null;
    contractor_name: string | null;
    ticket_registered: boolean;
    ticket_error: string | null;
  };
}

async function call(path: string, body?: unknown): Promise<DialogueView> {
  const res = await fetch(`${DIALOGUE_API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`대화 엔진 오류 (${res.status}) ${detail.slice(0, 200)}`);
  }
  return res.json() as Promise<DialogueView>;
}

export const startDialogue = () => call("/api/dialogue/sessions");
export const sendDialogue = (id: string, text: string) => call(`/api/dialogue/sessions/${id}/messages`, { text });

const digits = (s: string | null) => (s ?? "").replace(/\D/g, "");

/** Python 통화 상태를 웹 화면의 통화 세션(양식·판정·접수 결과)에 반영 */
export function applyDialogueView(s: CallSession, v: DialogueView) {
  const p = v.session;
  s.dialogueSessionId = v.session_id;
  s.dialogueAwaiting = v.awaiting;
  s.dialogueLlm = v.engine;
  s.form = {
    complainantName: p.is_resident_verified ? (p.resident_name ?? "") : "",
    phone: p.is_resident_verified ? (p.phone ?? "") : "",
    apartmentName: p.apartment_name ?? "",
    building: digits(p.building),
    unit: digits(p.unit),
    defectType: (p.defect_type ?? "") as DefectType | "",
    urgency: "" as Urgency | "",
    description: [p.facility_name && `[${p.facility_name}]`, p.symptom, p.cause_detail && `경위: ${p.cause_detail}`]
      .filter(Boolean)
      .join(" / "),
  };
  s.decision = p.liability_verdict
    ? {
        verdict: p.liability_verdict,
        item: p.facility_name ?? "시설물 특정 안 됨",
        basis: p.liability_reason ?? "",
        explanation: p.liability_explanation ?? "",
      }
    : null;
  // 접수 동의 → 대화 엔진이 이 웹에 민원을 바로 등록 (방문 일정은 관리자가 업체와 조율 후 문자 발송)
  if (p.ticket_id && !s.submitted) {
    if (p.ticket_registered && p.complaint_id) {
      s.submitted = { complaintId: p.complaint_id, receiptNo: p.ticket_id, status: "RECEIVED", contractorName: p.contractor_name };
    } else {
      // 웹 연결 실패로 대화 엔진이 임시 번호만 발급한 경우
      s.notice = `민원이 관리자 웹에 등록되지 않았습니다 (임시 접수번호 ${p.ticket_id}): ${p.ticket_error ?? "원인 미상"}`;
    }
  }
  if (v.awaiting === "done") s.step = "done";
}
