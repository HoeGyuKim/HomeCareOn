import type { NextRequest } from "next/server";
import { errorResponse, readJson } from "@/lib/api-helpers";
import {
  assignManually,
  autoAssign,
  changeStatus,
  getComplaintDetail,
  ServiceError,
} from "@/lib/services/complaint-service";
import type { ComplaintStatus } from "@/lib/types";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/complaints/[id]">) {
  try {
    const { id } = await ctx.params;
    const detail = await getComplaintDetail(id);
    if (!detail) throw new ServiceError("민원을 찾을 수 없습니다.", 404);
    return Response.json(detail);
  } catch (err) {
    return errorResponse(err);
  }
}

type PatchBody =
  | { action: "status"; status: ComplaintStatus; note?: string }
  | { action: "assign"; contractorId: string }
  | { action: "auto-assign" };

export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/complaints/[id]">) {
  try {
    const { id } = await ctx.params;
    const body = await readJson<PatchBody>(request);
    switch (body.action) {
      case "status":
        await changeStatus(id, body.status, body.note);
        break;
      case "assign":
        await assignManually(id, body.contractorId);
        break;
      case "auto-assign":
        await autoAssign(id);
        break;
      default:
        throw new ServiceError("지원하지 않는 작업입니다.");
    }
    return Response.json(await getComplaintDetail(id));
  } catch (err) {
    return errorResponse(err);
  }
}
