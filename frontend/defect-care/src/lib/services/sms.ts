// ─────────────────────────────────────────────
// 거주자 문자 발송 (모의)
// 지금은 서버 로그와 메모리에만 남깁니다. 실제 발송(NCP SENS, 알리고, 카카오 알림톡 등) 연동 시
// sendSms 내부만 교체하면 됩니다.
// ─────────────────────────────────────────────
import "server-only";

export interface SmsRecord {
  to: string;
  text: string;
  sentAt: string;
  mock: true;
}

const g = globalThis as unknown as { __smsLog?: SmsRecord[] };
const log = (g.__smsLog ??= []);

export async function sendSms(to: string, text: string): Promise<SmsRecord> {
  const rec: SmsRecord = { to, text, sentAt: new Date().toISOString(), mock: true };
  log.unshift(rec);
  log.splice(50);
  console.info(`[sms:mock] → ${to}\n${text}`);
  return rec;
}

/** 최근 모의 발송 기록 (최신순) */
export const recentSms = () => [...log];
