// ─────────────────────────────────────────────
// 규칙 기반 통화 분석기 (API 키 없이 동작하는 테스트용)
// 키워드·정규식으로 민원 정보를 추출합니다.
// ─────────────────────────────────────────────
import { APARTMENTS } from "../../mock-data";
import { extractDongHo, extractName, extractPhone } from "../../normalize";
import type { CallAnalysis, DefectType, Urgency } from "../../types";
import type { CallAnalyzer } from "./types";

const DEFECT_KEYWORDS: [DefectType, string[]][] = [
  ["LEAK_PIPE", ["누수", "물이", "물 새", "물새", "배관", "수도", "역류", "배수", "하수", "변기", "싱크", "막혔", "물바다"]],
  ["ELECTRIC", ["전기", "조명", "전등", "형광등", "콘센트", "차단기", "누전", "정전", "스위치", "전원"]],
  ["DOOR_WINDOW", ["현관문", "도어", "문이", "창문", "창호", "방충망", "샷시", "새시", "손잡이", "경첩", "유리"]],
  ["HVAC", ["보일러", "난방", "냉방", "에어컨", "온도", "온수", "환기", "추워", "더워"]],
  ["WALL_FLOOR", ["벽", "바닥", "타일", "마루", "균열", "금이", "곰팡이", "결로", "도배", "벽지", "들뜸", "들떠"]],
  ["COMMON", ["엘리베이터", "승강기", "주차장", "복도", "계단", "놀이터", "공용", "옥상", "경비실", "관리동"]],
];

const EMERGENCY_WORDS = ["쏟아", "물바다", "누전", "정전", "화재", "불꽃", "연기", "가스", "갇혔", "감전", "침수", "폭발"];
const HIGH_WORDS = ["빨리", "급해", "급합", "긴급", "당장", "계속", "아이가", "노인", "추워", "안 돼요", "안돼요", "전혀"];
const LOW_WORDS = ["급하진", "급하지 않", "천천히", "시간 될 때", "여유"];

/** 민원인 발화 줄만 추출 ("민원인:" 접두사가 있으면) */
function callerLines(t: string) {
  const lines = t.split(/\r?\n/).filter((l) => l.trim());
  const caller = lines.filter((l) => /^\s*(민원인|고객|입주민|caller)\s*[:：]/i.test(l));
  return (caller.length ? caller : lines).map((l) => l.replace(/^\s*[^:：]{1,6}[:：]\s*/, ""));
}

function extractApartment(text: string) {
  const compact = text.replace(/\s/g, "");
  const apt = APARTMENTS.find((a) => compact.includes(a.name.replace(/\s/g, "")));
  if (apt) return apt.name;
  const m = text.match(/([가-힣A-Za-z0-9]{2,12})\s*(?:아파트|APT)/i);
  return m ? m[1] : "";
}

export function classifyDefect(text: string): { type: DefectType; hits: number } {
  let best: DefectType = "ETC";
  let bestScore = 0;
  for (const [type, words] of DEFECT_KEYWORDS) {
    const score = words.reduce((s, w) => s + (text.includes(w) ? 1 : 0), 0);
    if (score > bestScore) {
      best = type;
      bestScore = score;
    }
  }
  return { type: best, hits: bestScore };
}

export function classifyUrgency(text: string): Urgency {
  if (EMERGENCY_WORDS.some((w) => text.includes(w))) return "EMERGENCY";
  if (LOW_WORDS.some((w) => text.includes(w))) return "LOW";
  if (HIGH_WORDS.some((w) => text.includes(w))) return "HIGH";
  return "NORMAL";
}

/** 문의 내용 문장만 골라 요약 (이름·연락처 문장 제외) */
function buildDescription(text: string) {
  const sentences = text
    .split(/(?<=[.!?요다])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !/(010|번호|연락처|이름은|성함)/.test(s) || /(누수|고장|안\s?돼|안\s?되|물|문|불)/.test(s));
  return sentences.join(" ").slice(0, 500);
}

export class RuleBasedCallAnalyzer implements CallAnalyzer {
  readonly name = "rule-based" as const;

  async analyze(transcript: string): Promise<CallAnalysis> {
    const lines = callerLines(transcript);
    const text = lines.join(" ");
    const dongHo = extractDongHo(text);
    const defect = classifyDefect(text);

    const result: CallAnalysis = {
      complainantName: extractName(lines, APARTMENTS.map((a) => a.name)),
      phone: extractPhone(text),
      apartmentName: extractApartment(text),
      building: dongHo.building,
      unit: dongHo.unit,
      defectType: defect.type,
      urgency: classifyUrgency(text),
      description: buildDescription(text),
      summary: "",
      confidence: 0,
      missingFields: [],
      engine: "rule-based",
    };

    const labels: [keyof CallAnalysis, string][] = [
      ["complainantName", "민원인 이름"],
      ["phone", "전화번호"],
      ["apartmentName", "아파트명"],
      ["building", "동"],
      ["unit", "호수"],
    ];
    result.missingFields = labels.filter(([k]) => !result[k]).map(([, l]) => l);
    if (defect.hits === 0) result.missingFields.push("하자 유형(키워드 미검출)");

    const filled = labels.length - labels.filter(([k]) => !result[k]).length;
    result.confidence = Math.round(((filled / labels.length) * 0.7 + Math.min(defect.hits, 3) * 0.1) * 100) / 100;
    result.summary = `${result.apartmentName || "단지 미상"} ${result.building ? result.building + "동" : ""} ${result.unit ? result.unit + "호" : ""} — ${result.description.slice(0, 80)}`.replace(/\s+/g, " ");
    return result;
  }
}
