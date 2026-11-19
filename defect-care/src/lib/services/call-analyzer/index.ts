import "server-only";
import type { CallAnalysis } from "../../types";
import { ClaudeCallAnalyzer } from "./claude";
import { RuleBasedCallAnalyzer } from "./rule-based";

const ruleBased = new RuleBasedCallAnalyzer();

/**
 * 통화 녹취를 분석합니다.
 * - ANTHROPIC_API_KEY 가 있으면 Claude API 사용, 실패 시 규칙 기반으로 자동 대체
 * - 없으면 규칙 기반 분석기 사용
 */
export async function analyzeCall(transcript: string): Promise<CallAnalysis & { warning?: string }> {
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      return await new ClaudeCallAnalyzer(process.env.ANTHROPIC_API_KEY).analyze(transcript);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[call-analyzer] Claude 분석 실패, 규칙 기반으로 대체:", message);
      return { ...(await ruleBased.analyze(transcript)), warning: `Claude 분석 실패로 규칙 기반 분석을 사용했습니다: ${message}` };
    }
  }
  return ruleBased.analyze(transcript);
}

export function analyzerEngine(): CallAnalysis["engine"] {
  return process.env.ANTHROPIC_API_KEY ? "claude" : "rule-based";
}
