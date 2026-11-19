// ─────────────────────────────────────────────
// Claude API 통화 분석기
// ANTHROPIC_API_KEY 가 설정되면 자동으로 사용됩니다.
// 구조화 출력(Zod 스키마)으로 항상 정해진 JSON 형태를 받습니다.
// ─────────────────────────────────────────────
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { DEFECT_TYPES, URGENCIES } from "../../constants";
import { APARTMENTS } from "../../mock-data";
import { formatPhone, isValidPhone, nameProblem, normalizeDongHo, normalizeName } from "../../normalize";
import type { CallAnalysis } from "../../types";
import type { CallAnalyzer } from "./types";

const AnalysisSchema = z.object({
  complainantName: z.string().describe("민원인 이름. 띄어쓰기 없이 한글 2~4글자(보통 3글자), 호칭·어미 제외. 없으면 빈 문자열"),
  phone: z.string().describe("연락처. 반드시 010-1234-5678 형식. 없으면 빈 문자열"),
  apartmentName: z.string().describe("아파트(단지)명. 등록 단지 목록에 있으면 그 이름 그대로"),
  building: z.string().describe("동 번호 아라비아 숫자만, 공백·'동' 제외 (예: 101)"),
  unit: z.string().describe("호수 아라비아 숫자만, 공백·'호' 제외 (예: 1502)"),
  defectType: z.enum(["LEAK_PIPE", "ELECTRIC", "DOOR_WINDOW", "HVAC", "WALL_FLOOR", "COMMON", "ETC"]),
  urgency: z.enum(["EMERGENCY", "HIGH", "NORMAL", "LOW"]),
  description: z.string().describe("업체에 전달할 상세 하자 내용 (2~4문장, 존댓말 없이 사실 위주)"),
  summary: z.string().describe("관리자용 한 줄 요약"),
  confidence: z.number().describe("추출 신뢰도 0~1"),
  missingFields: z.array(z.string()).describe("통화에서 확인되지 않은 필수 항목(한국어)"),
});

const SYSTEM_PROMPT = `당신은 아파트·공동주택 하자보수 접수센터의 통화 분석 담당자입니다.
상담원과 민원인의 통화 녹취록을 읽고 민원 접수에 필요한 정보를 추출합니다.

하자 유형 코드:
${DEFECT_TYPES.map((d) => `- ${d.value}: ${d.label}`).join("\n")}

긴급도 코드:
${URGENCIES.map((u) => `- ${u.value}: ${u.label}`).join("\n")}
긴급도 기준: 누수가 계속되거나 침수, 누전·정전·화재·가스·감전 위험, 사람이 갇힘 등 즉시 대응이 필요하면 EMERGENCY.
생활에 큰 불편(난방 불가, 전원 차단 등)이면 HIGH. 일반 불편은 NORMAL. 민원인이 급하지 않다고 하면 LOW.

등록된 단지 목록: ${APARTMENTS.map((a) => a.name).join(", ")}

녹취록은 음성인식 결과라 띄어쓰기가 불규칙합니다. 띄어쓰기에 의존하지 말고 아래 규칙으로 정리하세요.

이름:
- 한국인 이름은 최대 4글자이며 보통 3글자입니다(성 1글자 + 이름 2글자). 2글자 이름이나 남궁·선우 같은 복성 4글자도 있습니다.
- 글자 사이가 띄어져 있어도 붙여 씁니다. 예: "홍 길 동입니다" → 홍길동, "홍길 동이에요" → 홍길동
- 뒤에 붙은 어미·호칭은 빼세요. 예: "박철수예요" → 박철수, "김영희씨" → 김영희, "최민지라고 합니다" → 최민지
- 단지명, "윗집", "관리실" 같은 말을 이름으로 착각하지 마세요.

동·호수:
- 숫자만 씁니다. "동", "호", 공백은 빼세요. 예: "1 0 1 동 15 02 호" → 101 / 1502, "101-1502호" → 101 / 1502
- 한글로 읽은 숫자도 변환합니다. 예: "백일동 천오백이호" → 101 / 1502, "일공일동" → 101

전화번호:
- 반드시 010-1234-5678 형식으로 씁니다. 공백·점·하이픈 위치가 어떻든 숫자만 모아 다시 나눕니다.
  예: "010 1234 5678", "010.1234.5678", "0 1 0 1 2 3 4 5 6 7 8" → 010-1234-5678
- 한글로 읽은 숫자도 변환합니다. 예: "공일공 일이삼사 오육칠팔" → 010-1234-5678
- "+82 10" 처럼 국가번호로 말하면 010으로 바꿉니다.

공통:
- 녹취록에 없는 정보는 추측하지 말고 빈 문자열로 두고 missingFields에 넣으세요.
- 민원인이 정정한 정보(예: 번호를 다시 말함)는 마지막에 말한 값을 사용하세요.`;

export class ClaudeCallAnalyzer implements CallAnalyzer {
  readonly name = "claude" as const;
  private client: Anthropic;
  private model: string;

  constructor(apiKey?: string, model = process.env.ANTHROPIC_MODEL || "claude-opus-5-5") {
    this.client = new Anthropic(apiKey ? { apiKey } : {});
    this.model = model;
  }

  async analyze(transcript: string): Promise<CallAnalysis> {
    const response = await this.client.messages.parse({
      model: this.model,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: "low", format: zodOutputFormat(AnalysisSchema) },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: `다음 통화 녹취록을 분석하세요.\n\n<transcript>\n${transcript}\n</transcript>` }],
    });

    if (response.stop_reason === "refusal") throw new Error("Claude가 요청을 처리하지 않았습니다(refusal).");
    const out = response.parsed_output;
    if (!out) throw new Error(`Claude 응답을 해석하지 못했습니다 (stop_reason: ${response.stop_reason}).`);

    // 모델 출력도 같은 규칙으로 한 번 더 정리 (형식 보장)
    const missing = [...out.missingFields];
    let name = normalizeName(out.complainantName);
    if (name && nameProblem(name)) {
      missing.push("민원인 이름(형식 확인 필요)");
      name = "";
    }
    let phone = out.phone ? formatPhone(out.phone) : "";
    if (phone && !isValidPhone(phone)) {
      missing.push("전화번호(형식 확인 필요)");
      phone = "";
    }
    return {
      ...out,
      complainantName: name,
      phone,
      building: normalizeDongHo(out.building),
      unit: normalizeDongHo(out.unit),
      missingFields: Array.from(new Set(missing)),
      confidence: Math.max(0, Math.min(1, out.confidence)),
      engine: "claude",
    };
  }
}
