"use client";

import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock,
  Hammer,
  Inbox,
  RefreshCw,
  Siren,
  Truck,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import ComplaintList from "@/components/ComplaintList";
import DailyIntakeChart, { type DailyPoint } from "@/components/DailyIntakeChart";
import DistrictRateMap from "@/components/DistrictRateMap";
import { ErrorBox, SectionTitle, Spinner, UrgencyBadge } from "@/components/ui";
import { api } from "@/lib/client-api";
import { DEFECT_LABEL, DEFECT_TYPES, URGENCIES } from "@/lib/constants";
import type { Complaint, Contractor, DashboardStats, Urgency } from "@/lib/types";
import { cn, formatDateTime } from "@/lib/utils";

interface Data {
  stats: DashboardStats;
  all: Complaint[];
  contractors: Contractor[];
  loadedAt: Date;
}

const DAY = 86_400_000;
const TREND_DAYS = 14;
const STALE_HOURS = 48; // 이 시간이 지나도록 배정되지 않으면 '지연'
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** 한국 시간 기준 날짜 키 (YYYY-MM-DD) */
const dayKey = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

const isWaiting = (c: Complaint) => c.status === "RECEIVED" || c.status === "PENDING_REVIEW";
const isOpen = (c: Complaint) => c.status !== "COMPLETED";

/** 경과 시간을 "2일 5시간" / "7시간" 형태로 */
function elapsed(ms: number) {
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return "1시간 미만";
  if (hours < 24) return `${hours}시간`;
  const d = Math.floor(hours / 24);
  const h = hours % 24;
  return h ? `${d}일 ${h}시간` : `${d}일`;
}

// 긴급도 막대 색 (긴급도 배지와 같은 계열)
const URGENCY_BAR: Record<Urgency, string> = {
  EMERGENCY: "bg-red-600",
  HIGH: "bg-orange-500",
  NORMAL: "bg-slate-400",
  LOW: "bg-slate-300",
};

export default function DashboardPage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const fetchAll = useCallback(
    () =>
      Promise.all([
        api<DashboardStats>("/api/stats"),
        api<{ items: Complaint[] }>("/api/complaints"),
        api<{ items: Contractor[] }>("/api/contractors"),
      ])
        .then(([stats, list, ctr]) => {
          setError("");
          setData({ stats, all: list.items, contractors: ctr.items, loadedAt: new Date() });
        })
        .catch((e: Error) => setError(e.message)),
    [],
  );

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const refresh = () => {
    setLoading(true);
    fetchAll().finally(() => setLoading(false));
  };

  const m = useMemo(() => {
    if (!data) return null;
    const { all, contractors, loadedAt } = data;
    const now = loadedAt.getTime();
    const todayKey = dayKey(loadedAt);
    const yesterdayKey = dayKey(new Date(now - DAY));

    // 최근 14일 일별 접수
    const perDay = new Map<string, number>();
    for (const c of all) {
      const k = dayKey(new Date(c.receivedAt));
      perDay.set(k, (perDay.get(k) ?? 0) + 1);
    }
    const daily: DailyPoint[] = Array.from({ length: TREND_DAYS }, (_, i) => {
      const d = new Date(now - (TREND_DAYS - 1 - i) * DAY);
      const key = dayKey(d);
      const [, mm, dd] = key.split("-").map(Number);
      const wd = new Date(`${key}T12:00:00+09:00`).getUTCDay();
      return { key, month: mm, day: dd, weekday: WEEKDAYS[wd], count: perDay.get(key) ?? 0, isToday: key === todayKey };
    });
    const trendTotal = daily.reduce((s, d) => s + d.count, 0);
    const prevWeek = daily.slice(0, 7).reduce((s, d) => s + d.count, 0);
    const thisWeek = daily.slice(7).reduce((s, d) => s + d.count, 0);

    // 평균 처리 기간 (접수 → 처리 완료)
    const leadDays = all
      .filter((c) => c.status === "COMPLETED")
      .map((c) => {
        const done = c.history.find((h) => h.status === "COMPLETED");
        return done ? (new Date(done.at).getTime() - new Date(c.receivedAt).getTime()) / DAY : null;
      })
      .filter((v): v is number => v !== null && v >= 0);
    const avgLead = leadDays.length ? leadDays.reduce((s, v) => s + v, 0) / leadDays.length : null;

    // 조치 필요
    const emergencyOpen = all.filter((c) => c.urgency === "EMERGENCY" && isOpen(c));
    const stale = all
      .filter((c) => isWaiting(c) && now - new Date(c.receivedAt).getTime() > STALE_HOURS * 3_600_000)
      .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
    // 가장 오래 기다린 미배정 민원 (긴급도 높은 순 → 오래된 순)
    const rank: Record<Urgency, number> = { EMERGENCY: 0, HIGH: 1, NORMAL: 2, LOW: 3 };
    const oldestWaiting = all
      .filter(isWaiting)
      .sort((a, b) => rank[a.urgency] - rank[b.urgency] || a.receivedAt.localeCompare(b.receivedAt))
      .slice(0, 5);

    // 미처리 긴급도 분포
    const open = all.filter(isOpen);
    const openByUrgency = URGENCIES.map((u) => ({ ...u, count: open.filter((c) => c.urgency === u.value).length }));

    // 업체 현황
    const loadByContractor = new Map<string, number>();
    for (const c of open) if (c.contractorId) loadByContractor.set(c.contractorId, (loadByContractor.get(c.contractorId) ?? 0) + 1);
    const contractorLoad = contractors
      .map((c) => ({ ...c, load: loadByContractor.get(c.id) ?? 0 }))
      .filter((c) => c.load > 0)
      .sort((a, b) => b.load - a.load)
      .slice(0, 5);

    const recent = [...all].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)).slice(0, 8);
    const aiCount = all.filter((c) => c.channel === "PHONE_AI").length;

    return {
      today: perDay.get(todayKey) ?? 0,
      yesterday: perDay.get(yesterdayKey) ?? 0,
      daily,
      trendAvg: trendTotal / TREND_DAYS,
      thisWeek,
      prevWeek,
      avgLead,
      emergencyOpen,
      stale,
      oldestWaiting,
      openTotal: open.length,
      openByUrgency,
      contractorLoad,
      contracted: contractors.filter((c) => c.isContracted).length,
      available: contractors.filter((c) => c.isContracted && c.isAvailable).length,
      recent,
      aiShare: all.length ? Math.round((aiCount / all.length) * 100) : 0,
    };
  }, [data]);

  if (error && !data) return <ErrorBox message={error} />;
  if (!data || !m) return <Spinner />;

  const { stats } = data;
  const completionRate = stats.total ? Math.round((stats.completed / stats.total) * 100) : 0;
  const weekDelta = m.thisWeek - m.prevWeek;

  const cards = [
    {
      label: "전체 민원 접수",
      value: stats.total,
      icon: ClipboardList,
      tone: "text-slate-700 bg-slate-100",
      href: "/complaints",
      sub: (
        <>
          오늘 <b className="font-semibold text-slate-700">+{m.today}</b> · 어제 {m.yesterday}건
        </>
      ),
    },
    {
      label: "접수 대기",
      value: stats.waiting,
      icon: Inbox,
      tone: "text-amber-700 bg-amber-100",
      href: "/complaints?status=PENDING_REVIEW",
      sub: <>관리자 확인 대기 {stats.pendingReview}건</>,
    },
    { label: "업체 배정", value: stats.assigned, icon: Truck, tone: "text-blue-700 bg-blue-100", href: "/complaints?status=ASSIGNED", sub: <>배정 + 작업 예정</> },
    { label: "작업 진행 중", value: stats.inProgress, icon: Hammer, tone: "text-violet-700 bg-violet-100", href: "/complaints?status=IN_PROGRESS", sub: <>업체 현장 작업</> },
    {
      label: "처리 완료",
      value: stats.completed,
      icon: CheckCircle2,
      tone: "text-emerald-700 bg-emerald-100",
      href: "/complaints?status=COMPLETED",
      sub: (
        <>
          완료율 <b className="font-semibold text-slate-700">{completionRate}%</b>
          {m.avgLead !== null && <> · 평균 {m.avgLead.toFixed(1)}일</>}
        </>
      ),
    },
  ];

  // 처리 단계 흐름 (처리 현황 막대·범례와 같은 색)
  const stages = [
    { label: "대기", v: stats.waiting, c: "bg-amber-400", href: "/complaints?status=RECEIVED" },
    { label: "배정·예정", v: stats.assigned, c: "bg-blue-500", href: "/complaints?status=ASSIGNED" },
    { label: "작업 중", v: stats.inProgress, c: "bg-violet-500", href: "/complaints?status=IN_PROGRESS" },
    { label: "완료", v: stats.completed, c: "bg-emerald-500", href: "/complaints?status=COMPLETED" },
  ];

  const typeRows = DEFECT_TYPES.map((d) => ({ ...d, v: stats.byDefectType[d.value] })).sort((a, b) => b.v - a.v);
  const maxType = Math.max(1, ...typeRows.map((t) => t.v));
  const maxUrg = Math.max(1, ...m.openByUrgency.map((u) => u.count));
  const maxLoad = Math.max(1, ...m.contractorLoad.map((c) => c.load));
  const actionCount = stats.pendingReview + m.emergencyOpen.length + m.stale.length;

  return (
    <div className="space-y-6">
      {/* ── 머리말: 기준 시각 · 새로고침 ── */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">민원 운영 현황</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            {formatDateTime(data.loadedAt.toISOString())} 기준 · 서울 25개 자치구 · AI 전화 접수 비율 {m.aiShare}%
          </p>
        </div>
        <button onClick={refresh} disabled={loading} className="btn-secondary !py-1.5 text-xs">
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          새로고침
        </button>
      </div>
      {error && <ErrorBox message={`새로고침 실패: ${error}`} />}

      {/* ── 1. 핵심 지표 ── */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 lg:gap-4">
        {cards.map(({ label, value, icon: Icon, tone, href, sub }, i) => (
          <Link key={label} href={href} className={cn("card p-4 transition-shadow hover:shadow-md lg:p-5", i === 0 && "col-span-2 sm:col-span-1")}>
            <div className="flex items-start justify-between">
              <p className="text-xs font-medium text-slate-500 lg:text-sm">{label}</p>
              <span className={cn("rounded-lg p-1.5", tone)}>
                <Icon className="size-4" />
              </span>
            </div>
            <p className="mt-2 text-2xl font-bold text-slate-900 tabular-nums lg:text-3xl">
              {value}
              <span className="ml-0.5 text-sm font-medium text-slate-400">건</span>
            </p>
            <p className="mt-1 truncate text-[11px] text-slate-500 tabular-nums">{sub}</p>
          </Link>
        ))}
      </section>

      {/* ── 2. 지금 조치가 필요한 민원 ── */}
      <section className={cn("card overflow-hidden", actionCount > 0 ? "border-amber-200" : "border-emerald-200")}>
        <SectionTitle
          title="지금 조치가 필요한 민원"
          action={
            actionCount > 0 ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700">
                <AlertTriangle className="size-3.5" />
                확인 필요
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700">
                <CheckCircle2 className="size-3.5" />
                모두 정상
              </span>
            )
          }
        />
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,22rem)_1fr]">
          {/* 조치 항목 */}
          <div className="divide-y divide-slate-100 border-slate-100 lg:border-r">
            <ActionRow
              href="/complaints?status=PENDING_REVIEW"
              icon={AlertTriangle}
              tone="amber"
              count={stats.pendingReview}
              title="관리자 확인 필요"
              desc={
                stats.pendingReview > 0 ? (
                  <>
                    자동 배정 조건에 맞는 업체가 없어 <b>관리자 확인이 필요한 민원 {stats.pendingReview}건</b>이 있습니다.
                  </>
                ) : (
                  "자동 배정되지 않은 민원이 없습니다."
                )
              }
            />
            <ActionRow
              href="/complaints?urgency=EMERGENCY"
              icon={Siren}
              tone="red"
              count={m.emergencyOpen.length}
              title="긴급 민원 미완료"
              desc="긴급도 '긴급'이면서 아직 처리 완료되지 않은 민원"
            />
            <ActionRow
              href="/complaints?status=RECEIVED"
              icon={Clock}
              tone="orange"
              count={m.stale.length}
              title={`${STALE_HOURS}시간 넘게 미배정`}
              desc="접수 후 업체가 정해지지 않은 채 오래 기다린 민원"
            />
          </div>

          {/* 가장 오래 기다린 미배정 민원 */}
          <div className="min-w-0">
            <p className="px-5 pt-4 pb-2 text-xs font-medium text-slate-500">배정 대기 민원 · 긴급도 높은 순, 오래된 순</p>
            {m.oldestWaiting.length === 0 ? (
              <p className="px-5 pb-6 text-sm text-slate-500">배정을 기다리는 민원이 없습니다.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {m.oldestWaiting.map((c) => {
                  const age = data.loadedAt.getTime() - new Date(c.receivedAt).getTime();
                  const late = age > STALE_HOURS * 3_600_000;
                  return (
                    <li key={c.id}>
                      <Link href={`/complaints/${c.id}`} className="flex items-center gap-3 px-5 py-2.5 hover:bg-slate-50">
                        <UrgencyBadge urgency={c.urgency} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm text-slate-900">
                            {c.apartmentName} {c.building}동 {c.unit}호 · {DEFECT_LABEL[c.defectType]}
                          </p>
                          <p className="truncate text-[11px] text-slate-500">
                            {c.receiptNo} · {c.region}
                            {c.status === "PENDING_REVIEW" && <span className="text-amber-700"> · 관리자 확인 대기</span>}
                          </p>
                        </div>
                        <span className={cn("shrink-0 text-xs tabular-nums", late ? "font-semibold text-orange-700" : "text-slate-500")}>
                          {elapsed(age)} 경과
                        </span>
                        <ChevronRight className="size-4 shrink-0 text-slate-300" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </section>

      {/* ── 3. 추이 · 처리 흐름 ── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="card lg:col-span-2">
          <SectionTitle
            title={`일별 접수 추이 (최근 ${TREND_DAYS}일)`}
            action={
              <span className="text-[11px] text-slate-500 tabular-nums">
                최근 7일 {m.thisWeek}건 ·{" "}
                <span className={weekDelta > 0 ? "font-medium text-rose-600" : weekDelta < 0 ? "font-medium text-emerald-600" : ""}>
                  지난 7일 대비 {weekDelta > 0 ? "▲" : weekDelta < 0 ? "▼" : "–"} {Math.abs(weekDelta)}건
                </span>
              </span>
            }
          />
          <div className="p-5">
            <DailyIntakeChart data={m.daily} />
          </div>
          <dl className="grid grid-cols-2 border-t border-slate-100 sm:grid-cols-4 sm:divide-x sm:divide-slate-100">
            {[
              { k: "오늘", v: `${m.today}건` },
              { k: "어제", v: `${m.yesterday}건` },
              { k: "최근 7일", v: `${m.thisWeek}건` },
              { k: `${TREND_DAYS}일 일평균`, v: `${m.trendAvg.toFixed(1)}건` },
            ].map((s) => (
              <div key={s.k} className="px-5 py-3">
                <dt className="text-[11px] text-slate-500">{s.k}</dt>
                <dd className="text-lg font-bold text-slate-900 tabular-nums">{s.v}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="card">
          <SectionTitle title="처리 현황" />
          <div className="space-y-4 p-5">
            <div className="flex items-end justify-between">
              <span className="text-sm text-slate-500">처리 완료율</span>
              <span className="text-2xl font-bold text-slate-900 tabular-nums">{completionRate}%</span>
            </div>
            <div className="flex h-2.5 gap-[2px] overflow-hidden rounded-full bg-slate-100">
              {[...stages].reverse().map((s) => (
                <div key={s.label} className={s.c} style={{ width: `${stats.total ? (s.v / stats.total) * 100 : 0}%` }} />
              ))}
            </div>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-slate-600">
              <li className="flex items-center gap-1.5"><i className="size-2 rounded-full bg-emerald-500" />완료 {stats.completed}</li>
              <li className="flex items-center gap-1.5"><i className="size-2 rounded-full bg-violet-500" />작업 중 {stats.inProgress}</li>
              <li className="flex items-center gap-1.5"><i className="size-2 rounded-full bg-blue-500" />배정·예정 {stats.assigned}</li>
              <li className="flex items-center gap-1.5"><i className="size-2 rounded-full bg-amber-400" />대기 {stats.waiting}</li>
            </ul>

            {/* 단계별 흐름 */}
            <div className="border-t border-slate-100 pt-4">
              <p className="mb-2 text-xs font-medium text-slate-500">단계별 흐름</p>
              <ol className="flex items-stretch gap-1">
                {stages.map((s, i) => (
                  <li key={s.label} className="flex flex-1 items-center gap-1">
                    <Link href={s.href} className="flex-1 rounded-lg bg-slate-50 px-2 py-2 text-center hover:bg-slate-100">
                      <i className={cn("mx-auto mb-1 block h-1 w-5 rounded-full", s.c)} />
                      <p className="text-base font-bold text-slate-900 tabular-nums">{s.v}</p>
                      <p className="text-[10px] text-slate-500">{s.label}</p>
                    </Link>
                    {i < stages.length - 1 && <ChevronRight className="size-3 shrink-0 text-slate-300" />}
                  </li>
                ))}
              </ol>
            </div>

            <dl className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 text-xs">
              <div>
                <dt className="text-slate-500">평균 처리 기간</dt>
                <dd className="mt-0.5 text-lg font-bold text-slate-900 tabular-nums">
                  {m.avgLead !== null ? `${m.avgLead.toFixed(1)}일` : "–"}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">미처리 합계</dt>
                <dd className="mt-0.5 text-lg font-bold text-slate-900 tabular-nums">{m.openTotal}건</dd>
              </div>
            </dl>
          </div>
        </section>
      </div>

      {/* ── 4. 서울 구별 처리율 ── */}
      <section className="card">
        <SectionTitle title="서울 구별 처리율" action={<span className="text-[11px] text-slate-500">구를 누르면 해당 구 민원 목록으로 이동</span>} />
        <DistrictRateMap data={stats.byDistrict} />
      </section>

      {/* ── 5. 유형 · 긴급도 · 업체 ── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="card">
          <SectionTitle title="하자 유형별 접수" action={<span className="text-[11px] text-slate-500">많은 순</span>} />
          <ul className="space-y-1 p-3">
            {typeRows.map((t) => (
              <li key={t.value}>
                <Link
                  href={`/complaints?defectType=${t.value}`}
                  className="grid grid-cols-[6.5rem_1fr_3.5rem] items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-slate-50"
                >
                  <span className="text-slate-600">{t.label}</span>
                  <span className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <span className="block h-full rounded-full bg-blue-500" style={{ width: `${(t.v / maxType) * 100}%` }} />
                  </span>
                  <span className="text-right tabular-nums">
                    <b className="font-medium text-slate-900">{t.v}</b>
                    <span className="ml-1 text-slate-400">{stats.total ? Math.round((t.v / stats.total) * 100) : 0}%</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <SectionTitle title="미처리 민원 긴급도" action={<span className="text-[11px] text-slate-500 tabular-nums">미처리 {m.openTotal}건</span>} />
          <ul className="space-y-1 p-3">
            {m.openByUrgency.map((u) => (
              <li key={u.value}>
                <Link href={`/complaints?urgency=${u.value}`} className="grid grid-cols-[3.5rem_1fr_2rem] items-center gap-2 rounded-md px-2 py-2 text-xs hover:bg-slate-50">
                  <span>
                    <UrgencyBadge urgency={u.value} />
                  </span>
                  <span className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <span className={cn("block h-full rounded-full", URGENCY_BAR[u.value])} style={{ width: `${(u.count / maxUrg) * 100}%` }} />
                  </span>
                  <span className="text-right font-medium text-slate-900 tabular-nums">{u.count}</span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="border-t border-slate-100 px-5 py-3 text-[11px] text-slate-500">
            긴급·높음 <b className="text-slate-800 tabular-nums">{m.openByUrgency.slice(0, 2).reduce((s, u) => s + u.count, 0)}건</b>을 우선 처리하세요.
          </p>
        </section>

        <section className="card">
          <SectionTitle
            title="업체 현황"
            action={
              <Link href="/contractors" className="text-xs font-medium text-blue-600 hover:underline">
                업체 관리
              </Link>
            }
          />
          <div className="grid grid-cols-2 gap-3 px-5 pt-4">
            <div className="rounded-lg bg-slate-50 px-3 py-2">
              <p className="text-[11px] text-slate-500">계약 업체</p>
              <p className="text-lg font-bold text-slate-900 tabular-nums">{m.contracted}곳</p>
            </div>
            <div className="rounded-lg bg-slate-50 px-3 py-2">
              <p className="text-[11px] text-slate-500">업무 가능</p>
              <p className="text-lg font-bold text-slate-900 tabular-nums">
                {m.available}
                <span className="text-sm font-medium text-slate-400">/{m.contracted}곳</span>
              </p>
            </div>
          </div>
          <p className="px-5 pt-4 pb-1 text-xs font-medium text-slate-500">진행 중인 민원이 많은 업체</p>
          {m.contractorLoad.length === 0 ? (
            <p className="px-5 pb-5 text-xs text-slate-500">진행 중인 배정 건이 없습니다.</p>
          ) : (
            <ul className="space-y-1 px-3 pb-4">
              {m.contractorLoad.map((c) => (
                <li key={c.id} className="grid grid-cols-[1fr_5rem_2rem] items-center gap-2 rounded-md px-2 py-1.5 text-xs">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <Building2 className="size-3.5 shrink-0 text-slate-400" />
                    <span className="truncate text-slate-700">{c.name}</span>
                    {!c.isAvailable && <span className="shrink-0 rounded bg-slate-100 px-1 text-[10px] text-slate-500">중지</span>}
                  </span>
                  <span className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <span className="block h-full rounded-full bg-violet-500" style={{ width: `${(c.load / maxLoad) * 100}%` }} />
                  </span>
                  <span className="text-right font-medium text-slate-900 tabular-nums">{c.load}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* ── 6. 최근 접수 민원 ── */}
      <section className="card overflow-hidden">
        <SectionTitle
          title="최근 접수 민원"
          action={
            <Link href="/complaints" className="text-xs font-medium text-blue-600 hover:underline">
              전체 보기
            </Link>
          }
        />
        <ComplaintList items={m.recent} contractors={data.contractors} emptyText="접수된 민원이 없습니다." />
      </section>
    </div>
  );
}

const TONE = {
  amber: { icon: "bg-amber-100 text-amber-700", num: "text-amber-700" },
  red: { icon: "bg-red-100 text-red-700", num: "text-red-700" },
  orange: { icon: "bg-orange-100 text-orange-700", num: "text-orange-700" },
};

function ActionRow({
  href,
  icon: Icon,
  tone,
  count,
  title,
  desc,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: keyof typeof TONE;
  count: number;
  title: string;
  desc: React.ReactNode;
}) {
  const active = count > 0;
  return (
    <Link href={href} className={cn("flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50", !active && "opacity-60")}>
      <span className={cn("rounded-lg p-2", active ? TONE[tone].icon : "bg-slate-100 text-slate-400")}>
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-900">{title}</p>
        <p className="text-[11px] leading-snug text-slate-500">{desc}</p>
      </div>
      <span className={cn("text-xl font-bold tabular-nums", active ? TONE[tone].num : "text-slate-400")}>{count}</span>
      <ChevronRight className="size-4 shrink-0 text-slate-300" />
    </Link>
  );
}
