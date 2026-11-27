"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export interface DailyPoint {
  key: string; // YYYY-MM-DD
  month: number;
  day: number;
  weekday: string; // 월~일
  count: number;
  isToday: boolean;
}

/** 최근 N일 일별 접수 건수 막대 차트 (단일 계열, 평균선, 막대별 툴팁) */
export default function DailyIntakeChart({ data }: { data: DailyPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.count));
  // 눈금: 0과 보기 좋은 최댓값
  const top = max <= 5 ? 5 : Math.ceil(max / 5) * 5;
  const avg = data.reduce((s, d) => s + d.count, 0) / (data.length || 1);
  const h = (v: number) => `${(v / top) * 100}%`;

  return (
    <div>
      <div className="relative flex h-56">
        {/* y축 눈금 */}
        <div className="flex w-6 shrink-0 flex-col justify-between pr-1.5 text-right text-[10px] text-slate-400 tabular-nums">
          <span className="-translate-y-1/2">{top}</span>
          <span className="-translate-y-1/2">{Math.round(top / 2)}</span>
          <span className="translate-y-1/2">0</span>
        </div>

        <div className="relative flex-1">
          {/* 격자선 */}
          <div className="absolute inset-x-0 top-0 border-t border-slate-100" />
          <div className="absolute inset-x-0 top-1/2 border-t border-slate-100" />
          <div className="absolute inset-x-0 bottom-0 border-t border-slate-200" />

          {/* 평균선 */}
          <div className="pointer-events-none absolute inset-x-0 z-[1] border-t border-dashed border-slate-400" style={{ bottom: h(avg) }}>
            <span className="absolute -top-4 left-1 rounded bg-white/90 px-1 text-[10px] text-slate-500 tabular-nums">일평균 {avg.toFixed(1)}건</span>
          </div>

          {/* 막대 */}
          <div className="absolute inset-0 flex items-end gap-[2px]">
            {data.map((d, i) => (
              <div
                key={d.key}
                className="group relative flex h-full flex-1 cursor-default items-end justify-center"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              >
                <div
                  className={cn(
                    "w-full max-w-7 rounded-t-[4px] transition-colors",
                    d.isToday ? "bg-[#1c5cab]" : "bg-[#5598e7]",
                    hover === i && "brightness-110",
                    hover !== null && hover !== i && "opacity-60",
                  )}
                  style={{ height: h(d.count), minHeight: d.count ? 2 : 0 }}
                />
                {hover === i && (
                  <div
                    className="pointer-events-none absolute z-10 w-max rounded-md bg-slate-900 px-2 py-1 text-[11px] text-white shadow-lg"
                    style={{ bottom: `calc(${h(d.count)} + 6px)` }}
                  >
                    <p className="font-medium">
                      {d.month}/{d.day} ({d.weekday}){d.isToday && " · 오늘"}
                    </p>
                    <p className="tabular-nums">접수 {d.count}건</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* x축 */}
      <div className="ml-6 mt-1.5 flex gap-[2px] text-[10px] text-slate-400 tabular-nums">
        {data.map((d, i) => (
          <span key={d.key} className={cn("flex-1 text-center", d.isToday && "font-semibold text-slate-700", d.weekday === "일" && !d.isToday && "text-rose-400")}>
            {i === 0 || d.day === 1 ? `${d.month}/${d.day}` : d.isToday ? "오늘" : d.day}
          </span>
        ))}
      </div>
    </div>
  );
}
