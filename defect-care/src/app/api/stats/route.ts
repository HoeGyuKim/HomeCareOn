import { connection } from "next/server";
import { errorResponse } from "@/lib/api-helpers";
import { getStats } from "@/lib/services/complaint-service";

export async function GET() {
  await connection(); // 요청 시점에 실행 (try 밖에 두어야 프리렌더 신호를 가로채지 않음)
  try {
    return Response.json(await getStats());
  } catch (err) {
    return errorResponse(err);
  }
}
