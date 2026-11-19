"""규칙(정규식·키워드) 기반 NLU. API 키 없이 동작하고 응답이 즉시 나온다.

LLM 모드에서도 접수 의사(네/아니요) 판단은 여기서 먼저 시도하고, 애매할 때만 LLM을 부른다.
"""
import re

from .korean_numbers import KOR_NUM, normalize_korean_numbers, parse_code

# ---------------------------------------------------------------- 긴급 상황
EMERGENCY_RE = re.compile(r"가스\s*(냄새|가\s*새|새)|불이\s*(났|붙)|화재|연기가|타는\s*냄새|감전")


def is_emergency(text: str) -> bool:
    return bool(EMERGENCY_RE.search(text))


# ---------------------------------------------------------------- 접수 정보 추출
DONG_RE = re.compile(r"(\d{3})\s*동(?!안)")
HO_RE = re.compile(r"(\d{3,4})\s*호(?![스텔수실선])")
DASH_RE = re.compile(r"(?<!\d)(\d{3})\s*-\s*(\d{3,4})(?!\d)")
BARE_NUM_RE = re.compile(r"^\D*?(\d{3,4})\D*$")
# 'Er 11', 'E03', '에러 03', '에러코드 공삼', '이알 십일'
ERROR_RE = re.compile(r"(?:(?<![a-z])er?|에러\s*(?:코드)?|이알)\s*[-_:]?\s*(\d{1,3}|[영공일이삼사오육칠팔구십]{2,4})", re.I)

FACILITY_KEYWORDS: list[tuple[str, list[str]]] = [
    ("보일러", ["보일러", "난방", "온수", "온돌", "조절기"]),
    ("가스", ["가스레인지", "가스쿡탑", "가스경보기", "가스 경보기", "가스밸브", "가스 밸브"]),
    ("욕실", ["변기", "세면대", "샤워", "욕조", "욕실", "화장실"]),
    ("주방", ["싱크대", "렌지후드", "후드", "주방", "식기세척"]),
    ("누수", ["누수", "물이 새", "물새", "새요", "새는", "물이 떨어", "물방울", "젖어"]),
    ("전기", ["전기", "차단기", "두꺼비집", "전등", "형광등", "콘센트", "정전", "스위치", "누전", "불이 안", "인터폰", "월패드", "초인종"]),
    ("문·창호", ["현관문", "방문이", "방문을", "문이", "문을", "문짝", "창문", "창호", "방충망", "도어락", "문고리", "샷시", "새시", "손잡이"]),
]

SYMPTOM_PATTERNS: list[tuple[str, str]] = [
    (r"안\s*켜|켜지지|작동이?\s*안|작동을\s*안|안\s*돌아|멈췄|꺼졌|꺼져", "작동 안 됨"),
    (r"온수|뜨거운\s*물|찬\s*물만", "온수 안 나옴"),
    (r"안\s*따뜻|차가워|난방이?\s*안", "난방 안 됨"),
    (r"새요|새는|샙니다|누수|물이\s*떨어|물방울|젖어", "물이 샘"),
    (r"깜빡", "표시등 깜빡임"),
    (r"차단기|두꺼비집|내려가|누전", "차단기 내려감"),
    (r"불이\s*안|안\s*들어와|정전", "전원 안 들어옴"),
    (r"안\s*열|열리지", "열리지 않음"),
    (r"안\s*닫|닫히지", "닫히지 않음"),
    (r"안\s*울", "소리 안 남"),
    (r"막혔|막혀", "막힘"),
    (r"뻑뻑|걸려요|안\s*움직", "작동이 뻑뻑함"),
    (r"소리|소음|덜컹", "소음"),
    (r"냄새", "냄새"),
    (r"얼었|얼어|동파", "동파"),
    (r"깨졌|깨져|부서|부러|파손|터졌", "파손"),
    (r"고장|이상해|안\s*돼|안돼", "고장"),
]


def normalize_error_code(raw: str | None) -> str | None:
    """LLM이 'Er 03', 'E-03'처럼 돌려준 값을 '03' 형식으로 맞춘다."""
    if not raw:
        return None
    m = re.search(rf"(\d{{1,3}}|{KOR_NUM})", raw)
    return parse_code(m.group(1)) if m else raw.strip()


def _error_code(text: str) -> tuple[str | None, str]:
    matches = list(ERROR_RE.finditer(text))
    if not matches:
        return None, text
    token = matches[-1].group(1)
    if not token.isdigit() and len(token) >= 3 and token.endswith("이"):  # '공삼이 뜨고' → 조사 '이' 제거
        token = token[:-1]
    return parse_code(token), ERROR_RE.sub(" ", text)


def facility_of(text: str) -> str | None:
    for facility, keywords in FACILITY_KEYWORDS:
        if any(k in text for k in keywords):
            return facility
    return None


def extract(text: str, expecting: str | None) -> dict:
    """발화에서 dong, ho, facility, symptom, error_code를 뽑는다. 못 찾은 항목은 넣지 않는다."""
    t = normalize_korean_numbers(text)
    out: dict = {}

    code, t = _error_code(t)
    if code:
        out["error_code"] = code

    # 같은 항목이 여러 번 나오면 마지막 값 (정정: '1204호, 아 아니 1205호')
    if dash := DASH_RE.findall(t):
        out["dong"], out["ho"] = int(dash[-1][0]), int(dash[-1][1])
    if dongs := DONG_RE.findall(t):
        out["dong"] = int(dongs[-1])
    if hos := HO_RE.findall(t):
        out["ho"] = int(hos[-1])
    if "dong" not in out and "ho" not in out and expecting in ("dong", "ho"):
        if m := BARE_NUM_RE.match(t):  # '몇 호이신가요?' → '1204요'
            out[expecting] = int(m.group(1))

    if facility := facility_of(t):
        out["facility"] = facility

    labels = [label for pattern, label in SYMPTOM_PATTERNS if re.search(pattern, t)]
    if labels:
        out["symptom"] = ", ".join(dict.fromkeys(labels[:2]))
    return out


# ---------------------------------------------------------------- 접수 의사 확인
NO_RE = re.compile(r"아니|아뇨|괜찮아요|괜찮습니다|안\s*할|안\s*해도|됐어요|필요\s*없|나중에|안내만|접수\s*(안|하지\s*않)")
YES_RE = re.compile(r"^\s*(네|예|응|그래|좋아)|접수|부탁|해\s*주세요|맞아요|그렇게\s*해")


def confirm_intent(text: str) -> str | None:
    """'yes' / 'no' / None(모름)."""
    if NO_RE.search(text):
        return "no"
    if YES_RE.search(text):
        return "yes"
    return None


DENY_RE = re.compile(r"^\s*(아니|아뇨|틀렸|잘못)")


def denies(text: str) -> bool:
    return bool(DENY_RE.search(text))
