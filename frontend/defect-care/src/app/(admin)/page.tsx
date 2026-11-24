"use client";

import { AlertTriangle, CheckCircle2, ClipboardList, Hammer, Inbox, Truck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import ComplaintList from "@/components/ComplaintList";
import DistrictRateMap from "@/components/DistrictRateMap";
import { ErrorBox, SectionTitle, Spinner } from "@/components/ui";
import { api } from "@/lib/client-api";
import { DEFECT_TYPES } from "@/lib/constants";
import type { Complaint, Contractor, DashboardStats } from "@/lib/types";

interface Data {
  stats: DashboardStats;
  recent: Complaint[];
  contractors: Contractor[];
}

export default function DashboardPage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      api<DashboardStats>("/api/stats"),
      api<{ items: Complaint[] }>("/api/complaints?limit=8"),
      api<{ items: Contractor[] }>("/api/contractors"),
    ])
      .then(([stats, recent, ctr]) => setData({ stats, recent: recent.items, contractors: ctr.items }))
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <ErrorBox message={error} />;
  if (!data) return <Spinner />;

  const { stats } = data;
  const cards = [
    { label: "전체 민원 접수", value: stats.total, icon: ClipboardList, tone: "text-slate-700 bg-slate-100", href: "/complaints" },
    { label: "접수 대기", value: stats.waiting, icon: Inbox, tone: "text-amber-700 bg-amber-100", href: "/complaints?status=PENDING_REVIEW", sub: `관리자 확인 대기 ${stats.pendingReview}건` },
    { label: "업체 배정", value: stats.assigned, icon: Truck, tone: "text-blue-700 bg-blue-100", href: "/complaints?status=ASSIGNED", sub: "배정 + 작업 예정" },
    { label: "작업 진행 중", value: stats.inProgress, icon: Hammer, tone: "text-violet-700 bg-violet-100", href: "/complaints?status=IN_PROGRESS" },
    { label: "처리 완료", value: stats.completed, icon: CheckCircle2, tone: "text-emerald-700 bg-emerald-100", href: "/complaints?status=COMPLETED" },
  ];
  const maxType = Math.max(1, ...Object.values(stats.byDefectType));
  const completionRate = stats.total ? Math.round((stats.completed / stats.total) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* 상단 통계 카드 */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 lg:gap-4">
        {cards.map(({ label, value, icon: Icon, tone, href, sub }, i) => (
          <Link
            key={label}
            href={href}
            className={`card p-4 transition-shadow hover:shadow-md lg:p-5 ${i === 0 ? "col-span-2 sm:col-span-1" : ""}`}
          >
            <div className="flex items-start justify-between">
              <p className="text-xs font-medium text-slate-500 lg:text-sm">{label}</p>
              <span className={`rounded-lg p-1.5 ${tone}`}>
                <Icon className="size-4" />
              </span>
            </div>
            <p className="mt-2 text-2xl font-bold text-slate-900 tabular-nums lg:text-3xl">
              {value}
              <span className="ml-0.5 text-sm font-medium text-slate-400">건</span>
            </p>
            {sub && <p className="mt-1 truncate text-[11px] text-slate-500">{sub}</p>}
          </Link>
        ))}
      </section>

      {stats.pendingReview > 0 && (
        <Link
          href="/complaints?status=PENDING_REVIEW"
          className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 hover:bg-amber-100"
        >
          <AlertTriangle className="size-4.5 shrink-0" />
          <span>
            자동 배정 조건에 맞는 업체가 없어 <b>관리자 확인이 필요한 민원 {stats.pendingReview}건</b>이 있습니다.
          </span>
          <span className="ml-auto shrink-0 font-medium">확인하기 →</span>
        </Link>
      )}

      {/* 서울 구별 처리율 */}
      <section className="card">
        <SectionTitle
          title="서울 구별 처리율"
          action={<span className="text-[11px] text-slate-500">구를 누르면 해당 구 민원 목록으로 이동</span>}
        />
        <DistrictRateMap data={stats.byDistrict} />
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* 최근 접수 민원 */}
        <section className="card overflow-hidden lg:col-span-2">
          <SectionTitle
            title="최근 접수 민원"
            action={
              <Link href="/complaints" className="text-xs font-medium text-blue-600 hover:underline">
                전체 보기
              </Link>
            }
          />
          <ComplaintList items={data.recent} contractors={data.contractors} emptyText="접수된 민원이 없습니다." />
        </section>

        <div className="space-y-6">
          {/* 처리율 */}
          <section className="card">
            <SectionTitle title="처리 현황" />
            <div className="space-y-3 p-5">
              <div className="flex items-end justify-between">
                <span className="text-sm text-slate-500">처리 완료율</span>
                <span className="text-2xl font-bold text-slate-900 tabular-nums">{completionRate}%</span>
              </div>
              <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-100">
                {[
                  { v: stats.completed, c: "bg-emerald-500" },
                  { v: stats.inProgress, c: "bg-violet-500" },
                  { v: stats.assigned, c: "bg-blue-500" },
                  { v: stats.waiting, c: "bg-amber-400" },
                ].map((s, i) => (
                  <div key={i} className={s.c} style={{ width: `${stats.total ? (s.v / stats.total) * 100 : 0}%` }} />
                ))}
              </div>
              <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-slate-600">
                <li className="flex items-center gap-1.5"><i className="size-2 rounded-full bg-emerald-500" />완료 {stats.completed}</li>
                <li className="flex items-center gap-1.5"><i className="size-2 rounded-full bg-violet-500" />작업 중 {stats.inProgress}</li>
                <li className="flex items-center gap-1.5"><i className="size-2 rounded-full bg-blue-500" />배정·예정 {stats.assigned}</li>
                <li className="flex items-center gap-1.5"><i className="size-2 rounded-full bg-amber-400" />대기 {stats.waiting}</li>
              </ul>
            </div>
          </section>

          {/* 하자 유형별 */}
          <section className="card">
            <SectionTitle title="하자 유형별 접수" />
            <ul className="space-y-2.5 p-5">
              {DEFECT_TYPES.map((d) => {
                const v = stats.byDefectType[d.value];
                return (
                  <li key={d.value} className="grid grid-cols-[6.5rem_1fr_2rem] items-center gap-2 text-xs">
                    <span className="text-slate-600">{d.label}</span>
                    <span className="h-2 overflow-hidden rounded-full bg-slate-100">
                      <span className="block h-full rounded-full bg-blue-500" style={{ width: `${(v / maxType) * 100}%` }} />
                    </span>
                    <span className="text-right font-medium text-slate-900 tabular-nums">{v}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
