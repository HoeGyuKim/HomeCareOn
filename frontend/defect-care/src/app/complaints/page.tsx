"use client";

import { Plus, RotateCcw, Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import ComplaintList from "@/components/ComplaintList";
import { ErrorBox, Spinner } from "@/components/ui";
import { api } from "@/lib/client-api";
import { DEFECT_TYPES, STATUSES, URGENCIES } from "@/lib/constants";
import { DISTRICT_NAMES } from "@/lib/seoul";
import type { Complaint, Contractor } from "@/lib/types";

function ComplaintsView() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const status = sp.get("status") ?? "ALL";
  const defectType = sp.get("defectType") ?? "ALL";
  const urgency = sp.get("urgency") ?? "ALL";
  const district = sp.get("district") ?? "ALL";
  const q = sp.get("q") ?? "";

  const [keyword, setKeyword] = useState(q);
  const [items, setItems] = useState<Complaint[] | null>(null);
  const [contractors, setContractors] = useState<Contractor[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ items: Contractor[] }>("/api/contractors").then((r) => setContractors(r.items)).catch(() => {});
  }, []);

  useEffect(() => {
    const params = new URLSearchParams({ status, defectType, urgency, district, q });
    let alive = true;
    api<{ items: Complaint[] }>(`/api/complaints?${params}`)
      .then((r) => alive && (setItems(r.items), setError("")))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [status, defectType, urgency, district, q]);

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(sp.toString());
    if (!value || value === "ALL") next.delete(key);
    else next.set(key, value);
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`);
  };

  const reset = () => {
    setKeyword("");
    router.replace(pathname);
  };

  return (
    <div className="space-y-4">
      {/* 검색 및 필터 */}
      <form
        className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[1fr_8rem_9rem_9rem_7rem_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          update("q", keyword.trim());
        }}
      >
        <div className="relative sm:col-span-2 lg:col-span-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
          <input
            className="input pl-9"
            placeholder="접수번호, 이름, 전화번호, 단지명, 내용 검색"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
        </div>
        <select className="input" value={district} onChange={(e) => update("district", e.target.value)} aria-label="자치구">
          <option value="ALL">전체 구</option>
          {DISTRICT_NAMES.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <select className="input" value={status} onChange={(e) => update("status", e.target.value)} aria-label="처리 상태">
          <option value="ALL">전체 상태</option>
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
        <select className="input" value={defectType} onChange={(e) => update("defectType", e.target.value)} aria-label="하자 유형">
          <option value="ALL">전체 유형</option>
          {DEFECT_TYPES.map((d) => (
            <option key={d.value} value={d.value}>{d.label}</option>
          ))}
        </select>
        <select className="input" value={urgency} onChange={(e) => update("urgency", e.target.value)} aria-label="긴급도">
          <option value="ALL">전체 긴급도</option>
          {URGENCIES.map((u) => (
            <option key={u.value} value={u.value}>{u.label}</option>
          ))}
        </select>
        <div className="flex gap-2">
          <button type="submit" className="btn-primary flex-1">검색</button>
          <button type="button" onClick={reset} className="btn-secondary" aria-label="필터 초기화">
            <RotateCcw className="size-4" />
          </button>
        </div>
      </form>

      <section className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <p className="text-sm text-slate-600">
            검색 결과 <b className="text-slate-900 tabular-nums">{items?.length ?? 0}</b>건
          </p>
          <Link href="/complaints/new" className="btn-secondary py-1.5 text-xs">
            <Plus className="size-3.5" />
            직접 등록
          </Link>
        </div>
        {error ? <div className="p-4"><ErrorBox message={error} /></div> : items ? <ComplaintList items={items} contractors={contractors} /> : <Spinner />}
      </section>
    </div>
  );
}

export default function ComplaintsPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <ComplaintsView />
    </Suspense>
  );
}
