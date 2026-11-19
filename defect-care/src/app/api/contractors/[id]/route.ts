import type { NextRequest } from "next/server";
import { errorResponse, readJson } from "@/lib/api-helpers";
import { getRepositories } from "@/lib/repositories";
import { ServiceError } from "@/lib/services/complaint-service";
import { validateContractor, type ContractorBody } from "@/lib/services/contractor-service";

export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/contractors/[id]">) {
  try {
    const { id } = await ctx.params;
    const body = await readJson<Partial<ContractorBody>>(request);
    // 토글 같은 부분 수정은 그대로, 전체 수정은 검증
    const patch = "name" in body ? validateContractor(body as ContractorBody) : body;
    const updated = await getRepositories().contractors.update(id, patch);
    if (!updated) throw new ServiceError("업체를 찾을 수 없습니다.", 404);
    return Response.json(updated);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/contractors/[id]">) {
  try {
    const { id } = await ctx.params;
    const { complaints, contractors } = getRepositories();
    const load = await complaints.countActiveByContractor();
    if (load[id]) throw new ServiceError(`진행 중인 민원 ${load[id]}건이 있어 삭제할 수 없습니다. 업무 불가로 변경하세요.`);
    await contractors.remove(id);
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
