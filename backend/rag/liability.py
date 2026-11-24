"""비용 부담 판정 (규칙 코드, LLM 아님).

입력: 검색으로 고른 기준표 항목 + 거주자가 말한 증상·경위 + 입주일
출력: 부담 주체와 근거. 근거는 항목 id와 원문으로 남겨 관리자 화면에서 그대로 보여 준다.

판정 순서
1. 천재지변(태풍·침수·지진 등)이면 임대인 부담 (제2장 1.4, P11)
2. 거주자 말에서 뽑은 원인 범주를 구체적인 것부터 보면서(파손 → 동파 → … → 작동불량)
   기준표 임대인 칸·임차인 칸 중 한쪽에만 있으면 그쪽으로 정한다.
   - "입주후 1개월내", "입주시만" 단서가 붙은 임대인 원인은 입주일이 1개월 안일 때만 인정
   - 본인 과실·파손인데 표에 해당 칸이 없으면 임차인 부담 (제2장 1.2, P09)
3. 공용부분의 임차인 부담은 관리비 공동부담 (제2장 1.3, P10)
4. 양쪽에 다 있거나 원인을 모르면 "점검 후 결정"
"""
from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from datetime import date, datetime

from . import causes as C
from .store import Cause, Item, load_principles

SH_REPAIR = "SH_REPAIR"
MGMT_FEE = "MGMT_FEE"
SITE_CHECK = "SITE_CHECK"
TENANT_PAY = "TENANT_PAY"

PARTY = {
    SH_REPAIR: "임대인(SH)",
    MGMT_FEE: "관리비(공동부담)",
    SITE_CHECK: "점검 후 결정",
    TENANT_PAY: "임차인(거주자)",
}

RECENT_DAYS = 31  # "입주후 1개월내", "입주시만" 단서를 인정하는 기간


@dataclass
class Decision:
    verdict: str
    party: str
    resident_cost_possible: bool
    item_id: str
    item_name: str
    causes: list[str]                     # 거주자 말에서 뽑은 원인 범주
    decided_by: str | None                # 판정을 가른 원인 범주
    basis: str                            # 근거 (기준표 원문)
    principles: list[str] = field(default_factory=list)  # 적용한 조항 id
    explanation: str = ""                 # 거주자 안내 문장

    def as_dict(self) -> dict:
        return asdict(self)


def _parse_date(d: str | date | None) -> date | None:
    if d is None or isinstance(d, date):
        return d
    try:
        return datetime.strptime(d[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def is_recent(move_in: str | date | None, today: date | None = None) -> bool:
    m = _parse_date(move_in)
    if not m:
        return False
    return 0 <= ((today or date.today()) - m).days <= RECENT_DAYS


def _index(entries: list[Cause], side: str, recent: bool) -> tuple[dict[str, list[Cause]], list[Cause]]:
    """원인 범주 → 해당 원문. 기간 단서가 안 맞는 임대인 원인은 따로 돌려준다."""
    out: dict[str, list[Cause]] = {}
    expired = []
    for e in entries:
        if side == "landlord" and e.timing and not recent:
            expired.append(e)
            continue
        for cat in C.classify_standard(e.text, side):
            out.setdefault(cat, []).append(e)
    return out, expired


def _say(entries: list[Cause], limit: int = 5) -> str:
    """원인 목록을 안내 문장용으로. 기간 단서는 괄호로 살린다: '작동불량(입주후 1개월내), 노후'"""
    seen = list(dict.fromkeys(f"{e.text}({e.condition})" if e.condition else e.text for e in entries))
    return ", ".join(seen[:limit]) + (" 등" if len(seen) > limit else "")


def _has_batchim(word: str) -> bool | None:
    ch = word.rstrip(" )")[-1:] if word else ""
    if ch and "가" <= ch <= "힣":
        return (ord(ch) - 0xAC00) % 28 != 0
    return None


def _josa(word: str, with_batchim: str, without: str) -> str:
    """받침에 맞는 조사: _josa('보일러', '은', '는') → '보일러는'"""
    b = _has_batchim(word)
    return word + (with_batchim if b else without if b is False else f"{with_batchim}({without})")


def _table_line(name: str, land: str, tenant: str) -> str:
    """기준표 해당 항목을 그대로 읽어 주는 문장."""
    subj = _josa(name, "은", "는")
    if land and tenant:
        return f"기준표상 {subj} {_josa(land, '이면', '면')} SH 부담, {_josa(tenant, '이면', '면')} 거주자 부담입니다."
    if land:
        return f"기준표상 {subj} {_josa(land, '이면', '면')} SH 부담이고, 거주자 부담 항목은 없습니다."
    if tenant:
        return f"기준표상 {subj} {_josa(tenant, '이면', '면')} 거주자 부담이고, SH 부담 항목은 없습니다."
    return f"기준표에 {name}의 부담 기준이 따로 적혀 있지 않습니다."


GENERIC_PART = {"기타부품", "본체", "부속품", "기타", "부속부품"}


def speak_name(item: Item) -> str:
    """안내 문장용 짧은 이름. 예: 개별보일러, 샷시 유리, 화장실 석고보드"""
    clean = [re.sub(r"\s*\([^)]*\)", "", p).strip() for p in item.path]
    label = (clean[0] if item.minor in ("공통", "기타") and clean else item.minor).replace(",", "·")
    detail = clean[-1] if clean and clean[-1] != label else ""
    if detail in GENERIC_PART:
        detail = ""
    return f"{label} {detail}".strip()


def _ro(word: str) -> str:
    """'(으)로' 조사: 받침 없거나 ㄹ받침이면 '로', 그 외 받침이면 '으로'"""
    ch = word.rstrip(" )")[-1:] if word else ""
    if ch and "가" <= ch <= "힣":
        jong = (ord(ch) - 0xAC00) % 28
        return word + ("로" if jong in (0, 8) else "으로")
    return word + "(으)로"


def inspection_note(item: Item | None, move_in_date: str | date | None = None, today: date | None = None) -> str:
    """'원인을 어떻게 아느냐'에 대한 답: 방문 점검과 SH 직원 검토로 정해지며, 점검 결과별로 누가 부담하는지.
    원인을 단정하지 않고 기준표 해당 항목의 칸만 그대로 읽어 준다."""
    head = ("원인은 직접 판단하지 않으셔도 됩니다. 접수하시면 기사님이 방문해 {what} 상태를 점검하고, "
            "SH 담당 직원이 점검 결과를 검토해 최종 부담을 결정합니다.")
    if item is None:
        return head.format(what="시설물") + " 기준표에 바로 해당하는 항목이 없어 담당 직원이 기준을 확인해 안내해 드립니다."
    recent = is_recent(move_in_date, today)
    land = _say([e for e in item.landlord if not (e.timing and not recent)])
    tenant = _say(item.tenant)
    payer = "관리비(입주자 공동부담)" if item.zone == "공용" else "거주자 부담"
    if land and tenant:
        tail = f" 점검에서 {_ro(land)} 확인되면 SH 부담, {_ro(tenant)} 확인되면 {payer}입니다."
    elif land:
        tail = f" 점검에서 {_ro(land)} 확인되면 SH 부담입니다."
    elif tenant:
        tail = f" 기준표상 이 항목은 {_ro(tenant)} 확인되면 {payer}입니다."
    else:
        tail = ""
    return head.format(what=speak_name(item)) + tail


def _basis(item: Item) -> str:
    return (f"[별표2] {item.full_path} — 임대인부담: {item.landlord_raw or '해당 없음'} / "
            f"임차인부담: {item.tenant_raw or '해당 없음'}"
            + (f" / 비고: {item.note}" if item.note else ""))


def decide_liability(item: Item, cause_text: str = "", symptom_text: str = "",
                     move_in_date: str | date | None = None, today: date | None = None) -> Decision:
    cats = C.classify_resident(cause_text) | C.classify_resident(symptom_text)
    ordered = [c for c in C.PRIORITY if c in cats]
    recent = is_recent(move_in_date, today)
    landlord, expired = _index(item.landlord, "landlord", recent)
    tenant, _ = _index(item.tenant, "tenant", recent)
    principles = load_principles()

    def make(verdict: str, decided_by: str | None, explanation: str, pids: list[str] | None = None) -> Decision:
        if item.zone == "공용":
            # 공용부분의 임차인 부담은 관리비로 입주자가 함께 낸다 (P10)
            explanation = explanation.replace("거주자 부담", "관리비(입주자 공동부담)")
            if verdict == TENANT_PAY:
                verdict = MGMT_FEE
                pids = (pids or []) + ["P10"]
        if C.CONDENSATION in cats and "P06" not in (pids or []):
            pids = (pids or []) + ["P06"]
            explanation += " 결로·곰팡이는 평소 환기와 온·습도 관리가 거주자 의무라 점검 결과에 따라 부담이 달라질 수 있습니다."
        basis = _basis(item)
        for pid in pids or []:
            text = principles[pid].text
            if pid == "P12" and "기타 명기" in text:
                text = text[text.index("기타 명기"):]  # P12 앞부분(장애인 주거편의)은 이 판정과 무관
            basis += f" / {pid}: {text}"
        cost_possible = verdict in (TENANT_PAY, SITE_CHECK, MGMT_FEE) or bool(item.tenant)
        return Decision(verdict, PARTY[verdict], cost_possible, item.id, item.name, ordered, decided_by,
                        basis, pids or [], explanation)

    name = speak_name(item)
    land_any, tenant_any = _say(item.landlord), _say(item.tenant)
    # "점검 결과 ~면 SH 부담"이라고 말할 때는 지금 입주 기간에 인정되는 임대인 원인만 쓴다
    land_now = _say([e for e in item.landlord if not (e.timing and not recent)])
    # 모든 안내는 기준표 해당 항목의 임대인·임차인 칸을 먼저 읽어 준다
    table = _table_line(name, land_any, tenant_any)

    if item.ref:
        return make(SITE_CHECK, None, f"{_josa(name, '은', '는')} 기준표에서 {item.ref}하도록 되어 있어, 기사님 점검 후 최종 결정됩니다.")

    if C.DISASTER in cats:
        return make(SH_REPAIR, C.DISASTER,
                    f"{table} 다만 태풍·홍수 같은 천재지변으로 생긴 피해는 기준 제2장에 따라 SH가 수선합니다.", ["P11"])

    # 1차: 거주자가 말한 원인이 표의 임대인·임차인 칸 중 한쪽에만 있으면 그 칸대로 정한다
    for cat in ordered:
        in_l, in_t = cat in landlord, cat in tenant
        if in_l and in_t and recent and any(e.timing for e in landlord[cat]):
            # "작동불량(입주후 1개월내)"처럼 기간 단서가 붙은 임대인 원인은, 기간 안이면 임대인 쪽이 우선
            in_t = False
        if in_l and not in_t:
            msg = f"{table} 말씀하신 내용은 '{_say(landlord[cat])}'에 해당해 SH 부담으로 안내드립니다."
            if tenant_any:
                msg += f" 다만 점검 결과 {tenant_any} 등으로 확인되면 거주자 부담으로 바뀔 수 있습니다."
            return make(SH_REPAIR, cat, msg)
        if in_t and not in_l:
            if cat == C.MALFUNCTION and expired:
                msg = (f"{table} 작동불량은 입주 후 1개월 안에만 SH 부담이라, "
                       f"지금은 거주자 부담으로 안내드립니다.")
            else:
                msg = f"{table} 말씀하신 내용은 '{_say(tenant[cat])}'에 해당해 거주자 부담으로 안내드립니다."
                if land_now:
                    msg += f" 점검 결과 {land_now} 때문으로 확인되면 SH 부담이 됩니다."
            return make(TENANT_PAY, cat, msg, ["P09"] if cat in C.CARELESS else [])

    # 2차: 표 칸으로 정해지지 않은 본인 과실·파손은 수선비 부담 원칙(제2장 1.2)에 따른다
    careless = [c for c in ordered if c in C.CARELESS]
    if careless and item.zone == "전용":
        msg = (f"{table} 말씀하신 {_josa(careless[0], '은', '는')} 표에 따로 적혀 있지 않지만, 기준 제2장에 따라 "
               f"사용 중 고의·과실·부주의로 생긴 전용부분 수리는 거주자 부담으로 안내드립니다.")
        if land_now:
            msg += f" 점검 결과 {land_now} 때문으로 확인되면 SH 부담이 됩니다."
        return make(TENANT_PAY, careless[0], msg, ["P09"])

    if not land_any and tenant_any:
        return make(TENANT_PAY, None, f"{table}")
    if land_any and not tenant_any:
        return make(SH_REPAIR, None, f"{table}")
    msg = f"{table} 말씀하신 내용만으로는 어느 쪽인지 정할 수 없어 기사님 점검 후 최종 결정됩니다."
    return make(SITE_CHECK, None, msg, ["P12"] if not ordered else [])
