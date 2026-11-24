import type { NextRequest } from "next/server";
import { errorResponse } from "@/lib/api-helpers";
import { getPendingIntake, publicView } from "@/lib/services/intake-service";

/** 거주자 희망일 선택 화면용 정보 (이름 일부 가림) */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/intakes/[token]">) {
  try {
    const { token } = await ctx.params;
    return Response.json(publicView(getPendingIntake(token)));
  } catch (err) {
    return errorResponse(err);
  }
}
