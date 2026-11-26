"""
한글 음성 수사(숫자 표현)를 아라비아 숫자로 변환하는 유틸리티 모듈

예시:
  - "백삼 동 천이백사 호" -> 103동, 1204호
  - "일공삼 동 일이공사 호" -> 103동, 1204호
  - "에러 공삼이 떠요" -> 에러 03
"""
import re
from typing import Optional, Tuple

DIGIT_MAP = {
    '영': 0, '공': 0, '일': 1, '이': 2, '삼': 3, '사': 4,
    '오': 5, '육': 6, '칠': 7, '팔': 8, '구': 9
}

UNIT_MAP = {
    '십': 10, '백': 100, '천': 1000, '만': 10000
}


def parse_korean_number(text: str) -> Optional[int]:
    """
    한글 수사 문자열을 정수로 변환합니다.
    형태 1: 자리수 조합형 ("백삼" -> 103, "천이백사" -> 1204)
    형태 2: 낱자리 연속형 ("일공삼" -> 103, "일이공사" -> 1204)
    """
    text = text.strip()
    if not text:
        return None

    # 이미 아라비아 숫자인 경우
    if text.isdigit():
        return int(text)

    # 1. 낱자리 연속형 검사 (예: 일공삼, 공삼, 일칠공오)
    if all(ch in DIGIT_MAP for ch in text):
        val_str = "".join(str(DIGIT_MAP[ch]) for ch in text)
        return int(val_str)

    # 2. 자리수 조합형 계산 (예: 백삼, 천이백사, 십삼)
    total = 0
    temp = 0
    has_digit = False

    for ch in text:
        if ch in DIGIT_MAP:
            temp = DIGIT_MAP[ch]
            has_digit = True
        elif ch in UNIT_MAP:
            unit = UNIT_MAP[ch]
            if temp == 0:
                temp = 1
            total += temp * unit
            temp = 0
            has_digit = True
        else:
            return None

    total += temp
    return total if has_digit else None


def extract_dong_ho(text: str) -> Tuple[Optional[str], Optional[str]]:
    """
    사용자 발화에서 동과 호수를 추출합니다.
    반환값: ("103동", "1204호") 형태의 튜플
    """
    # 1. 아라비아 숫자 형태 먼저 탐색 (예: 103동 1204호)
    dong_match = re.search(r'(\d+)\s*동', text)
    ho_match = re.search(r'(\d+)\s*호', text)

    dong = f"{dong_match.group(1)}동" if dong_match else None
    ho = f"{ho_match.group(1)}호" if ho_match else None

    # 2. 한글 수사 형태 탐색 (예: 백삼 동, 천이백사 호 / 일공삼 동)
    if not dong:
        k_dong_match = re.search(r'([영공일이삼사오육칠팔구십백천]+)\s*동', text)
        if k_dong_match:
            val = parse_korean_number(k_dong_match.group(1))
            if val is not None:
                dong = f"{val}동"

    if not ho:
        k_ho_match = re.search(r'([영공일이삼사오육칠팔구십백천]+)\s*호', text)
        if k_ho_match:
            val = parse_korean_number(k_ho_match.group(1))
            if val is not None:
                ho = f"{val}호"

    return dong, ho


def extract_error_code(text: str) -> Optional[str]:
    """
    발화에서 에러코드를 추출합니다 (예: "에러 03", "에러 공삼이 떠요", "E03" 등)
    """
    # 1. 아라비아 숫자 패턴: "에러 03", "코드 12", "E-03", "E03"
    match = re.search(r'(?:에러|코드|알람|E)\s*[-_]?\s*([0-9]{1,3})', text, re.IGNORECASE)
    if match:
        code_num = int(match.group(1))
        return f"{code_num:02d}"

    # 2. 한글 수사 패턴: "에러 공삼", "에러 삼번", "에러 공삼이 떠요"
    k_match = re.search(r'(?:에러|코드|알람)\s*([영공일이삼사오육칠팔구십]+)', text)
    if k_match:
        cand = k_match.group(1)
        # 한국어 조사 '이' 처리 (예: "공삼이" -> "공삼" + 조사 "이")
        # 단, "이" 자체만 있는 경우("에러 2번")는 유지
        if len(cand) > 1 and cand.endswith('이'):
            # "공삼이" -> 앞부분 "공삼"이 유효한 숫자인지 확인
            sub_val = parse_korean_number(cand[:-1])
            if sub_val is not None:
                return f"{sub_val:02d}"

        val = parse_korean_number(cand)
        if val is not None:
            return f"{val:02d}"

    return None


# ── 이름 추출 (규칙 기반 명시적 패턴 + 수식어/조사 제거) ──────────────
SURNAMES = set(
    "김이박최정강조윤장임한오서신권황안송류유전홍고문양손배백허남심노하곽성차주우구민나진지엄채원천방공현함변염여추도소석선설마길연위표명기반왕금옥육인맹제모탁국어은편용예봉경사부황보"
)
NAME_PATTERNS = [
    re.compile(r"(?:이름은|이름이|성함은|성함이)\s*([가-힣]+)"),
    re.compile(r"([가-힣]+)(?:이라고|라고)\s*(?:해|해요|합니다|함)"),
    re.compile(r"(?:저|제|내)\s+([가-힣]+)\s*(?:인데요|입니다|이에요|예요|이요)"),
]
NAME_STOPWORDS = {
    "안녕하세요", "계약자", "계약자는", "계약자분", "성함", "성함은", "이름", "이름은", "이름이",
    "저는", "제가", "저", "제", "나는", "내가", "나", "내", "난", "날", "너", "너는", "네가",
    "그", "그는", "그녀", "그녀는", "우리", "우리는", "저희", "저희는",
    "여기", "거기", "맞아요", "맞습니다", "네", "예", "응", "아니요", "아닙니다",
    "본인", "본인이에요", "본인입니다", "어머니", "아버지", "남편", "아내", "세입자", "입주자", "거주자", "주민",
    "살고", "살고있어", "살고있어요", "살아요", "살고요", "있어", "있어요",
}
NAME_SUFFIX = re.compile(r"(입니다|이에요|예요|이요|이고요|이고|고요|이라고\s?합니다|라고\s?합니다|씨|님|은|는|이|가|요)$")
VERB_ENDINGS = ("어요", "해요", "했어요", "네요", "는데", "해서", "어서", "워요", "돼요", "까요", "게요", "세요", "니다만", "있어", "살아", "살고")


def extract_name(text: str) -> Optional[str]:
    """'내 이름은 홍길동이고', '103동 1204호 홍길동입니다', '홍길동이요', '제 이름은 김민수예요' → 이름. 못 찾으면 None."""
    # 1. '이름은 홍길동이고', '홍길동이라고 합니다' 등 명시적 구문 우선 탐색
    for pat in NAME_PATTERNS:
        m = pat.search(text)
        if m:
            cand = m.group(1)
            cand = NAME_SUFFIX.sub("", cand)
            if 2 <= len(cand) <= 4 and cand[0] in SURNAMES and cand not in NAME_STOPWORDS:
                return cand

    # 2. 토큰별 후방 탐색 (조사/서술어 및 불용어 제거)
    t = re.sub(r"[0-9]+\s*(동|호)", " ", text)
    t = re.sub(r"[영공일이삼사오육칠팔구십백천]+\s*(동|호)\b", " ", t)
    for token in reversed(re.findall(r"[가-힣]+", t)):
        if token in NAME_STOPWORDS or token.endswith(VERB_ENDINGS):
            continue
        name = NAME_SUFFIX.sub("", token)
        if (2 <= len(name) <= 4 and name[0] in SURNAMES and name not in NAME_STOPWORDS
                and not re.fullmatch(r"[영공일이삼사오육칠팔구십백천만]+", name)):
            return name
    return None

