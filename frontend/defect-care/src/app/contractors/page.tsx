"use client";

import { Loader2, Mail, Pencil, Phone, Plus, Search, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ErrorBox, Spinner } from "@/components/ui";
import { api } from "@/lib/client-api";
import { DEFECT_LABEL, DEFECT_TYPES } from "@/lib/constants";
import { DISTRICT_NAMES } from "@/lib/seoul";
import type { Contractor, DefectType } from "@/lib/types";
import { cn } from "@/lib/utils";

type Body = Omit<Contractor, "id" | "createdAt">;
const EMPTY: Body = { name: "", defectTypes: [], regions: [], phone: "", email: "", isContracted: true, isAvailable: true };

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

export default function ContractorsPage() {
  const [items, setItems] = useState<Contractor[] | null>(null);
  const [load, setLoad] = useState<Record<string, number>>({});
  const [regions, setRegions] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState<DefectType | "ALL">("ALL");
  const [editing, setEditing] = useState<{ id: string | null; body: Body } | null>(null);

  const refresh = useCallback(() => {
    api<{ items: Contractor[]; load: Record<string, number> }>("/api/contractors")
      .then((r) => {
        setItems(r.items);
        setLoad(r.load);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    refresh();
    api<{ regions: string[] }>("/api/meta").then((m) => setRegions(m.regions)).catch(() => {});
  }, [refresh]);

  const filtered = useMemo(() => {
    const k = q.trim();
    return (items ?? []).filter(
      (c) =>
        (typeFilter === "ALL" || c.defectTypes.includes(typeFilter)) &&
        (!k || c.name.includes(k) || c.regions.some((r) => r.includes(k)) || c.phone.includes(k)),
    );
  }, [items, q, typeFilter]);

  const toggle = async (c: Contractor, key: "isContracted" | "isAvailable") => {
    try {
      await api(`/api/contractors/${c.id}`, { method: "PATCH", json: { [key]: !c[key] } });
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const remove = async (c: Contractor) => {
    if (!confirm(`'${c.name}' 업체를 삭제하시겠습니까?`)) return;
    try {
      await api(`/api/contractors/${c.id}`, { method: "DELETE" });
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const allRegions = regions.length ? regions : DISTRICT_NAMES;

  return (
    <div className="space-y-4">
      <div className="card grid gap-3 p-4 sm:grid-cols-[1fr_12rem_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9" placeholder="업체명, 지역, 연락처 검색" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="input" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as DefectType | "ALL")} aria-label="담당 하자 유형">
          <option value="ALL">전체 담당 분야</option>
          {DEFECT_TYPES.map((d) => (
            <option key={d.value} value={d.value}>{d.label}</option>
          ))}
        </select>
        <button className="btn-primary" onClick={() => setEditing({ id: null, body: EMPTY })}>
          <Plus className="size-4" /> 업체 등록
        </button>
      </div>

      {error && <ErrorBox message={error} />}

      {!items ? (
        <Spinner />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((c) => (
            <article key={c.id} className={cn("card flex flex-col p-4", !(c.isContracted && c.isAvailable) && "bg-slate-50/60")}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="truncate font-semibold text-slate-900">{c.name}</h3>
                  <p className="mt-0.5 text-xs text-slate-500">진행 중 {load[c.id] ?? 0}건</p>
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
              <div className="mt-3 flex flex-wrap gap-1">
                {c.defectTypes.map((d) => (
                  <span key={d} className="rounded bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-700">{DEFECT_LABEL[d]}</span>
                ))}
              </div>
              <p className="mt-2 text-xs text-slate-600">
                <span className="text-slate-400">담당 지역 </span>
                {c.regions.length === DISTRICT_NAMES.length ? "서울 전체" : c.regions.join(", ")}
              </p>
              <div className="mt-2 space-y-0.5 text-xs text-slate-600">
                <p className="flex items-center gap-1.5"><Phone className="size-3" /> {c.phone}</p>
                <p className="flex items-center gap-1.5 truncate"><Mail className="size-3" /> {c.email || "-"}</p>
              </div>
              <div className="mt-auto flex gap-5 border-t border-slate-100 pt-3 text-xs">
                <label className="flex items-center gap-2 text-slate-700">
                  <Toggle on={c.isContracted} onChange={() => toggle(c, "isContracted")} label="계약 여부" />
                  {c.isContracted ? "계약" : "미계약"}
                </label>
                <label className="flex items-center gap-2 text-slate-700">
                  <Toggle on={c.isAvailable} onChange={() => toggle(c, "isAvailable")} label="업무 가능 여부" />
                  {c.isAvailable ? "업무 가능" : "업무 불가"}
                </label>
              </div>
            </article>
          ))}
          {filtered.length === 0 && <p className="col-span-full py-12 text-center text-sm text-slate-500">조건에 맞는 업체가 없습니다.</p>}
        </div>
      )}

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
          <button type="button" className="btn-secondary" onClick={onClose}>취소</button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving && <Loader2 className="size-4 animate-spin" />} 저장
          </button>
        </div>
      </form>
    </div>
  );
}
