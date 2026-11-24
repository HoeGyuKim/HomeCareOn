"use client";

import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { SEOUL_DISTRICTS } from "@/lib/seoul";
import type { DistrictStat } from "@/lib/types";
import { cn } from "@/lib/utils";

// 처리율 5단계 — 단일 파랑 계열, 밝을수록 낮음 (dataviz 검증 통과: 단조 명도·단일 색상·표면 대비)
const BINS = [
  { min: 0, label: "0–20%", fill: "#86b6ef", ink: "#0f172a" },
  { min: 0.2, label: "20–40%", fill: "#5598e7", ink: "#0f172a" },
  { min: 0.4, label: "40–60%", fill: "#2a78d6", ink: "#ffffff" },
  { min: 0.6, label: "60–80%", fill: "#1c5cab", ink: "#ffffff" },
  { min: 0.8, label: "80–100%", fill: "#0d366b", ink: "#ffffff" },
];
const binOf = (rate: number) => [...BINS].reverse().find((b) => rate >= b.min)!;
const pct = (rate: number) => `${Math.round(rate * 100)}%`;
const short = (name: string) => (name.length > 2 ? name.replace(/구$/, "") : name);

const COLS = 6;
const ROWS = 6;

export default function DistrictRateMap({ data }: { data: DistrictStat[] }) {
  const [hover, setHover] = useState<string | null>(null);
  const [order, setOrder] = useState<"low" | "high">("low");
  const byName = useMemo(() => Object.fromEntries(data.map((d) => [d.district, d])), [data]);

  const withData = data.filter((d) => d.total > 0);
  const empty = data.length - withData.length;
  const sorted = [...withData].sort((a, b) =>
    order === "low" ? a.rate! - b.rate! || b.total - a.total : b.rate! - a.rate! || b.total - a.total,
  );
  const hovered = hover ? byName[hover] : null;
  const hoveredTile = hover ? SEOUL_DISTRICTS.find((d) => d.name === hover) : null;

  return (
    <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,26rem)_1fr] lg:gap-8">
      {/* 타일 지도 */}
      <div>
        <div className="relative mx-auto w-full max-w-[26rem]">
          <div className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${ROWS}, minmax(0, 1fr))` }}>
            {SEOUL_DISTRICTS.map((t) => {
              const d = byName[t.name];
              const has = d && d.total > 0;
              const bin = has ? binOf(d.rate!) : null;
              return (
                <Link
                  key={t.name}
                  href={`/complaints?district=${encodeURIComponent(t.name)}`}
                  onMouseEnter={() => setHover(t.name)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(t.name)}
                  onBlur={() => setHover(null)}
                  aria-label={has ? `${t.name} 처리율 ${pct(d.rate!)}, 완료 ${d.completed}건 / 전체 ${d.total}건` : `${t.name} 접수 없음`}
                  className={cn(
                    "flex aspect-square flex-col items-center justify-center rounded-[4px] text-center leading-tight outline-offset-2 transition-[filter] hover:brightness-110 focus-visible:outline-2 focus-visible:outline-slate-900",
                    !has && "border border-dashed border-slate-300 bg-slate-50",
                    hover === t.name && "ring-2 ring-slate-900 ring-offset-1",
                  )}
                  style={{ gridColumn: t.col + 1, gridRow: t.row + 1, ...(bin ? { background: bin.fill, color: bin.ink } : {}) }}
                >
                  <span className={cn("text-[10px] sm:text-xs", has ? "font-medium" : "text-slate-500")}>{short(t.name)}</span>
                  <span className={cn("text-xs font-bold tabular-nums sm:text-sm", !has && "font-normal text-slate-400")}>
                    {has ? pct(d.rate!) : "–"}
                  </span>
                </Link>
              );
            })}
          </div>

          {/* 호버 툴팁 */}
          {hovered && hoveredTile && (
            <div
              className="pointer-events-none absolute z-10 w-max -translate-x-1/2 -translate-y-full rounded-lg bg-slate-900 px-3 py-2 text-xs text-white shadow-lg"
              style={{ left: `${((hoveredTile.col + 0.5) / COLS) * 100}%`, top: `calc(${(hoveredTile.row / ROWS) * 100}% - 6px)` }}
            >
              <p className="font-semibold">{hovered.district}</p>
              {hovered.total ? (
                <>
                  <p className="tabular-nums">처리율 {pct(hovered.rate!)} · 완료 {hovered.completed}/{hovered.total}건</p>
                  <p className="text-slate-300 tabular-nums">진행 {hovered.inProgress}건 · 대기 {hovered.waiting}건</p>
                </>
              ) : (
                <p className="text-slate-300">접수된 민원 없음</p>
              )}
            </div>
          )}
        </div>

        {/* 범례 */}
        <div className="mx-auto mt-4 max-w-[26rem]">
          <p className="mb-1.5 text-[11px] text-slate-500">처리 완료율</p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-slate-600">
            {BINS.map((b) => (
              <span key={b.label} className="inline-flex items-center gap-1">
                <i className="size-3 rounded-[3px]" style={{ background: b.fill }} />
                {b.label}
              </span>
            ))}
            <span className="inline-flex items-center gap-1">
              <i className="size-3 rounded-[3px] border border-dashed border-slate-300 bg-slate-50" />
              접수 없음
            </span>
          </div>
        </div>
      </div>

      {/* 구별 순위 (값 확인용 목록) */}
      <div className="min-w-0">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-xs text-slate-500">
            접수 {withData.length}개 구{empty > 0 && ` · 접수 없음 ${empty}개 구`}
          </p>
          <div className="flex rounded-lg bg-slate-100 p-0.5 text-xs" role="group" aria-label="정렬">
            {(["low", "high"] as const).map((o) => (
              <button
                key={o}
                onClick={() => setOrder(o)}
                aria-pressed={order === o}
                className={cn("rounded-md px-2.5 py-1", order === o ? "bg-white font-medium text-slate-900 shadow-sm" : "text-slate-500")}
              >
                {o === "low" ? "처리율 낮은 순" : "높은 순"}
              </button>
            ))}
          </div>
        </div>
        <ul className="max-h-[26rem] space-y-0.5 overflow-y-auto pr-1">
          {sorted.map((d) => (
            <li key={d.district}>
              <Link
                href={`/complaints?district=${encodeURIComponent(d.district)}`}
                onMouseEnter={() => setHover(d.district)}
                onMouseLeave={() => setHover(null)}
                className={cn(
                  "grid grid-cols-[4.5rem_1fr_auto] items-center gap-3 rounded-md px-2 py-1.5 text-xs hover:bg-slate-50",
                  hover === d.district && "bg-slate-50",
                )}
              >
                <span className="font-medium text-slate-800">{d.district}</span>
                <span className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <span className="block h-full rounded-full bg-[#2a78d6]" style={{ width: `${d.rate! * 100}%`, minWidth: d.rate ? 4 : 0 }} />
                </span>
                <span className="flex items-center justify-end gap-2 tabular-nums">
                  {d.waiting > 0 && (
                    <span className="inline-flex items-center gap-0.5 text-amber-700" title="접수 대기(관리자 확인 대기 포함)">
                      <AlertTriangle className="size-3" />
                      대기 {d.waiting}
                    </span>
                  )}
                  <span className="w-9 text-right font-semibold text-slate-900">{pct(d.rate!)}</span>
                  <span className="w-9 text-right text-slate-500">
                    {d.completed}/{d.total}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
