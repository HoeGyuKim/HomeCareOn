// ─────────────────────────────────────────────
// 민원 처리 서비스 (업무 흐름 오케스트레이션)
//   접수 저장 → 자동 업체 배정 → 업체 전달 → 상태 관리
// ─────────────────────────────────────────────
import "server-only";
import { DEFECT_TYPES, STATUS_LABEL } from "../constants";
import { findApartment } from "../mock-data";
import { getRepositories } from "../repositories";
import type {
  AssignmentResult,
  Complaint,
  ComplaintFilter,
  ComplaintHistory,
  ComplaintInput,
  ComplaintStatus,
  DashboardStats,
  DefectType,
  DistrictStat,
} from "../types";
import { DISTRICT_NAMES } from "../seoul";
import { formatPhone, isValidPhone, nameProblem, normalizeDongHo, normalizeName } from "../normalize";
import { selectContractor } from "./assignment";
import { sendToContractor } from "./notification";

const now = () => new Date().toISOString();

export class ServiceError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/** 이름·동호수·전화번호 띄어쓰기/형식 정리 후 검증 */
function normalizeAndValidate(raw: ComplaintInput): ComplaintInput {
  const input: ComplaintInput = {
    ...raw,
    complainantName: normalizeName(raw.complainantName ?? ""),
    phone: raw.phone ? formatPhone(raw.phone) : "",
    building: normalizeDongHo(raw.building ?? ""),
    unit: normalizeDongHo(raw.unit ?? ""),
  };

  const missing: string[] = [];
  if (!input.complainantName) missing.push("민원인 이름");
  if (!input.phone) missing.push("전화번호");
  if (!input.apartmentName?.trim()) missing.push("아파트명");
  if (!input.building) missing.push("동");
  if (!input.unit) missing.push("호수");
  if (!input.description?.trim()) missing.push("상세 민원 내용");
  if (!DEFECT_TYPES.some((d) => d.value === input.defectType)) missing.push("하자 유형");
  if (missing.length) throw new ServiceError(`필수 항목이 누락되었습니다: ${missing.join(", ")}`);

  const nameErr = nameProblem(input.complainantName);
  if (nameErr) throw new ServiceError(nameErr);
  if (!isValidPhone(input.phone)) throw new ServiceError("전화번호 형식이 올바르지 않습니다. (예: 010-1234-5678)");
  if ((input.photos?.length ?? 0) > 5) throw new ServiceError("사진은 최대 5장까지 첨부할 수 있습니다.");
  return input;
}

export async function listComplaints(filter?: ComplaintFilter) {
  return getRepositories().complaints.list(filter);
}

export async function createComplaint(rawInput: ComplaintInput, opts: { autoAssign?: boolean } = {}) {
  const input = normalizeAndValidate(rawInput);
  const { complaints } = getRepositories();
  const apt = findApartment(input.apartmentName);
  const ts = now();
  const actor = input.channel === "PHONE_AI" ? "AI" : "ADMIN";

  const created = await complaints.create({
    receivedAt: ts,
    complainantName: input.complainantName,
    phone: input.phone,
    apartmentName: apt?.name ?? input.apartmentName.trim(),
    region: input.region?.trim() || apt?.region || "",
    building: input.building,
    unit: input.unit,
    defectType: input.defectType,
    description: input.description.trim(),
    urgency: input.urgency ?? "NORMAL",
    photos: input.photos ?? [],
    contractorId: null,
    status: "RECEIVED",
    channel: input.channel ?? "MANUAL",
    callTranscript: input.callTranscript ?? null,
    aiSummary: input.aiSummary ?? null,
    history: [
      { at: ts, status: "RECEIVED", note: actor === "AI" ? "AI 전화 접수" : "관리자 직접 접수", actor },
    ],
    updatedAt: ts,
  });

  if (opts.autoAssign === false) return { complaint: created, assignment: null };
  return autoAssign(created.id);
}

/** 자동 배정 실행 (재배정 버튼에서도 사용) */
export async function autoAssign(id: string): Promise<{ complaint: Complaint; assignment: AssignmentResult }> {
  const { complaints, contractors } = getRepositories();
  const c = await complaints.get(id);
  if (!c) throw new ServiceError("민원을 찾을 수 없습니다.", 404);

  const result = selectContractor(
    c.defectType,
    c.region,
    await contractors.list(),
    await complaints.countActiveByContractor(),
  );
  const ts = now();

  if (!result.contractor) {
    const updated = await complaints.update(id, {
      status: "PENDING_REVIEW",
      contractorId: null,
      updatedAt: ts,
      history: [...c.history, { at: ts, status: "PENDING_REVIEW", note: result.reason, actor: "SYSTEM" }],
    });
    return { complaint: updated!, assignment: result };
  }

  const sent = await sendToContractor(c, result.contractor);
  const history: ComplaintHistory[] = [
    ...c.history,
    { at: ts, status: "ASSIGNED", note: `자동 배정: ${result.reason}`, actor: "SYSTEM" },
    { at: ts, status: "ASSIGNED", note: `업체 전달 완료 → ${sent.channels.join(", ")}`, actor: "SYSTEM" },
  ];
  const updated = await complaints.update(id, {
    status: "ASSIGNED",
    contractorId: result.contractor.id,
    updatedAt: ts,
    history,
  });
  return { complaint: updated!, assignment: result };
}

/** 관리자 수동 배정 */
export async function assignManually(id: string, contractorId: string) {
  const { complaints, contractors } = getRepositories();
  const c = await complaints.get(id);
  if (!c) throw new ServiceError("민원을 찾을 수 없습니다.", 404);
  const ctr = await contractors.get(contractorId);
  if (!ctr) throw new ServiceError("업체를 찾을 수 없습니다.", 404);

  const sent = await sendToContractor(c, ctr);
  const ts = now();
  return complaints.update(id, {
    status: "ASSIGNED",
    contractorId,
    updatedAt: ts,
    history: [
      ...c.history,
      { at: ts, status: "ASSIGNED", note: `관리자 수동 배정: ${ctr.name}`, actor: "ADMIN" },
      { at: ts, status: "ASSIGNED", note: `업체 전달 완료 → ${sent.channels.join(", ")}`, actor: "SYSTEM" },
    ],
  });
}

export async function changeStatus(id: string, status: ComplaintStatus, note?: string) {
  const { complaints } = getRepositories();
  const c = await complaints.get(id);
  if (!c) throw new ServiceError("민원을 찾을 수 없습니다.", 404);
  if (!(status in STATUS_LABEL)) throw new ServiceError("올바르지 않은 상태값입니다.");
  if (["ASSIGNED", "SCHEDULED", "IN_PROGRESS", "COMPLETED"].includes(status) && !c.contractorId)
    throw new ServiceError("업체가 배정되지 않은 민원은 해당 상태로 변경할 수 없습니다. 먼저 업체를 배정하세요.");

  const ts = now();
  return complaints.update(id, {
    status,
    updatedAt: ts,
    history: [
      ...c.history,
      { at: ts, status, note: note?.trim() || `상태 변경: ${STATUS_LABEL[c.status]} → ${STATUS_LABEL[status]}`, actor: "ADMIN" },
    ],
  });
}

export async function getComplaintDetail(id: string) {
  const { complaints, contractors } = getRepositories();
  const c = await complaints.get(id);
  if (!c) return null;
  const all = await contractors.list();
  const preview = selectContractor(c.defectType, c.region, all, await complaints.countActiveByContractor());
  return {
    complaint: c,
    contractor: c.contractorId ? all.find((x) => x.id === c.contractorId) ?? null : null,
    recommendation: preview,
    contractors: all,
  };
}

export async function getStats(): Promise<DashboardStats> {
  const all = await getRepositories().complaints.list();
  const count = (...s: ComplaintStatus[]) => all.filter((c) => s.includes(c.status)).length;
  const byDefectType = Object.fromEntries(DEFECT_TYPES.map((d) => [d.value, 0])) as Record<DefectType, number>;
  for (const c of all) byDefectType[c.defectType] += 1;

  const byDistrict: DistrictStat[] = DISTRICT_NAMES.map((district) => {
    const rows = all.filter((c) => c.region === district);
    const completed = rows.filter((c) => c.status === "COMPLETED").length;
    const waiting = rows.filter((c) => c.status === "RECEIVED" || c.status === "PENDING_REVIEW").length;
    return {
      district,
      total: rows.length,
      completed,
      waiting,
      inProgress: rows.length - completed - waiting,
      rate: rows.length ? completed / rows.length : null,
    };
  });

  return {
    byDistrict,
    total: all.length,
    waiting: count("RECEIVED", "PENDING_REVIEW"),
    assigned: count("ASSIGNED", "SCHEDULED"),
    inProgress: count("IN_PROGRESS"),
    completed: count("COMPLETED"),
    pendingReview: count("PENDING_REVIEW"),
    byDefectType,
  };
}
