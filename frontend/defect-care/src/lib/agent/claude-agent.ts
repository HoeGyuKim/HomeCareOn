// ─────────────────────────────────────────────
// Claude 전화 상담원
// - 기준표·시행내규 원문을 시스템 프롬프트로 읽고(프롬프트 캐시), 도구로 양식을 채우고 접수합니다.
// - 판정이 '접수 불가'면 서버(submitIntake)가 접수를 막습니다.
// ─────────────────────────────────────────────
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { DEFECT_TYPES, URGENCIES } from "../constants";
import { APARTMENTS } from "../mock-data";
import { COST_STANDARD_GENERAL, COST_STANDARD_TABLE, HOUSING_RULES_EXCERPT } from "../policy/standard-text";
import { recordDecision, submitIntake, updateIntake, type CallSession, type IntakePatch } from "./session";
import type { PolicyDecision } from "./types";

type Tool = Anthropic.Beta.Messages.BetaTool;
type Block = Anthropic.Beta.Messages.BetaContentBlock;

const nullableString = (description: string) => ({ type: ["string", "null"], description });

const TOOLS: Tool[] = [
  {
    name: "record_policy_decision",
    description:
      "민원 내용을 비용부담 기준표·시행내규에 비춰 판정하고 기록합니다. 하자 내용과 원인을 파악하면 개인정보를 묻기 전에 반드시 호출하세요. 판정이 바뀌면 다시 호출합니다.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["verdict", "item", "basis", "explanation"],
      properties: {
        verdict: {
          type: "string",
          enum: ["SH_REPAIR", "MGMT_FEE", "SITE_CHECK", "TENANT_PAY", "NOT_ALLOWED"],
          description:
            "SH_REPAIR=임대인(SH) 부담 수선, MGMT_FEE=공용부분 일상 유지관리(관리비), SITE_CHECK=원인에 따라 갈려 현장확인 필요, TENANT_PAY=입주자 부담(접수 불가), NOT_ALLOWED=구조변경·신규설치 등(접수 불가)",
        },
        item: { type: "string", description: "기준표의 시설물 항목명 (예: 4)화장실 수전류)" },
        basis: { type: "string", description: "근거 문구를 기준표/내규에서 그대로 인용 (예: [별표2] 4)화장실 수전류 — 임차인부담: 파손,탈락,패킹교환)" },
        explanation: { type: "string", description: "민원인에게 설명할 한두 문장" },
      },
    },
  },
  {
    name: "update_intake_form",
    description:
      "민원인에게 들은 정보를 접수 양식에 넣습니다. 확인된 항목만 넣고 나머지는 null. 서버가 형식을 정리하고, 형식 오류는 problems로 돌려주니 그 항목은 다시 물어보세요.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["complainantName", "phone", "apartmentName", "building", "unit", "defectType", "urgency", "description"],
      properties: {
        complainantName: nullableString("민원인 이름 (한글 2~4글자, 띄어쓰기 없이)"),
        phone: nullableString("연락처 (010-1234-5678 형식)"),
        apartmentName: nullableString("단지명 (등록 단지명 그대로)"),
        building: nullableString("동 (숫자만)"),
        unit: nullableString("호수 (숫자만)"),
        defectType: { type: ["string", "null"], enum: [...DEFECT_TYPES.map((d) => d.value), null], description: "하자 유형 코드" },
        urgency: { type: ["string", "null"], enum: [...URGENCIES.map((u) => u.value), null], description: "긴급도 코드" },
        description: nullableString("업체에 전달할 하자 내용 요약 (위치·증상·발생 시점·원인)"),
      },
    },
  },
  {
    name: "submit_complaint",
    description:
      "양식을 접수하고 업체를 자동 배정합니다. 판정이 접수 가능(SH_REPAIR·MGMT_FEE·SITE_CHECK)이고, 양식 내용을 민원인에게 읽어 주고 '맞다'는 확인을 받은 뒤에만 호출하세요.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["caller_confirmed"],
      properties: { caller_confirmed: { type: "boolean", description: "민원인이 양식 내용이 맞다고 확인했는지" } },
    },
  },
];

const SYSTEM_INSTRUCTIONS = `당신은 서울주택도시개발공사(SH) 임대아파트의 하자보수 접수센터 AI 전화 상담원입니다.
지금 입주민과 전화 통화 중이며, 첫 인사("안녕하세요, SH 하자보수 접수센터 AI 상담원입니다. 어떤 문제로 연락 주셨나요?")는 이미 했습니다.

# 대화 방식 — 번갈아 말하기
- 상담원과 민원인은 한 번씩 번갈아 말합니다. 당신의 차례는 매번 질문 하나로 끝나고, 민원인의 답을 기다립니다.
- 한 차례에 질문은 정확히 하나만 합니다. 이름과 연락처를 한꺼번에 묻는 식으로 묻지 않습니다.
- 도구는 말하기 전에 먼저 호출하고, 도구 결과를 받은 뒤 마지막에 한 번만 말합니다.
- 민원인이 한 번에 여러 정보를 말하면 모두 양식에 넣고, 아직 비어 있는 다음 항목 하나만 묻습니다.
- 접수가 끝나면 접수번호를 알려 주고 인사로 마무리합니다. 이때만 질문 없이 끝냅니다.

# 말하는 방식 (전화 음성)
- 존댓말, 한 번에 1~3문장.
- 마크다운·목록·이모지·괄호 설명을 쓰지 않습니다. 소리 내어 읽기 좋은 문장으로 말합니다.
- 숫자는 통화에서 확인하기 쉽게 말합니다. 예: "공일공 일이삼사 오육칠팔 맞으신가요?"

# 진행 순서
1. 무엇이, 어디서(세대 안/공용부분), 어떻게 고장 났는지 듣습니다.
2. 부담 주체를 가르는 정보를 확인합니다. 원인(오래돼서 저절로 / 사용 중 파손·부주의 / 동파), 입주한 지 1개월 이내인지, 소모품인지 등입니다. 필요한 것만 짧게 묻습니다.
3. 아래 기준표와 시행내규로 판정하고 record_policy_decision을 호출합니다. 개인정보를 묻기 전에 반드시 판정합니다.
4. 판정에 따라 진행합니다.
   - 접수 불가(TENANT_PAY, NOT_ALLOWED): "죄송하지만 이 건은 SH공사 수선 대상이 아니라 접수해 드릴 수 없습니다"처럼 안 된다는 것을 분명하게 먼저 말합니다. 그다음 근거를 한 문장으로 말합니다(예: "시설물 수선비 비용부담 기준에 따라 전구 같은 소모품은 입주자 부담입니다"). 이어서 입주자가 할 수 있는 방법을 안내합니다. 입주자가 직접 업체를 정해 원래대로 고쳐야 하고, 시중에서 구하기 어려운 제품은 관할 센터에 일괄 구입·설치를 요청하고 비용을 낼 수 있습니다. 구조 변경이나 미승인 설치는 퇴거 때 원상복구 대상입니다. 이 경우 개인정보를 묻지 않고 접수하지 않습니다. "확인해 보겠다", "아마 될 수도 있다"처럼 흐리게 말하지 않습니다. 민원인이 다시 요청해도 기준이 바뀌지 않는 한 판정을 바꾸지 않습니다. 다만 민원인이 새 사실(예: 사실은 파손이 아니라 오래돼서 저절로)을 말하면 다시 판정합니다.
   - 접수 가능(SH_REPAIR, MGMT_FEE, SITE_CHECK): 접수 가능하다고 말하고 정보를 받습니다. SITE_CHECK이면 "현장 확인 후 최종 부담이 결정되며, 입주자 원인으로 확인되면 비용이 청구될 수 있다"고 알립니다. MGMT_FEE이면 관리사무소에서 관리비로 처리한다고 알립니다.
5. 정보는 이 순서로 하나씩 묻습니다: 이름 → 연락처 → 단지명 → 동 → 호수. 답을 들을 때마다 update_intake_form을 호출합니다. 하자 유형·긴급도·하자 내용 요약은 대화 내용으로 직접 채웁니다.
   - 이름: 한글 2~4글자, 보통 3글자(성 1 + 이름 2). 음성인식 때문에 글자 사이가 띄어져 있어도 붙여 씁니다("홍 길 동" → 홍길동). "입니다", "예요", "씨" 같은 말은 뺍니다.
   - 연락처: 반드시 010-1234-5678 형식. 공백·점·한글 숫자("공일공")를 숫자로 바꿔 다시 나눕니다.
   - 단지명은 아래 등록 단지 중 하나여야 합니다. 동·호수는 숫자만 씁니다("백일동" → 101).
   - 도구가 problems를 돌려주면 그 항목만 형식을 알려 주며 다시 묻습니다.
6. 모두 채우면 한 번에 읽어 주고 확인받습니다. 예: "홍길동 님, 연락처 010-1234-5678, 한빛센트럴 101동 1502호, 욕실 천장 누수로 접수하겠습니다. 맞으신가요?"
7. "맞다"고 하면 submit_complaint를 호출합니다. 결과로 받은 접수번호를 또박또박 말하고, 배정 업체 또는 배정 예정이라는 것을 안내한 뒤 통화를 마무리합니다.

# 안전·긴급
- 누수가 계속되면 세대 파이프 덕트 안의 주밸브를 잠그라고 먼저 안내합니다(입주자 유의사항 다.1). 긴급도는 EMERGENCY로 둡니다.
- 가스 냄새, 불꽃·연기, 감전 위험이 있으면 즉시 대피하고 119(가스는 가스안전 신고)에 먼저 신고하라고 안내한 뒤 접수합니다.
- 누수처럼 2차 피해가 생기는 결함은 즉시 신고해야 합니다. 늦게 알려 피해가 커지면 추가 비용이 입주자 부담이 될 수 있습니다(기준 제1장 3.2), 3.4)).

# 판정 원칙 (원문은 아래 참고자료)
- 판정은 반드시 참고자료에 근거합니다. 참고자료에 없는 규정을 지어내지 않습니다. 기준표에 명시되지 않았거나 원인이 끝내 불분명하면 SITE_CHECK입니다(기준 제2장 1.5), 시행내규 제13조).
- 일람표의 "임대인" 칸은 SH 부담, "임차인" 칸은 입주자 부담입니다. 세대 전용부분의 임차인 부담은 해당 세대가 부담합니다(접수 불가).
- 공용부분 표의 "임차인" 칸은 관리비, 즉 입주자 공동부담입니다. 이것은 MGMT_FEE이고 관리사무소 처리로 접수합니다.
- 시행내규 제12조③: 공사(SH) 책임 시설물이라도 자연 마모·노후화 이외의 수선은 입주자 책임입니다. 파손·부주의·고의는 입주자 부담입니다.
- 많은 항목에서 "작동불량(입주후 1개월내)"은 SH 부담이고, 그 이후의 작동불량은 입주자 부담입니다. 해당 항목이면 입주 시기를 꼭 확인합니다.
- 소모품(전구·램프·건전지·필터·패킹)과 동파, 세대 내 막힘은 입주자 부담입니다.
- 천재지변(지진·태풍·수해·한파)으로 인한 파손은 임대인 부담입니다(기준 제2장 1.4)).
- 내외부 구조 변경은 불가입니다(입주자 유의사항 나.1)). 신규 설치는 수선 대상이 아닙니다(NOT_ALLOWED).
- 마지막에 "최종 부담 여부는 현장 확인 후 관할 센터에서 결정됩니다"라고 안내해도 좋지만, 접수 불가 판정을 흐리는 데 쓰지 않습니다.

# 등록 단지 (서울)
${APARTMENTS.map((a) => `${a.name}(${a.region})`).join(", ")}
등록 단지가 아니면 이 센터의 접수 대상 단지가 아니라고 안내합니다.

# 하자 유형 코드
${DEFECT_TYPES.map((d) => `${d.value}=${d.label}`).join(", ")}
# 긴급도 코드
${URGENCIES.map((u) => `${u.value}=${u.label}`).join(", ")}`;

const REFERENCE = `# 참고자료 1. 시설물 수선비 비용부담 기준(임대아파트 및 기타주택, 2026) — 본문
${COST_STANDARD_GENERAL}

# 참고자료 2. [별표2] 시설물 수선비 비용부담 구분 일람표
각 줄 형식: "- 항목 | 임대인: (SH 부담 사유) | 임차인: (입주자 부담 사유) | 비고". PDF에서 추출해 일부 줄은 열이 섞였을 수 있으니 문맥으로 해석하세요.
${COST_STANDARD_TABLE}

# 참고자료 3. 주택관리규정 시행내규(개정 2026.08.26) 발췌
${HOUSING_RULES_EXCERPT}`;

const SYSTEM: Anthropic.Beta.Messages.BetaTextBlockParam[] = [
  { type: "text", text: SYSTEM_INSTRUCTIONS },
  { type: "text", text: REFERENCE, cache_control: { type: "ephemeral" } },
];

const MAX_STEPS = 8;

/** 민원인 발화 하나를 처리하고 상담원의 말을 돌려줌 */
export async function claudeTurn(s: CallSession, callerText: string): Promise<string> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  s.claudeHistory.push({ role: "user", content: callerText });

  const spoken: string[] = []; // 이번 차례에 나온 모든 말 (대비용)
  let finalSay = ""; // 도구 처리가 끝난 마지막 응답의 말 — 화면에는 이것만 보여 줌
  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await client.beta.messages.create({
      model: process.env.ANTHROPIC_MODEL || "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      system: SYSTEM,
      tools: TOOLS,
      messages: s.claudeHistory,
    });

    // 응답 블록은 thinking 포함 그대로 기록에 추가 (수정하면 안 됨)
    s.claudeHistory.push({ role: "assistant", content: res.content });

    if (res.stop_reason === "refusal") {
      return "죄송합니다. 이 내용은 제가 처리하기 어렵습니다. 관리사무소로 직접 연락 부탁드립니다.";
    }

    const texts = res.content.flatMap((b) => (b.type === "text" && b.text.trim() ? [b.text.trim()] : []));
    spoken.push(...texts);

    const toolUses = res.content.filter((b): b is Extract<Block, { type: "tool_use" }> => b.type === "tool_use");
    if (res.stop_reason !== "tool_use" || toolUses.length === 0) {
      finalSay = texts.join(" ");
      break;
    }

    const results: Anthropic.Beta.Messages.BetaToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      let output: unknown;
      let isError = false;
      try {
        const input = tu.input as Record<string, unknown>;
        if (tu.name === "update_intake_form") output = updateIntake(s, input as IntakePatch);
        else if (tu.name === "record_policy_decision") output = recordDecision(s, input as unknown as PolicyDecision);
        else if (tu.name === "submit_complaint") {
          output = input.caller_confirmed
            ? await submitIntake(s)
            : { ok: false, error: "민원인 확인을 먼저 받으세요." };
        } else {
          output = { error: `알 수 없는 도구: ${tu.name}` };
          isError = true;
        }
      } catch (e) {
        output = { error: e instanceof Error ? e.message : String(e) };
        isError = true;
      }
      results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(output), is_error: isError });
    }
    s.claudeHistory.push({ role: "user", content: results });
  }

  return finalSay || spoken.at(-1) || "네, 말씀해 주세요.";
}
