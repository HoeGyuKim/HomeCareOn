"use client";

import { CalendarCheck, CalendarDays, Check, ChevronLeft, ChevronRight, CircleCheck, House, Loader2, Wrench, X } from "lucide-react";
import { useParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/client-api";
import { cn } from "@/lib/utils";

/** GET /api/intakes/[token] 응답 (intake-service.publicView) */
interface IntakeView {
  status: "WAITING" | "DONE";
  apartmentName: string;
  building: string;
  unit: string;
  complainantName: string;
  facility: string;
  from: string;
  to: string;
  maxPicks: number;
  closedWeekdays: number[];
  result: { receiptNo: string; preferredDates: string[] } | null;
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

// 날짜는 한국 날짜 문자열(YYYY-MM-DD)로만 다뤄 시간대 차이를 피한다
const ymd = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
const weekday = (s: string) => new Date(`${s}T00:00:00Z`).getUTCDay();
function label(s: string) {
  const [, m, d] = s.split("-").map(Number);
  return `${m}월 ${d}일 (${WEEKDAYS[weekday(s)]})`;
}

/** 해당 월의 달력 칸 (앞쪽 빈칸은 null) */
function monthCells(year: number, month: number): (string | null)[] {
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => ymd(year, month, i + 1))];
}

/**
 * 거주자 방문 희망일 선택 (문자 링크로 여는 화면)
 * 날짜를 1~3개 고르고 '접수하기'를 누르면 민원이 접수된다.
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
  const [view, setView] = useState<IntakeView | null>(null);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [sending, setSending] = useState(false);
  const [cursor, setCursor] = useState<{ y: number; m: number } | null>(null);

  useEffect(() => {
    api<IntakeView>(`/api/intakes/${token}`)
      .then((v) => {
        setView(v);
        const [y, m] = v.from.split("-").map(Number);
        setCursor({ y, m: m - 1 });
      })
      .catch((e: Error) => setError(e.message));
  }, [token]);

  const cells = useMemo(() => (cursor ? monthCells(cursor.y, cursor.m) : []), [cursor]);

  if (error && !view) return <Shell><Message tone="error" title="링크를 열 수 없습니다" body={error} /></Shell>;
  if (!view || !cursor) return <Shell><Loading /></Shell>;

  if (view.status === "DONE" && view.result) {
    return (
      <Shell>
        <Summary view={view} />
        <Done receiptNo={view.result.receiptNo} dates={view.result.preferredDates} />
      </Shell>
    );
  }

  const fromYm = view.from.slice(0, 7);
  const toYm = view.to.slice(0, 7);
  const curYm = `${cursor.y}-${String(cursor.m + 1).padStart(2, "0")}`;
  const selectable = (d: string) => d >= view.from && d <= view.to && !view.closedWeekdays.includes(weekday(d));
  const full = picked.length >= view.maxPicks;

  const toggle = (d: string) => {
    setNotice("");
    if (picked.includes(d)) return setPicked(picked.filter((p) => p !== d));
    if (full) return setNotice(`최대 ${view.maxPicks}개까지 고를 수 있어요. 다른 날짜를 빼고 골라 주세요.`);
    setPicked([...picked, d].sort());
  };
  const move = (delta: number) => {
    const t = new Date(Date.UTC(cursor.y, cursor.m + delta, 1));
    setCursor({ y: t.getUTCFullYear(), m: t.getUTCMonth() });
  };

  const submit = async () => {
    if (!picked.length || sending) return;
    setSending(true);
    setError("");
    try {
      const r = await api<{ receiptNo: string; preferredDates: string[] }>(`/api/intakes/${token}/schedule`, {
        method: "POST",
        json: { dates: picked },
      });
      setView({ ...view, status: "DONE", result: r });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <Shell>
      <Summary view={view} />

      <section className="space-y-1 px-1">
        <h1 className="text-lg font-bold text-slate-900">방문 희망 날짜를 골라 주세요</h1>
        <p className="text-sm leading-relaxed text-slate-600">
          편하신 날짜를 <b>최대 {view.maxPicks}개</b>까지 눌러 주세요. 담당 직원이 그중 하루로 방문 일정을 확정해 문자로 다시
          알려 드립니다. 일요일은 방문하지 않아요.
        </p>
      </section>

      <section className="card p-3" aria-label="달력">
        <div className="mb-2 flex items-center justify-between px-1">
          <button onClick={() => move(-1)} disabled={curYm <= fromYm} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 disabled:opacity-30" aria-label="이전 달">
            <ChevronLeft className="size-5" />
          </button>
          <p className="text-base font-semibold text-slate-900">{cursor.y}년 {cursor.m + 1}월</p>
          <button onClick={() => move(1)} disabled={curYm >= toYm} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 disabled:opacity-30" aria-label="다음 달">
            <ChevronRight className="size-5" />
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center">
          {WEEKDAYS.map((w, i) => (
            <span key={w} className={cn("py-1 text-xs font-medium", i === 0 ? "text-red-400" : i === 6 ? "text-blue-500" : "text-slate-400")}>
              {w}
            </span>
          ))}
          {cells.map((d, i) =>
            d === null ? (
              <span key={`e${i}`} />
            ) : (
              <button
                key={d}
                onClick={() => toggle(d)}
                disabled={!selectable(d)}
                aria-pressed={picked.includes(d)}
                aria-label={label(d)}
                className={cn(
                  "relative flex aspect-square min-h-11 items-center justify-center rounded-xl text-sm font-medium transition-colors",
                  picked.includes(d)
                    ? "bg-blue-600 text-white shadow-sm"
                    : selectable(d)
                      ? "bg-white text-slate-800 hover:bg-blue-50 border border-slate-200"
                      : "text-slate-300",
                  !picked.includes(d) && selectable(d) && full && "opacity-50",
                )}
              >
                {Number(d.slice(8))}
                {picked.includes(d) && <Check className="absolute top-1 right-1 size-3" />}
              </button>
            ),
          )}
        </div>
      </section>

      <section className="space-y-2 px-1">
        <p className="text-xs font-medium text-slate-500">
          선택한 날짜 {picked.length}/{view.maxPicks}
        </p>
        {picked.length ? (
          <ul className="flex flex-wrap gap-2">
            {picked.map((d) => (
              <li key={d}>
                <button onClick={() => toggle(d)} className="flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-800 hover:bg-blue-100" aria-label={`${label(d)} 빼기`}>
                  {label(d)} <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-400">아직 고른 날짜가 없어요.</p>
        )}
        {notice && <p className="text-sm text-amber-700">{notice}</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </section>

      <div className="sticky bottom-0 -mx-4 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
        <button onClick={submit} disabled={!picked.length || sending} className="btn-primary w-full py-3 text-base">
          {sending ? <Loader2 className="size-4 animate-spin" /> : <CalendarCheck className="size-4" />}
          {picked.length ? `선택한 ${picked.length}개 날짜로 접수하기` : "날짜를 골라 주세요"}
        </button>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col gap-4 px-4 pt-5 pb-0">
      <header className="flex items-center gap-2 px-1">
        <span className="flex size-8 items-center justify-center rounded-lg bg-blue-600">
          <House className="size-4 text-white" />
        </span>
        <p className="text-sm font-semibold text-slate-900">SH 시설물 접수센터</p>
      </header>
      {children}
    </div>
  );
}

function Summary({ view }: { view: IntakeView }) {
  return (
    <section className="card space-y-1.5 p-4 text-sm">
      <p className="flex items-center gap-1.5 font-semibold text-slate-900">
        <Wrench className="size-4 text-blue-600" /> {view.facility} 방문 점검
      </p>
      <p className="text-slate-600">
        {view.apartmentName} {view.building}동 {view.unit}호 · {view.complainantName} 님
      </p>
    </section>
  );
}

function Done({ receiptNo, dates }: { receiptNo: string; dates: string[] }) {
  return (
    <section className="card space-y-3 p-5 text-center">
      <CircleCheck className="mx-auto size-10 text-emerald-600" />
      <div>
        <p className="text-lg font-bold text-slate-900">접수가 완료되었습니다</p>
        <p className="mt-1 text-sm text-slate-500">접수번호 {receiptNo}</p>
      </div>
      <div className="rounded-xl bg-slate-50 p-3 text-left">
        <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-500">
          <CalendarDays className="size-3.5" /> 방문 희망 날짜
        </p>
        <ul className="space-y-1 text-sm font-medium text-slate-800">
          {dates.map((d) => (
            <li key={d}>{label(d)}</li>
          ))}
        </ul>
      </div>
      <p className="text-sm leading-relaxed text-slate-600">담당 직원이 이 중 하루로 방문 일정을 확정해 문자로 안내해 드립니다.</p>
    </section>
  );
}

function Message({ tone, title, body }: { tone: "error"; title: string; body: string }) {
  return (
    <section className={cn("card space-y-2 p-5 text-center", tone === "error" && "border-red-200")}>
      <p className="text-base font-semibold text-slate-900">{title}</p>
      <p className="text-sm text-slate-600">{body}</p>
    </section>
  );
}
