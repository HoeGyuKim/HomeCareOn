// ─────────────────────────────────────────────
// 자동 업체 배정 규칙
//  1) 하자 유형이 업체 담당 분야와 일치
//  2) 민원 지역이 업체 담당 지역에 포함
//  3) 계약 업체 + 업무 가능 상태
//  → 후보 중 현재 진행 건수가 가장 적은 업체를 배정 (동률이면 등록 순)
//  → 후보가 없으면 null (관리자 확인 대기)
// ─────────────────────────────────────────────
import { DEFECT_LABEL } from "../constants";
import type { AssignmentResult, Contractor, DefectType } from "../types";

export function selectContractor(
  defectType: DefectType,
  region: string,
  contractors: Contractor[],
  activeLoad: Record<string, number>,
): AssignmentResult {
  const fieldAndRegion = contractors.filter(
    (c) => c.defectTypes.includes(defectType) && c.regions.includes(region),
  );
  const candidates = fieldAndRegion
    .filter((c) => c.isContracted && c.isAvailable)
    .sort((a, b) => (activeLoad[a.id] ?? 0) - (activeLoad[b.id] ?? 0));
  const suggestions = fieldAndRegion.filter((c) => !(c.isContracted && c.isAvailable));

  const label = DEFECT_LABEL[defectType];
  if (candidates.length > 0) {
    const chosen = candidates[0];
    return {
      contractor: chosen,
      candidates,
      suggestions,
      reason: `[${label}] · [${region}] 조건 일치 계약 업체 ${candidates.length}곳 중 진행 건수가 가장 적은 '${chosen.name}'(진행 ${activeLoad[chosen.id] ?? 0}건) 배정`,
    };
  }

  let reason = `[${label}] · [${region}] 조건에 맞는 계약·업무가능 업체가 없습니다.`;
  if (!region) reason = "단지 지역을 확인할 수 없어 자동 배정을 진행하지 못했습니다.";
  else if (suggestions.length > 0)
    reason += ` (참고: 미계약 또는 업무불가 업체 ${suggestions.length}곳 존재)`;
  return { contractor: null, candidates: [], suggestions, reason };
}
