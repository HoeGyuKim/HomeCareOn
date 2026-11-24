import type { NextRequest } from "next/server";
import { errorResponse, readJson } from "@/lib/api-helpers";
import { createPendingIntake } from "@/lib/services/intake-service";
import type { ComplaintInput } from "@/lib/types";

/**
 * 접수 대기 생성 + 희망일 선택 링크 문자 발송 (대화 엔진이 호출)
 * body: { complaint: ComplaintInput, facility?: string }
 * 링크 주소는 PUBLIC_BASE_URL(실제 문자 발송 시 외부에서 열리는 주소) → 없으면 요청 받은 주소 기준
 */
export async function POST(request: NextRequest) {
  try {
    const { complaint, facility } = await readJson<{ complaint: ComplaintInput; facility?: string }>(request);
    const baseUrl = process.env.PUBLIC_BASE_URL || request.nextUrl.origin;
    const result = await createPendingIntake(complaint, { baseUrl, facility });
    return Response.json(result, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
