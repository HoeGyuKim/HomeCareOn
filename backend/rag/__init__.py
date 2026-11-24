"""수선유지 RAG: 시설물 비용부담 기준 검색과 판정.

    from backend.rag import search_policy, decide, defect_type_of

    cands = search_policy("보일러 온수가 안 나와요")          # 후보 항목 (검색)
    d = decide(cands[0]["id"], cause_text="오래돼서 갑자기 안 돼요", move_in_date="2021-04-10")
    d.verdict, d.explanation, d.basis                         # 판정 (규칙)

데이터: knowledge/cost_standard/ (items.jsonl, principles.jsonl, aliases.csv)
"""
from __future__ import annotations

import re
from datetime import date

from .liability import MGMT_FEE, PARTY, SH_REPAIR, SITE_CHECK, TENANT_PAY, Decision, decide_liability
from .retriever import Candidate, get_retriever
from .store import Item, get_item, load_items, load_principles

__all__ = [
    "search_policy", "decide", "defect_type_of", "get_item", "load_items", "load_principles",
    "Decision", "Candidate", "Item", "PARTY", "SH_REPAIR", "MGMT_FEE", "SITE_CHECK", "TENANT_PAY",
]

MIN_SCORE = 8.0  # 이보다 낮으면 "어떤 시설물인지 모름"으로 본다. 시험 문장 1순위 최저 점수 약 20, 잡음 발화 약 2


def search_policy(query: str, top_k: int = 5, min_score: float = MIN_SCORE) -> list[dict]:
    """거주자 발화 → 기준표 후보 항목 (점수 높은 순)."""
    return [c.as_dict() for c in get_retriever().search(query, top_k) if c.score >= min_score]


def decide(item_id: str, cause_text: str = "", symptom_text: str = "",
           move_in_date: str | None = None, today: date | None = None) -> Decision:
    item = get_item(item_id)
    if item is None:
        raise KeyError(f"없는 항목 id: {item_id}")
    return decide_liability(item, cause_text, symptom_text, move_in_date, today)


# 관리자 웹(defect-care)의 하자 유형 코드
_DEFECT_RULES = [
    ("COMMON", lambda i: i.zone == "공용"),
    ("HVAC", lambda i: re.search(r"보일러|난방|온수분배|에어컨|환기|배기|온도조절", " ".join([i.minor, *i.path]))),
    ("LEAK_PIPE", lambda i: re.search(r"배관|배수|급수|급탕|오·배수|수전|누수|트랩|양변기|세면기|욕조|샤워|씽크|우수", " ".join(i.path))),
    ("ELECTRIC", lambda i: i.minor in ("전기기구",) or re.search(r"전기|전등|조명|스위치|콘센트|분전반|인터폰|비디오폰", " ".join(i.path))),
    ("DOOR_WINDOW", lambda i: re.search(r"문|창|샷시|방충망|유리|도어|크리센트|경첩|손잡이", " ".join([i.minor, *i.path]))),
    ("WALL_FLOOR", lambda i: re.search(r"천정|벽|바닥|도배|장판|타일|마루|몰탈|걸레받이|도색", " ".join(i.path))),
]


def defect_type_of(item_id: str) -> str:
    item = get_item(item_id)
    if item is None:
        return "ETC"
    for code, rule in _DEFECT_RULES:
        if rule(item):
            return code
    return "ETC"
