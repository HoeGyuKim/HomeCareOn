import type { NextRequest } from "next/server";
import { errorResponse, readJson } from "@/lib/api-helpers";
import { analyzeCall } from "@/lib/services/call-analyzer";
import { createComplaint, ServiceError } from "@/lib/services/complaint-service";

/**
 * 원스톱 접수 엔드포인트: 통화 녹취 → AI 분석 → 저장 → 자동 배정 → 업체 전달
 *
 * 추후 실제 전화 시스템(예: Twilio, 클라우드 PBX + STT)의 통화 종료 웹훅이
 * { transcript, callerPhone } 를 이 주소로 POST 하도록 연결하면 됩니다.
 */
export async function POST(request: NextRequest) {
  try {
    const { transcript, callerPhone } = await readJson<{ transcript: string; callerPhone?: string }>(request);
    if (!transcript?.trim()) throw new ServiceError("통화 내용이 비어 있습니다.");

    const analysis = await analyzeCall(transcript);
    const result = await createComplaint({
      complainantName: analysis.complainantName || "미확인",
      phone: analysis.phone || callerPhone || "",
      apartmentName: analysis.apartmentName,
      building: analysis.building,
      unit: analysis.unit,
      defectType: analysis.defectType,
      description: analysis.description || transcript.slice(0, 500),
      urgency: analysis.urgency,
      channel: "PHONE_AI",
      callTranscript: transcript,
      aiSummary: analysis.summary,
    });
    return Response.json({ analysis, ...result }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
