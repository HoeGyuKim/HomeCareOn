import type { NextRequest } from "next/server";
import { errorResponse, readJson } from "@/lib/api-helpers";
import { claudeTurn } from "@/lib/agent/claude-agent";
import { applyDialogueView, DIALOGUE_API_URL, sendDialogue, startDialogue } from "@/lib/agent/dialogue-engine";
import { scriptedTurn } from "@/lib/agent/scripted-agent";
import { createSession, getSession, say, toView } from "@/lib/agent/session";
import { ACCEPTABLE_VERDICTS } from "@/lib/agent/types";
import { ServiceError } from "@/lib/services/complaint-service";

const GREETING = "안녕하세요, SH 하자보수 접수센터 AI 상담원입니다. 어떤 문제로 연락 주셨나요?";

/**
 * AI 전화 상담
 * - { } → 새 통화 시작 (인사말)
 * - { sessionId, message } → 민원인 발화 처리 후 상담원 응답
 *
 * 상담원 엔진
 * - 기본: HomeCareOn 대화 엔진(Python, backend/server.py) + 수선유지 RAG
 *   서버 주소는 DIALOGUE_API_URL (기본 http://127.0.0.1:8100)
 * - 대화 엔진 서버에 연결할 수 없거나 AGENT_ENGINE=builtin 이면 이 웹에 내장된 상담원
 *   (ANTHROPIC_API_KEY 가 있으면 Claude, 없으면 테스트용)
 * 추후 실제 전화(STT/TTS) 연동 시 같은 엔드포인트에 음성인식 텍스트를 보내면 됩니다.
 */
export async function POST(request: NextRequest) {
  try {
    const { sessionId, message } = await readJson<{ sessionId?: string; message?: string }>(request);

    if (!sessionId) {
      if (process.env.AGENT_ENGINE !== "builtin") {
        try {
          const v = await startDialogue();
          const s = createSession("dialogue");
          applyDialogueView(s, v);
          say(s, "agent", v.reply);
          return Response.json(toView(s));
        } catch (err) {
          console.error("[agent] 대화 엔진 연결 실패, 내장 상담원으로 시작:", err);
          const s = createSession(process.env.ANTHROPIC_API_KEY ? "claude" : "scripted");
          s.notice = `대화 엔진 서버(${DIALOGUE_API_URL})에 연결하지 못해 내장 상담원으로 시작했습니다.`;
          say(s, "agent", GREETING);
          return Response.json(toView(s));
        }
      }
      const s = createSession(process.env.ANTHROPIC_API_KEY ? "claude" : "scripted");
      say(s, "agent", GREETING);
      return Response.json(toView(s));
    }

    const s = getSession(sessionId);
    if (!s) throw new ServiceError("통화가 종료되었거나 만료되었습니다. 새 통화를 시작하세요.", 404);
    // 말 없이 sessionId만 보내면 진행 중인 대화를 그대로 이어서 보여 줌 (새로고침 대비)
    if (message === undefined) return Response.json(toView(s));
    const text = message.trim();
    if (!text) throw new ServiceError("말씀을 입력하세요.");
    if (text.length > 1000) throw new ServiceError("한 번에 1,000자까지 말할 수 있습니다.");

    if (s.engine === "dialogue") {
      let v;
      try {
        v = await sendDialogue(s.dialogueSessionId!, text);
      } catch (err) {
        // 대화 단계가 엔진마다 달라 중간에 다른 상담원으로 넘기지 않고 다시 말하게 함
        throw new ServiceError(
          `대화 엔진 응답을 받지 못했습니다. 잠시 뒤 다시 말씀해 주세요. (${err instanceof Error ? err.message : String(err)})`,
          502,
        );
      }
      say(s, "caller", text);
      applyDialogueView(s, v);
      say(s, "agent", v.reply);
      return Response.json(toView(s));
    }

    say(s, "caller", text);
    let reply: string;
    if (s.engine === "claude") {
      try {
        reply = await claudeTurn(s, text);
      } catch (err) {
        // Claude 호출 실패 시 이 통화는 테스트용 상담원으로 이어서 진행
        console.error("[agent] Claude 실패, 테스트 상담원으로 전환:", err);
        s.engine = "scripted";
        s.notice = `Claude 연결 실패로 테스트용 상담원으로 전환했습니다: ${err instanceof Error ? err.message : String(err)}`;
        if (s.step === "issue" && s.decision && ACCEPTABLE_VERDICTS.includes(s.decision.verdict)) s.step = "collect";
        reply = await scriptedTurn(s, text);
      }
    } else {
      reply = await scriptedTurn(s, text);
    }
    say(s, "agent", reply);
    return Response.json(toView(s));
  } catch (err) {
    return errorResponse(err);
  }
}
