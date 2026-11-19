// ─────────────────────────────────────────────
// 도메인 타입 정의
// Supabase 테이블 구조(supabase/schema.sql)와 1:1로 대응합니다.
// ─────────────────────────────────────────────

/** 하자 유형 코드 */
export type DefectType =
  | "LEAK_PIPE" // 누수 및 배관
  | "ELECTRIC" // 전기 및 조명
  | "DOOR_WINDOW" // 도어 및 창호
  | "HVAC" // 난방 및 냉방
  | "WALL_FLOOR" // 벽체 및 바닥
  | "COMMON" // 공용시설
  | "ETC"; // 기타

/** 처리 상태: 접수 → 업체 배정 → 작업 예정 → 작업 중 → 처리 완료 (+ 관리자 확인 대기) */
export type ComplaintStatus =
  | "RECEIVED" // 접수
  | "PENDING_REVIEW" // 관리자 확인 대기 (자동 배정 실패)
  | "ASSIGNED" // 업체 배정
  | "SCHEDULED" // 작업 예정
  | "IN_PROGRESS" // 작업 중
  | "COMPLETED"; // 처리 완료

/** 긴급도 */
export type Urgency = "EMERGENCY" | "HIGH" | "NORMAL" | "LOW";

/** 접수 경로 */
export type ComplaintChannel = "PHONE_AI" | "MANUAL";

export interface Apartment {
  id: string;
  name: string;
  region: string; // 예: "서울 강남구"
  address: string;
}

export interface Contractor {
  id: string;
  name: string;
  defectTypes: DefectType[];
  regions: string[];
  phone: string;
  email: string;
  isContracted: boolean; // 계약 여부
  isAvailable: boolean; // 업무 가능 여부
  createdAt: string;
}

export interface ComplaintHistory {
  at: string; // ISO
  status: ComplaintStatus;
  note: string;
  actor: "SYSTEM" | "AI" | "ADMIN";
}

export interface Complaint {
  id: string;
  receiptNo: string; // 접수번호
  receivedAt: string; // 접수 일시 (ISO)
  complainantName: string;
  phone: string;
  apartmentName: string;
  region: string;
  building: string; // 동
  unit: string; // 호
  defectType: DefectType;
  description: string; // 상세 민원 내용
  urgency: Urgency;
  photos: string[]; // 이미지 URL (현재는 data URL, 추후 Supabase Storage URL)
  contractorId: string | null;
  status: ComplaintStatus;
  channel: ComplaintChannel;
  callTranscript?: string | null;
  aiSummary?: string | null;
  history: ComplaintHistory[];
  updatedAt: string;
}

/** 민원 생성 입력값 */
export interface ComplaintInput {
  complainantName: string;
  phone: string;
  apartmentName: string;
  region?: string;
  building: string;
  unit: string;
  defectType: DefectType;
  description: string;
  urgency: Urgency;
  photos?: string[];
  channel?: ComplaintChannel;
  callTranscript?: string | null;
  aiSummary?: string | null;
}

export interface ComplaintFilter {
  q?: string;
  status?: ComplaintStatus | "ALL";
  defectType?: DefectType | "ALL";
  urgency?: Urgency | "ALL";
  district?: string | "ALL"; // 자치구 (예: "강남구")
}

/** 자치구별 처리 현황 */
export interface DistrictStat {
  district: string;
  total: number;
  completed: number;
  inProgress: number; // 업체 배정 ~ 작업 중
  waiting: number; // 접수 + 관리자 확인 대기
  rate: number | null; // 처리 완료율 0~1 (접수 0건이면 null)
}

export interface DashboardStats {
  total: number;
  waiting: number; // 접수 대기 (접수 + 관리자 확인 대기)
  assigned: number; // 업체 배정 (배정 + 작업 예정)
  inProgress: number; // 작업 진행 중
  completed: number; // 처리 완료
  pendingReview: number;
  byDefectType: Record<DefectType, number>;
  byDistrict: DistrictStat[]; // 서울 25개 구 전체 (접수 없는 구 포함)
}

/** 통화 분석 결과 */
export interface CallAnalysis {
  complainantName: string;
  phone: string;
  apartmentName: string;
  building: string;
  unit: string;
  defectType: DefectType;
  urgency: Urgency;
  description: string;
  summary: string;
  confidence: number; // 0~1
  missingFields: string[];
  engine: "rule-based" | "claude";
}

/** 자동 배정 결과 */
export interface AssignmentResult {
  contractor: Contractor | null;
  reason: string;
  candidates: Contractor[]; // 조건 일치 계약 업체
  suggestions: Contractor[]; // 미계약/업무불가지만 분야·지역 일치 (관리자 참고용)
}
