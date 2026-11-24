// ─────────────────────────────────────────────
// Supabase 저장소
// .env.local 에 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 설정되면 자동 사용됩니다.
// 테이블 구조: supabase/schema.sql
// ─────────────────────────────────────────────
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Complaint, Contractor } from "../types";
import type { Repositories } from "./types";

type Row = Record<string, unknown>;

const toComplaint = (r: Row): Complaint => ({
  id: r.id as string,
  receiptNo: r.receipt_no as string,
  receivedAt: r.received_at as string,
  complainantName: r.complainant_name as string,
  phone: r.phone as string,
  apartmentName: r.apartment_name as string,
  region: r.region as string,
  building: r.building as string,
  unit: r.unit as string,
  defectType: r.defect_type as Complaint["defectType"],
  description: r.description as string,
  urgency: r.urgency as Complaint["urgency"],
  photos: (r.photos as string[]) ?? [],
  contractorId: (r.contractor_id as string) ?? null,
  status: r.status as Complaint["status"],
  channel: r.channel as Complaint["channel"],
  callTranscript: (r.call_transcript as string) ?? null,
  aiSummary: (r.ai_summary as string) ?? null,
  preferredDates: (r.preferred_dates as string[]) ?? [],
  history: (r.history as Complaint["history"]) ?? [],
  updatedAt: r.updated_at as string,
});

const fromComplaint = (c: Partial<Complaint>): Row => {
  const map: Record<string, string> = {
    receivedAt: "received_at",
    complainantName: "complainant_name",
    phone: "phone",
    apartmentName: "apartment_name",
    region: "region",
    building: "building",
    unit: "unit",
    defectType: "defect_type",
    description: "description",
    urgency: "urgency",
    photos: "photos",
    contractorId: "contractor_id",
    status: "status",
    channel: "channel",
    callTranscript: "call_transcript",
    aiSummary: "ai_summary",
    preferredDates: "preferred_dates",
    history: "history",
    updatedAt: "updated_at",
  };
  const row: Row = {};
  for (const [k, v] of Object.entries(c)) if (map[k] && v !== undefined) row[map[k]] = v;
  return row;
};

const toContractor = (r: Row): Contractor => ({
  id: r.id as string,
  name: r.name as string,
  defectTypes: (r.defect_types as Contractor["defectTypes"]) ?? [],
  regions: (r.regions as string[]) ?? [],
  phone: r.phone as string,
  email: r.email as string,
  isContracted: r.is_contracted as boolean,
  isAvailable: r.is_available as boolean,
  createdAt: r.created_at as string,
});

const fromContractor = (c: Partial<Contractor>): Row => {
  const row: Row = {};
  if (c.name !== undefined) row.name = c.name;
  if (c.defectTypes !== undefined) row.defect_types = c.defectTypes;
  if (c.regions !== undefined) row.regions = c.regions;
  if (c.phone !== undefined) row.phone = c.phone;
  if (c.email !== undefined) row.email = c.email;
  if (c.isContracted !== undefined) row.is_contracted = c.isContracted;
  if (c.isAvailable !== undefined) row.is_available = c.isAvailable;
  return row;
};

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(`Supabase 오류: ${res.error.message}`);
  return res.data;
}

export function createSupabaseRepositories(url: string, serviceKey: string): Repositories {
  const sb: SupabaseClient = createClient(url, serviceKey, { auth: { persistSession: false } });

  return {
    kind: "supabase",
    complaints: {
      async list(f = {}) {
        let q = sb.from("complaints").select("*").order("received_at", { ascending: false });
        if (f.status && f.status !== "ALL") q = q.eq("status", f.status);
        if (f.defectType && f.defectType !== "ALL") q = q.eq("defect_type", f.defectType);
        if (f.urgency && f.urgency !== "ALL") q = q.eq("urgency", f.urgency);
        if (f.district && f.district !== "ALL") q = q.eq("region", f.district);
        const term = f.q?.trim().replace(/[,()%]/g, "");
        if (term) {
          const p = `%${term}%`;
          q = q.or(
            `receipt_no.ilike.${p},complainant_name.ilike.${p},phone.ilike.${p},apartment_name.ilike.${p},description.ilike.${p}`,
          );
        }
        return (check(await q) as Row[]).map(toComplaint);
      },
      async get(id) {
        const data = check(await sb.from("complaints").select("*").eq("id", id).maybeSingle());
        return data ? toComplaint(data as Row) : null;
      },
      async create(input) {
        const data = check(await sb.from("complaints").insert(fromComplaint(input)).select("*").single());
        return toComplaint(data as Row);
      },
      async update(id, patch) {
        const data = check(
          await sb.from("complaints").update(fromComplaint(patch)).eq("id", id).select("*").maybeSingle(),
        );
        return data ? toComplaint(data as Row) : null;
      },
      async countActiveByContractor() {
        const rows = check(
          await sb
            .from("complaints")
            .select("contractor_id")
            .in("status", ["ASSIGNED", "SCHEDULED", "IN_PROGRESS"])
            .not("contractor_id", "is", null),
        ) as Row[];
        const counts: Record<string, number> = {};
        for (const r of rows) {
          const id = r.contractor_id as string;
          counts[id] = (counts[id] ?? 0) + 1;
        }
        return counts;
      },
    },
    contractors: {
      async list() {
        return (check(await sb.from("contractors").select("*").order("created_at")) as Row[]).map(toContractor);
      },
      async get(id) {
        const data = check(await sb.from("contractors").select("*").eq("id", id).maybeSingle());
        return data ? toContractor(data as Row) : null;
      },
      async create(input) {
        const data = check(await sb.from("contractors").insert(fromContractor(input)).select("*").single());
        return toContractor(data as Row);
      },
      async update(id, patch) {
        const data = check(
          await sb.from("contractors").update(fromContractor(patch)).eq("id", id).select("*").maybeSingle(),
        );
        return data ? toContractor(data as Row) : null;
      },
      async remove(id) {
        check(await sb.from("contractors").delete().eq("id", id));
        return true;
      },
    },
  };
}
