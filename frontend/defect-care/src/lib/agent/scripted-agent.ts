// ─────────────────────────────────────────────
// 테스트용 전화 상담원 (ANTHROPIC_API_KEY 없을 때)
// 정해진 순서로 묻고, 키워드 규칙(policy/rules.ts)으로 판정합니다.
// ─────────────────────────────────────────────
import "server-only";
import { APARTMENTS } from "../mock-data";
import { extractDongHo, extractName, extractPhone, normalizeName } from "../normalize";
import { quickPolicyCheck, SITE_CHECK_DECISION } from "../policy/rules";
import { classifyDefect, classifyUrgency } from "../services/call-analyzer/rule-based";
import { recordDecision, submitIntake, updateIntake, type CallSession } from "./session";
import { ACCEPTABLE_VERDICTS } from "./types";

const YES = /^(네|예|넵|맞아|맞습니다|맞아요|맞네요|그래요|응|어|좋아요|접수해)/;
const NO = /(아니|틀렸|틀려|잘못|다시)/;

/** 숫자를 통화용으로 읽기: 010-1234-5678 → 공일공 일이삼사 오육칠팔 */
const spellDigits = (s: string) =>
  s.split("-").map((g) => [...g].map((d) => "공일이삼사오육칠팔구"[Number(d)]).join("")).join(" ");

function nextQuestion(s: CallSession): string | null {
  const f = s.form;
  if (!f.complainantName) return "성함이 어떻게 되시나요?";
  if (!f.phone) return "연락 가능한 휴대폰 번호가 어떻게 되시나요?";
  if (!f.apartmentName) return "사시는 단지 이름이 무엇인가요?";
  if (!f.building || !f.unit) return "몇 동 몇 호이신가요?";
  return null;
}

function confirmText(s: CallSession) {
  const f = s.form;
  const issue = f.description.split(/(?<=[.!?요다])\s+/)[0].replace(/[.!?]$/, "").slice(0, 40);
  return `확인하겠습니다. ${f.complainantName} 님, 연락처 ${spellDigits(f.phone)}, ${f.apartmentName} ${f.building}동 ${f.unit}호, "${issue}" 건으로 접수하겠습니다. 맞으신가요?`;
}

/** 같은 질문을 다시 할 때 형식 안내 */
function retryQuestion(q: string) {
  if (q.includes("성함")) return "성함은 한글 두 글자에서 네 글자로, 예를 들어 홍길동처럼 말씀해 주시면 됩니다. 성함이 어떻게 되시나요?";
  if (q.includes("번호")) return "공일공으로 시작하는 열한 자리 번호가 필요합니다. 휴대폰 번호를 다시 말씀해 주시겠어요?";
  if (q.includes("단지")) return `말씀하신 단지를 접수 가능한 단지에서 찾지 못했습니다. ${APARTMENTS.slice(0, 5).map((a) => a.name).join(", ")} 등이 있습니다. 사시는 단지 이름이 무엇인가요?`;
  return "예를 들어 백일동 천오백이호처럼 숫자로 말씀해 주시면 됩니다. 몇 동 몇 호이신가요?";
}

/**
 * 한 번의 발화에서 찾을 수 있는 정보를 양식에 넣음.
 * - 기본: 비어 있는 칸만 채움 (이미 받은 이름을 "백오동" 같은 말로 덮어쓰지 않도록)
 * - correcting: 확인 단계에서 정정할 때만 기존 값을 바꿈. 이름은 "이름은/성함은"이라고 말한 경우에만 바꿈
 */
function absorbDetails(s: CallSession, text: string, correcting = false) {
  const f = s.form;
  const canSet = (k: keyof typeof f) => correcting || !f[k];
  const compact = text.replace(/\s+/g, "");
  const apt = APARTMENTS.find((a) => compact.includes(a.name));
  const dongHo = extractDongHo(text);
  const aptNames = APARTMENTS.map((a) => a.name);

  let name = "";
  if (correcting) {
    if (/(이름|성함)/.test(text)) name = extractName([text], aptNames);
  } else if (!f.complainantName) {
    name = extractName([text], aptNames);
    // 이름만 짧게 답한 경우: "홍 길 동" — 동·호수나 단지명으로 보이는 말은 제외
    if (!name && /^[가-힣\s]{2,8}$/.test(text.trim()) && !/(동|호)$/.test(text.trim()) && !apt) name = normalizeName(text);
  }
  return updateIntake(s, {
    complainantName: name || null,
    phone: canSet("phone") ? extractPhone(text) || null : null,
    apartmentName: canSet("apartmentName") ? apt?.name ?? null : null,
    building: canSet("building") ? dongHo.building || null : null,
    unit: canSet("unit") ? dongHo.unit || null : null,
  });
}

/** 하자 내용 앞의 맞장구 제거: "네 욕실에서…" → "욕실에서…" */
const stripFiller = (t: string) => t.trim().replace(/^(네|예|아|어|음|저기요?|그게|그러니까)[,.\s]+/, "");

function refuse(s: CallSession) {
  const d = s.decision!;
  const head =
    d.verdict === "NOT_ALLOWED"
      ? "죄송하지만 이 요청은 하자보수 접수 대상이 아니라서 접수해 드릴 수 없습니다."
      : "죄송하지만 이 건은 입주자 부담 항목이라 SH공사 수선으로 접수해 드릴 수 없습니다.";
  return `${head} ${d.explanation} 근거는 ${d.basis.split(" / ")[0]}입니다. 혹시 다른 고장도 있으신가요?`;
}

function accept(s: CallSession, advice = "") {
  const d = s.decision!;
  const q = nextQuestion(s);
  return `${d.explanation}${advice} ${q ? `접수를 위해 몇 가지 여쭤보겠습니다. ${q}` : confirmText(s)}`;
}

const LEAK = /(누수|물이?.{0,6}(새|샌|떨어|쏟|흘러|뚝뚝))/;
const SEVERE = /(계속|쏟|많이|물바다|뚝뚝|넘쳐|흥건)/;

export async function scriptedTurn(s: CallSession, text: string): Promise<string> {
  if (s.step === "done") return "통화가 종료되었습니다. 새로 접수하시려면 '새 통화'를 눌러 주세요.";

  // 접수 불가 안내 후 "다른 고장 있으신가요?"에 없다고 하면 통화 종료
  if (s.step === "issue" && s.decision && /^(아니|아뇨|없어|없습니다|없네|괜찮|됐어|됐습니다)/.test(text.trim())) {
    s.step = "done";
    return "알겠습니다. 안내해 드린 내용 참고 부탁드립니다. 이용해 주셔서 감사합니다.";
  }

  // 1) 하자 내용 듣고 판정
  if (s.step === "issue" || s.step === "cause") {
    const issueText = s.step === "cause" ? `${s.form.description} ${text}` : stripFiller(text);
    let decision = quickPolicyCheck(issueText);

    if (!decision && s.step === "issue") {
      s.form.description = stripFiller(text);
      s.step = "cause";
      return "원인에 따라 부담이 달라져서 여쭤볼게요. 입주하신 지 한 달이 안 되셨다면 그것도 함께 말씀해 주세요. 오래 써서 저절로 고장 난 건가요, 아니면 사용 중에 부딪히거나 떨어뜨려서 파손된 건가요?";
    }
    decision ??= SITE_CHECK_DECISION;
    recordDecision(s, decision);

    const defect = classifyDefect(issueText);
    updateIntake(s, {
      description: issueText.trim(),
      defectType: decision.verdict === "MGMT_FEE" ? "COMMON" : defect.type,
      urgency: LEAK.test(issueText) && SEVERE.test(issueText) ? "EMERGENCY" : classifyUrgency(issueText),
    });

    if (!ACCEPTABLE_VERDICTS.includes(decision.verdict)) {
      s.step = "issue";
      Object.assign(s.form, { description: "", defectType: "", urgency: "" });
      return refuse(s);
    }
    absorbDetails(s, text);
    s.step = nextQuestion(s) ? "collect" : "confirm";
    const valve = LEAK.test(issueText) ? " 물이 계속 새면 먼저 세대 파이프 덕트 안의 주밸브를 잠가 주세요." : "";
    return accept(s, valve);
  }

  // 2) 정보 받기
  if (s.step === "collect") {
    const before = nextQuestion(s);
    absorbDetails(s, text);
    const q = nextQuestion(s);
    if (q && q === before) return retryQuestion(q);
    if (q) return `네, ${q}`;
    s.step = "confirm";
    return confirmText(s);
  }

  // 3) 확인 후 접수
  if (s.step === "confirm") {
    if (NO.test(text) && !YES.test(text)) {
      const before = JSON.stringify(s.form);
      const { problems } = absorbDetails(s, text, true);
      if (!problems.length && JSON.stringify(s.form) !== before) return confirmText(s);
      return "예를 들어 '번호는 010-1234-5678이에요'처럼 바른 내용을 말씀해 주시면 됩니다. 어느 부분이 틀렸나요?";
    }
    if (!YES.test(text.trim())) return "틀린 부분이 있으면 그 부분을 말씀해 주세요. 방금 읽어 드린 내용이 맞으신가요?";
    const r = await submitIntake(s);
    if (!r.ok) return `접수에 실패했습니다. ${r.error}`;
    const who = r.assignedContractor ? `${r.assignedContractor}에 작업을 요청했고, 업체에서 연락드릴 예정입니다.` : "담당자가 확인한 뒤 업체를 배정해 연락드리겠습니다.";
    return `접수되었습니다. 접수번호는 ${r.receiptNo}입니다. ${who} 최종 부담 여부는 현장 확인 후 관할 센터에서 결정됩니다. 이용해 주셔서 감사합니다.`;
  }

  return "네, 말씀해 주세요.";
}
