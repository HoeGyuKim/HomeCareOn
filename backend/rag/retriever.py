"""시설물 항목 검색 (BM25, 한글 글자 n-gram).

거주자 발화("보일러 온수가 안 나와요")를 기준표 457개 항목 중 후보로 좁힌다.
형태소 분석기 없이 글자 2·3-gram을 쓰므로 조사·띄어쓰기 차이에 강하고 의존성이 없다.

검색 문서 = 중분류 + 항목 경로 + 별칭. 별칭(aliases.csv)은 거주자 표현이라 가중치를 더 준다.
부담 원인 원문은 넣지 않는다. "파손", "노후" 같은 말은 거의 모든 항목에 있어 검색을 흐리기 때문이다.
"""
from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass

from .store import Item, load_items

K1, B = 1.2, 0.75
ALIAS_WEIGHT = 2        # 별칭 n-gram을 몇 번 반복해 넣을지
COMMON_PENALTY = 0.6    # 공용 단서가 없는 발화에서 공용부분 항목 점수 배율

# 발화에 이런 말이 있으면 공용부분을 말하는 것으로 본다
COMMON_HINT = re.compile(
    r"복도|계단|엘리베이터|승강기|주차장|놀이터|경비실|관리사무소|공용|단지|옥상|외벽|"
    r"현관\s?자동문|공동\s?현관|우편함|게시판|조경|나무|보안등|가로등|CCTV|씨씨티비|소화전"
)

# 검색에 도움이 안 되는 말 (n-gram을 흐림)
NOISE = re.compile(
    r"고장|안\s?돼|안\s?되|문제|이상|있어요|있습니다|했어요|해요|하는데|그런데|근데|"
    r"갑자기|좀|너무|계속|자꾸|요즘|어제|오늘|부터|저희|우리|집에|집|댁|세대|"
    r"안녕하세요|전화|연락|문의|말씀|접수|수리|고쳐|봐\s?주|와\s?주|해\s?주"
)


def _clean(text: str) -> str:
    text = re.sub(r"\([^)]*\)", " ", text)
    return re.sub(r"[^가-힣A-Za-z0-9]", "", text)


def ngrams(text: str) -> list[str]:
    t = _clean(text)
    grams = [t[i:i + 2] for i in range(len(t) - 1)]
    grams += [t[i:i + 3] for i in range(len(t) - 2)]
    if len(t) == 1:
        grams.append(t)
    return grams


def document(item: Item) -> list[str]:
    base = " ".join([item.minor, *item.path])
    toks = ngrams(base)
    for alias in item.aliases:
        toks += ngrams(alias) * ALIAS_WEIGHT
    return toks


@dataclass
class Candidate:
    item: Item
    score: float

    def as_dict(self) -> dict:
        return {"id": self.item.id, "name": self.item.name, "zone": self.item.zone, "score": round(self.score, 3)}


class Retriever:
    def __init__(self, items: tuple[Item, ...] | None = None):
        self.items = items if items is not None else load_items()
        self.docs = [Counter(document(i)) for i in self.items]
        self.lengths = [sum(d.values()) for d in self.docs]
        self.avgdl = sum(self.lengths) / len(self.lengths)
        df = Counter()
        for d in self.docs:
            df.update(d.keys())
        n = len(self.docs)
        self.idf = {g: math.log(1 + (n - c + 0.5) / (c + 0.5)) for g, c in df.items()}

    def search(self, query: str, top_k: int = 5, zone: str | None = None) -> list[Candidate]:
        q = Counter(ngrams(NOISE.sub(" ", query)))
        if not q:
            return []
        common_hint = bool(COMMON_HINT.search(query))
        scored = []
        for item, doc, dl in zip(self.items, self.docs, self.lengths):
            if zone and item.zone != zone:
                continue
            s = 0.0
            for g, qtf in q.items():
                tf = doc.get(g)
                if not tf:
                    continue
                s += self.idf[g] * tf * (K1 + 1) / (tf + K1 * (1 - B + B * dl / self.avgdl)) * qtf
            if s <= 0:
                continue
            if item.zone == "공용" and not common_hint:
                s *= COMMON_PENALTY
            scored.append(Candidate(item, s))
        scored.sort(key=lambda c: c.score, reverse=True)
        return scored[:top_k]


_default: Retriever | None = None


def get_retriever() -> Retriever:
    global _default
    if _default is None:
        _default = Retriever()
    return _default
