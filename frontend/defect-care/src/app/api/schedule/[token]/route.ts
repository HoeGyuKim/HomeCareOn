import type { NextRequest } from "next/server";
import { errorResponse, readJson } from "@/lib/api-helpers";
import { ServiceError } from "@/lib/services/complaint-service";
import { chooseSlot, declineSlots, getPublicSchedule } from "@/lib/services/schedule-service";

/** 거주자: 문자 링크로 받은 방문 가능 일정 보기 (이름 일부 가림) */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/schedule/[token]">) {
  try {
    const { token } = await ctx.params;
    return Response.json(await getPublicSchedule(token));
  } catch (err) {
    return errorResponse(err);
  }
}

/** 거주자: { action: "choose", index } 일정 선택 → 확정 / { action: "decline" } 가능한 날짜 없음 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/schedule/[token]">) {
  try {
    const { token } = await ctx.params;
    const body = await readJson<{ action: "choose" | "decline"; index?: number }>(request);
    if (body.action === "choose") return Response.json(await chooseSlot(token, body.index));
    if (body.action === "decline") return Response.json(await declineSlots(token));
    throw new ServiceError("올바르지 않은 요청입니다.");
  } catch (err) {
    return errorResponse(err);
  }
}
