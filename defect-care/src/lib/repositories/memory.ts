// ─────────────────────────────────────────────
// 메모리 저장소 (테스트용)
// 서버 프로세스가 재시작되면 초기 데이터로 리셋됩니다.
// ─────────────────────────────────────────────
import { seedComplaints, seedContractors } from "../mock-data";
import type { Complaint, Contractor } from "../types";
import { matchesFilter } from "./filter";
import type { Repositories } from "./types";

interface MemoryDb {
  complaints: Complaint[];
  contractors: Contractor[];
  seq: number;
}

// 개발 모드 HMR 시에도 데이터가 유지되도록 globalThis에 보관
const g = globalThis as unknown as { __defectCareDb?: MemoryDb };

function db(): MemoryDb {
  if (!g.__defectCareDb) {
    const contractors = seedContractors();
    const complaints = seedComplaints(contractors);
    g.__defectCareDb = { complaints, contractors, seq: complaints.length };
  }
  return g.__defectCareDb;
}

const clone = <T>(v: T): T => structuredClone(v);
const ACTIVE = new Set(["ASSIGNED", "SCHEDULED", "IN_PROGRESS"]);

export function createMemoryRepositories(): Repositories {
  return {
    kind: "memory",
    complaints: {
      async list(filter) {
        return clone(
          db()
            .complaints.filter((c) => matchesFilter(c, filter))
            .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)),
        );
      },
      async get(id) {
        const c = db().complaints.find((x) => x.id === id);
        return c ? clone(c) : null;
      },
      async create(input) {
        const d = db();
        d.seq += 1;
        const ymd = input.receivedAt.slice(0, 10).replace(/-/g, "");
        const complaint: Complaint = {
          ...clone(input),
          id: crypto.randomUUID(),
          receiptNo: `MW-${ymd}-${String(d.seq).padStart(4, "0")}`,
        };
        d.complaints.push(complaint);
        return clone(complaint);
      },
      async update(id, patch) {
        const d = db();
        const idx = d.complaints.findIndex((x) => x.id === id);
        if (idx < 0) return null;
        d.complaints[idx] = { ...d.complaints[idx], ...clone(patch), id };
        return clone(d.complaints[idx]);
      },
      async countActiveByContractor() {
        const counts: Record<string, number> = {};
        for (const c of db().complaints) {
          if (c.contractorId && ACTIVE.has(c.status)) counts[c.contractorId] = (counts[c.contractorId] ?? 0) + 1;
        }
        return counts;
      },
    },
    contractors: {
      async list() {
        return clone(db().contractors);
      },
      async get(id) {
        const c = db().contractors.find((x) => x.id === id);
        return c ? clone(c) : null;
      },
      async create(input) {
        const c: Contractor = { ...clone(input), id: crypto.randomUUID(), createdAt: new Date().toISOString() };
        db().contractors.push(c);
        return clone(c);
      },
      async update(id, patch) {
        const d = db();
        const idx = d.contractors.findIndex((x) => x.id === id);
        if (idx < 0) return null;
        d.contractors[idx] = { ...d.contractors[idx], ...clone(patch), id };
        return clone(d.contractors[idx]);
      },
      async remove(id) {
        const d = db();
        const before = d.contractors.length;
        d.contractors = d.contractors.filter((x) => x.id !== id);
        return d.contractors.length < before;
      },
    },
  };
}
