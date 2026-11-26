import type { NextRequest } from "next/server";
import { errorResponse, readJson } from "@/lib/api-helpers";
import { sendScheduleOffer } from "@/lib/services/schedule-service";
import type { VisitSlot } from "@/lib/types";

/**
 * 관리자: 배정 업체와 조율한 방문 가능 일정을 거주자에게 문자로 발송 (body: { slots: [{ date, period }] })
 * 링크 주소는 PUBLIC_BASE_URL(실제 문자 발송 시 거주자 휴대폰에서 열리는 외부 주소) → 없으면 요청 받은 주소 기준
 * 응답: 민원 상세 (GET /api/complaints/[id] 와 같은 형식)
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/complaints/[id]/schedule-offer">) {
  try {
    const { id } = await ctx.params;
    const { slots } = await readJson<{ slots: VisitSlot[] }>(request);
    const baseUrl = process.env.PUBLIC_BASE_URL || request.nextUrl.origin;
    return Response.json(await sendScheduleOffer(id, slots, baseUrl));
  } catch (err) {
    return errorResponse(err);
  }
}
