"use client";

import { Camera, ChevronRight } from "lucide-react";
import Link from "next/link";
import { DEFECT_LABEL } from "@/lib/constants";
import type { Complaint, Contractor } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";
import { StatusBadge, UrgencyBadge } from "./ui";

interface Props {
  items: Complaint[];
  contractors: Contractor[];
  emptyText?: string;
}

/** PC: 표 / 모바일: 카드 */
export default function ComplaintList({ items, contractors, emptyText = "조건에 맞는 민원이 없습니다." }: Props) {
  const nameOf = (id: string | null) => (id ? contractors.find((c) => c.id === id)?.name ?? "-" : null);

  if (items.length === 0) return <p className="px-5 py-12 text-center text-sm text-slate-500">{emptyText}</p>;

  return (
    <>
      {/* PC 표 */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-4 py-2.5 font-medium">접수번호</th>
              <th className="px-4 py-2.5 font-medium">접수 일시</th>
              <th className="px-4 py-2.5 font-medium">민원인</th>
              <th className="px-4 py-2.5 font-medium">단지 / 동·호</th>
              <th className="px-4 py-2.5 font-medium">하자 유형</th>
              <th className="px-4 py-2.5 font-medium">긴급도</th>
              <th className="px-4 py-2.5 font-medium">배정 업체</th>
              <th className="px-4 py-2.5 font-medium">상태</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((c) => (
              <tr key={c.id} className="group hover:bg-blue-50/40">
                <td className="px-4 py-3 whitespace-nowrap">
                  <Link href={`/complaints/${c.id}`} className="font-medium text-blue-700 group-hover:underline">
                    {c.receiptNo}
                  </Link>
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-slate-600 tabular-nums">{formatDateTime(c.receivedAt)}</td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <p className="font-medium text-slate-900">{c.complainantName}</p>
                  <p className="text-xs text-slate-500 tabular-nums">{c.phone}</p>
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <p className="text-slate-900">{c.apartmentName}</p>
                  <p className="text-xs text-slate-500">
                    {c.building}동 {c.unit}호
                  </p>
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-slate-700">
                  <span className="inline-flex items-center gap-1">
                    {DEFECT_LABEL[c.defectType]}
                    {c.photos.length > 0 && <Camera className="size-3.5 text-slate-400" aria-label="사진 첨부" />}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <UrgencyBadge urgency={c.urgency} />
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-slate-700">
                  {nameOf(c.contractorId) ?? <span className="text-slate-400">미배정</span>}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={c.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 모바일 카드 */}
      <ul className="divide-y divide-slate-100 md:hidden">
        {items.map((c) => (
          <li key={c.id}>
            <Link href={`/complaints/${c.id}`} className="flex items-center gap-3 px-4 py-3.5 active:bg-slate-50">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <UrgencyBadge urgency={c.urgency} />
                  <StatusBadge status={c.status} />
                  <span className="text-xs text-slate-400 tabular-nums">{c.receiptNo}</span>
                </div>
                <p className="truncate text-sm font-medium text-slate-900">
                  {c.apartmentName} {c.building}동 {c.unit}호 · {DEFECT_LABEL[c.defectType]}
                </p>
                <p className="truncate text-xs text-slate-500">
                  {c.complainantName} · {formatDateTime(c.receivedAt)} · {nameOf(c.contractorId) ?? "미배정"}
                </p>
              </div>
              <ChevronRight className="size-4 shrink-0 text-slate-300" />
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
