// ─────────────────────────────────────────────
// 방문 일정 조율
//
// 1. 관리자가 민원 상세에서 배정 업체와 조율한 방문 가능 일정(날짜 + 오전/오후/종일)을 입력해
//    거주자에게 선택 링크(/s/{token})를 문자로 보낸다.
// 2. 거주자가 링크에서 하나를 고르면 방문 일정이 확정되고(민원 상태 '작업 예정'),
//    거주자·업체에 확정 문자를 보낸다.
// 3. 맞는 날이 없으면 거주자가 '가능한 날짜가 없어요'를 눌러 관리자에게 재조율을 요청한다.
// ─────────────────────────────────────────────
import "server-only";
import { DEFECT_LABEL } from "../constants";
import { getRepositories } from "../repositories";
import type { Complaint, ScheduleOffer, VisitPeriod, VisitSlot } from "../types";
import { getComplaintDetail, ServiceError } from "./complaint-service";
import { sendSms } from "./sms";

export const MAX_SLOTS = 5;
export const OFFER_FROM_DAYS = 1; // 내일부터
export const OFFER_TO_DAYS = 60; // 두 달 뒤까지
const LINK_TTL_DAYS = 7;

export const PERIOD_LABEL: Record<VisitPeriod, string> = {
  AM: "오전 (9~12시)",
  PM: "오후 (13~18시)",
  ALLDAY: "종일 (시간 협의)",
};

// ── 날짜 (한국 날짜 문자열 YYYY-MM-DD 로만 다룸) ──

export const todayKst = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());

export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

const WEEKDAYS = "일월화수목금토";
export function slotLabel(s: VisitSlot): string {
  const [, m, d] = s.date.split("-").map(Number);
  const w = WEEKDAYS[new Date(`${s.date}T00:00:00Z`).getUTCDay()];
  return `${m}월 ${d}일 (${w}) ${PERIOD_LABEL[s.period]}`;
}

const sameSlot = (a: VisitSlot, b: VisitSlot) => a.date === b.date && a.period === b.period;

function newToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(9))).toString("base64url"); // 12자
}

const maskName = (n: string) => (n.length <= 2 ? n[0] + "*" : n[0] + "*".repeat(n.length - 2) + n.at(-1));

/** 민원 내용에서 시설물 이름 (대화 엔진이 '[화장실 > 세면기 > 배수트랩,배수관] …' 형식으로 넣음) */
function facilityOf(c: Complaint): string {
  const m = c.description.match(/^\[([^\]]+)\]/);
  return m ? m[1].split(" > ").at(-1)!.trim() : DEFECT_LABEL[c.defectType];
}

function history(c: Complaint, note: string, actor: "ADMIN" | "SYSTEM", status = c.status) {
  return [...c.history, { at: new Date().toISOString(), status, note, actor }];
}

// ── 1. 관리자: 방문 가능 일정 문자 발송 ──

export async function sendScheduleOffer(id: string, rawSlots: unknown, baseUrl: string) {
  const { complaints, contractors } = getRepositories();
  const c = await complaints.get(id);
  if (!c) throw new ServiceError("민원을 찾을 수 없습니다.", 404);
  if (c.status === "COMPLETED") throw new ServiceError("처리 완료된 민원입니다.");
  if (!c.contractorId) throw new ServiceError("업체를 먼저 배정한 뒤, 업체와 조율한 일정을 보내 주세요.");

  if (!Array.isArray(rawSlots) || rawSlots.length === 0) throw new ServiceError("방문 가능 일정을 1개 이상 입력하세요.");
  if (rawSlots.length > MAX_SLOTS) throw new ServiceError(`방문 가능 일정은 최대 ${MAX_SLOTS}개까지 보낼 수 있습니다.`);
  const from = addDays(todayKst(), OFFER_FROM_DAYS);
  const to = addDays(todayKst(), OFFER_TO_DAYS);
  const slots: VisitSlot[] = [];
  for (const raw of rawSlots as Partial<VisitSlot>[]) {
    const date = String(raw?.date ?? "");
    const period = raw?.period as VisitPeriod;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < from || date > to)
      throw new ServiceError(`${date || "(빈 날짜)"}: 내일(${from})부터 ${to} 사이 날짜만 보낼 수 있습니다.`);
    if (!(period in PERIOD_LABEL)) throw new ServiceError(`${date}: 시간대를 선택하세요.`);
    if (slots.some((s) => sameSlot(s, { date, period }))) throw new ServiceError(`${slotLabel({ date, period })}: 같은 일정이 중복되었습니다.`);
    slots.push({ date, period });
  }
  slots.sort((a, b) => (a.date + a.period).localeCompare(b.date + b.period));

  const token = newToken();
  const link = `${baseUrl.replace(/\/$/, "")}/s/${token}`;
  const smsText = [
    `[SH 시설물 접수] ${c.receiptNo}`,
    `${c.apartmentName} ${c.building}동 ${c.unit}호 ${facilityOf(c)} 방문 점검 가능 일정입니다.`,
    `아래 링크에서 편하신 일정을 하나 골라 주시면 방문 일정이 확정됩니다.`,
    link,
  ].join("\n");
  const now = new Date();
  const offer: ScheduleOffer = {
    token,
    slots,
    status: "SENT",
    chosen: null,
    sentAt: now.toISOString(),
    respondedAt: null,
    expiresAt: new Date(now.getTime() + LINK_TTL_DAYS * 86_400_000).toISOString(),
    link,
    smsText,
  };
  await sendSms(c.phone, smsText);
  const contractor = await contractors.get(c.contractorId);
  await complaints.update(id, {
    scheduleOffer: offer, // 새로 보내면 이전 링크는 무효
    updatedAt: offer.sentAt,
    history: history(
      c,
      `방문 가능 일정 ${slots.length}개 문자 발송 (${contractor?.name ?? "배정 업체"}와 조율): ${slots.map(slotLabel).join(", ")}`,
      "ADMIN",
    ),
  });
  return getComplaintDetail(id);
}

// ── 2·3. 거주자: 링크에서 선택 / 가능한 날 없음 ──

async function findByToken(token: string): Promise<Complaint> {
  const all = await getRepositories().complaints.list();
  const c = all.find((x) => x.scheduleOffer?.token === token);
  if (!c?.scheduleOffer) throw new ServiceError("링크가 올바르지 않거나 새 일정이 다시 발송되었습니다. 가장 최근에 받은 문자를 확인해 주세요.", 404);
  return c;
}

function expired(o: ScheduleOffer) {
  return o.status === "SENT" && Date.parse(o.expiresAt) < Date.now();
}

/** 거주자 화면에 보여 줄 내용 (이름 일부 가림) */
export async function getPublicSchedule(token: string) {
  const c = await findByToken(token);
  const o = c.scheduleOffer!;
  const contractor = c.contractorId ? await getRepositories().contractors.get(c.contractorId) : null;
  return {
    status: expired(o) ? ("EXPIRED" as const) : o.status,
    receiptNo: c.receiptNo,
    apartmentName: c.apartmentName,
    building: c.building,
    unit: c.unit,
    complainantName: maskName(c.complainantName),
    facility: facilityOf(c),
    contractorName: contractor?.name ?? null,
    slots: o.slots.map((s) => ({ ...s, label: slotLabel(s) })),
    chosen: o.chosen ? { ...o.chosen, label: slotLabel(o.chosen) } : null,
  };
}

async function respondable(token: string) {
  const c = await findByToken(token);
  const o = c.scheduleOffer!;
  if (expired(o)) throw new ServiceError("링크 유효기간(7일)이 지났습니다. 접수센터로 연락해 주세요.", 410);
  if (o.status === "CHOSEN") throw new ServiceError(`이미 방문 일정이 확정되었습니다: ${slotLabel(o.chosen!)}`, 409);
  if (o.status === "DECLINED") throw new ServiceError("이미 '가능한 날짜 없음'으로 응답하셨습니다. 담당 직원이 다시 연락드립니다.", 409);
  return { c, o };
}

export async function chooseSlot(token: string, index: unknown) {
  const { c, o } = await respondable(token);
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i >= o.slots.length) throw new ServiceError("방문 일정을 하나 골라 주세요.");
  const slot = o.slots[i];
  const { complaints, contractors } = getRepositories();
  const contractor = c.contractorId ? await contractors.get(c.contractorId) : null;
  const ts = new Date().toISOString();

  await complaints.update(c.id, {
    scheduleOffer: { ...o, status: "CHOSEN", chosen: slot, respondedAt: ts },
    status: "SCHEDULED",
    updatedAt: ts,
    history: history(c, `거주자 방문 일정 선택 → 확정: ${slotLabel(slot)} (문자 링크)`, "SYSTEM", "SCHEDULED"),
  });
  await sendSms(
    c.phone,
    `[SH 시설물 접수] ${c.receiptNo}\n방문 일정이 확정되었습니다: ${slotLabel(slot)}` +
      (contractor ? `\n방문 업체: ${contractor.name} (${contractor.phone})` : ""),
  );
  if (contractor) {
    await sendSms(
      contractor.phone,
      `[방문 일정 확정] ${c.receiptNo}\n${slotLabel(slot)}\n${c.apartmentName} ${c.building}동 ${c.unit}호 · ${c.complainantName} ${c.phone}\n${c.description}`,
    );
  }
  return getPublicSchedule(token);
}

export async function declineSlots(token: string) {
  const { c, o } = await respondable(token);
  const ts = new Date().toISOString();
  await getRepositories().complaints.update(c.id, {
    scheduleOffer: { ...o, status: "DECLINED", respondedAt: ts },
    updatedAt: ts,
    history: history(c, "거주자: 보낸 일정 중 가능한 날짜 없음 → 업체와 재조율 필요", "SYSTEM"),
  });
  return getPublicSchedule(token);
}
