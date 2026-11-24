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
  Phone,
  PhoneCall,
  PhoneOff,
  Radio,
  Scale,
  SendHorizonal,
  ShieldAlert,
  Sparkles,
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
    return `HomeCareOn 대화 엔진 · 수선유지 RAG · ${v.llm === "gemini" ? "Gemini 자연어 대화" : "규칙 모드"}`;
  if (v.engine === "claude") return "Claude API 상담원";
  return "테스트용 상담원";
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

/** 브라우저 내장 한국어 음성 fallback */
function getBestKoreanVoice(): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  const koVoices = voices.filter((v) => v.lang.startsWith("ko") || v.lang.includes("KR"));
  if (koVoices.length === 0) return null;

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
  const [useNeuralVoice, setUseNeuralVoice] = useState(true);
  const [isSpeaking, setIsSpeaking] = useState(false);

  // 실제 전화 통화 시연 모드 (Phone Call Mode)
  const [phoneMode, setPhoneMode] = useState(false);
  const [callSeconds, setCallSeconds] = useState(0);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const lastSpokenIndexRef = useRef<number>(-1);

  const started = useRef(false);
  const phoneModeRef = useRef(false);
  phoneModeRef.current = phoneMode;
  const ended = view?.awaiting === "done";
  const endedRef = useRef(false);
  endedRef.current = ended;

  /** 통화 타이머 */
  useEffect(() => {
    let timer: any = null;
    if (phoneMode && !ended) {
      timer = setInterval(() => {
        setCallSeconds((s) => s + 1);
      }, 1000);
    } else {
      setCallSeconds(0);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [phoneMode, ended]);

  /** 브라우저 내장 TTS fallback */
  const fallbackSpeak = (cleaned: string) => {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      setIsSpeaking(false);
      return;
    }
    try {
      const utterance = new SpeechSynthesisUtterance(cleaned);
      utterance.lang = "ko-KR";
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      const voice = getBestKoreanVoice();
      if (voice) utterance.voice = voice;
      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => {
        setIsSpeaking(false);
        if (phoneModeRef.current && !endedRef.current) {
          setTimeout(() => startListening(), 400);
        }
      };
      utterance.onerror = () => setIsSpeaking(false);
      window.speechSynthesis.speak(utterance);
    } catch {
      setIsSpeaking(false);
    }
  };

  /** TTS 음성 발화 함수: 초자연적 한국어 신경망 보이스 우선 재생 */
  const speak = (text: string) => {
    if (!ttsEnabled) return;
    try {
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current = null;
      }
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }

      const cleaned = cleanTextForSpeech(text);
      if (!cleaned) return;

      setIsSpeaking(true);

      if (useNeuralVoice) {
        // 자연스러운 한국어 신경망 보이스 (edge-tts ko-KR-SunHiNeural)
        const audio = new Audio(`/api/tts?text=${encodeURIComponent(cleaned)}`);
        currentAudioRef.current = audio;

        audio.onended = () => {
          setIsSpeaking(false);
          currentAudioRef.current = null;
          // 전화 통화 모드일 때 AI 발화 종료 즉시 거주자 마이크 자동 오픈 (진짜 전화 대화처럼)
          if (phoneModeRef.current && !endedRef.current) {
            setTimeout(() => {
              startListening();
            }, 300);
          }
        };

        audio.onerror = (e) => {
          console.warn("신경망 TTS 재생 실패, 브라우저 음성으로 대체합니다:", e);
          fallbackSpeak(cleaned);
        };

        audio.play().catch((err) => {
          console.warn("오디오 자동 재생이 브라우저 정책으로 차단됨, 대체 음성 시도:", err);
          fallbackSpeak(cleaned);
        });
      } else {
        fallbackSpeak(cleaned);
      }
    } catch (e) {
      console.warn("TTS speak error:", e);
      setIsSpeaking(false);
    }
  };

  /** AI 상담원의 새 답변이 오면 자동으로 TTS 낭독 */
  useEffect(() => {
    if (!view || !view.messages || view.messages.length === 0) return;
    const lastIdx = view.messages.length - 1;
    const lastMsg = view.messages[lastIdx];

    if (lastMsg.role === "agent" && lastIdx > lastSpokenIndexRef.current) {
      lastSpokenIndexRef.current = lastIdx;
      speak(lastMsg.text);
    }
  }, [view?.messages, ttsEnabled, useNeuralVoice]);

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

  const stopAllAudio = () => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
    }
    setIsSpeaking(false);
    setIsListening(false);
  };

  const restart = () => {
    stopAllAudio();
    lastSpokenIndexRef.current = -1;
    saveSessionId(null);
    setView(null);
    setError("");
    setInput("");
    setAiTurn(true);
    setCallSeconds(0);
    connect();
  };

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

    stopAllAudio();

    setInput("");
    setError("");
    setAiTurn(true);
    setView({ ...view, messages: [...view.messages, { role: "caller", text, at: new Date().toISOString() }] });

    try {
      const nextView = await api<CallView>("/api/agent", {
        method: "POST",
        json: { sessionId: view.sessionId, message: text },
      });
      setView(nextView);
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

  /** STT 마이크 시작 함수 */
  const startListening = () => {
    if (typeof window === "undefined") return;

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert("현재 브라우저에서는 음성 인식을 지원하지 않습니다. Chrome 또는 Edge 브라우저를 이용해 주세요.");
      return;
    }

    // AI 발화 중지
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);

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

        // 발화 완료 (isFinal)
        const isFinal = event.results[event.results.length - 1].isFinal;
        if (isFinal && transcript.trim()) {
          recognition.stop();
          setIsListening(false);
          setTimeout(() => {
            sendMessage(transcript);
          }, 350);
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

  /** STT 마이크 토글 함수 */
  const toggleListening = () => {
    if (isListening) {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {}
      }
      setIsListening(false);
    } else {
      startListening();
    }
  };

  const toggleTts = () => {
    if (ttsEnabled) {
      stopAllAudio();
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
      ? { label: "동·호수와 계약자 성함을 말씀해 주세요", placeholder: "예: 103동 1204호 권승민입니다" }
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

  const formatTimer = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  return (
    <div className="relative">
      {/* ─────────────────────────────────────────────────────────────
          📱 실제 통화 모드 시연 풀스크린 오버레이 (Phone Call Mode)
         ───────────────────────────────────────────────────────────── */}
      {phoneMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4">
          <div className="relative flex flex-col justify-between w-full max-w-sm h-[640px] rounded-[2.5rem] bg-gradient-to-b from-slate-900 via-slate-800 to-slate-950 text-white p-6 shadow-2xl border-4 border-slate-700/60 overflow-hidden">
            {/* 상단 스피커 & 노치 */}
            <div className="flex flex-col items-center gap-1.5">
              <div className="w-16 h-1 rounded-full bg-slate-700 mb-2" />
              <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 text-[11px] font-medium text-emerald-400 border border-emerald-500/20">
                <span className="size-2 rounded-full bg-emerald-400 animate-ping" />
                HD Voice · 100% 무료 신경망 AI 통화
              </div>
              <h3 className="text-xl font-bold tracking-tight text-white mt-1">SH AI 고객만족센터</h3>
              <p className="text-xs text-slate-400">1600-1004 (24시간 AI 하자접수)</p>
              <p className="text-sm font-semibold tracking-wider text-emerald-400 mt-1">
                {ended ? "통화 종료됨" : `통화 중 · ${formatTimer(callSeconds)}`}
              </p>
            </div>

            {/* 중앙 상담원 상태 및 자막 프리뷰 */}
            <div className="my-auto flex flex-col items-center text-center px-2">
              <div
                className={cn(
                  "relative flex size-28 items-center justify-center rounded-full transition-all duration-300 shadow-xl",
                  isSpeaking
                    ? "bg-emerald-500 text-white ring-8 ring-emerald-500/30 scale-105 animate-pulse"
                    : isListening
                      ? "bg-red-500 text-white ring-8 ring-red-500/30 scale-105"
                      : "bg-blue-600/90 text-white ring-4 ring-blue-500/20",
                )}
              >
                {isSpeaking ? (
                  <Radio className="size-12 animate-pulse" />
                ) : isListening ? (
                  <Mic className="size-12 animate-bounce" />
                ) : (
                  <Bot className="size-12" />
                )}
                {isSpeaking && (
                  <span className="absolute -bottom-2 px-2.5 py-0.5 rounded-full bg-emerald-600 text-[10px] font-bold tracking-wide uppercase shadow">
                    AI 안내 중
                  </span>
                )}
                {isListening && (
                  <span className="absolute -bottom-2 px-2.5 py-0.5 rounded-full bg-red-600 text-[10px] font-bold tracking-wide uppercase shadow animate-pulse">
                    말씀하세요
                  </span>
                )}
              </div>

              {/* 실시간 말풍선 프리뷰 */}
              <div className="mt-6 w-full min-h-[90px] max-h-[140px] overflow-y-auto rounded-2xl bg-white/10 p-3.5 backdrop-blur-sm border border-white/10 text-left">
                {view?.messages && view.messages.length > 0 ? (
                  (() => {
                    const last = view.messages[view.messages.length - 1];
                    return (
                      <div className="space-y-1">
                        <span className="text-[10px] font-semibold text-emerald-400">
                          {last.role === "agent" ? "🤖 AI 상담원" : "👤 나(민원인)"}
                        </span>
                        <p className="text-xs leading-relaxed text-slate-100 whitespace-pre-wrap">{last.text}</p>
                      </div>
                    );
                  })()
                ) : (
                  <p className="text-xs text-slate-400 text-center py-4">연결 중...</p>
                )}
                {isListening && input && (
                  <p className="text-xs text-red-300 font-medium italic mt-2">인식 중: &quot;{input}&quot;</p>
                )}
              </div>
            </div>

            {/* 하단 통화 조작 키패드 및 통화 종료 */}
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-3 gap-3 text-center">
                {/* 마이크 음소거 / 말하기 */}
                <button
                  type="button"
                  onClick={toggleListening}
                  disabled={ended || aiTurn}
                  className={cn(
                    "flex flex-col items-center justify-center gap-1 py-3 rounded-2xl transition-all border",
                    isListening
                      ? "bg-red-500/20 text-red-300 border-red-500/40"
                      : "bg-white/5 text-slate-300 border-white/10 hover:bg-white/10 disabled:opacity-40",
                  )}
                >
                  {isListening ? <MicOff className="size-6 text-red-400" /> : <Mic className="size-6" />}
                  <span className="text-[11px]">{isListening ? "음소거" : "내 마이크"}</span>
                </button>

                {/* 신경망 TTS 음성 */}
                <button
                  type="button"
                  onClick={() => setUseNeuralVoice(!useNeuralVoice)}
                  className="flex flex-col items-center justify-center gap-1 py-3 rounded-2xl bg-white/5 text-slate-300 border border-white/10 hover:bg-white/10"
                >
                  <Sparkles className={cn("size-6", useNeuralVoice ? "text-amber-400" : "text-slate-500")} />
                  <span className="text-[11px]">{useNeuralVoice ? "신경망 보이스" : "일반 보이스"}</span>
                </button>

                {/* 스피커폰 / 소리 켜기 */}
                <button
                  type="button"
                  onClick={toggleTts}
                  className={cn(
                    "flex flex-col items-center justify-center gap-1 py-3 rounded-2xl transition-all border",
                    ttsEnabled
                      ? "bg-blue-500/20 text-blue-300 border-blue-500/40"
                      : "bg-white/5 text-slate-400 border-white/10",
                  )}
                >
                  {ttsEnabled ? <Volume2 className="size-6 text-blue-400" /> : <VolumeX className="size-6" />}
                  <span className="text-[11px]">{ttsEnabled ? "스피커폰" : "음소거"}</span>
                </button>
              </div>

              {/* 통화 종료 버튼 */}
              <div className="flex items-center justify-center gap-6 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    stopAllAudio();
                    setPhoneMode(false);
                  }}
                  className="flex items-center justify-center size-16 rounded-full bg-red-600 hover:bg-red-700 text-white shadow-lg shadow-red-600/40 transition-transform active:scale-95"
                  title="통화 종료"
                >
                  <PhoneOff className="size-8" />
                </button>
              </div>

              <p className="text-center text-[10px] text-slate-400">
                빨간 버튼을 누르면 통화가 종료되고 접수 내역 화면으로 돌아갑니다.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          웹 화면 (통화 + 수선유지 RAG 판정 및 실시간 접수 양식)
         ───────────────────────────────────────────────────────────── */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* 대화 영역 */}
        <section className="card flex h-[min(44rem,calc(100dvh-11rem))] min-h-[30rem] flex-col overflow-hidden">
          {/* 상단 헤더 바 */}
          <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
            <span
              className={cn(
                "flex size-9 items-center justify-center rounded-full transition-colors",
                isSpeaking ? "bg-emerald-100 text-emerald-700 animate-pulse" : "bg-blue-100 text-blue-700",
              )}
            >
              <Bot className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-slate-900">AI 시설물 접수센터 (음성 통화)</p>
                {isSpeaking && (
                  <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 border border-emerald-200">
                    <span className="size-1.5 rounded-full bg-emerald-600 animate-ping" /> 신경망 음성 낭독 중
                  </span>
                )}
              </div>
              <p className="truncate text-[11px] text-slate-500">
                {view ? engineLabel(view) : "연결 중…"} · 한국어 Neural 음성(0원) 연동
              </p>
            </div>

            {/* 실제 스마트폰 통화 시연 모드 버튼 */}
            <button
              type="button"
              onClick={() => {
                setPhoneMode(true);
                // 통화 시작 시 아직 안 읽었으면 낭독
                if (view?.messages && view.messages.length > 0) {
                  const last = view.messages[view.messages.length - 1];
                  if (last.role === "agent" && !isSpeaking) {
                    speak(last.text);
                  }
                }
              }}
              className="btn-primary px-3 py-1.5 text-xs flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
              title="스마트폰 실제 통화 화면으로 시연하기"
            >
              <PhoneCall className="size-3.5" />
              <span>실제 통화 시연 모드</span>
            </button>

            {/* 음성 안내 켜기/끄기 토글 버튼 */}
            <button
              type="button"
              onClick={toggleTts}
              className={cn(
                "btn-secondary px-2.5 py-1.5 text-xs flex items-center gap-1",
                ttsEnabled ? "text-blue-700 bg-blue-50/80" : "text-slate-400",
              )}
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
                  <span
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-full",
                      ai ? "bg-blue-100 text-blue-700" : "bg-slate-200 text-slate-600",
                    )}
                  >
                    {ai ? <Bot className="size-3.5" /> : <User className="size-3.5" />}
                  </span>
                  <div className={cn("max-w-[80%] space-y-0.5", !ai && "text-right")}>
                    <p className="px-1 text-[11px] text-slate-400">{ai ? "AI 상담원 (음성 안내)" : "민원인(나)"}</p>
                    <p
                      className={cn(
                        "inline-block rounded-2xl px-3.5 py-2 text-left text-sm leading-relaxed whitespace-pre-wrap",
                        ai
                          ? "rounded-bl-sm border border-slate-200 bg-white text-slate-800"
                          : "rounded-br-sm bg-blue-600 text-white",
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
            {ended && (
              <p className="py-2 text-center text-xs text-slate-400">— 대화가 끝났습니다. 새로 접수하려면 ‘새 대화’를 누르세요 —</p>
            )}
          </div>

          {view?.notice && <div className="border-t border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">{view.notice}</div>}
          {error && <div className="px-4 pt-3"><ErrorBox message={error} /></div>}

          {/* 하단 음성 마이크 및 텍스트 입력 바 */}
          {!ended && (
            <form onSubmit={send} className="space-y-1.5 border-t border-slate-100 p-3 bg-white">
              <p
                className={cn(
                  "flex items-center gap-1.5 px-1 text-xs font-medium",
                  isListening ? "text-red-600" : myTurn ? "text-blue-700" : "text-slate-400",
                )}
              >
                <span
                  className={cn(
                    "size-2 rounded-full",
                    isListening ? "bg-red-500 animate-ping" : myTurn ? "animate-pulse bg-blue-600" : "bg-slate-300",
                  )}
                />
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
                  className={cn("input flex-1", isListening && "border-red-400 bg-red-50/30 placeholder:text-red-500")}
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
                <button
                  type="submit"
                  className="btn-primary shrink-0 px-3.5 h-10 rounded-xl"
                  disabled={!myTurn || !input.trim()}
                  aria-label="보내기"
                >
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
                  <p className="text-xs">
                    <b>항목</b> · {d.item}
                  </p>
                  {dialogue && d.explanation && (
                    <p className="text-xs leading-relaxed">
                      <b>안내</b> · {d.explanation}
                    </p>
                  )}
                  <p className="text-xs leading-relaxed">
                    <b>근거</b> · {d.basis}
                  </p>
                </div>
              )}
            </div>
          </section>

          <section className="card">
            <SectionTitle title="접수 양식" />
            <dl className="divide-y divide-slate-100">
              {fields.map(([label, value]) => (
                <div key={label} className="flex items-start gap-2 px-4 py-2 text-sm">
                  {value ? (
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                  ) : (
                    <Circle className="mt-0.5 size-4 shrink-0 text-slate-300" />
                  )}
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
                <p className="text-xs">
                  {view.submitted.contractorName
                    ? `배정 업체: ${view.submitted.contractorName}`
                    : "관리자 확인 대기 (업체 배정 예정)"}
                </p>
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
    </div>
  );
}
