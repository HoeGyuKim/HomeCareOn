"""고장 원인 분류.

거주자 말과 기준표 원인 원문을 같은 원인 범주로 바꿔서 서로 비교한다.
  거주자: "오래돼서 그런지 갑자기 안 켜져요"  → {노후, 작동불량}
  기준표: 임대인 "작동불량 교체" → {작동불량},  임차인 "파손,동파,청소" → {파손}, {동파}, {소모·청소}
"""
from __future__ import annotations

import re

DISASTER = "천재지변"
DAMAGE = "파손"          # 파손·고의·과실·사용 부주의
FREEZE = "동파"
LOST = "분실"
OLD = "노후"             # 노후·부식·자연적 손상 (내용연수가 지나 생긴 것)
WEAR = "손모"            # 사용하면서 닳음 ([별표1] ⑧). 표에서 임대인·임차인 칸 양쪽에 나와 노후와 구분한다
LEAK = "누수"
CLOG = "막힘"
CONSUMABLE = "소모·청소"  # 소모품 교체, 청소, 일상 유지관리
STAIN = "오염"
CONDENSATION = "결로"
MALFUNCTION = "작동불량"  # 원인은 모르고 작동만 안 됨

# 판정할 때 먼저 보는 순서: 구체적인 원인일수록 앞
PRIORITY = [DISASTER, DAMAGE, FREEZE, LOST, OLD, LEAK, CLOG, CONSUMABLE, STAIN, CONDENSATION, WEAR, MALFUNCTION]
CARELESS = {DAMAGE, FREEZE, LOST}

# 거주자 발화 → 원인 범주
RESIDENT_PATTERNS: dict[str, re.Pattern] = {
    DISASTER: re.compile(r"태풍|홍수|침수|지진|폭우|물난리|낙뢰|벼락|수해"),
    FREEZE: re.compile(r"동파|얼어|얼었|얼어붙|동결"),
    DAMAGE: re.compile(
        r"깨뜨|깼|깨졌|깨져|부숴|부쉈|부서|부러|떨어뜨|떨궈|떨어트|부딪|박았|세게\s?쳤|쳐서|찢|넘어뜨|던져|던졌|발로\s?차|"
        r"실수|잘못\s?(해서|건드|만져)|건드려|애가|아이가|애들이|강아지가|고양이가|파손|망가뜨|고장\s?냈|함부로|세게|충격"
    ),
    LOST: re.compile(r"잃어버|분실|없어졌|도난|잃었"),
    OLD: re.compile(r"노후|오래|낡|녹(이)?\s?슬|녹물|부식|저절로|자연(적|히|스럽)|가만히|세월|연식"),
    WEAR: re.compile(r"닳|마모|헐거|헐렁|느슨"),
    CLOG: re.compile(
        r"막혀|막혔|막힘|막힌|안\s?내려|역류|물이?\s?안\s?빠|배수가?\s?안|물티슈|휴지를?\s?많이|이물질|기름을?\s?(버|부)"
    ),
    CONSUMABLE: re.compile(
        r"전구|형광등|램프|건전지|배터리|필터|패킹|청소|소모품|가스가?\s?(빠|부족|없|새)|가스\s?(충전|주입)|냉매"
    ),
    STAIN: re.compile(r"더러|얼룩|오염|낙서|때가|찌든"),
    CONDENSATION: re.compile(r"결로|곰팡이|이슬|습기"),
    LEAK: re.compile(r"누수|새요|새는|샌다|새서|새고|물이?\s?(떨어|흘러|흐르|고여|스며)|물방울|젖어|축축"),
    MALFUNCTION: re.compile(
        r"작동\s?(이\s?)?안|안\s?(켜|나와|나오|돌아|들어와|열려|닫혀|잠겨|돼|되|움직|눌러|올라|내려가)|"
        r"멈췄|멈춰|꺼져|꺼졌|작동불량|고장|에러|오류|이상해|안\s?맞"
    ),
}

# 부주의를 부정하는 말: "충격 준 적 없어요", "떨어뜨린 건 아니고", "깨진 건 아니에요"
NEGATION_AFTER = re.compile(
    r"[^.,!?]{0,10}?\s?(적|일|건|거|것)\s?(은|는|이|도|이나)?\s?(전혀\s?)?(없|아니|안\s?했)|\S{0,3}지\s?않"
)
NEGATION_BEFORE = re.compile(r"(안|않|없|전혀)\s?$")

# 기준표 원인 원문 → 원인 범주
STANDARD_PATTERNS: list[tuple[str, re.Pattern]] = [
    (DAMAGE, re.compile(r"파손|훼손|깨짐|고의|찢어|찌그러|오손|부주의|사용상|관리소홀|이물질|임의철거")),
    (FREEZE, re.compile(r"동파|동결")),
    (LOST, re.compile(r"망실|분실")),
    (CLOG, re.compile(r"막힘|배수불량|청소미흡")),
    (CONSUMABLE, re.compile(
        r"청소|유지관리|유지보수|소모|패킹|필터|램프|전구|건전지|배터리|충전지|퓨즈|부품교체|부속품|부속물|"
        r"가스주입|광내기|정리정돈|약제|충약|셋팅|세관|준설|점검|부착물교체|코크교체")),
    (STAIN, re.compile(r"오염|도색")),
    (CONDENSATION, re.compile(r"결로|곰팡이")),
    (LEAK, re.compile(r"누수|누설|누출|누기")),
    (OLD, re.compile(r"노후|부식|자연적|변색|침하|단종")),
    (WEAR, re.compile(r"손모|마모|느슨|헐거워")),
    (MALFUNCTION, re.compile(
        r"작동불량|고장|휨|처짐|탈락|들뜸|크랙|갈라짐|박리|변형|단선|단락|절연|개폐불량|고정불량|시건불량|"
        r"뒤틀림|비틀림|흔들림|터짐|설치불량|구배불량|단전|정전|이탈|닫힘불량|점등불량|소음|신규입주")),
]
# 임대인 칸의 "교체", "수리", "보수"는 고장 수리 일반을 뜻한다 (임차인 칸에서는 부분수리라 원인으로 안 봄)
LANDLORD_GENERIC = re.compile(r"교체|수리|보수|보강|복구")

# "관리 부주의로 인한 작동불량"은 작동불량이 아니라 부주의로 본다
CARELESS_MALFUNCTION = re.compile(r"부주의|사용상|관리소홀")


def _negated(text: str, start: int, end: int) -> bool:
    return bool(NEGATION_AFTER.match(text[end:end + 12]) or NEGATION_BEFORE.search(text[max(0, start - 4):start]))


def classify_resident(text: str) -> set[str]:
    """거주자 발화에서 원인 범주를 뽑는다. 부정된 부주의("충격 준 적 없어요")는 뺀다."""
    if not text:
        return set()
    found = set()
    for cat, pat in RESIDENT_PATTERNS.items():
        for m in pat.finditer(text):
            if cat in CARELESS and _negated(text, m.start(), m.end()):
                continue
            found.add(cat)
            break
    # "건전지 갈아도 안 돼요": 소모품은 이미 바꿨으니 소모품 문제가 아니다
    if CONSUMABLE in found and re.search(
        r"(전구|형광등|램프|건전지|배터리|필터|패킹)\S{0,3}\s?(갈|바꿔|바꾸|교체|새로)\S{0,4}\s?(도|봤|봐도|했는데|줬는데)", text
    ):
        found.discard(CONSUMABLE)
        found.add(MALFUNCTION)
    # "오래돼서 저절로 깨졌어요": 본인이 했다는 말이 없으면 자연적 손상으로 본다
    if DAMAGE in found and OLD in found and not re.search(
        r"제가|실수|애가|아이가|애들이|떨어뜨|떨궈|부딪|세게\s?쳤|쳐서|던져|던졌|찢었|부쉈|깨뜨", text
    ):
        found.discard(DAMAGE)
    return found


def classify_standard(cause_text: str, side: str) -> set[str]:
    """side: 'landlord' | 'tenant'"""
    cats = {cat for cat, pat in STANDARD_PATTERNS if pat.search(cause_text)}
    if MALFUNCTION in cats and CARELESS_MALFUNCTION.search(cause_text):
        cats.discard(MALFUNCTION)
        cats.add(DAMAGE)
    if "자연적" in cause_text:
        cats.discard(DAMAGE)
    if side == "landlord" and not cats and LANDLORD_GENERIC.search(cause_text):
        cats.add(MALFUNCTION)
    return cats
