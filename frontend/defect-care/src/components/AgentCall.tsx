"use client";

import {
  Ban,
  Bot,
  CheckCircle2,
  Circle,
  Loader2,
  MessageSquareText,
  Mic,
  MicOff,
  Scale,
  SendHorizonal,
  ShieldAlert,
  User,
  Volume2,
  VolumeX,
} from "lucide-react";
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

/** TTS 낭독용 텍스트 정제 (마크다운, 특수기호, 영문 티켓번호를 자연스러운 한국어 구어로 변환) */
function cleanTextForSpeech(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, "$1") // bold 제거
    .replace(/\*(.*?)\*/g, "$1") // italic 제거
    .replace(/TKT-[A-Za-z0-9-]+/gi, "접수 번호") // 티켓 번호 기계적 낭독 방지
    .replace(/https?:\/\/\S+/g, "") // URL 제거
    .replace(/[#\-~_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 가장 자연스러운 한국어 목소리(Microsoft Natural, Online, SunHi, Heami, Google 등) 선택 */
function getBestKoreanVoice(): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  const koVoices = voices.filter((v) => v.lang.startsWith("ko") || v.lang.includes("KR"));
  if (koVoices.length === 0) return null;

  // 자연스러운 고품질 한국어 음성 우선순위 탐색
  const preferred = koVoices.find(
    (v) =>
      v.name.includes("Natural") ||
      v.name.includes("Online") ||
      v.name.includes("SunHi") ||
      v.name.includes("Heami") ||
      v.name.includes("Google"),
  );
  return preferred || koVoices[0];
}

/**
 * AI 상담원과 음성(STT/TTS) 및 글로 주고받는 민원 접수 화면
 */
export default function AgentCall() {
  const [view, setView] = useState<CallView | null>(null);
  const [input, setInput] = useState("");
  const [aiTurn, setAiTurn] = useState(true);
  const [error, setError] = useState("");

  // 음성 엔진(STT / TTS) 상태
  const [isListening, setIsListening] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);
  const lastSpokenIndexRef = useRef<number>(-1);

  const started = useRef(false);

  /** TTS 음성 발화 함수 */
  const speak = (text: string) => {
    if (typeof window === "undefined" || !window.speechSynthesis || !ttsEnabled) return;
    try {
      window.speechSynthesis.cancel();
      const cleaned = cleanTextForSpeech(text);
      if (!cleaned) return;

      const utterance = new SpeechSynthesisUtterance(cleaned);
      utterance.lang = "ko-KR";
      utterance.rate = 1.0; // 자연스럽고 차분한 상담원 발화 속도
      utterance.pitch = 1.0;

      const voice = getBestKoreanVoice();
      if (voice) utterance.voice = voice;

      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);

      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.warn("TTS speak error:", e);
      setIsSpeaking(false);
    }
  };

  /** 브라우저 음성 로드 이벤트 바인딩 */
  useEffect(() => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = () => {
        // 음성 목록 갱신 트리거
        window.speechSynthesis.getVoices();
      };
    }
  }, []);

  /** AI 상담원의 새 답변이 오면 자동으로 TTS 낭독 */
  useEffect(() => {
    if (!view || !view.messages || view.messages.length === 0) return;
    const lastIdx = view.messages.length - 1;
    const lastMsg = view.messages[lastIdx];

    if (lastMsg.role === "agent" && lastIdx > lastSpokenIndexRef.current) {
      lastSpokenIndexRef.current = lastIdx;
      speak(lastMsg.text);
    }
  }, [view?.messages, ttsEnabled]);

  /** 새 대화 시작 */
  const connect = () =>
    api<CallView>("/api/agent", { method: "POST", json: {} })
      .then((v) => {
        saveSessionId(v.sessionId);
        setView(v);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setAiTurn(false));

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const saved = loadSessionId();
    if (!saved) {
      connect();
      return;
    }
    api<CallView>("/api/agent", { method: "POST", json: { sessionId: saved } })
      .then((v) => {
        setView(v);
        setAiTurn(false);
      })
      .catch(() => connect());
  }, []);

  const restart = () => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    setIsSpeaking(false);
    setIsListening(false);
    lastSpokenIndexRef.current = -1;
    saveSessionId(null);
    setView(null);
    setError("");
    setInput("");
    setAiTurn(true);
    connect();
  };

  const ended = view?.awaiting === "done";
  const myTurn = !!view && !aiTurn && !ended;

  // 새 메시지가 오면 아래로 스크롤
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    if (myTurn && !isListening) inputRef.current?.focus();
  }, [view?.messages.length, aiTurn, myTurn, isListening]);

  /** 메시지 전송 로직 */
  const sendMessage = async (rawText: string) => {
    const text = rawText.trim();
    if (!text || !myTurn || !view) return;

    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
    }

    setInput("");
    setError("");
    setAiTurn(true);
    setView({ ...view, messages: [...view.messages, { role: "caller", text, at: new Date().toISOString() }] });

    try {
      setView(await api<CallView>("/api/agent", { method: "POST", json: { sessionId: view.sessionId, message: text } }));
    } catch (err) {
      setError((err as Error).message);
      setView(view);
      setInput(text);
    } finally {
      setAiTurn(false);
    }
  };

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  /** STT 마이크 토글 함수 (Web Speech API) */
  const toggleListening = () => {
    if (typeof window === "undefined") return;

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert("현재 브라우저에서는 음성 인식을 지원하지 않습니다. Chrome 또는 Edge 브라우저를 이용해 주세요.");
      return;
    }

    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    // AI가 말하고 있으면 멈춤
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.lang = "ko-KR";
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      recognition.continuous = false;

      recognition.onstart = () => {
        setIsListening(true);
        setError("");
      };

      recognition.onresult = (event: any) => {
        let transcript = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        setInput(transcript);

        // 발화가 최종 완료된 경우 (isFinal)
        const isFinal = event.results[event.results.length - 1].isFinal;
        if (isFinal && transcript.trim()) {
          recognition.stop();
          setIsListening(false);
          // 0.3초 후 자동 전송
          setTimeout(() => {
            sendMessage(transcript);
          }, 300);
        }
      };

      recognition.onerror = (event: any) => {
        console.warn("STT 인식 이벤트:", event.error);
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      console.error("STT 시작 실패:", err);
      setIsListening(false);
    }
  };

  const toggleTts = () => {
    if (ttsEnabled) {
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      setIsSpeaking(false);
      setTtsEnabled(false);
    } else {
      setTtsEnabled(true);
    }
  };

  const d = view?.decision;
  const dialogue = view?.engine === "dialogue";
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
      {/* 대화 영역 */}
      <section className="card flex h-[min(44rem,calc(100dvh-11rem))] min-h-[30rem] flex-col overflow-hidden">
        {/* 상단 헤더 바 */}
        <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
          <span className={cn("flex size-9 items-center justify-center rounded-full transition-colors", isSpeaking ? "bg-emerald-100 text-emerald-700 animate-pulse" : "bg-blue-100 text-blue-700")}>
            <Bot className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-slate-900">AI 시설물 접수센터 (음성 통화)</p>
              {isSpeaking && (
                <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 border border-emerald-200">
                  <span className="size-1.5 rounded-full bg-emerald-600 animate-ping" /> 상담원 안내 중
                </span>
              )}
            </div>
            <p className="truncate text-[11px] text-slate-500">
              {view ? engineLabel(view) : "연결 중…"} · 한국어 음성(STT/TTS) 연동
            </p>
          </div>

          {/* 음성 안내 켜기/끄기 토글 버튼 */}
          <button
            type="button"
            onClick={toggleTts}
            className={cn("btn-secondary px-2.5 py-1.5 text-xs flex items-center gap-1", ttsEnabled ? "text-blue-700 bg-blue-50/80" : "text-slate-400")}
            title={ttsEnabled ? "음성 안내 끄기" : "음성 안내 켜기"}
          >
            {ttsEnabled ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5" />}
            <span className="hidden sm:inline">{ttsEnabled ? "음성 켜짐" : "음소거"}</span>
          </button>

          <button onClick={restart} disabled={aiTurn && !ended} className="btn-secondary px-2.5 py-1.5 text-xs">
            새 대화
          </button>
        </div>

        {/* 메시지 대화창 */}
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
              <Loader2 className="size-3.5 animate-spin" /> {view ? "AI 상담원이 답변을 생각하고 있어요…" : "상담원 연결 중…"}
            </div>
          )}
          {ended && <p className="py-2 text-center text-xs text-slate-400">— 대화가 끝났습니다. 새로 접수하려면 ‘새 대화’를 누르세요 —</p>}
        </div>

        {view?.notice && <div className="border-t border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">{view.notice}</div>}
        {error && <div className="px-4 pt-3"><ErrorBox message={error} /></div>}

        {/* 하단 음성 마이크 및 텍스트 입력 바 */}
        {!ended && (
          <form onSubmit={send} className="space-y-1.5 border-t border-slate-100 p-3 bg-white">
            <p className={cn("flex items-center gap-1.5 px-1 text-xs font-medium", isListening ? "text-red-600" : myTurn ? "text-blue-700" : "text-slate-400")}>
              <span className={cn("size-2 rounded-full", isListening ? "bg-red-500 animate-ping" : myTurn ? "animate-pulse bg-blue-600" : "bg-slate-300")} />
              {isListening
                ? "🎙️ 말씀해 주세요, 듣고 있습니다... (말이 끝나면 자동 전송)"
                : myTurn
                  ? `내 차례 — ${hint?.label || "말씀하시거나 입력하세요"}`
                  : "AI 차례 — 답변을 기다려 주세요"}
            </p>
            <div className="flex gap-2 items-center">
              {/* STT 마이크 버튼 */}
              <button
                type="button"
                onClick={toggleListening}
                disabled={!myTurn}
                className={cn(
                  "flex size-10 shrink-0 items-center justify-center rounded-xl transition-all border",
                  isListening
                    ? "bg-red-600 text-white border-red-700 shadow-md shadow-red-200 animate-pulse"
                    : "bg-slate-100 text-slate-700 border-slate-200 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-300 disabled:opacity-40 disabled:hover:bg-slate-100 disabled:hover:text-slate-700",
                )}
                title={isListening ? "음성 인식 중지" : "마이크로 말하기"}
                aria-label={isListening ? "음성 인식 중지" : "마이크로 말하기"}
              >
                {isListening ? <MicOff className="size-4 animate-bounce" /> : <Mic className="size-4" />}
              </button>

              {/* 텍스트 입력창 */}
              <input
                ref={inputRef}
                className={cn(
                  "input flex-1",
                  isListening && "border-red-400 bg-red-50/30 placeholder:text-red-500",
                )}
                placeholder={
                  isListening
                    ? "듣고 있습니다... 말씀해 주세요"
                    : myTurn
                      ? hint?.placeholder || "마이크 버튼을 누르거나 글을 입력하세요"
                      : "AI가 안내하는 중입니다"
                }
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={!myTurn}
                maxLength={1000}
              />

              {/* 전송 버튼 */}
              <button type="submit" className="btn-primary shrink-0 px-3.5 h-10 rounded-xl" disabled={!myTurn || !input.trim()} aria-label="보내기">
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
