import { connection } from "next/server";
import { APARTMENTS, REGIONS } from "@/lib/mock-data";
import { getRepositories } from "@/lib/repositories";
import { analyzerEngine } from "@/lib/services/call-analyzer";

/** 화면에서 쓰는 기준 정보 + 현재 연결 상태 */
export async function GET() {
  await connection();
  return Response.json({
    apartments: APARTMENTS,
    regions: REGIONS,
    analyzer: analyzerEngine(),
    storage: getRepositories().kind,
  });
}
