// ─────────────────────────────────────────────
// 업체 전달(알림) 서비스
// 현재는 서버 로그에 기록하는 모의 발송입니다.
// 추후 이메일(Resend 등)·문자(알리고, NCP SENS 등)·카카오 알림톡 연동 시
// sendToContractor 내부만 교체하면 됩니다.
// ─────────────────────────────────────────────
import { DEFECT_LABEL, URGENCY_LABEL } from "../constants";
import type { Complaint, Contractor } from "../types";

export interface NotificationResult {
  ok: boolean;
  channels: string[];
  message: string;
}

export function buildWorkOrderMessage(c: Complaint, contractor: Contractor) {
  return [
    `[하자보수 작업 요청] ${c.receiptNo}`,
    `업체: ${contractor.name}`,
    `긴급도: ${URGENCY_LABEL[c.urgency]}`,
    `단지: ${c.apartmentName} ${c.building}동 ${c.unit}호 (${c.region})`,
    `유형: ${DEFECT_LABEL[c.defectType]}`,
    `내용: ${c.description}`,
    `민원인: ${c.complainantName} / ${c.phone}`,
  ].join("\n");
}

export async function sendToContractor(c: Complaint, contractor: Contractor): Promise<NotificationResult> {
  const message = buildWorkOrderMessage(c, contractor);
  const channels = [`이메일(${contractor.email})`, `문자(${contractor.phone})`];
  console.info(`[notification:mock] → ${channels.join(", ")}\n${message}`);
  return { ok: true, channels, message };
}
