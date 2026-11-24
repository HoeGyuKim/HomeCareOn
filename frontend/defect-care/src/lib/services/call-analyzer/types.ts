import type { CallAnalysis } from "../../types";

/** 통화 분석기 인터페이스 — 규칙 기반 / Claude API 구현을 교체할 수 있습니다. */
export interface CallAnalyzer {
  readonly name: CallAnalysis["engine"];
  analyze(transcript: string): Promise<CallAnalysis>;
}
