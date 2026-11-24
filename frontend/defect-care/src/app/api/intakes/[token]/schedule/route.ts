import type { NextRequest } from "next/server";
import { errorResponse, readJson } from "@/lib/api-helpers";
import { completePendingIntake } from "@/lib/services/intake-service";

/** 거주자가 고른 방문 희망일(1~3개) 저장 → 민원 접수 + 업체 자동 배정. body: { dates: ["YYYY-MM-DD", ...] } */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/intakes/[token]/schedule">) {
  try {
    const { token } = await ctx.params;
    const { dates } = await readJson<{ dates: string[] }>(request);
    const result = await completePendingIntake(token, dates);
    return Response.json({ receiptNo: result.receiptNo, preferredDates: result.preferredDates }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
