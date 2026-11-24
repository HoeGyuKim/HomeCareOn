"use client";

import { AlertTriangle, Bot, CheckCircle2, Loader2, PhoneCall, Sparkles, Zap } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import ComplaintForm, { type FormValues } from "@/components/ComplaintForm";
import { ErrorBox, SectionTitle, StatusBadge } from "@/components/ui";
import { api } from "@/lib/client-api";
import { DEFECT_LABEL, URGENCY_LABEL } from "@/lib/constants";
import { SAMPLE_CALLS } from "@/lib/mock-data";
import type { AssignmentResult, CallAnalysis, Complaint } from "@/lib/types";

type Analysis = CallAnalysis & { warning?: string };
interface Outcome {
  complaint: Complaint;
  assignment: AssignmentResult | null;
}

export default function TranscriptAnalyzer() {
  const [transcript, setTranscript] = useState(SAMPLE_CALLS[0].transcript);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [busy, setBusy] = useState<"" | "analyze" | "intake">("");
  const [error, setError] = useState("");
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const analyze = async () => {
    setBusy("analyze");
    setError("");
    setOutcome(null);
    try {
      const a = await api<Analysis>("/api/calls/analyze", { method: "POST", json: { transcript } });
      setAnalysis(a);
      setFormKey((k) => k + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  /** 실제 전화 연동 시와 동일한 원스톱 처리(분석→저장→배정→전달) */
  const intake = async () => {
    setBusy("intake");
    setError("");
    try {
      const r = await api<Outcome & { analysis: Analysis }>("/api/calls/intake", { method: "POST", json: { transcript } });
      setAnalysis(r.analysis);
      setOutcome(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const initial: FormValues | null = analysis && {
    complainantName: analysis.complainantName,
    phone: analysis.phone,
    apartmentName: analysis.apartmentName,
    building: analysis.building,
    unit: analysis.unit,
    defectType: analysis.defectType,
    description: analysis.description,
    urgency: analysis.urgency,
    photos: [],
  };

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        실제 전화 연결 전 테스트 화면입니다. 가상의 통화 내용을 입력하면 AI가 민원 정보를 추출하고, 접수 시 자동으로 업체를 배정합니다.
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* 통화 입력 */}
        <section className="card flex flex-col">
          <SectionTitle title="① 가상 통화 내용 입력" />
          <div className="flex flex-1 flex-col gap-3 p-5">
            <div className="flex flex-wrap gap-1.5">
              {SAMPLE_CALLS.map((s) => (
                <button
                  key={s.title}
                  onClick={() => {
                    setTranscript(s.transcript);
                    setAnalysis(null);
                    setOutcome(null);
                  }}
                  className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 hover:border-blue-300 hover:text-blue-700"
                >
                  {s.title}
                </button>
              ))}
            </div>
            <textarea
              className="input min-h-72 flex-1 font-mono text-[13px] leading-relaxed"
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              placeholder={"상담원: ...\n민원인: ..."}
            />
            <div className="grid gap-2 sm:grid-cols-2">
              <button className="btn-primary" onClick={analyze} disabled={!!busy || !transcript.trim()}>
                {busy === "analyze" ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                AI 분석 후 검토
              </button>
              <button className="btn-secondary" onClick={intake} disabled={!!busy || !transcript.trim()}>
                {busy === "intake" ? <Loader2 className="size-4 animate-spin" /> : <Zap className="size-4" />}
                원스톱 자동 접수
              </button>
            </div>
            <p className="text-[11px] leading-relaxed text-slate-500">
              <b>AI 분석 후 검토</b>: 추출 결과를 관리자가 확인·수정 후 접수합니다. <b>원스톱 자동 접수</b>: 실제 전화 연동과 동일하게
              사람 개입 없이 분석 → 저장 → 배정 → 업체 전달까지 진행합니다.
            </p>
          </div>
        </section>

        {/* 분석 결과 */}
        <section className="card">
          <SectionTitle
            title="② AI 분석 결과 확인 및 접수"
            action={
              analysis && (
                <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                  <Bot className="size-3.5" />
                  {analysis.engine === "claude" ? "Claude API" : "규칙 기반"} · 신뢰도 {Math.round(analysis.confidence * 100)}%
                </span>
              )
            }
          />
          <div className="space-y-4 p-5">
            {error && <ErrorBox message={error} />}
            {analysis?.warning && <ErrorBox message={analysis.warning} />}

            {!analysis && !error && (
              <div className="flex flex-col items-center gap-2 py-16 text-center text-sm text-slate-400">
                <PhoneCall className="size-8" />
                왼쪽에 통화 내용을 입력하고 분석을 실행하세요.
              </div>
            )}

            {analysis && (
              <div className="space-y-2 rounded-lg bg-slate-50 p-3.5 text-sm">
                <p className="text-slate-800">
                  <b>요약</b> · {analysis.summary}
                </p>
                <p className="text-xs text-slate-600">
                  유형: <b>{DEFECT_LABEL[analysis.defectType]}</b> · 긴급도: <b>{URGENCY_LABEL[analysis.urgency]}</b>
                </p>
                {analysis.missingFields.length > 0 && (
                  <p className="flex items-start gap-1.5 text-xs text-amber-700">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                    확인 필요: {analysis.missingFields.join(", ")}
                  </p>
                )}
              </div>
            )}

            {outcome && <OutcomeCard outcome={outcome} />}

            {analysis && initial && !outcome && (
              <ComplaintForm
                key={formKey}
                initial={initial}
                extra={{ channel: "PHONE_AI", callTranscript: transcript, aiSummary: analysis.summary }}
                onCreated={setOutcome}
              />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function OutcomeCard({ outcome }: { outcome: Outcome }) {
  const { complaint: c, assignment: a } = outcome;
  const ok = !!a?.contractor;
  return (
    <div className={`space-y-2 rounded-lg border p-4 text-sm ${ok ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
      <p className={`flex items-center gap-1.5 font-semibold ${ok ? "text-emerald-800" : "text-amber-800"}`}>
        {ok ? <CheckCircle2 className="size-4" /> : <AlertTriangle className="size-4" />}
        접수 완료 · {c.receiptNo} <StatusBadge status={c.status} />
      </p>
      <p className={ok ? "text-emerald-900" : "text-amber-900"}>
        {ok ? `‘${a!.contractor!.name}’ 업체에 자동 배정 및 작업 요청 전달 완료` : "관리자 확인 대기로 처리되었습니다."}
      </p>
      {a && <p className="text-xs text-slate-600">{a.reason}</p>}
      <Link href={`/complaints/${c.id}`} className="inline-block text-xs font-medium text-blue-700 hover:underline">
        민원 상세 보기 →
      </Link>
    </div>
  );
}
