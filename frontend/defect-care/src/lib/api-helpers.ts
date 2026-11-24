import "server-only";
import { ServiceError } from "./services/complaint-service";

export function errorResponse(err: unknown) {
  if (err instanceof ServiceError) return Response.json({ error: err.message }, { status: err.status });
  console.error(err);
  const message = err instanceof Error ? err.message : "서버 오류가 발생했습니다.";
  return Response.json({ error: message }, { status: 500 });
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new ServiceError("요청 본문(JSON)을 해석할 수 없습니다.");
  }
}
