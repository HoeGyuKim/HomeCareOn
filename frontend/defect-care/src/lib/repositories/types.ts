import type { Complaint, ComplaintFilter, Contractor } from "../types";

/**
 * 저장소 인터페이스.
 * 메모리 구현(memory.ts)과 Supabase 구현(supabase.ts)이 동일한 계약을 따르므로
 * 서비스 계층 코드는 저장소 종류를 몰라도 됩니다.
 */
export interface ComplaintRepository {
  list(filter?: ComplaintFilter): Promise<Complaint[]>;
  get(id: string): Promise<Complaint | null>;
  create(complaint: Omit<Complaint, "id" | "receiptNo">): Promise<Complaint>;
  update(id: string, patch: Partial<Complaint>): Promise<Complaint | null>;
  countActiveByContractor(): Promise<Record<string, number>>;
}

export interface ContractorRepository {
  list(): Promise<Contractor[]>;
  get(id: string): Promise<Contractor | null>;
  create(input: Omit<Contractor, "id" | "createdAt">): Promise<Contractor>;
  update(id: string, patch: Partial<Contractor>): Promise<Contractor | null>;
  remove(id: string): Promise<boolean>;
}

export interface Repositories {
  complaints: ComplaintRepository;
  contractors: ContractorRepository;
  kind: "memory" | "supabase";
}
