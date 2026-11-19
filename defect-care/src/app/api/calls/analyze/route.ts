import type { NextRequest } from "next/server";
import { errorResponse, readJson } from "@/lib/api-helpers";
import { analyzeCall } from "@/lib/services/call-analyzer";
import { ServiceError } from "@/lib/services/complaint-service";

/** 통화 녹취 분석만 수행 (저장하지 않음) — 통화 시뮬레이터 미리보기용 */
export async function POST(request: NextRequest) {
  try {
    const { transcript } = await readJson<{ transcript: string }>(request);
    if (!transcript?.trim()) throw new ServiceError("통화 내용을 입력하세요.");
    if (transcript.length > 20000) throw new ServiceError("통화 내용이 너무 깁니다(최대 20,000자).");
    return Response.json(await analyzeCall(transcript));
  } catch (err) {
    return errorResponse(err);
  }
}
