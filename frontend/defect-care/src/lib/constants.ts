import type { ComplaintStatus, DefectType, Urgency } from "./types";

export const DEFECT_TYPES: { value: DefectType; label: string }[] = [
  { value: "LEAK_PIPE", label: "누수 및 배관" },
  { value: "ELECTRIC", label: "전기 및 조명" },
  { value: "DOOR_WINDOW", label: "도어 및 창호" },
  { value: "HVAC", label: "난방 및 냉방" },
  { value: "WALL_FLOOR", label: "벽체 및 바닥" },
  { value: "COMMON", label: "공용시설" },
  { value: "ETC", label: "기타" },
];

export const DEFECT_LABEL: Record<DefectType, string> = Object.fromEntries(
  DEFECT_TYPES.map((d) => [d.value, d.label]),
) as Record<DefectType, string>;

/** 진행 단계 순서 (관리자 확인 대기는 '접수' 단계의 분기) */
export const STATUS_FLOW: ComplaintStatus[] = [
  "RECEIVED",
  "ASSIGNED",
  "SCHEDULED",
  "IN_PROGRESS",
  "COMPLETED",
];

export const STATUSES: { value: ComplaintStatus; label: string }[] = [
  { value: "RECEIVED", label: "접수" },
  { value: "PENDING_REVIEW", label: "관리자 확인 대기" },
  { value: "ASSIGNED", label: "업체 배정" },
  { value: "SCHEDULED", label: "작업 예정" },
  { value: "IN_PROGRESS", label: "작업 중" },
  { value: "COMPLETED", label: "처리 완료" },
];

export const STATUS_LABEL: Record<ComplaintStatus, string> = Object.fromEntries(
  STATUSES.map((s) => [s.value, s.label]),
) as Record<ComplaintStatus, string>;

export const STATUS_STYLE: Record<ComplaintStatus, string> = {
  RECEIVED: "bg-slate-100 text-slate-700 ring-slate-200",
  PENDING_REVIEW: "bg-amber-50 text-amber-700 ring-amber-200",
  ASSIGNED: "bg-blue-50 text-blue-700 ring-blue-200",
  SCHEDULED: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  IN_PROGRESS: "bg-violet-50 text-violet-700 ring-violet-200",
  COMPLETED: "bg-emerald-50 text-emerald-700 ring-emerald-200",
};

export const URGENCIES: { value: Urgency; label: string }[] = [
  { value: "EMERGENCY", label: "긴급" },
  { value: "HIGH", label: "높음" },
  { value: "NORMAL", label: "보통" },
  { value: "LOW", label: "낮음" },
];

export const URGENCY_LABEL: Record<Urgency, string> = Object.fromEntries(
  URGENCIES.map((u) => [u.value, u.label]),
) as Record<Urgency, string>;

export const URGENCY_STYLE: Record<Urgency, string> = {
  EMERGENCY: "bg-red-600 text-white ring-red-600",
  HIGH: "bg-orange-50 text-orange-700 ring-orange-200",
  NORMAL: "bg-slate-50 text-slate-600 ring-slate-200",
  LOW: "bg-white text-slate-500 ring-slate-200",
};

export const URGENCY_RANK: Record<Urgency, number> = {
  EMERGENCY: 0,
  HIGH: 1,
  NORMAL: 2,
  LOW: 3,
};
