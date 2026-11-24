import { DEFECT_TYPES } from "../constants";
import { DISTRICT_NAMES } from "../seoul";
import type { Contractor } from "../types";
import { ServiceError } from "./complaint-service";

export type ContractorBody = Omit<Contractor, "id" | "createdAt">;

export function validateContractor(b: ContractorBody): ContractorBody {
  const missing: string[] = [];
  if (!b.name?.trim()) missing.push("업체명");
  if (!b.defectTypes?.length) missing.push("담당 하자 유형");
  if (!b.regions?.length) missing.push("담당 지역");
  if (!b.phone?.trim()) missing.push("연락처");
  if (missing.length) throw new ServiceError(`필수 항목이 누락되었습니다: ${missing.join(", ")}`);
  if (b.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email)) throw new ServiceError("이메일 형식이 올바르지 않습니다.");
  const outside = (b.regions ?? []).filter((r) => !DISTRICT_NAMES.includes(r.trim()));
  if (outside.length) throw new ServiceError(`서울 자치구만 담당 지역으로 지정할 수 있습니다: ${outside.join(", ")}`);
  const valid = new Set(DEFECT_TYPES.map((d) => d.value));
  return {
    name: b.name.trim(),
    defectTypes: b.defectTypes.filter((d) => valid.has(d)),
    regions: b.regions.map((r) => r.trim()).filter(Boolean),
    phone: b.phone.trim(),
    email: (b.email ?? "").trim(),
    isContracted: !!b.isContracted,
    isAvailable: !!b.isAvailable,
  };
}
