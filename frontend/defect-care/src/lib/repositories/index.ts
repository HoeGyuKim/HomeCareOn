import "server-only";
import { createMemoryRepositories } from "./memory";
import { createSupabaseRepositories } from "./supabase";
import type { Repositories } from "./types";

let repos: Repositories | null = null;

/**
 * 환경변수에 따라 저장소를 선택합니다.
 * - NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY 설정 시 → Supabase
 * - 그 외 → 메모리(테스트 데이터)
 */
export function getRepositories(): Repositories {
  if (repos) return repos;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  repos = url && key ? createSupabaseRepositories(url, key) : createMemoryRepositories();
  return repos;
}

export type { Repositories } from "./types";
