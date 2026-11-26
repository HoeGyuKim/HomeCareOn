"use client";

import { CalendarCheck, CalendarClock, CalendarX, ExternalLink, Loader2, MessageSquareText, Plus, Send, Trash2 } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/client-api";
import type { Complaint, Contractor, VisitPeriod, VisitSlot } from "@/lib/types";
import { cn, formatDateTime } from "@/lib/utils";
import { ErrorBox, SectionTitle } from "./ui";

const PERIODS: { value: VisitPeriod; label: string; short: string }[] = [
  { value: "AM", label: "오전 (9~12시)", short: "오전 9~12시" },
  { value: "PM", label: "오후 (13~18시)", short: "오후 1~6시" },
  { value: "ALLDAY", label: "종일 (시간 협의)", short: "종일·시간 협의" },
];
const PERIOD_LABEL = Object.fromEntries(PERIODS.map((p) => [p.value, p.label])) as Record<VisitPeriod, string>;
const MAX_SLOTS = 5;

const kstToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
function addDays(ymd: string, n: number) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function slotLabel(s: VisitSlot) {
  const [, m, d] = s.date.split("-").map(Number);
  return `${m}월 ${d}일 (${"일월화수목금토"[new Date(`${s.date}T00:00:00Z`).getUTCDay()]}) ${PERIOD_LABEL[s.period]}`;
}

/**
 * 방문 일정 조율 (민원 상세 오른쪽)
 * 배정 업체와 통화로 조율한 방문 가능 일정을 입력해 거주자에게 선택 링크 문자를 보낸다.
 * 거주자가 하나를 고르면 '작업 예정'으로 확정되고, 맞는 날이 없으면 '재조율 필요'로 표시된다.
 */
export default function ScheduleOfferCard({
  complaint: c,
  contractor,
  onUpdated,
}: {
  complaint: Complaint;
  contractor: Contractor | null;
  onUpdated: (detail: unknown) => void;
}) {
  const offer = c.scheduleOffer ?? null;
  const [editing, setEditing] = useState(false);
  const [slots, setSlots] = useState<VisitSlot[]>([{ date: "", period: "AM" }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const min = addDays(kstToday(), 1);
  const max = addDays(kstToday(), 60);

  const showForm = !!contractor && c.status !== "COMPLETED" && (!offer || offer.status === "DECLINED" || editing);
  const filled = slots.filter((s) => s.date);

  const set = (i: number, patch: Partial<VisitSlot>) => setSlots(slots.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  const send = async () => {
    setBusy(true);
    setError("");
    try {
      onUpdated(await api(`/api/complaints/${c.id}/schedule-offer`, { method: "POST", json: { slots: filled } }));
      setEditing(false);
      setSlots([{ date: "", period: "AM" }]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <SectionTitle title="방문 일정 조율" action={<CalendarClock className="size-4 text-slate-400" />} />
      <div className="space-y-4 p-5">
        {!contractor && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
            업체가 배정되면, 업체와 방문 가능한 날짜를 조율한 뒤 거주자에게 일정 선택 문자를 보낼 수 있습니다.
          </p>
        )}

        {offer?.status === "SENT" && (
          <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50/60 p-3 text-sm">
            <p className="flex items-center gap-1.5 font-semibold text-blue-900"><MessageSquareText className="size-4" /> 거주자 선택 대기</p>
            <p className="text-xs text-slate-500">{formatDateTime(offer.sentAt)} 문자 발송 · {c.phone}</p>
            <ul className="space-y-1 text-xs text-slate-700">
              {offer.slots.map((s) => <li key={s.date + s.period}>· {slotLabel(s)}</li>)}
            </ul>
            <a href={offer.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline">
              거주자 화면으로 링크 열기 <ExternalLink className="size-3" />
            </a>
          </div>
        )}
        {offer?.status === "CHOSEN" && offer.chosen && (
          <div className="space-y-1 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
            <p className="flex items-center gap-1.5 font-semibold"><CalendarCheck className="size-4" /> 방문 일정 확정</p>
            <p className="font-medium">{slotLabel(offer.chosen)}</p>
            <p className="text-xs text-emerald-800">{offer.respondedAt && `${formatDateTime(offer.respondedAt)} 거주자 선택 · `}거주자·업체에 확정 문자 발송됨</p>
          </div>
        )}
        {offer?.status === "DECLINED" && (
          <div className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="flex items-center gap-1.5 font-semibold"><CalendarX className="size-4" /> 재조율 필요</p>
            <p className="text-xs">거주자가 보낸 일정 중 가능한 날짜가 없다고 응답했습니다. 업체와 다시 조율해 새 일정을 보내 주세요.</p>
          </div>
        )}

        {offer && offer.status !== "DECLINED" && !editing && contractor && c.status !== "COMPLETED" && (
          <button className="btn-secondary w-full" onClick={() => setEditing(true)}>
            <CalendarClock className="size-4" /> {offer.status === "CHOSEN" ? "일정 변경 (다시 조율)" : "다른 일정으로 다시 보내기"}
          </button>
        )}

        {showForm && (
          <div className="space-y-3">
            <p className="text-xs leading-relaxed text-slate-500">
              <b className="text-slate-700">{contractor?.name}</b>({contractor?.phone})와 조율한 방문 가능 일정을 입력하세요. 거주자가 문자 링크에서
              하나를 고르면 확정됩니다. (최대 {MAX_SLOTS}개)
            </p>
            <ul className="space-y-2">
              {slots.map((s, i) => (
                <li key={i} className="space-y-1.5 rounded-lg border border-slate-200 p-2">
                  <input type="date" className="input text-sm" min={min} max={max} value={s.date} onChange={(e) => set(i, { date: e.target.value })} aria-label={`일정 ${i + 1} 날짜`} />
                  <div className="flex gap-1.5">
                    <select className="input min-w-0 flex-1 text-sm" value={s.period} onChange={(e) => set(i, { period: e.target.value as VisitPeriod })} aria-label={`일정 ${i + 1} 시간대`}>
                      {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.short}</option>)}
                    </select>
                    <button
                      className="shrink-0 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-red-600 disabled:opacity-30"
                      onClick={() => setSlots(slots.filter((_, j) => j !== i))}
                      disabled={slots.length === 1}
                      aria-label={`일정 ${i + 1} 삭제`}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            {slots.length < MAX_SLOTS && (
              <button className="flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline" onClick={() => setSlots([...slots, { date: "", period: "AM" }])}>
                <Plus className="size-3.5" /> 일정 추가
              </button>
            )}
            {error && <ErrorBox message={error} />}
            <button className={cn("btn-primary w-full whitespace-normal")} disabled={!filled.length || busy} onClick={send}>
              {busy ? <Loader2 className="size-4 shrink-0 animate-spin" /> : <Send className="size-4 shrink-0" />}
              일정 선택 문자 보내기 {filled.length ? `(${filled.length}개)` : ""}
            </button>
            {editing && (
              <button className="w-full text-xs text-slate-500 hover:underline" onClick={() => setEditing(false)}>취소</button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
