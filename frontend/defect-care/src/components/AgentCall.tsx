"use client";

import { Ban, Bot, CheckCircle2, Circle, Loader2, MessageSquareText, Scale, SendHorizonal, ShieldAlert, User } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  ACCEPTABLE_VERDICTS,
  AWAITING_HINT,
  DIALOGUE_VERDICT_LABEL,
  VERDICT_LABEL,
  type CallView,
  type PolicyVerdict,
} from "@/lib/agent/types";
import { api } from "@/lib/client-api";
import { DEFECT_LABEL, URGENCY_LABEL } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { ErrorBox, SectionTitle } from "./ui";

const VERDICT_STYLE: Record<PolicyVerdict, string> = {
  SH_REPAIR: "border-emerald-200 bg-emerald-50 text-emerald-900",
  MGMT_FEE: "border-blue-200 bg-blue-50 text-blue-900",
  SITE_CHECK: "border-amber-200 bg-amber-50 text-amber-900",
  TENANT_PAY: "border-red-200 bg-red-50 text-red-900",
  NOT_ALLOWED: "border-red-200 bg-red-50 text-red-900",
};

function engineLabel(v: CallView): string {
  if (v.engine === "dialogue")
    return `HomeCareOn 대화 엔진 · 수선유지 RAG · ${v.llm === "gemini" ? "Gemini 대화" : "규칙 모드 (Gemini 키를 넣으면 자연어 대화)"}`;
  if (v.engine === "claude") return "Claude API 상담원";
  return "테스트용 상담원 · Claude API 키를 넣으면 실제 AI로 대화";
}

const SESSION_KEY = "agent-session-id";
function loadSessionId(): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}
function saveSessionId(id: string | null) {
  try {
    if (id) sessionStorage.setItem(SESSION_KEY, id);
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // 저장소를 쓸 수 없는 환경이면 새로고침 시 새 대화로 시작
  }
}

/**
 * AI 상담원과 글로 주고받는 접수 (번갈아 말하기)
 * - AI가 먼저 묻고, 민원인이 답하면 AI가 다음 질문 하나를 합니다.
 * - AI가 답하는 동안에는 입력할 수 없습니다.
 */
export default function AgentCall() {
  const [view, setView] = useState<CallView | null>(null);
  const [input, setInput] = useState("");
  const [aiTurn, setAiTurn] = useState(true); // 처음엔 AI가 먼저 말함
  const [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const started = useRef(false);

  /** 새 대화 시작 — 대화 번호를 브라우저 탭에 저장해 새로고침해도 이어지게 함 */
  const connect = () =>
    api<CallView>("/api/agent", { method: "POST", json: {} })
      .then((v) => {
        saveSessionId(v.sessionId);
        setView(v);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setAiTurn(false));

  useEffect(() => {
    // 개발 모드에서 effect가 두 번 실행돼도 대화는 하나만 만듦
    if (started.current) return;
    started.current = true;
    const saved = loadSessionId();
    if (!saved) {
      connect();
      return;
    }
    // 진행 중이던 대화 이어 보기 (만료됐으면 새로 시작)
    api<CallView>("/api/agent", { method: "POST", json: { sessionId: saved } })
      .then((v) => {
        setView(v);
        setAiTurn(false);
      })
      .catch(() => connect());
  }, []);

  const restart = () => {
    saveSessionId(null);
    setView(null);
    setError("");
    setInput("");
    setAiTurn(true);
    connect();
  };

  const ended = view?.awaiting === "done";
  const myTurn = !!view && !aiTurn && !ended;

  // 새 메시지가 오면 아래로, 내 차례가 되면 입력칸에 커서
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    if (myTurn) inputRef.current?.focus();
  }, [view?.messages.length, aiTurn, myTurn]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || !myTurn || !view) return;
    setInput("");
    setError("");
    setAiTurn(true);
    // 내가 한 말은 바로 표시하고 AI 차례로 넘김
    setView({ ...view, messages: [...view.messages, { role: "caller", text, at: new Date().toISOString() }] });
    try {
      setView(await api<CallView>("/api/agent", { method: "POST", json: { sessionId: view.sessionId, message: text } }));
    } catch (err) {
      setError((err as Error).message);
      setView(view); // 실패하면 보낸 말을 되돌리고 다시 입력하게 함
      setInput(text);
    } finally {
      setAiTurn(false);
    }
  };

  const d = view?.decision;
  const dialogue = view?.engine === "dialogue";
  // 대화 엔진은 첫 질문에서 동·호수와 계약자 성함을 함께 묻는다
  const hint = !view
    ? null
    : dialogue && view.awaiting === "dongho"
      ? { label: "동·호수와 계약자 성함을 말씀해 주세요", placeholder: "예: 103동 1204호 홍길동입니다" }
      : AWAITING_HINT[view.awaiting];
  const f = view?.form;
  const fields: [string, string][] = f
    ? [
        ["이름", f.complainantName],
        ["연락처", f.phone],
        ["단지", f.apartmentName],
        ["동·호수", f.building && f.unit ? `${f.building}동 ${f.unit}호` : f.building ? `${f.building}동` : ""],
        ["하자 유형", f.defectType ? DEFECT_LABEL[f.defectType] : ""],
        ["긴급도", f.urgency ? URGENCY_LABEL[f.urgency] : ""],
        ["하자 내용", f.description],
      ]
    : [];

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
      {/* 대화 */}
      <section className="card flex h-[min(44rem,calc(100dvh-11rem))] min-h-[30rem] flex-col overflow-hidden">
        <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
          <span className="flex size-9 items-center justify-center rounded-full bg-blue-100 text-blue-700">
            <Bot className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-900">AI 상담원 접수 (글로 대화)</p>
            <p className="truncate text-[11px] text-slate-500">
              {view ? engineLabel(view) : "연결 중…"}
            </p>
          </div>
          <button onClick={restart} disabled={aiTurn && !ended} className="btn-secondary px-2.5 py-1.5 text-xs">
            새 대화
          </button>
        </div>

        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto bg-slate-50/60 px-4 py-4">
          {view?.messages.map((m, i) => {
            const ai = m.role === "agent";
            return (
              <div key={i} className={cn("flex items-end gap-2", ai ? "justify-start" : "flex-row-reverse")}>
                <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-full", ai ? "bg-blue-100 text-blue-700" : "bg-slate-200 text-slate-600")}>
                  {ai ? <Bot className="size-3.5" /> : <User className="size-3.5" />}
                </span>
                <div className={cn("max-w-[80%] space-y-0.5", !ai && "text-right")}>
                  <p className="px-1 text-[11px] text-slate-400">{ai ? "AI 상담원" : "민원인(나)"}</p>
                  <p
                    className={cn(
                      "inline-block rounded-2xl px-3.5 py-2 text-left text-sm leading-relaxed whitespace-pre-wrap",
                      ai ? "rounded-bl-sm border border-slate-200 bg-white text-slate-800" : "rounded-br-sm bg-blue-600 text-white",
                    )}
                  >
                    {m.text}
                  </p>
                </div>
              </div>
            );
          })}
          {aiTurn && (
            <div className="flex items-center gap-2 pl-9 text-xs text-slate-400">
              <Loader2 className="size-3.5 animate-spin" /> {view ? "AI 상담원이 답변을 작성하고 있어요…" : "상담원 연결 중…"}
            </div>
          )}
          {ended && <p className="py-2 text-center text-xs text-slate-400">— 대화가 끝났습니다. 새로 접수하려면 ‘새 대화’를 누르세요 —</p>}
        </div>

        {view?.notice && <div className="border-t border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">{view.notice}</div>}
        {error && <div className="px-4 pt-3"><ErrorBox message={error} /></div>}

        {!ended && (
          <form onSubmit={send} className="space-y-1.5 border-t border-slate-100 p-3">
            <p className={cn("flex items-center gap-1.5 px-1 text-xs font-medium", myTurn ? "text-blue-700" : "text-slate-400")}>
              <span className={cn("size-2 rounded-full", myTurn ? "animate-pulse bg-blue-600" : "bg-slate-300")} />
              {myTurn ? `내 차례 — ${hint?.label}` : "AI 차례 — 답변을 기다려 주세요"}
            </p>
            <div className="flex gap-2">
              <input
                ref={inputRef}
                className="input"
                placeholder={myTurn ? hint?.placeholder : "AI가 답변하는 중입니다"}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={!myTurn}
                maxLength={1000}
              />
              <button type="submit" className="btn-primary shrink-0 px-3.5" disabled={!myTurn || !input.trim()} aria-label="보내기">
                <SendHorizonal className="size-4" />
              </button>
            </div>
          </form>
        )}
      </section>

      {/* 오른쪽: 판정 + 접수 양식 */}
      <div className="space-y-5">
        <section className="card">
          <SectionTitle title="비용부담 판정" action={<Scale className="size-4 text-slate-400" />} />
          <div className="p-4">
            {!d ? (
              <p className="text-xs leading-relaxed text-slate-500">
                {dialogue
                  ? "고장 내용과 경위를 들으면 수선유지 RAG가 「시설물 수선비 비용부담 기준」 일람표에서 항목을 찾고, 원인·입주일로 비용 부담을 판정합니다. 거주자 부담이어도 안내 후 원하시면 접수합니다."
                  : "하자 내용을 들으면 「시설물 수선비 비용부담 기준」과 「주택관리규정 시행내규」에 따라 판정합니다. 입주자 부담이거나 허용되지 않는 요청은 접수하지 않습니다."}
              </p>
            ) : (
              <div className={cn("space-y-2 rounded-lg border p-3 text-sm", VERDICT_STYLE[d.verdict])}>
                <p className="flex items-center gap-1.5 font-semibold">
                  {d.verdict === "SH_REPAIR" || d.verdict === "MGMT_FEE" || (!dialogue && ACCEPTABLE_VERDICTS.includes(d.verdict)) ? (
                    <CheckCircle2 className="size-4" />
                  ) : d.verdict === "NOT_ALLOWED" ? (
                    <Ban className="size-4" />
                  ) : (
                    <ShieldAlert className="size-4" />
                  )}
                  {(dialogue ? DIALOGUE_VERDICT_LABEL : VERDICT_LABEL)[d.verdict]}
                </p>
                <p className="text-xs"><b>항목</b> · {d.item}</p>
                {dialogue && d.explanation && <p className="text-xs leading-relaxed"><b>안내</b> · {d.explanation}</p>}
                <p className="text-xs leading-relaxed"><b>근거</b> · {d.basis}</p>
              </div>
            )}
          </div>
        </section>

        <section className="card">
          <SectionTitle title="접수 양식" />
          <dl className="divide-y divide-slate-100">
            {fields.map(([label, value]) => (
              <div key={label} className="flex items-start gap-2 px-4 py-2 text-sm">
                {value ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <Circle className="mt-0.5 size-4 shrink-0 text-slate-300" />}
                <dt className="w-16 shrink-0 text-xs text-slate-500">{label}</dt>
                <dd className={cn("min-w-0 flex-1 break-words", value ? "text-slate-900" : "text-slate-400")}>{value || "—"}</dd>
              </div>
            ))}
          </dl>
          {view?.sms && (
            <div className="m-4 mt-1 space-y-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950">
              <p className="flex items-center gap-1.5 font-semibold">
                <MessageSquareText className="size-4" /> 희망일 선택 문자 발송 (모의) · {view.sms.to}
              </p>
              <p className="rounded-md bg-white/70 p-2 text-xs leading-relaxed whitespace-pre-wrap text-slate-700">{view.sms.text}</p>
              <a href={view.sms.link} target="_blank" rel="noreferrer" className="inline-block text-xs font-medium text-blue-700 hover:underline">
                거주자 화면으로 링크 열기 →
              </a>
              <p className="text-[11px] text-slate-500">거주자가 날짜를 고르면 민원 접수 관리에 등록되고 업체가 자동 배정됩니다.</p>
            </div>
          )}
          {view?.submitted && (
            <div className="m-4 mt-1 space-y-1 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
              <p className="font-semibold">접수 완료 · {view.submitted.receiptNo}</p>
              <p className="text-xs">{view.submitted.contractorName ? `배정 업체: ${view.submitted.contractorName}` : "관리자 확인 대기 (업체 배정 예정)"}</p>
              {view.submitted.complaintId ? (
                <Link href={`/complaints/${view.submitted.complaintId}`} className="inline-block text-xs font-medium text-blue-700 hover:underline">
                  민원 상세 보기 →
                </Link>
              ) : (
                <p className="text-xs text-amber-800">관리자 웹에 등록되지 않은 임시 접수번호입니다.</p>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
