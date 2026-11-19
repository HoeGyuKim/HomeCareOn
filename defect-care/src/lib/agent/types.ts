import type { DefectType, Urgency } from "../types";

/**
 * 비용부담 판정 결과
 * - SH_REPAIR   : SH공사(임대인) 부담 수선 → 접수
 * - MGMT_FEE    : 공용부분 일상 유지관리, 관리비(공동부담) → 접수(관리사무소 처리)
 * - SITE_CHECK  : 원인에 따라 부담이 갈려 현장 확인 후 결정 → 접수
 * - TENANT_PAY  : 입주자 부담 → 접수 불가
 * - NOT_ALLOWED : 구조 변경·신규 설치 등 허용/수선 대상 아님 → 접수 불가
 */
export type PolicyVerdict = "SH_REPAIR" | "MGMT_FEE" | "SITE_CHECK" | "TENANT_PAY" | "NOT_ALLOWED";

export const ACCEPTABLE_VERDICTS: PolicyVerdict[] = ["SH_REPAIR", "MGMT_FEE", "SITE_CHECK"];

export const VERDICT_LABEL: Record<PolicyVerdict, string> = {
  SH_REPAIR: "SH공사 부담 · 접수 가능",
  MGMT_FEE: "관리비(공동부담) · 접수 가능",
  SITE_CHECK: "현장 확인 후 결정 · 접수 가능",
  TENANT_PAY: "입주자 부담 · 접수 불가",
  NOT_ALLOWED: "허용·수선 대상 아님 · 접수 불가",
};

export interface PolicyDecision {
  verdict: PolicyVerdict;
  item: string; // 시설물 항목 (예: 화장실 수전류)
  basis: string; // 근거 (예: 별표2 1.건물전용부분 4)화장실 수전류 — 임차인부담: 파손,탈락,패킹교환)
  explanation: string; // 민원인에게 설명한 내용
}

export interface IntakeForm {
  complainantName: string;
  phone: string;
  apartmentName: string;
  building: string;
  unit: string;
  defectType: DefectType | "";
  urgency: Urgency | "";
  description: string;
}

export const EMPTY_INTAKE: IntakeForm = {
  complainantName: "",
  phone: "",
  apartmentName: "",
  building: "",
  unit: "",
  defectType: "",
  urgency: "",
  description: "",
};

export interface CallMessage {
  role: "agent" | "caller";
  text: string;
  at: string;
}

export interface SubmittedInfo {
  complaintId: string;
  receiptNo: string;
  status: string;
  contractorName: string | null;
}

/** 상담원이 지금 기다리는 답 */
export type Awaiting = "issue" | "cause" | "name" | "phone" | "apartment" | "dongho" | "confirm" | "done";

export const AWAITING_HINT: Record<Awaiting, { label: string; placeholder: string }> = {
  issue: { label: "어떤 문제인지 말씀해 주세요", placeholder: "예: 욕실 천장에서 물이 새요" },
  cause: { label: "고장 원인을 답해 주세요", placeholder: "예: 오래돼서 저절로 고장 났어요" },
  name: { label: "성함을 입력해 주세요", placeholder: "예: 홍길동" },
  phone: { label: "연락처를 입력해 주세요", placeholder: "예: 010-1234-5678" },
  apartment: { label: "단지 이름을 입력해 주세요", placeholder: "예: 한빛센트럴" },
  dongho: { label: "동·호수를 입력해 주세요", placeholder: "예: 101동 1502호" },
  confirm: { label: "읽어 드린 내용이 맞는지 답해 주세요", placeholder: "예: 네, 맞아요" },
  done: { label: "", placeholder: "" },
};

/** 화면에 내려주는 통화 상태 */
export interface CallView {
  sessionId: string;
  engine: "claude" | "scripted";
  messages: CallMessage[];
  form: IntakeForm;
  decision: PolicyDecision | null;
  submitted: SubmittedInfo | null;
  awaiting: Awaiting;
  notice?: string;
}
