"use client";

import {
  AlertTriangle,
  ArrowDownUp,
  Building2,
  CheckCircle2,
  Clock,
  Hammer,
  Loader2,
  Mail,
  Pencil,
  Phone,
  Plus,
  Search,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ErrorBox, SectionTitle, Spinner } from "@/components/ui";
import { api } from "@/lib/client-api";
import { DEFECT_LABEL, DEFECT_TYPES } from "@/lib/constants";
import { DISTRICT_NAMES } from "@/lib/seoul";
import type { Complaint, Contractor, DefectType } from "@/lib/types";
import { cn, formatDateTime } from "@/lib/utils";

type Body = Omit<Contractor, "id" | "createdAt">;
const EMPTY: Body = { name: "", defectTypes: [], regions: [], phone: "", email: "", isContracted: true, isAvailable: true };

const DAY = 86_400_000;
const short = (name: string) => (name.length > 2 ? name.replace(/구$/, "") : name);

/** 자동 배정 대상: 계약 + 업무 가능 (assignment.ts 규칙과 같음) */
const isEligible = (c: Contractor) => c.isContracted && c.isAvailable;

type StatusKey = "ALL" | "ELIGIBLE" | "UNCONTRACTED" | "PAUSED";
const STATUS_TABS: { key: StatusKey; label: string }[] = [
  { key: "ALL", label: "전체" },
  { key: "ELIGIBLE", label: "배정 대상" },
  { key: "PAUSED", label: "업무 중지" },
  { key: "UNCONTRACTED", label: "미계약" },
];
const statusOf = (c: Contractor): Exclude<StatusKey, "ALL"> => (!c.isContracted ? "UNCONTRACTED" : !c.isAvailable ? "PAUSED" : "ELIGIBLE");
const STATUS_BADGE: Record<Exclude<StatusKey, "ALL">, { label: string; cls: string }> = {
  ELIGIBLE: { label: "배정 대상", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  PAUSED: { label: "업무 중지", cls: "bg-amber-50 text-amber-700 ring-amber-200" },
  UNCONTRACTED: { label: "미계약", cls: "bg-slate-100 text-slate-600 ring-slate-200" },
};

type SortKey = "name" | "active" | "done" | "lead";
const SORTS: { key: SortKey; label: string }[] = [
  { key: "active", label: "진행 중 많은 순" },
  { key: "done", label: "완료 많은 순" },
  { key: "lead", label: "처리 빠른 순" },
  { key: "name", label: "이름 순" },
];

function Toggle({ on, onChange, label }: { on: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onChange}
      className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors", on ? "bg-blue-600" : "bg-slate-300")}
    >
      <span className={cn("absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow transition-transform", on && "translate-x-4")} />
    </button>
  );
}

/** (하자 유형 × 자치구) 조합마다 배정 가능한 업체 수 */
function coverageOf(contractors: Contractor[]) {
  const m = new Map<string, Contractor[]>();
  for (const t of DEFECT_TYPES) for (const d of DISTRICT_NAMES) m.set(`${t.value}|${d}`, []);
  for (const c of contractors.filter(isEligible))
    for (const t of c.defectTypes) for (const d of c.regions) m.get(`${t}|${d}`)?.push(c);
  return m;
}

export default function ContractorsPage() {
  const [items, setItems] = useState<Contractor[] | null>(null);
  const [load, setLoad] = useState<Record<string, number>>({});
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [regions, setRegions] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState<DefectType | "ALL">("ALL");
  const [districtFilter, setDistrictFilter] = useState<string>("ALL");
  const [statusTab, setStatusTab] = useState<StatusKey>("ALL");
  const [sort, setSort] = useState<SortKey>("active");
  const [editing, setEditing] = useState<{ id: string | null; body: Body } | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => {
    Promise.all([
      api<{ items: Contractor[]; load: Record<string, number> }>("/api/contractors"),
      api<{ items: Complaint[] }>("/api/complaints"),
    ])
      .then(([r, c]) => {
        setItems(r.items);
        setLoad(r.load);
        setComplaints(c.items);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    refresh();
    api<{ regions: string[] }>("/api/meta").then((m) => setRegions(m.regions)).catch(() => {});
  }, [refresh]);

  // ── 업체별 실적 (민원 이력에서 계산) ──
  const perf = useMemo(() => {
    const out: Record<string, { done: number; lead: number | null; lastAssigned: string | null; total: number }> = {};
    const leads: Record<string, number[]> = {};
    for (const c of complaints) {
      if (!c.contractorId) continue;
      const p = (out[c.contractorId] ??= { done: 0, lead: null, lastAssigned: null, total: 0 });
      p.total += 1;
      const assigned = [...c.history].reverse().find((h) => h.status === "ASSIGNED");
      const at = assigned?.at ?? c.receivedAt;
      if (!p.lastAssigned || at > p.lastAssigned) p.lastAssigned = at;
      if (c.status === "COMPLETED") {
        p.done += 1;
        const fin = c.history.find((h) => h.status === "COMPLETED");
        if (fin) (leads[c.contractorId] ??= []).push((new Date(fin.at).getTime() - new Date(c.receivedAt).getTime()) / DAY);
      }
    }
    for (const [id, arr] of Object.entries(leads)) out[id].lead = arr.reduce((s, v) => s + v, 0) / arr.length;
    return out;
  }, [complaints]);

  // ── 배정 커버리지 ──
  const coverage = useMemo(() => coverageOf(items ?? []), [items]);
  const pendingByCell = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of complaints)
      if (c.status === "PENDING_REVIEW") m.set(`${c.defectType}|${c.region}`, (m.get(`${c.defectType}|${c.region}`) ?? 0) + 1);
    return m;
  }, [complaints]);
  const cov = useMemo(() => {
    let gap = 0,
      single = 0;
    for (const v of coverage.values()) {
      if (v.length === 0) gap++;
      else if (v.length === 1) single++;
    }
    const total = coverage.size;
    const pendingInGaps = [...pendingByCell.entries()].filter(([k]) => (coverage.get(k)?.length ?? 0) === 0).reduce((s, [, n]) => s + n, 0);
    return { total, gap, single, rate: total ? Math.round(((total - gap) / total) * 100) : 0, pendingInGaps };
  }, [coverage, pendingByCell]);

  // ── 목록 필터·정렬 ──
  const filtered = useMemo(() => {
    const k = q.trim();
    const rows = (items ?? []).filter(
      (c) =>
        (typeFilter === "ALL" || c.defectTypes.includes(typeFilter)) &&
        (districtFilter === "ALL" || c.regions.includes(districtFilter)) &&
        (statusTab === "ALL" || statusOf(c) === statusTab) &&
        (!k || c.name.includes(k) || c.regions.some((r) => r.includes(k)) || c.phone.includes(k)),
    );
    const lead = (c: Contractor) => perf[c.id]?.lead ?? Number.POSITIVE_INFINITY;
    return rows.sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name, "ko");
      if (sort === "done") return (perf[b.id]?.done ?? 0) - (perf[a.id]?.done ?? 0);
      if (sort === "lead") return lead(a) - lead(b);
      return (load[b.id] ?? 0) - (load[a.id] ?? 0);
    });
  }, [items, q, typeFilter, districtFilter, statusTab, sort, load, perf]);

  const counts = useMemo(() => {
    const all = items ?? [];
    return {
      ALL: all.length,
      ELIGIBLE: all.filter((c) => statusOf(c) === "ELIGIBLE").length,
      PAUSED: all.filter((c) => statusOf(c) === "PAUSED").length,
      UNCONTRACTED: all.filter((c) => statusOf(c) === "UNCONTRACTED").length,
    } satisfies Record<StatusKey, number>;
  }, [items]);

  const activeTotal = Object.values(load).reduce((s, v) => s + v, 0);
  const allLeads = Object.values(perf).filter((p) => p.lead !== null);
  const avgLead = allLeads.length ? allLeads.reduce((s, p) => s + (p.lead ?? 0) * p.done, 0) / allLeads.reduce((s, p) => s + p.done, 0) : null;
  const maxLoad = Math.max(1, ...Object.values(load));

  /** 이 업체가 빠지면 새로 생기는 배정 공백 조합 수 */
  const gapsIfRemoved = (c: Contractor) => {
    if (!isEligible(c)) return 0;
    let n = 0;
    for (const t of c.defectTypes) for (const d of c.regions) if (coverage.get(`${t}|${d}`)?.length === 1) n++;
    return n;
  };

  const toggle = async (c: Contractor, key: "isContracted" | "isAvailable") => {
    if (c[key]) {
      const gaps = gapsIfRemoved(c);
      if (gaps > 0) {
        const what = key === "isAvailable" ? "업무 불가" : "미계약";
        if (!confirm(`'${c.name}'을(를) ${what}(으)로 바꾸면 ${gaps}개 (하자 유형·자치구) 조합에 배정 가능한 업체가 없어집니다.\n해당 민원은 '관리자 확인 대기'로 넘어갑니다. 계속할까요?`)) return;
      }
    }
    try {
      await api(`/api/contractors/${c.id}`, { method: "PATCH", json: { [key]: !c[key] } });
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const remove = async (c: Contractor) => {
    const gaps = gapsIfRemoved(c);
    const warn = gaps > 0 ? `\n\n삭제하면 ${gaps}개 (하자 유형·자치구) 조합에 배정 가능한 업체가 없어집니다.` : "";
    if (!confirm(`'${c.name}' 업체를 삭제하시겠습니까?${warn}`)) return;
    try {
      await api(`/api/contractors/${c.id}`, { method: "DELETE" });
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const pickCell = (t: DefectType, d: string) => {
    setTypeFilter(t);
    setDistrictFilter(d);
    setStatusTab("ALL");
    setQ("");
    tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const allRegions = regions.length ? regions : DISTRICT_NAMES;
  const filtersOn = typeFilter !== "ALL" || districtFilter !== "ALL" || statusTab !== "ALL" || q.trim() !== "";

  if (!items && !error) return <Spinner />;

  return (
    <div className="space-y-6">
      {/* ── 머리말 ── */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900">협력 업체 관리</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            자동 배정 규칙: 담당 분야 일치 → 담당 지역 포함 → 계약·업무 가능 → 진행 건수가 가장 적은 업체
          </p>
        </div>
        <button className="btn-primary" onClick={() => setEditing({ id: null, body: EMPTY })}>
          <Plus className="size-4" /> 업체 등록
        </button>
      </div>

      {error && <ErrorBox message={error} />}

      {/* ── 1. 업체 현황 지표 ── */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 lg:gap-4">
        <Kpi icon={Building2} tone="text-slate-700 bg-slate-100" label="등록 업체" value={`${counts.ALL}`} unit="곳" sub={`미계약 ${counts.UNCONTRACTED}곳 포함`} />
        <Kpi icon={CheckCircle2} tone="text-emerald-700 bg-emerald-100" label="자동 배정 대상" value={`${counts.ELIGIBLE}`} unit="곳" sub="계약 + 업무 가능" />
        <Kpi icon={AlertTriangle} tone="text-amber-700 bg-amber-100" label="업무 중지" value={`${counts.PAUSED}`} unit="곳" sub="계약 중 · 업무 불가" />
        <Kpi icon={Hammer} tone="text-violet-700 bg-violet-100" label="진행 중 배정" value={`${activeTotal}`} unit="건" sub={`업체당 평균 ${counts.ELIGIBLE ? (activeTotal / counts.ELIGIBLE).toFixed(1) : 0}건`} />
        <Kpi icon={Clock} tone="text-blue-700 bg-blue-100" label="평균 처리 기간" value={avgLead !== null ? avgLead.toFixed(1) : "–"} unit="일" sub="접수 → 처리 완료" />
        <Kpi
          icon={ShieldAlert}
          tone={cov.gap ? "text-red-700 bg-red-100" : "text-emerald-700 bg-emerald-100"}
          label="배정 커버리지"
          value={`${cov.rate}`}
          unit="%"
          sub={`공백 ${cov.gap}개 조합`}
          alert={cov.gap > 0}
        />
      </section>

      {/* ── 2. 배정 커버리지 매트릭스 ── */}
      <section className="card">
        <SectionTitle
          title="배정 커버리지 (하자 유형 × 자치구)"
          action={<span className="text-[11px] text-slate-500">칸을 누르면 해당 조건의 업체만 아래 목록에 표시</span>}
        />
        <div className="space-y-4 p-5">
          {cov.gap > 0 ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800">
              <ShieldAlert className="size-4 shrink-0" />
              <span>
                전체 {cov.total}개 조합 중 <b>{cov.gap}개 조합에 배정 가능한 업체가 없습니다.</b> 이 조합으로 접수된 민원은 자동 배정되지 않고 관리자 확인 대기로 넘어갑니다.
              </span>
              {cov.pendingInGaps > 0 && (
                <Link href="/complaints?status=PENDING_REVIEW" className="ml-auto shrink-0 font-medium hover:underline">
                  공백으로 대기 중인 민원 {cov.pendingInGaps}건 →
                </Link>
              )}
            </div>
          ) : (
            <p className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
              <CheckCircle2 className="size-4" /> 모든 (하자 유형·자치구) 조합에 배정 가능한 업체가 있습니다.
            </p>
          )}

          <div className="overflow-x-auto">
            <table className="border-separate border-spacing-[2px] text-[10px]">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-white" />
                  {DISTRICT_NAMES.map((d) => (
                    <th key={d} scope="col" className="w-7 min-w-7 pb-1 text-center font-medium text-slate-500">
                      {short(d)}
                    </th>
                  ))}
                  <th className="pl-2 text-left font-medium text-slate-500">공백</th>
                </tr>
              </thead>
              <tbody>
                {DEFECT_TYPES.map((t) => {
                  const rowGaps = DISTRICT_NAMES.filter((d) => (coverage.get(`${t.value}|${d}`)?.length ?? 0) === 0).length;
                  return (
                    <tr key={t.value}>
                      <th scope="row" className="sticky left-0 z-10 bg-white pr-2 text-left text-[11px] font-medium whitespace-nowrap text-slate-600">
                        {t.label}
                      </th>
                      {DISTRICT_NAMES.map((d) => {
                        const list = coverage.get(`${t.value}|${d}`) ?? [];
                        const n = list.length;
                        const pend = pendingByCell.get(`${t.value}|${d}`) ?? 0;
                        const selected = typeFilter === t.value && districtFilter === d;
                        return (
                          <td key={d} className="p-0">
                            <button
                              onClick={() => pickCell(t.value, d)}
                              title={`${t.label} · ${d}\n배정 가능 ${n}곳${n ? `: ${list.map((c) => c.name).join(", ")}` : ""}${pend ? `\n관리자 확인 대기 ${pend}건` : ""}`}
                              aria-label={`${t.label} ${d} 배정 가능 업체 ${n}곳${pend ? `, 대기 민원 ${pend}건` : ""}`}
                              className={cn(
                                "relative flex size-7 items-center justify-center rounded-[4px] font-semibold tabular-nums transition hover:brightness-95",
                                n === 0 && "bg-red-50 text-red-600 ring-1 ring-red-200 ring-inset",
                                n === 1 && "bg-amber-100 text-amber-800",
                                n === 2 && "bg-emerald-100 text-emerald-800",
                                n >= 3 && "bg-emerald-300 text-emerald-950",
                                selected && "outline-2 outline-offset-1 outline-slate-900",
                              )}
                            >
                              {n === 0 ? "✕" : n}
                              {pend > 0 && (
                                <span className="absolute -top-1 -right-1 flex size-3.5 items-center justify-center rounded-full bg-red-600 text-[8px] font-bold text-white">
                                  {pend}
                                </span>
                              )}
                            </button>
                          </td>
                        );
                      })}
                      <td className={cn("pl-2 text-[11px] tabular-nums", rowGaps ? "font-semibold text-red-600" : "text-slate-400")}>{rowGaps}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-slate-600">
            <span className="inline-flex items-center gap-1.5">
              <i className="flex size-4 items-center justify-center rounded-[3px] bg-red-50 text-[9px] font-bold text-red-600 not-italic ring-1 ring-red-200 ring-inset">✕</i>
              배정 공백 (업체 없음)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <i className="size-4 rounded-[3px] bg-amber-100" />
              1곳뿐 (단일 업체 의존, {cov.single}개 조합)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <i className="size-4 rounded-[3px] bg-emerald-100" />
              2곳
            </span>
            <span className="inline-flex items-center gap-1.5">
              <i className="size-4 rounded-[3px] bg-emerald-300" />
              3곳 이상
            </span>
            <span className="inline-flex items-center gap-1.5">
              <i className="flex size-3.5 items-center justify-center rounded-full bg-red-600 text-[8px] font-bold text-white not-italic">n</i>
              관리자 확인 대기 민원
            </span>
          </div>
        </div>
      </section>

      {/* ── 3. 업체 목록 (성과표) ── */}
      <section className="card scroll-mt-20" ref={tableRef}>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-3">
          <h2 className="mr-2 text-sm font-semibold text-slate-900">업체 목록</h2>
          <div className="flex rounded-lg bg-slate-100 p-0.5 text-xs" role="tablist" aria-label="업체 상태">
            {STATUS_TABS.map((s) => (
              <button
                key={s.key}
                role="tab"
                aria-selected={statusTab === s.key}
                onClick={() => setStatusTab(s.key)}
                className={cn("rounded-md px-2.5 py-1", statusTab === s.key ? "bg-white font-medium text-slate-900 shadow-sm" : "text-slate-500")}
              >
                {s.label} <span className="tabular-nums text-slate-400">{counts[s.key]}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2 border-b border-slate-100 px-5 py-3 sm:grid-cols-2 lg:grid-cols-[1fr_11rem_9rem_10rem_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
            <input className="input pl-9" placeholder="업체명, 지역, 연락처 검색" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className="input" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as DefectType | "ALL")} aria-label="담당 하자 유형">
            <option value="ALL">전체 담당 분야</option>
            {DEFECT_TYPES.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
          <select className="input" value={districtFilter} onChange={(e) => setDistrictFilter(e.target.value)} aria-label="담당 지역">
            <option value="ALL">전체 지역</option>
            {DISTRICT_NAMES.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <label className="relative">
            <ArrowDownUp className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-slate-400" />
            <select className="input pl-8" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="정렬">
              {SORTS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          {filtersOn && (
            <button
              className="btn-secondary"
              onClick={() => {
                setQ("");
                setTypeFilter("ALL");
                setDistrictFilter("ALL");
                setStatusTab("ALL");
              }}
            >
              <X className="size-3.5" /> 필터 해제
            </button>
          )}
        </div>

        {typeFilter !== "ALL" && districtFilter !== "ALL" && (
          <p className="border-b border-slate-100 bg-slate-50 px-5 py-2 text-xs text-slate-600">
            <b>{DEFECT_LABEL[typeFilter]} · {districtFilter}</b> 담당 업체 {filtered.length}곳 — 이 중 자동 배정 대상{" "}
            <b className="tabular-nums">{filtered.filter(isEligible).length}곳</b>
          </p>
        )}

        {/* PC 표 */}
        <div className="hidden overflow-x-auto lg:block">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-5 py-2.5 font-medium">업체</th>
                <th className="px-3 py-2.5 font-medium">상태 · 계약 / 업무</th>
                <th className="px-3 py-2.5 font-medium">담당 분야</th>
                <th className="px-3 py-2.5 font-medium">담당 지역</th>
                <th className="px-3 py-2.5 font-medium">진행 중</th>
                <th className="px-3 py-2.5 text-right font-medium">완료</th>
                <th className="px-3 py-2.5 text-right font-medium">평균 처리</th>
                <th className="px-3 py-2.5 font-medium">최근 배정</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((c) => {
                const st = STATUS_BADGE[statusOf(c)];
                const p = perf[c.id];
                const active = load[c.id] ?? 0;
                const critical = gapsIfRemoved(c);
                return (
                  <tr key={c.id} className={cn("align-top hover:bg-slate-50/60", !isEligible(c) && "bg-slate-50/40")}>
                    <td className="px-5 py-3">
                      <p className="font-semibold text-slate-900">{c.name}</p>
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500 tabular-nums">
                        <Phone className="size-3" /> {c.phone}
                      </p>
                      {c.email && (
                        <p className="flex items-center gap-1 text-xs text-slate-500">
                          <Mail className="size-3" /> {c.email}
                        </p>
                      )}
                      {critical > 0 && (
                        <p className="mt-1 inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800" title="이 업체만 담당하는 (유형·지역) 조합 수">
                          <ShieldAlert className="size-3" /> 단독 담당 {critical}개 조합
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", st.cls)}>{st.label}</span>
                      <div className="mt-2 space-y-1.5 text-xs text-slate-600">
                        <label className="flex items-center gap-2">
                          <Toggle on={c.isContracted} onChange={() => toggle(c, "isContracted")} label="계약 여부" />
                          {c.isContracted ? "계약" : "미계약"}
                        </label>
                        <label className="flex items-center gap-2">
                          <Toggle on={c.isAvailable} onChange={() => toggle(c, "isAvailable")} label="업무 가능 여부" />
                          {c.isAvailable ? "업무 가능" : "업무 불가"}
                        </label>
                      </div>
                    </td>
                    <td className="max-w-48 px-3 py-3">
                      <div className="flex flex-wrap gap-1">
                        {c.defectTypes.map((d) => (
                          <span key={d} className="rounded bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-700">
                            {DEFECT_LABEL[d]}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="max-w-56 px-3 py-3 text-xs text-slate-600">
                      <p className="font-medium text-slate-800 tabular-nums">
                        {c.regions.length === DISTRICT_NAMES.length ? "서울 전체" : `${c.regions.length}개 구`}
                      </p>
                      {c.regions.length !== DISTRICT_NAMES.length && <p className="mt-0.5 leading-relaxed">{c.regions.map(short).join(" · ")}</p>}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <span className="h-1.5 w-14 overflow-hidden rounded-full bg-slate-100">
                          <span className="block h-full rounded-full bg-violet-500" style={{ width: `${(active / maxLoad) * 100}%` }} />
                        </span>
                        <span className="text-sm font-semibold text-slate-900 tabular-nums">{active}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      <span className="font-medium text-slate-900">{p?.done ?? 0}</span>
                      <span className="text-xs text-slate-400">/{p?.total ?? 0}</span>
                    </td>
                    <td className="px-3 py-3 text-right text-slate-900 tabular-nums">{p?.lead != null ? `${p.lead.toFixed(1)}일` : <span className="text-slate-400">–</span>}</td>
                    <td className="px-3 py-3 text-xs whitespace-nowrap text-slate-500 tabular-nums">{p?.lastAssigned ? formatDateTime(p.lastAssigned).slice(5) : "–"}</td>
                    <td className="px-3 py-3">
                      <div className="flex justify-end gap-1">
                        <button className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="수정" onClick={() => setEditing({ id: c.id, body: { ...c } })}>
                          <Pencil className="size-4" />
                        </button>
                        <button className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="삭제" onClick={() => remove(c)}>
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* 태블릿·모바일 카드 */}
        <ul className="divide-y divide-slate-100 lg:hidden">
          {filtered.map((c) => {
            const st = STATUS_BADGE[statusOf(c)];
            const p = perf[c.id];
            const critical = gapsIfRemoved(c);
            return (
              <li key={c.id} className="space-y-2.5 px-5 py-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <h3 className="font-semibold text-slate-900">{c.name}</h3>
                      <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset", st.cls)}>{st.label}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500 tabular-nums">
                      {c.phone}
                      {c.email && ` · ${c.email}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="수정" onClick={() => setEditing({ id: c.id, body: { ...c } })}>
                      <Pencil className="size-4" />
                    </button>
                    <button className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="삭제" onClick={() => remove(c)}>
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {c.defectTypes.map((d) => (
                    <span key={d} className="rounded bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-700">
                      {DEFECT_LABEL[d]}
                    </span>
                  ))}
                </div>
                <p className="text-xs text-slate-600">
                  <span className="text-slate-400">담당 지역 </span>
                  {c.regions.length === DISTRICT_NAMES.length ? "서울 전체" : c.regions.join(", ")}
                </p>
                <dl className="grid grid-cols-4 gap-2 rounded-lg bg-slate-50 px-3 py-2 text-center text-xs">
                  <div>
                    <dt className="text-[10px] text-slate-500">진행 중</dt>
                    <dd className="font-semibold text-slate-900 tabular-nums">{load[c.id] ?? 0}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] text-slate-500">완료</dt>
                    <dd className="font-semibold text-slate-900 tabular-nums">{p?.done ?? 0}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] text-slate-500">평균 처리</dt>
                    <dd className="font-semibold text-slate-900 tabular-nums">{p?.lead != null ? `${p.lead.toFixed(1)}일` : "–"}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] text-slate-500">단독 담당</dt>
                    <dd className={cn("font-semibold tabular-nums", critical ? "text-amber-700" : "text-slate-900")}>{critical}</dd>
                  </div>
                </dl>
                <div className="flex gap-5 text-xs">
                  <label className="flex items-center gap-2 text-slate-700">
                    <Toggle on={c.isContracted} onChange={() => toggle(c, "isContracted")} label="계약 여부" />
                    {c.isContracted ? "계약" : "미계약"}
                  </label>
                  <label className="flex items-center gap-2 text-slate-700">
                    <Toggle on={c.isAvailable} onChange={() => toggle(c, "isAvailable")} label="업무 가능 여부" />
                    {c.isAvailable ? "업무 가능" : "업무 불가"}
                  </label>
                </div>
              </li>
            );
          })}
        </ul>

        {filtered.length === 0 && (
          <div className="px-5 py-12 text-center text-sm text-slate-500">
            <p>조건에 맞는 업체가 없습니다.</p>
            {typeFilter !== "ALL" && districtFilter !== "ALL" && (
              <button className="btn-primary mt-3" onClick={() => setEditing({ id: null, body: { ...EMPTY, defectTypes: [typeFilter], regions: [districtFilter] } })}>
                <Plus className="size-4" /> {DEFECT_LABEL[typeFilter]} · {districtFilter} 담당 업체 등록
              </button>
            )}
          </div>
        )}
      </section>

      {editing && (
        <ContractorModal
          initial={editing.body}
          id={editing.id}
          regions={allRegions}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function Kpi({
  icon: Icon,
  tone,
  label,
  value,
  unit,
  sub,
  alert,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tone: string;
  label: string;
  value: string;
  unit: string;
  sub: string;
  alert?: boolean;
}) {
  return (
    <div className={cn("card p-4", alert && "border-red-200")}>
      <div className="flex items-start justify-between">
        <p className="text-xs font-medium text-slate-500">{label}</p>
        <span className={cn("rounded-lg p-1.5", tone)}>
          <Icon className="size-4" />
        </span>
      </div>
      <p className="mt-2 text-2xl font-bold text-slate-900 tabular-nums">
        {value}
        <span className="ml-0.5 text-sm font-medium text-slate-400">{unit}</span>
      </p>
      <p className={cn("mt-1 truncate text-[11px]", alert ? "font-medium text-red-600" : "text-slate-500")}>{sub}</p>
    </div>
  );
}

function ContractorModal({
  initial,
  id,
  regions,
  onClose,
  onSaved,
}: {
  initial: Body;
  id: string | null;
  regions: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [b, setB] = useState<Body>({
    name: initial.name,
    defectTypes: initial.defectTypes,
    regions: initial.regions,
    phone: initial.phone,
    email: initial.email,
    isContracted: initial.isContracted,
    isAvailable: initial.isAvailable,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const toggleIn = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const regionOptions = Array.from(new Set([...regions, ...b.regions]));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api(id ? `/api/contractors/${id}` : "/api/contractors", { method: id ? "PATCH" : "POST", json: b });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 sm:items-center sm:p-4">
      <form onSubmit={save} className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white shadow-xl sm:rounded-2xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-4">
          <h2 className="font-semibold text-slate-900">{id ? "업체 정보 수정" : "업체 등록"}</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-slate-400 hover:text-slate-700" aria-label="닫기">
            <X className="size-5" />
          </button>
        </div>
        <div className="space-y-4 p-5">
          <div>
            <label className="label">업체명 *</label>
            <input className="input" value={b.name} onChange={(e) => setB({ ...b, name: e.target.value })} />
          </div>
          <div>
            <label className="label">담당 하자 유형 *</label>
            <div className="flex flex-wrap gap-1.5">
              {DEFECT_TYPES.map((d) => (
                <button
                  type="button"
                  key={d.value}
                  onClick={() => setB({ ...b, defectTypes: toggleIn(b.defectTypes, d.value) })}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs",
                    b.defectTypes.includes(d.value) ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 text-slate-600 hover:border-slate-400",
                  )}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="label">담당 지역 *</label>
            <div className="flex flex-wrap gap-1.5">
              {regionOptions.map((r) => (
                <button
                  type="button"
                  key={r}
                  onClick={() => setB({ ...b, regions: toggleIn(b.regions, r) })}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs",
                    b.regions.includes(r) ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 text-slate-600 hover:border-slate-400",
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
            <div className="mt-2 flex gap-3 text-xs">
              <button type="button" className="text-blue-600 hover:underline" onClick={() => setB({ ...b, regions: [...regionOptions] })}>
                서울 전체 선택
              </button>
              <button type="button" className="text-slate-500 hover:underline" onClick={() => setB({ ...b, regions: [] })}>
                선택 해제
              </button>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">연락처 *</label>
              <input className="input" value={b.phone} onChange={(e) => setB({ ...b, phone: e.target.value })} />
            </div>
            <div>
              <label className="label">이메일</label>
              <input className="input" type="email" value={b.email} onChange={(e) => setB({ ...b, email: e.target.value })} />
            </div>
          </div>
          <div className="flex gap-6 text-sm">
            <label className="flex items-center gap-2">
              <Toggle on={b.isContracted} onChange={() => setB({ ...b, isContracted: !b.isContracted })} label="계약 여부" /> 계약 업체
            </label>
            <label className="flex items-center gap-2">
              <Toggle on={b.isAvailable} onChange={() => setB({ ...b, isAvailable: !b.isAvailable })} label="업무 가능 여부" /> 업무 가능
            </label>
          </div>
          {error && <ErrorBox message={error} />}
        </div>
        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-slate-100 bg-white px-5 py-3">
          <button type="button" className="btn-secondary" onClick={onClose}>
            취소
          </button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving && <Loader2 className="size-4 animate-spin" />} 저장
          </button>
        </div>
      </form>
    </div>
  );
}
