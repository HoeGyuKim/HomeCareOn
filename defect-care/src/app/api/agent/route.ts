import type { NextRequest } from "next/server";
import { errorResponse, readJson } from "@/lib/api-helpers";
import { claudeTurn } from "@/lib/agent/claude-agent";
import { scriptedTurn } from "@/lib/agent/scripted-agent";
import { createSession, getSession, say, toView } from "@/lib/agent/session";
import { ACCEPTABLE_VERDICTS } from "@/lib/agent/types";
import { ServiceError } from "@/lib/services/complaint-service";

const GREETING = "안녕하세요, SH 하자보수 접수센터 AI 상담원입니다. 어떤 문제로 연락 주셨나요?";

/**
 * AI 전화 상담
 * - { } → 새 통화 시작 (인사말)
 * - { sessionId, message } → 민원인 발화 처리 후 상담원 응답
 * 추후 실제 전화(STT/TTS) 연동 시 같은 엔드포인트에 음성인식 텍스트를 보내면 됩니다.
 */
export async function POST(request: NextRequest) {
  try {
    const { sessionId, message } = await readJson<{ sessionId?: string; message?: string }>(request);

    if (!sessionId) {
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
