import type { NextRequest } from "next/server";
import { errorResponse, readJson } from "@/lib/api-helpers";
import { createComplaint, listComplaints } from "@/lib/services/complaint-service";
import type { ComplaintFilter, ComplaintInput } from "@/lib/types";

/** 민원 목록 조회 — ?q=&status=&defectType=&urgency= */
export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const filter: ComplaintFilter = {
      q: sp.get("q") ?? undefined,
      status: (sp.get("status") as ComplaintFilter["status"]) ?? undefined,
      defectType: (sp.get("defectType") as ComplaintFilter["defectType"]) ?? undefined,
      urgency: (sp.get("urgency") as ComplaintFilter["urgency"]) ?? undefined,
      district: sp.get("district") ?? undefined,
    };
    const items = await listComplaints(filter);
    const limit = Number(sp.get("limit"));
    return Response.json({ items: limit > 0 ? items.slice(0, limit) : items });
  } catch (err) {
    return errorResponse(err);
  }
}

/** 민원 등록 (+ 자동 배정) */
export async function POST(request: NextRequest) {
  try {
    const body = await readJson<ComplaintInput & { autoAssign?: boolean }>(request);
    const result = await createComplaint(body, { autoAssign: body.autoAssign !== false });
    return Response.json(result, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
