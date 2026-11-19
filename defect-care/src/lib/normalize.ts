// ─────────────────────────────────────────────
// 민원인 정보 정규화 규칙 (이름 · 동호수 · 전화번호)
// 통화 분석(규칙 기반 · Claude), 서버 저장, 입력 폼이 모두 이 규칙을 공유합니다.
// 음성인식(STT) 결과는 띄어쓰기가 불규칙하므로 공백에 의존하지 않도록 처리합니다.
//   예) "홍 길 동입니다" → 홍길동
//       "1 0 1 동 1502 호", "백일 동 천오백이 호" → 101동 1502호
//       "010 1234 5678", "공일공 일이삼사 오육칠팔", "+82 10-1234-5678" → 010-1234-5678
// ─────────────────────────────────────────────

export const NAME_MAX = 4; // 이름 최대 글자 수 (보통 3글자)

const KOR_DIGIT: Record<string, number> = {
  공: 0, 영: 0, 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 륙: 6, 칠: 7, 팔: 8, 구: 9,
};
const KOR_UNIT: Record<string, number> = { 십: 10, 백: 100, 천: 1000 };

// ── 전화번호 ─────────────────────────────────

/** 전화번호 문자열 → 숫자만 (한글 숫자 변환, +82 국가번호 → 0) */
export function phoneDigits(raw: string): string {
  let d = raw
    .split("")
    .map((ch) => (ch in KOR_DIGIT ? String(KOR_DIGIT[ch]) : ch))
    .join("")
    .replace(/\D/g, "");
  if (d.startsWith("82") && d.length >= 11) d = "0" + d.slice(2).replace(/^0/, "");
  return d;
}

/**
 * 숫자열에서 유효한 전화번호 부분만 잘라냄 (뒤에 다른 숫자가 붙어 들어온 경우 대비)
 * 010은 항상 11자리로 취급합니다.
 */
function trimPhoneDigits(d: string): string | null {
  if (/^010\d{8}/.test(d)) return d.slice(0, 11);
  if (/^01[16789]\d{7,8}/.test(d)) return d.length >= 11 ? d.slice(0, 11) : d.slice(0, 10);
  if (/^02\d{7,8}/.test(d)) return d.length === 9 || d.length === 10 ? d : null;
  if (/^0[3-6]\d\d{7,8}/.test(d)) return d.length === 10 || d.length === 11 ? d : null;
  if (/^070\d{8}/.test(d)) return d.slice(0, 11);
  return null;
}

/** 표준 형식으로 변환: 010-1234-5678 / 02-123-4567 / 031-123-4567. 변환 불가하면 입력값 그대로 */
export function formatPhone(raw: string): string {
  const d = trimPhoneDigits(phoneDigits(raw));
  if (!d) return raw.trim();
  if (d.startsWith("02")) return d.length === 9 ? `02-${d.slice(2, 5)}-${d.slice(5)}` : `02-${d.slice(2, 6)}-${d.slice(6)}`;
  return d.length === 11 ? `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}` : `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
}

export function isValidPhone(raw: string): boolean {
  return /^(01[016789]|02|0[3-6]\d|070)-\d{3,4}-\d{4}$/.test(formatPhone(raw));
}

/** 통화 내용에서 전화번호 추출 — 여러 번 말하면 마지막(정정한) 번호 사용 */
export function extractPhone(text: string): string {
  // 1) 아라비아 숫자: 숫자 사이의 공백·하이픈·점·괄호를 지우고 찾기
  const compact = text.replace(/(?<=[\d+])[\s\-.–—)(]+(?=\d)/g, "");
  const arabic = [...compact.matchAll(/(?<!\d)(?:\+?82|0)\d{8,12}/g)].map((m) => m[0]);
  for (const m of arabic.reverse()) {
    const d = trimPhoneDigits(phoneDigits(m));
    if (d) return formatPhone(d);
  }
  // 2) 한글로 읽은 번호: "공일공 일이삼사 오육칠팔"
  const spaceless = text.replace(/\s+/g, "");
  const korean = [...spaceless.matchAll(/[공영][공영일이삼사오육륙칠팔구0-9\-]{8,}/g)].map((m) => m[0]);
  for (const m of korean.reverse()) {
    const d = trimPhoneDigits(phoneDigits(m));
    if (d) return formatPhone(d);
  }
  return "";
}

// ── 동 · 호수 ────────────────────────────────

/** "이백칠" → 207, "천오백이" → 1502, "일공일" → 101, "101" → 101 */
export function koreanNumberToString(token: string): string {
  if (/^\d+$/.test(token)) return token;
  if (/\d/.test(token)) return token.replace(/\D/g, ""); // 섞여 있으면 숫자만
  if (![...token].some((ch) => ch in KOR_UNIT)) {
    // 자릿수 단위 없이 한 자리씩 읽은 경우
    return [...token].map((ch) => (ch in KOR_DIGIT ? String(KOR_DIGIT[ch]) : "")).join("");
  }
  let total = 0;
  let cur = -1;
  for (const ch of token) {
    if (ch in KOR_DIGIT) cur = KOR_DIGIT[ch];
    else if (ch in KOR_UNIT) {
      total += (cur < 0 ? 1 : cur) * KOR_UNIT[ch];
      cur = -1;
    }
  }
  if (cur > 0) total += cur;
  return total > 0 ? String(total) : "";
}

/** 입력값 정리: " 101 동" → "101", "천오백이호" → "1502" */
export function normalizeDongHo(raw: string): string {
  const s = raw.replace(/\s+/g, "").replace(/(동|호)$/, "");
  if (/^[0-9공영일이삼사오육륙칠팔구십백천]+$/.test(s)) return koreanNumberToString(s);
  return s;
}

const NUM = "0-9공영일이삼사오육륙칠팔구십백천";

/** 통화 내용에서 동·호수 추출 */
export function extractDongHo(text: string): { building: string; unit: string } {
  // 숫자 사이 공백 제거 ("1 0 1 동" → "101 동"), 이후 동/호 앞뒤 공백 무시
  const t = text.replace(/(?<=\d)\s+(?=\d)/g, "");
  const tries: RegExp[] = [
    /(\d{1,4})\s*동\s*(\d{1,5})\s*호/, // 101동 1502호
    /(?<!\d)(\d{1,4})\s*[-–]\s*(\d{3,5})\s*호/, // 101-1502호
    /(\d{1,4})\s*동\s*(\d{3,5})(?![\d\-])/, // 101동 1502 (호 생략)
  ];
  for (const re of tries) {
    const m = t.match(re);
    if (m) return { building: m[1], unit: m[2] };
  }
  // 한글로 읽은 번호: "백일 동 천오백이 호", "일공일동 일오공이호"
  const spaceless = text.replace(/\s+/g, "");
  const m = spaceless.match(new RegExp(`([${NUM}]{1,8})동([${NUM}]{1,10})호`));
  if (m) {
    const building = koreanNumberToString(m[1]);
    const unit = koreanNumberToString(m[2]);
    if (building && unit && Number(building) < 10000 && Number(unit) < 100000) return { building, unit };
  }
  return { building: "", unit: "" };
}

// ── 이름 ─────────────────────────────────────

/** 한글 이름의 띄어쓰기 제거: "홍 길 동" → "홍길동" (외국인 등 한글 외 이름은 그대로) */
export function normalizeName(raw: string): string {
  const s = raw.trim().replace(/\s+/g, " ");
  return /^[가-힣 ]+$/.test(s) ? s.replace(/ /g, "") : s;
}

/** 이름 검증 — 문제 있으면 안내 문구, 없으면 null */
export function nameProblem(name: string): string | null {
  const n = normalizeName(name);
  if (!n) return "민원인 이름을 입력하세요.";
  if (/^[가-힣]+$/.test(n) && n.length > NAME_MAX) return `이름은 최대 ${NAME_MAX}글자입니다. (입력: ${n.length}글자)`;
  if (/^[가-힣]+$/.test(n) && n.length < 2) return "이름은 2글자 이상이어야 합니다.";
  return null;
}

// 이름 뒤에 붙는 말 (긴 것부터 검사)
const NAME_ENDINGS = [
  "이라고합니다", "라고합니다", "이라고해요", "라고해요", "이라고요", "라고요",
  "인데요", "입니다", "이에요", "이구요", "이고요", "인데", "예요", "이고", "이요", "이며", "라고", "고요", "이야", "씨", "님", "요",
];
const NOT_NAMES = new Set([
  "아파트", "관리", "관리실", "주민", "입주민", "민원인", "여기", "지금", "저희", "우리", "우리집", "윗집", "아랫집", "옆집",
  "안녕", "안녕하세", "여보세요", "네네", "그게", "저기", "다름", "다름이", "다름아", "혹시", "죄송", "그러니까",
]);

/**
 * 이름 시작 위치의 문자열에서 이름만 잘라냄.
 * 3글자 → 2글자 → 4글자 순으로 시도해 바로 뒤가 어미("인데요", "입니다"…)나 문장 끝이면 이름으로 인정.
 */
function pickName(after: string, exclude: string[]): string {
  const s = after.replace(/^[,.\s~]+/, "");
  for (const len of [3, 2, 4]) {
    const cand = s.slice(0, len);
    if (cand.length !== len || !/^[가-힣]+$/.test(cand) || NOT_NAMES.has(cand)) continue;
    if (exclude.some((x) => x.includes(cand) || cand.includes(x))) continue;
    const rest = s.slice(len);
    if (/^\d+\s*동/.test(rest) || rest.startsWith("아파트")) continue; // "하늘채움101동" 같은 단지명
    if (rest === "" || /^[^가-힣]/.test(rest) || NAME_ENDINGS.some((e) => rest.startsWith(e))) return cand;
  }
  return "";
}

/**
 * 통화 내용에서 민원인 이름 추출 (띄어쓰기 무시)
 * @param lines 민원인 발화 줄 목록
 * @param exclude 이름으로 잡히면 안 되는 단어 (단지명 등)
 */
export function extractName(lines: string[], exclude: string[] = []): string {
  const s = lines.join(",").replace(/\s+/g, "");
  const anchors: RegExp[] = [
    /(?:제)?(?:이름|성함|성명)(?:은|는|이)?/g, // "이름은 홍길동"
    /(?:저는|제가|나는|본인은)/g, // "저는 홍길동인데요"
    new RegExp(`[${NUM}]호(?:에사는|사는|에살고있는|살고있는|에서|에요|예요|입니다|이고요?|인데요|요)?`, "g"), // "1502호 홍길동입니다"
  ];
  for (const re of anchors) {
    for (const m of s.matchAll(re)) {
      const name = pickName(s.slice(m.index! + m[0].length), exclude);
      if (name) return name;
    }
  }
  // 발화 첫머리: "네, 홍길동인데요"
  for (const line of lines) {
    const l = line.replace(/\s+/g, "").replace(/^(?:네|예|아|어|음|안녕하세요|여보세요|저기요|수고하십니다|[,.~!])+/, "");
    const name = pickName(l, exclude);
    if (name) return name;
  }
  return "";
}
