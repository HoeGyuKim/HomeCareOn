"use client";

import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { HAN_RIVER_ISLANDS, HAN_RIVER_OUTER, SAETGANG_LINE, SEOUL_DISTRICT_SHAPES, SEOUL_MAP_HEIGHT, SEOUL_MAP_WIDTH } from "@/lib/seoul-geo";
import type { DistrictStat } from "@/lib/types";
import { cn } from "@/lib/utils";

// 처리율 연속 색상 — 단일 파랑 계열, 처리율 1% → 100%로 갈수록 점점 짙어짐
// 중간(50%)에 선명한 파랑을 두어 중간 구간이 회색으로 탁해지지 않게 함
const STOPS: [number, number[]][] = [
  [0, [219, 234, 254]], // #dbeafe (낮음)
  [0.5, [42, 120, 214]], // #2a78d6
  [1, [11, 46, 92]], // #0b2e5c (높음)
];
const toLin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fillOf = (rate: number) => {
  const t = Math.min(1, Math.max(0, rate));
  const i = t <= 0.5 ? 0 : 1;
  const [t0, c0] = STOPS[i];
  const [t1, c1] = STOPS[i + 1];
  const u = (t - t0) / (t1 - t0);
  const [r, g, b] = c0.map((c, k) => Math.round(c + (c1[k] - c) * u));
  return { fill: `rgb(${r}, ${g}, ${b})`, lum: 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b) };
};
// 배경이 어두우면 흰 글씨, 밝으면 검은 글씨
const inkOf = (lum: number) => (lum < 0.22 ? "#ffffff" : "#0f172a");
const GRADIENT = `linear-gradient(to right, ${STOPS.map(([t, c]) => `rgb(${c.join(",")}) ${t * 100}%`).join(", ")})`;
const pct = (rate: number) => `${Math.round(rate * 100)}%`;
const short = (name: string) => (name.length > 2 ? name.replace(/구$/, "") : name);

// 지도 가장자리 여백: 테두리·호버 강조선이 잘리지 않게
const PAD = 12;
// 한강: 처리율 파랑과 헷갈리지 않도록 채도가 낮은 회청색
const RIVER_FILL = "#d3dce3";
const RIVER_EDGE = "#a9b8c4";
const RIVER_LABEL = { x: 298, y: 339 }; // 도심 구간에서 한강 폭이 가장 넓은 곳(반포 부근)
const VB_W = SEOUL_MAP_WIDTH + PAD * 2;
const VB_H = SEOUL_MAP_HEIGHT + PAD * 2;

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
  const hoveredShape = hover ? SEOUL_DISTRICT_SHAPES.find((d) => d.name === hover) : null;
  // 호버한 구를 맨 마지막에 그려 강조 테두리가 이웃 구에 가려지지 않게 함
  const shapes = hover
    ? [...SEOUL_DISTRICT_SHAPES.filter((s) => s.name !== hover), ...SEOUL_DISTRICT_SHAPES.filter((s) => s.name === hover)]
    : SEOUL_DISTRICT_SHAPES;

  return (
    <div className="grid grid-cols-1 gap-6 p-5 lg:grid-cols-[minmax(0,34rem)_1fr] lg:gap-8">
      {/* 서울 지도 */}
      <div>
        <div className="relative mx-auto w-full max-w-[34rem]">
          <svg viewBox={`${-PAD} ${-PAD} ${VB_W} ${VB_H}`} className="block h-auto w-full" role="img" aria-label="서울 자치구별 민원 처리율 지도">
            <defs>
              {/* 서울 경계: 한강을 서울 안쪽만 그리도록 자름 */}
              <clipPath id="seoul-clip">
                {SEOUL_DISTRICT_SHAPES.map((s) => (
                  <path key={s.name} d={s.d} />
                ))}
              </clipPath>
              {/* 한강 수면 = 바깥 경계(흰색) − 섬(검은색) */}
              <mask id="han-river-mask" maskUnits="userSpaceOnUse" x={-PAD} y={-PAD} width={VB_W} height={VB_H}>
                <path d={HAN_RIVER_OUTER} fill="#fff" />
                <path d={HAN_RIVER_ISLANDS} fill="#000" />
              </mask>
            </defs>
            {shapes.map((s) => {
              const d = byName[s.name];
              const has = d && d.total > 0;
              const c = has ? fillOf(d.rate!) : null;
              const active = hover === s.name;
              return (
                <Link
                  key={s.name}
                  href={`/complaints?district=${encodeURIComponent(s.name)}`}
                  onMouseEnter={() => setHover(s.name)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(s.name)}
                  onBlur={() => setHover(null)}
                  aria-label={has ? `${s.name} 처리율 ${pct(d.rate!)}, 완료 ${d.completed}건 / 전체 ${d.total}건` : `${s.name} 접수 없음`}
                  className="outline-none"
                >
                  <path
                    d={s.d}
                    fill={c ? c.fill : "#f8fafc"}
                    stroke={active ? "#0f172a" : c ? "#ffffff" : "#cbd5e1"}
                    strokeWidth={active ? 2.5 : 1.5}
                    strokeDasharray={!c && !active ? "4 3" : undefined}
                    strokeLinejoin="round"
                    className="cursor-pointer transition-[filter] hover:brightness-110"
                  />
                </Link>
              );
            })}

            {/* 구 이름·처리율 라벨 (클릭을 막지 않도록 포인터 무시) */}
            {/* 한강 (마우스 이벤트는 아래 구로 통과) */}
            <g pointerEvents="none" clipPath="url(#seoul-clip)">
              {/* 수면 조각이 겹치는 이음매가 보이지 않도록 외곽선 없이 마스크로만 채움 */}
              <rect x={-PAD} y={-PAD} width={VB_W} height={VB_H} fill={RIVER_FILL} mask="url(#han-river-mask)" />
              {/* 샛강: 여의도와 영등포 본토 사이 물길 — 실제 폭은 너무 좁아 보이도록 굵게 그림 */}
              <path d={SAETGANG_LINE} fill="none" stroke={RIVER_FILL} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
            </g>
            <text
              x={RIVER_LABEL.x}
              y={RIVER_LABEL.y}
              pointerEvents="none"
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={9}
              fontStyle="italic"
              fontWeight={600}
              fill="#5b6b78"
              letterSpacing={1}
            >
              한강
            </text>

            {/* 위치: 구 안에서 경계와 가장 먼 점 — 모양이 길쭉해도 글자가 이웃 구로 넘어가지 않음 */}
            <g pointerEvents="none" textAnchor="middle" dominantBaseline="central">
              {SEOUL_DISTRICT_SHAPES.map((s) => {
                const d = byName[s.name];
                const has = d && d.total > 0;
                const c = has ? fillOf(d.rate!) : null;
                const ink = c ? inkOf(c.lum) : "#64748b";
                const size = s.r < 20 ? 11 : 13; // 작은 구(중구·금천·구로·양천)는 글자를 줄임
                const halo = { stroke: c ? c.fill : "#f8fafc", strokeWidth: 3, paintOrder: "stroke" as const, strokeLinejoin: "round" as const };
                return (
                  <text key={s.name} fill={ink} fontSize={size} style={halo}>
                    <tspan x={s.cx} y={s.cy - size * 0.6} fontWeight={600}>
                      {short(s.name)}
                    </tspan>
                    <tspan x={s.cx} y={s.cy + size * 0.6} fontWeight={700} style={{ fontVariantNumeric: "tabular-nums" }}>
                      {has ? pct(d.rate!) : "–"}
                    </tspan>
                  </text>
                );
              })}
            </g>
          </svg>

          {/* 호버 툴팁 */}
          {hovered && hoveredShape && (
            <div
              className="pointer-events-none absolute z-10 w-max -translate-x-1/2 -translate-y-full rounded-lg bg-slate-900 px-3 py-2 text-xs text-white shadow-lg"
              style={{
                left: `${((hoveredShape.cx + PAD) / VB_W) * 100}%`,
                top: `calc(${((hoveredShape.cy - hoveredShape.r * 0.6 + PAD) / VB_H) * 100}% - 6px)`,
              }}
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

        {/* 범례: 연속 색상 막대 */}
        <div className="mx-auto mt-4 max-w-[34rem]">
          <p className="mb-1.5 text-[11px] text-slate-500">처리 완료율</p>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-slate-600">
            <div className="min-w-48 flex-1">
              <div className="h-2.5 rounded-full" style={{ background: GRADIENT }} />
              <div className="mt-1 flex justify-between tabular-nums text-slate-500">
                <span>1%</span>
                <span>25%</span>
                <span>50%</span>
                <span>75%</span>
                <span>100%</span>
              </div>
            </div>
            <span className="inline-flex items-center gap-1">
              <i className="size-3 rounded-[3px] border border-dashed border-slate-300 bg-slate-50" />
              접수 없음
            </span>
            <span className="inline-flex items-center gap-1">
              <i className="h-1.5 w-4 rounded-full" style={{ background: RIVER_FILL, boxShadow: `inset 0 0 0 0.5px ${RIVER_EDGE}` }} />
              한강
            </span>
          </div>
          <p className="mt-2 text-[10px] text-slate-400">지도 출처: 통계청 행정구역 경계(2013) · 한강 © OpenStreetMap contributors</p>
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
        <ul className="max-h-[30rem] space-y-0.5 overflow-y-auto pr-1">
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
