"use client";

import { AlertTriangle, ArrowLeft, Bot, Check, CheckCircle2, Loader2, Mail, Phone, RefreshCw, User, Wand2 } from "lucide-react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import ScheduleOfferCard from "@/components/ScheduleOfferCard";
import { ErrorBox, SectionTitle, Spinner, StatusBadge, UrgencyBadge } from "@/components/ui";
import { api } from "@/lib/client-api";
import { DEFECT_LABEL, STATUS_FLOW, STATUS_LABEL, STATUSES } from "@/lib/constants";
import type { AssignmentResult, Complaint, ComplaintStatus, Contractor } from "@/lib/types";
import { cn, formatDateTime } from "@/lib/utils";

interface Detail {
  complaint: Complaint;
  contractor: Contractor | null;
  recommendation: AssignmentResult;
  contractors: Contractor[];
}

const ACTOR_LABEL = { AI: "AI", SYSTEM: "시스템", ADMIN: "관리자" } as const;

function Stepper({ status }: { status: ComplaintStatus }) {
  const idx = status === "PENDING_REVIEW" ? 0 : STATUS_FLOW.indexOf(status);
  return (
    <ol className="flex items-center">
      {STATUS_FLOW.map((s, i) => {
        const done = i < idx || status === "COMPLETED";
        const current = i === idx && status !== "COMPLETED";
        return (
          <li key={s} className={cn("flex items-center", i < STATUS_FLOW.length - 1 && "flex-1")}>
            <div className="flex flex-col items-center gap-1.5">
              <span
                className={cn(
                  "flex size-7 items-center justify-center rounded-full text-xs font-semibold ring-2",
                  done && "bg-blue-600 text-white ring-blue-600",
                  current && (status === "PENDING_REVIEW" ? "bg-amber-50 text-amber-600 ring-amber-400" : "bg-white text-blue-600 ring-blue-600"),
                  !done && !current && "bg-white text-slate-400 ring-slate-200",
                )}
              >
                {done ? <Check className="size-3.5" /> : current && status === "PENDING_REVIEW" ? "!" : i + 1}
              </span>
              <span className={cn("text-[11px] whitespace-nowrap sm:text-xs", current || done ? "font-medium text-slate-900" : "text-slate-400")}>
                {i === 0 && status === "PENDING_REVIEW" ? "확인 대기" : STATUS_LABEL[s]}
              </span>
            </div>
            {i < STATUS_FLOW.length - 1 && (
              <span className={cn("mx-1 mb-5 h-0.5 flex-1 sm:mx-2", i < idx || status === "COMPLETED" ? "bg-blue-600" : "bg-slate-200")} />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-900">{children}</dd>
    </div>
  );
}

function DetailView() {
  const { id } = useParams<{ id: string }>();
  const created = useSearchParams().get("created") === "1";
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [manualId, setManualId] = useState("");
  const [nextStatus, setNextStatus] = useState<ComplaintStatus | "">("");
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);

  const load = useCallback(() => {
    api<Detail>(`/api/complaints/${id}`).then(setD).catch((e: Error) => setError(e.message));
  }, [id]);

  useEffect(load, [load]);

  const patch = async (key: string, body: object) => {
    setBusy(key);
    setError("");
    try {
      setD(await api<Detail>(`/api/complaints/${id}`, { method: "PATCH", json: body }));
      setNote("");
      setNextStatus("");
      setManualId("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  if (!d) return error ? <ErrorBox message={error} /> : <Spinner />;
  const { complaint: c, contractor, recommendation } = d;
  const flowIdx = STATUS_FLOW.indexOf(c.status);
  const nextInFlow = flowIdx >= 1 && flowIdx < STATUS_FLOW.length - 1 ? STATUS_FLOW[flowIdx + 1] : null;
  const candidateIds = new Set(recommendation.candidates.map((x) => x.id));
  const sortedContractors = [...d.contractors].sort(
    (a, b) => Number(candidateIds.has(b.id)) - Number(candidateIds.has(a.id)) || Number(b.defectTypes.includes(c.defectType)) - Number(a.defectTypes.includes(c.defectType)),
  );

  return (
    <div className="space-y-5">
      <Link href="/complaints" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="size-4" /> 목록으로
      </Link>

      {created && (
        <div
          className={cn(
            "flex items-start gap-2 rounded-xl border px-4 py-3 text-sm",
            c.contractorId ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800",
          )}
        >
          {c.contractorId ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" />}
          <span>
            민원이 접수되었습니다.{" "}
            {c.contractorId ? <>‘{contractor?.name}’에 자동 배정되어 작업 요청이 전달되었습니다.</> : <>조건에 맞는 업체가 없어 <b>관리자 확인 대기</b>로 처리되었습니다.</>}
          </span>
        </div>
      )}

      {/* 헤더 + 진행 단계 */}
      <section className="card space-y-5 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-bold text-slate-900 tabular-nums">{c.receiptNo}</h2>
          <StatusBadge status={c.status} />
          <UrgencyBadge urgency={c.urgency} />
          <span className="text-xs text-slate-500 sm:ml-auto">접수 {formatDateTime(c.receivedAt)} · {c.channel === "PHONE_AI" ? "AI 전화 접수" : "직접 등록"}</span>
        </div>
        <Stepper status={c.status} />
      </section>

      {error && <ErrorBox message={error} />}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <section className="card">
            <SectionTitle title="민원 정보" />
            <dl className="grid gap-4 p-5 sm:grid-cols-2">
              <Field label="민원인">{c.complainantName}</Field>
              <Field label="전화번호"><a href={`tel:${c.phone}`} className="text-blue-700 tabular-nums">{c.phone}</a></Field>
              <Field label="아파트 / 지역">{c.apartmentName} <span className="text-slate-500">({c.region || "지역 미확인"})</span></Field>
              <Field label="동·호수">{c.building}동 {c.unit}호</Field>
              <Field label="하자 유형">{DEFECT_LABEL[c.defectType]}</Field>
              <Field label="긴급도"><UrgencyBadge urgency={c.urgency} /></Field>
              <Field label="상세 민원 내용" wide>
                <p className="whitespace-pre-wrap leading-relaxed">{c.description}</p>
              </Field>
              <Field label={`사진 첨부 (${c.photos.length})`} wide>
                {c.photos.length === 0 ? (
                  <span className="text-slate-400">첨부된 사진이 없습니다.</span>
                ) : (
                  <div className="mt-1 flex flex-wrap gap-2">
                    {c.photos.map((src, i) => (
                      <button key={i} onClick={() => setPhoto(src)} className="size-24 overflow-hidden rounded-lg border border-slate-200">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={src} alt={`첨부 사진 ${i + 1}`} className="size-full object-cover" />
                      </button>
                    ))}
                  </div>
                )}
              </Field>
            </dl>
          </section>

          {(c.aiSummary || c.callTranscript) && (
            <section className="card">
              <SectionTitle title="AI 통화 분석" />
              <div className="space-y-3 p-5 text-sm">
                {c.aiSummary && (
                  <p className="flex gap-2 rounded-lg bg-blue-50 px-3 py-2 text-blue-900">
                    <Bot className="mt-0.5 size-4 shrink-0" /> {c.aiSummary}
                  </p>
                )}
                {c.callTranscript && (
                  <details className="group">
                    <summary className="cursor-pointer text-xs font-medium text-slate-600 hover:text-slate-900">통화 녹취 원문 보기</summary>
                    <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-slate-50 p-3 font-sans text-xs leading-relaxed whitespace-pre-wrap text-slate-700">{c.callTranscript}</pre>
                  </details>
                )}
              </div>
            </section>
          )}

          <section className="card">
            <SectionTitle title="처리 이력" />
            <ol className="space-y-0 p-5">
              {[...c.history].reverse().map((h, i) => (
                <li key={i} className="relative flex gap-3 pb-5 last:pb-0">
                  {i < c.history.length - 1 && <span className="absolute top-3 left-[5px] h-full w-px bg-slate-200" />}
                  <span className={cn("relative mt-1.5 size-2.5 shrink-0 rounded-full", i === 0 ? "bg-blue-600" : "bg-slate-300")} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={h.status} />
                      <span className="text-xs text-slate-500 tabular-nums">{formatDateTime(h.at)}</span>
                      <span className="text-xs text-slate-400">· {ACTOR_LABEL[h.actor]}</span>
                    </div>
                    <p className="mt-1 text-sm break-words text-slate-700">{h.note}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <div className="space-y-5">
          {/* 배정 업체 */}
          <section className="card">
            <SectionTitle title="배정 업체" />
            <div className="space-y-4 p-5">
              {contractor ? (
                <div className="space-y-1.5 rounded-lg border border-blue-100 bg-blue-50/50 p-3.5 text-sm">
                  <p className="font-semibold text-slate-900">{contractor.name}</p>
                  <p className="flex items-center gap-1.5 text-slate-600"><Phone className="size-3.5" /> {contractor.phone}</p>
                  <p className="flex items-center gap-1.5 text-slate-600"><Mail className="size-3.5" /> {contractor.email || "-"}</p>
                </div>
              ) : (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3.5 text-sm text-amber-800">
                  <p className="font-medium">미배정</p>
                  <p className="mt-1 text-xs leading-relaxed">{recommendation.reason}</p>
                </div>
              )}

              {c.status !== "COMPLETED" && (
                <>
                  <button
                    className="btn-secondary w-full"
                    disabled={!!busy}
                    onClick={() => patch("auto", { action: "auto-assign" })}
                  >
                    {busy === "auto" ? <Loader2 className="size-4 animate-spin" /> : contractor ? <RefreshCw className="size-4" /> : <Wand2 className="size-4" />}
                    {contractor ? "자동 재배정" : "자동 배정 다시 실행"}
                  </button>

                  <div className="space-y-2 border-t border-slate-100 pt-4">
                    <label className="label">관리자 수동 배정</label>
                    <select className="input" value={manualId} onChange={(e) => setManualId(e.target.value)}>
                      <option value="">업체 선택</option>
                      {sortedContractors.map((x) => {
                        const tags = [
                          candidateIds.has(x.id) && "★추천",
                          !x.defectTypes.includes(c.defectType) && "분야 불일치",
                          !x.regions.includes(c.region) && "지역 외",
                          !x.isContracted && "미계약",
                          !x.isAvailable && "업무불가",
                        ].filter(Boolean);
                        return (
                          <option key={x.id} value={x.id}>
                            {x.name}{tags.length ? ` (${tags.join(", ")})` : ""}
                          </option>
                        );
                      })}
                    </select>
                    <button
                      className="btn-primary w-full"
                      disabled={!manualId || !!busy}
                      onClick={() => patch("manual", { action: "assign", contractorId: manualId })}
                    >
                      {busy === "manual" && <Loader2 className="size-4 animate-spin" />}
                      배정 및 업체 전달
                    </button>
                  </div>
                </>
              )}
            </div>
          </section>

          {/* 방문 일정 조율: 업체와 조율한 일정 → 거주자 선택 문자 */}
          <ScheduleOfferCard complaint={c} contractor={contractor} onUpdated={(x) => setD(x as Detail)} />

          {/* 상태 변경 */}
          <section className="card">
            <SectionTitle title="처리 상태 변경" />
            <div className="space-y-3 p-5">
              {nextInFlow && (
                <button
                  className="btn-primary w-full"
                  disabled={!!busy}
                  onClick={() => patch("next", { action: "status", status: nextInFlow, note })}
                >
                  {busy === "next" && <Loader2 className="size-4 animate-spin" />}
                  ‘{STATUS_LABEL[nextInFlow]}’ 단계로 진행
                </button>
              )}
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <select className="input" value={nextStatus} onChange={(e) => setNextStatus(e.target.value as ComplaintStatus)}>
                  <option value="">상태 직접 선택</option>
                  {STATUSES.filter((s) => s.value !== c.status).map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
                <button
                  className="btn-secondary"
                  disabled={!nextStatus || !!busy}
                  onClick={() => patch("set", { action: "status", status: nextStatus, note })}
                >
                  변경
                </button>
              </div>
              <textarea
                className="input min-h-16 text-xs"
                placeholder="처리 메모 (선택) — 예: 11/20 오전 10시 방문 예정"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <p className="flex items-center gap-1 text-[11px] text-slate-400">
                <User className="size-3" /> 변경 내역은 처리 이력에 기록됩니다.
              </p>
            </div>
          </section>
        </div>
      </div>

      {photo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 p-4" onClick={() => setPhoto(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo} alt="첨부 사진 확대" className="max-h-full max-w-full rounded-lg" />
        </div>
      )}
    </div>
  );
}

export default function ComplaintDetailPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <DetailView />
    </Suspense>
  );
}
