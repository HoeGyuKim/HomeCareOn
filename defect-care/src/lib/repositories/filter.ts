import { DEFECT_LABEL } from "../constants";
import type { Complaint, ComplaintFilter } from "../types";

/** 메모리 저장소용 필터 (Supabase는 쿼리로 처리) */
export function matchesFilter(c: Complaint, f: ComplaintFilter = {}) {
  if (f.status && f.status !== "ALL" && c.status !== f.status) return false;
  if (f.defectType && f.defectType !== "ALL" && c.defectType !== f.defectType) return false;
  if (f.urgency && f.urgency !== "ALL" && c.urgency !== f.urgency) return false;
  if (f.district && f.district !== "ALL" && c.region !== f.district) return false;
  const q = f.q?.trim().toLowerCase();
  if (q) {
    const hay = [
      c.receiptNo,
      c.complainantName,
      c.phone,
      c.phone.replace(/\D/g, ""),
      c.apartmentName,
      `${c.building}동`,
      `${c.unit}호`,
      `${c.building}동 ${c.unit}호`,
      c.description,
      DEFECT_LABEL[c.defectType],
    ]
      .join(" ")
      .toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}
