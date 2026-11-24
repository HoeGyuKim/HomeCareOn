// ─────────────────────────────────────────────
// 접수 대기 → 희망일 선택 → 접수 완료
//
// 1. AI 상담에서 거주자가 방문 접수에 동의하면, 대화 엔진이 POST /api/intakes 로 접수 내용을 보낸다.
// 2. 여기서 접수 대기를 만들고 거주자에게 희망일 선택 링크(/s/{token})를 문자로 보낸다.
// 3. 거주자가 링크에서 방문 희망일을 1~3개 고르면 그때 민원으로 접수하고 업체를 자동 배정한다.
//
// 접수 대기는 서버 메모리에만 있으므로 서버를 재시작하면 사라진다 (운영 시 DB 테이블로 옮길 것).
// ─────────────────────────────────────────────
import "server-only";
import type { ComplaintInput } from "../types";
import { createComplaint, normalizeAndValidate, ServiceError } from "./complaint-service";
import { sendSms } from "./sms";

export const MAX_PICKS = 3;
export const PICK_FROM_DAYS = 1; // 내일부터
export const PICK_TO_DAYS = 21; // 3주 뒤까지
export const CLOSED_WEEKDAYS = [0]; // 일요일은 방문 불가
const LINK_TTL_DAYS = 7;

export interface PendingIntake {
  token: string;
  createdAt: string;
  expiresAt: string;
  input: ComplaintInput;
  facility: string;
  link: string;
  smsText: string;
  status: "WAITING" | "DONE";
  result?: { complaintId: string; receiptNo: string; preferredDates: string[] };
}

const g = globalThis as unknown as { __pendingIntakes?: Map<string, PendingIntake> };
const store = (g.__pendingIntakes ??= new Map());

// ── 날짜 (한국 시간 기준, YYYY-MM-DD 문자열로 다룸) ──

export function todayKst(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}

export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export const weekdayOf = (ymd: string) => new Date(`${ymd}T00:00:00Z`).getUTCDay();

export function selectableRange() {
  const today = todayKst();
  return { from: addDays(today, PICK_FROM_DAYS), to: addDays(today, PICK_TO_DAYS) };
}

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return Buffer.from(bytes).toString("base64url"); // 12자
}

const maskName = (n: string) => (n.length <= 1 ? n : n[0] + "*".repeat(n.length - 2) + (n.length > 2 ? n.at(-1) : "*"));

// ── 1·2단계: 접수 대기 생성 + 문자 발송 ──

export async function createPendingIntake(raw: ComplaintInput, opts: { baseUrl: string; facility?: string }) {
  const input = normalizeAndValidate({ ...raw, channel: "PHONE_AI" }); // 형식 오류는 지금 바로 알림
  const token = newToken();
  const link = `${opts.baseUrl.replace(/\/$/, "")}/s/${token}`;
  const facility = opts.facility?.trim() || "시설물";
  const smsText = [
    `[SH 시설물 접수] ${input.apartmentName} ${input.building}동 ${input.unit}호`,
    `${facility} 방문 점검을 위해 방문 희망 날짜를 최대 ${MAX_PICKS}개까지 골라 주세요.`,
    `날짜를 선택하시면 접수가 완료됩니다.`,
    link,
  ].join("\n");

  const now = new Date();
  const pending: PendingIntake = {
    token,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + LINK_TTL_DAYS * 86_400_000).toISOString(),
    input,
    facility,
    link,
    smsText,
    status: "WAITING",
  };
  store.set(token, pending);
  await sendSms(input.phone, smsText);
  return { token, link, smsText, to: input.phone };
}

export function getPendingIntake(token: string): PendingIntake {
  const p = store.get(token);
  if (!p) throw new ServiceError("링크가 올바르지 않거나 만료되었습니다. 접수센터로 다시 연락해 주세요.", 404);
  if (p.status === "WAITING" && Date.parse(p.expiresAt) < Date.now()) {
    store.delete(token);
    throw new ServiceError("링크 유효기간(7일)이 지났습니다. 접수센터로 다시 연락해 주세요.", 410);
  }
  return p;
}

/** 거주자 화면에 보여 줄 내용 (개인정보는 가려서) */
export function publicView(p: PendingIntake) {
  return {
    status: p.status,
    apartmentName: p.input.apartmentName,
    building: p.input.building,
    unit: p.input.unit,
    complainantName: maskName(p.input.complainantName),
    facility: p.facility,
    ...selectableRange(),
    maxPicks: MAX_PICKS,
    closedWeekdays: CLOSED_WEEKDAYS,
    result: p.result ? { receiptNo: p.result.receiptNo, preferredDates: p.result.preferredDates } : null,
  };
}

// ── 3단계: 희망일 선택 → 민원 접수 ──

export async function completePendingIntake(token: string, rawDates: unknown) {
  const p = getPendingIntake(token);
  if (p.status === "DONE") throw new ServiceError(`이미 접수되었습니다. 접수번호 ${p.result?.receiptNo}`, 409);

  if (!Array.isArray(rawDates)) throw new ServiceError("희망 날짜를 골라 주세요.");
  const dates = [...new Set(rawDates.map(String))].sort();
  if (dates.length < 1) throw new ServiceError("희망 날짜를 1개 이상 골라 주세요.");
  if (dates.length > MAX_PICKS) throw new ServiceError(`희망 날짜는 최대 ${MAX_PICKS}개까지 고를 수 있습니다.`);
  const { from, to } = selectableRange();
  for (const d of dates) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d < from || d > to)
      throw new ServiceError(`${d}: 선택할 수 없는 날짜입니다. (${from} ~ ${to})`);
    if (CLOSED_WEEKDAYS.includes(weekdayOf(d))) throw new ServiceError(`${d}: 일요일은 방문할 수 없습니다.`);
  }

  // 같은 링크로 두 번 눌러도 한 번만 접수되도록 먼저 상태를 바꾼다
  p.status = "DONE";
  try {
    const { complaint } = await createComplaint({ ...p.input, preferredDates: dates });
    p.result = { complaintId: complaint.id, receiptNo: complaint.receiptNo, preferredDates: dates };
    return p.result;
  } catch (e) {
    p.status = "WAITING";
    throw e;
  }
}
