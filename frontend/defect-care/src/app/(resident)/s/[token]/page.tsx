"use client";

import { CalendarCheck, CalendarX, ChevronLeft, ChevronRight, CircleCheck, House, Loader2, Wrench } from "lucide-react";
import { useParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/client-api";
import { cn } from "@/lib/utils";

type Period = "AM" | "PM" | "ALLDAY";
interface Slot {
  date: string;
  period: Period;
  label: string;
}

/** GET /api/schedule/[token] 응답 (schedule-service.getPublicSchedule) */
interface ScheduleView {
  status: "SENT" | "CHOSEN" | "DECLINED" | "EXPIRED";
  receiptNo: string;
  apartmentName: string;
  building: string;
  unit: string;
  complainantName: string;
  facility: string;
  contractorName: string | null;
  slots: Slot[];
  chosen: Slot | null;
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const PERIOD_SHORT: Record<Period, string> = { AM: "오전 9~12시", PM: "오후 1~6시", ALLDAY: "종일 (시간 협의)" };
const ymd = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
const weekday = (s: string) => new Date(`${s}T00:00:00Z`).getUTCDay();
function dateLabel(s: string) {
  const [, m, d] = s.split("-").map(Number);
  return `${m}월 ${d}일 (${WEEKDAYS[weekday(s)]})`;
}
function monthCells(year: number, month: number): (string | null)[] {
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => ymd(year, month, i + 1))];
}

/**
 * 거주자 방문 일정 선택 (문자 링크로 여는 화면)
 * 담당 직원이 업체와 조율해 보낸 일정 중 하나를 고르면 방문 일정이 확정된다.
 * useParams 는 Suspense 안에서 써야 한다 (Cache Components)
 */
export default function SchedulePickPage() {
  return (
    <Suspense fallback={<Shell><Loading /></Shell>}>
      <SchedulePick />
    </Suspense>
  );
}

function Loading() {
  return (
    <p className="flex items-center justify-center gap-2 py-24 text-sm text-slate-500">
      <Loader2 className="size-4 animate-spin" /> 불러오는 중…
    </p>
  );
}

function SchedulePick() {
  const { token } = useParams<{ token: string }>();
  const [view, setView] = useState<ScheduleView | null>(null);
  const [error, setError] = useState("");
  const [day, setDay] = useState<string | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [cursor, setCursor] = useState<{ y: number; m: number } | null>(null);
  const [sending, setSending] = useState<"" | "choose" | "decline">("");
  const [confirmDecline, setConfirmDecline] = useState(false);

  useEffect(() => {
    api<ScheduleView>(`/api/schedule/${token}`)
      .then((v) => {
        setView(v);
        if (v.slots.length) {
          const [y, m] = v.slots[0].date.split("-").map(Number);
          setCursor({ y, m: m - 1 });
          setDay(v.slots[0].date);
        }
      })
      .catch((e: Error) => setError(e.message));
  }, [token]);

  const offeredDates = useMemo(() => new Set(view?.slots.map((s) => s.date)), [view]);
  const cells = useMemo(() => (cursor ? monthCells(cursor.y, cursor.m) : []), [cursor]);

  if (error && !view) return <Shell><Notice tone="error" title="링크를 열 수 없습니다" body={error} /></Shell>;
  if (!view || !cursor) return <Shell><Loading /></Shell>;

  if (view.status === "CHOSEN" && view.chosen) {
    return (
      <Shell>
        <Summary view={view} />
        <section className="card space-y-3 p-5 text-center">
          <CircleCheck className="mx-auto size-10 text-emerald-600" />
          <p className="text-lg font-bold text-slate-900">방문 일정이 확정되었습니다</p>
          <p className="rounded-xl bg-slate-50 p-3 text-base font-semibold text-slate-800">{view.chosen.label}</p>
          <p className="text-sm leading-relaxed text-slate-600">
            {view.contractorName ? `${view.contractorName} 기사님이 방문합니다. ` : ""}확정 내용은 문자로도 보내드렸어요.
          </p>
        </section>
      </Shell>
    );
  }
  if (view.status === "DECLINED") {
    return (
      <Shell>
        <Summary view={view} />
        <Notice title="다시 연락드리겠습니다" body="보내드린 일정이 맞지 않는다고 전달했습니다. 담당 직원이 업체와 다시 조율해 새 일정을 문자로 보내드릴게요." />
      </Shell>
    );
  }
  if (view.status === "EXPIRED") {
    return <Shell><Summary view={view} /><Notice tone="error" title="링크 유효기간이 지났습니다" body="접수센터로 연락해 주시면 새 일정을 보내드립니다." /></Shell>;
  }

  const months = [...new Set(view.slots.map((s) => s.date.slice(0, 7)))].sort();
  const curYm = `${cursor.y}-${String(cursor.m + 1).padStart(2, "0")}`;
  const move = (delta: number) => {
    const t = new Date(Date.UTC(cursor.y, cursor.m + delta, 1));
    setCursor({ y: t.getUTCFullYear(), m: t.getUTCMonth() });
  };
  const daySlots = view.slots.map((s, i) => ({ ...s, i })).filter((s) => s.date === day);

  const respond = async (action: "choose" | "decline") => {
    setSending(action);
    setError("");
    try {
      setView(await api<ScheduleView>(`/api/schedule/${token}`, { method: "POST", json: action === "choose" ? { action, index: picked } : { action } }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending("");
    }
  };

  return (
    <Shell>
      <Summary view={view} />

      <section className="space-y-1 px-1">
        <h1 className="text-lg font-bold text-slate-900">방문 일정을 골라 주세요</h1>
        <p className="text-sm leading-relaxed text-slate-600">
          담당 직원이 업체와 조율한 방문 가능 날짜입니다. 파란 날짜를 누르고 시간을 하나 고르시면 방문 일정이 확정됩니다.
        </p>
      </section>

      <section className="card p-3" aria-label="달력">
        <div className="mb-2 flex items-center justify-between px-1">
          <button onClick={() => move(-1)} disabled={curYm <= months[0]} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 disabled:opacity-30" aria-label="이전 달">
            <ChevronLeft className="size-5" />
          </button>
          <p className="text-base font-semibold text-slate-900">{cursor.y}년 {cursor.m + 1}월</p>
          <button onClick={() => move(1)} disabled={curYm >= months.at(-1)!} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 disabled:opacity-30" aria-label="다음 달">
            <ChevronRight className="size-5" />
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center">
          {WEEKDAYS.map((w, i) => (
            <span key={w} className={cn("py-1 text-xs font-medium", i === 0 ? "text-red-400" : i === 6 ? "text-blue-500" : "text-slate-400")}>{w}</span>
          ))}
          {cells.map((d, i) =>
            d === null ? (
              <span key={`e${i}`} />
            ) : (
              <button
                key={d}
                onClick={() => { setDay(d); setPicked(null); }}
                disabled={!offeredDates.has(d)}
                aria-pressed={day === d}
                aria-label={dateLabel(d)}
                className={cn(
                  "flex aspect-square min-h-11 items-center justify-center rounded-xl text-sm font-medium",
                  day === d
                    ? "bg-blue-600 text-white shadow-sm"
                    : offeredDates.has(d)
                      ? "border border-blue-300 bg-blue-50 text-blue-800 hover:bg-blue-100"
                      : "text-slate-300",
                )}
              >
                {Number(d.slice(8))}
              </button>
            ),
          )}
        </div>
      </section>

      {day && (
        <section className="space-y-2 px-1" aria-label="시간 선택">
          <p className="text-sm font-semibold text-slate-800">{dateLabel(day)} 방문 시간</p>
          <div className="space-y-2">
            {daySlots.map((s) => (
              <label
                key={s.i}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-xl border bg-white p-3.5 text-sm",
                  picked === s.i ? "border-blue-600 ring-2 ring-blue-600/20" : "border-slate-200",
                )}
              >
                <input type="radio" name="slot" className="size-4 accent-blue-600" checked={picked === s.i} onChange={() => setPicked(s.i)} />
                <span className="font-medium text-slate-900">{PERIOD_SHORT[s.period]}</span>
              </label>
            ))}
          </div>
        </section>
      )}

      {error && <p className="px-1 text-sm text-red-600">{error}</p>}

      <div className="sticky bottom-0 -mx-4 space-y-2 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
        <button onClick={() => respond("choose")} disabled={picked === null || !!sending} className="btn-primary w-full py-3 text-base">
          {sending === "choose" ? <Loader2 className="size-4 animate-spin" /> : <CalendarCheck className="size-4" />}
          {picked === null ? "날짜와 시간을 골라 주세요" : `${view.slots[picked].label}로 확정하기`}
        </button>
        {confirmDecline ? (
          <div className="flex gap-2">
            <button onClick={() => respond("decline")} disabled={!!sending} className="btn-secondary flex-1 text-sm">
              {sending === "decline" ? <Loader2 className="size-4 animate-spin" /> : <CalendarX className="size-4" />} 네, 다시 조율해 주세요
            </button>
            <button onClick={() => setConfirmDecline(false)} className="btn-secondary text-sm">취소</button>
          </div>
        ) : (
          <button onClick={() => setConfirmDecline(true)} className="w-full py-1 text-sm text-slate-500 hover:underline">
            가능한 날짜가 없어요
          </button>
        )}
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col gap-4 px-4 pt-5 pb-0">
      <header className="flex items-center gap-2 px-1">
        <span className="flex size-8 items-center justify-center rounded-lg bg-blue-600"><House className="size-4 text-white" /></span>
        <p className="text-sm font-semibold text-slate-900">SH 시설물 접수센터</p>
      </header>
      {children}
    </div>
  );
}

function Summary({ view }: { view: ScheduleView }) {
  return (
    <section className="card space-y-1.5 p-4 text-sm">
      <p className="flex items-center gap-1.5 font-semibold text-slate-900">
        <Wrench className="size-4 text-blue-600" /> {view.facility} 방문 점검
      </p>
      <p className="text-slate-600">
        {view.apartmentName} {view.building}동 {view.unit}호 · {view.complainantName} 님
      </p>
      <p className="text-xs text-slate-400">접수번호 {view.receiptNo}{view.contractorName ? ` · 방문 업체 ${view.contractorName}` : ""}</p>
    </section>
  );
}

function Notice({ tone, title, body }: { tone?: "error"; title: string; body: string }) {
  return (
    <section className={cn("card space-y-2 p-5 text-center", tone === "error" && "border-red-200")}>
      <p className="text-base font-semibold text-slate-900">{title}</p>
      <p className="text-sm leading-relaxed text-slate-600">{body}</p>
    </section>
  );
}
