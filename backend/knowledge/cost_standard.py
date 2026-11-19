"""수선유지 기준 검색·판정 (README의 search_policy / decide_liability, B 담당 영역의 1차 구현).

데이터: knowledge/cost_standard/ (SH 「시설물 수선비 비용부담 기준 2026」을 구조화한 457개 항목)
- search_policy(): 거주자 발화로 기준표 항목을 찾는다. 글자 2-gram TF-IDF 검색이며,
  임베딩 기반 RAG로 바꿀 때는 이 함수만 교체하면 된다.
- decide_liability(): 찾은 항목의 임대인·임차인 부담 원인과 발화를 비교해 부담 주체를 정한다.
  LLM은 쓰지 않는다. 판단이 갈리면 '점검 후 결정', 기준에 없으면 '직원 확인 필요'로 돌린다.
"""
import csv
import json
import math
import re
from collections import Counter
from datetime import date
from functools import lru_cache

from ..config import COST_STANDARD_DIR, MOCK_DIR

MIN_SCORE = 0.12  # 이보다 낮으면 '해당 항목 없음'으로 본다
PUBLIC_PENALTY = 0.85  # 세대 민원은 대부분 전용부분이라 공용 항목 점수를 조금 낮춘다
MOVE_IN_WINDOW_DAYS = 31  # '입주후 1개월내', '입주시만 적용' 판정 기준

SH, TENANT, INSPECT, REVIEW = "SH", "거주자", "점검 후 결정", "직원 확인 필요"


# ---------------------------------------------------------------- 데이터 로드
def _load_aliases() -> dict[str, list[str]]:
    """aliases.csv(팀이 채우는 파일)와 MVP용 aliases_mvp.csv를 합친다."""
    out: dict[str, list[str]] = {}
    for path in (COST_STANDARD_DIR / "aliases.csv", MOCK_DIR / "aliases_mvp.csv"):
        if not path.exists():
            continue
        with path.open(encoding="utf-8-sig", newline="") as f:
            for row in csv.DictReader(f):
                item_id, alias = (row.get("id") or "").strip(), (row.get("별칭") or "").strip()
                if item_id and alias:
                    out.setdefault(item_id, []).extend(a.strip() for a in alias.split("|") if a.strip())
    return out


@lru_cache
def load_items() -> dict[str, dict]:
    aliases = _load_aliases()
    items: dict[str, dict] = {}
    for line in (COST_STANDARD_DIR / "items.jsonl").read_text(encoding="utf-8").splitlines():
        if line.strip():
            it = json.loads(line)
            it["별칭"] = list(dict.fromkeys([*it.get("별칭", []), *aliases.get(it["id"], [])]))
            items[it["id"]] = it
    return items


@lru_cache
def load_principles() -> dict[str, dict]:
    out = {}
    for line in (COST_STANDARD_DIR / "principles.jsonl").read_text(encoding="utf-8").splitlines():
        if line.strip():
            p = json.loads(line)
            out[p["id"]] = p
    return out


def _clean(s: str) -> str:
    """'샷시 (우리공사 부담으로 …)'처럼 띄어 쓴 괄호 설명만 지운다. '열교환기(온수)'는 그대로 둔다."""
    return re.sub(r"\s+\(.*?\)", "", s).strip()


LABEL_SKIP_GROUPS = {"공통", "기타", "전기기구", "현관,복도"}


def item_label(it: dict) -> str:
    """'개별보일러 PCB'처럼 안내 문장에 넣기 좋은 짧은 이름."""
    parts = [] if it["중분류"] in LABEL_SKIP_GROUPS else [it["중분류"]]
    names = [_clean(p) for p in it["항목"]]
    for i, p in enumerate(names):
        last = i == len(names) - 1
        if not p or p in parts or p == "기타" or p.endswith(("부속물포함", "시설물")):
            continue
        if not last and len(p) > 8:  # '목재,금속, AL창호, PL창호 및 부착물' 같은 긴 묶음 이름은 생략
            continue
        parts.append(p)
    return " ".join(parts)


def item_path(it: dict) -> str:
    return " > ".join([it["대분류"], it["중분류"], *it["항목"]])


# ---------------------------------------------------------------- 검색
def _grams(text: str) -> list[str]:
    text = re.sub(r"[^0-9A-Za-z가-힣]+", " ", text.lower())
    grams: list[str] = []
    for w in text.split():
        grams.extend([w] if len(w) == 1 else [w[i : i + 2] for i in range(len(w) - 1)])
    return grams


@lru_cache
def _index():
    items = load_items()
    docs = {}
    for item_id, it in items.items():
        # 부담 원인(파손, 노후 등)은 거의 모든 항목에 있어 검색을 흐리므로 넣지 않는다. 별칭은 2배 가중.
        text = " ".join([it["중분류"], *it["항목"], *it["별칭"], *it["별칭"]])
        docs[item_id] = Counter(_grams(text))
    df = Counter(g for c in docs.values() for g in c)
    n = len(docs)
    idf = {g: math.log((n + 1) / (d + 1)) + 1 for g, d in df.items()}
    vectors = {}
    for item_id, c in docs.items():
        v = {g: tf * idf[g] for g, tf in c.items()}
        vectors[item_id] = (v, math.sqrt(sum(x * x for x in v.values())))
    return vectors, idf


def search_policy(query: str, top_k: int = 5) -> list[dict]:
    """발화와 가장 비슷한 기준표 항목들. [{"item": {...}, "score": 0.42}, ...]"""
    vectors, idf = _index()
    items = load_items()
    q = {g: tf * idf[g] for g, tf in Counter(_grams(query)).items() if g in idf}
    qn = math.sqrt(sum(x * x for x in q.values()))
    if not qn:
        return []
    scored = []
    for item_id, (v, vn) in vectors.items():
        dot = sum(w * v.get(g, 0.0) for g, w in q.items())
        if dot:
            s = dot / (qn * vn)
            if items[item_id]["구역"] == "공용":
                s *= PUBLIC_PENALTY
            scored.append((s, item_id))
    scored.sort(reverse=True)
    return [{"item": items[i], "score": round(s, 3)} for s, i in scored[:top_k]]


def best_item(query: str) -> dict | None:
    hits = search_policy(query, top_k=1)
    return hits[0]["item"] if hits and hits[0]["score"] >= MIN_SCORE else None


# ---------------------------------------------------------------- 판정
# 거주자가 말로 표현하는 귀책 사유 → 기준표 임차인 부담 원인
TENANT_TRIGGERS = {
    "파손": ["깨졌", "깨져", "깨뜨", "부서", "부러", "금이 갔", "찌그러", "떨어뜨", "부딪", "던져", "발로", "망가뜨", "파손"],
    "깨짐": ["깨졌", "깨져", "깨뜨", "금이 갔"],
    "고의적깨짐": ["깨뜨", "일부러"],
    "동파": ["얼었", "얼어", "동파"],
    "관리소홀": ["창문을 열어", "창문 열어", "오래 비워", "방치"],
    "망실": ["잃어버", "없어졌", "분실", "망실"],
    "분실": ["잃어버", "없어졌", "분실"],
    "막힘": ["막혔", "막혀", "막힘"],
    "배수불량": ["안 빠져", "안빠져"],
    "오염": ["더러", "얼룩", "오염"],
    "훼손": ["찢어", "찢겨", "긁", "낙서", "못을 박", "못 박", "훼손"],
    "찢어짐": ["찢어", "찢겨"],
    "건전지교체": ["건전지", "배터리"],
    "건전지 교체": ["건전지", "배터리"],
    "관리 부주의로 인한 작동불량": ["부주의", "잘못 써", "실수로", "잘못 사용"],
    "관리부주의로 인한 작동불량": ["부주의", "잘못 써", "실수로", "잘못 사용"],
}
# 발화로 알 수 없는 원인(수리 방식·관리 행위)은 귀책 판단에 쓰지 않는다
NON_FAULT_CAUSES = {
    "작동불량", "수리", "보수", "교체", "청소", "유지관리", "부분보수", "부분수리", "부품교체", "부품수리",
    "도색", "부분도색", "외부도색", "패킹교환", "패킹", "준설", "세관", "소모성부품교체", "부분교체", "유지보수",
    "필터교환", "램프교환", "필터교체", "청소미흡", "오염물청소", "부착물교체", "손모",
}
CAUSE_DISPLAY = {"관리 부주의로 인한 작동불량": "사용 부주의", "관리부주의로 인한 작동불량": "사용 부주의", "건전지교체": "건전지 교체"}

# 발화에서 읽어 내는 고장 유형 → 기준표 임대인 부담 원인에 들어 있는 낱말
SYMPTOM_KINDS = [
    ("누수", r"새요|새는|샌다|샙니다|누수|물이\s*떨어|물방울|젖어|물이\s*차"),
    ("부식", r"녹슬|녹이|부식"),
    ("노후", r"오래돼|오래되|오래\s*써|낡|노후"),
    ("개폐불량", r"안\s*닫|안\s*열|닫히지|열리지|뻑뻑"),
    ("탈락", r"(?<!물이 )떨어졌|빠졌"),
    ("처짐", r"처졌|휘었|내려앉"),
]
KIND_WORDS = {
    "작동불량": ["작동불량", "고장"],
    "누수": ["누수", "누출"],
    "부식": ["부식"],
    "노후": ["노후"],
    "개폐불량": ["개폐불량", "작동불량"],
    "탈락": ["탈락"],
    "처짐": ["처짐", "휨"],
}

CLAUSE_SPLIT = re.compile(r"[,.!?]|그리고|지만|는데|고\s")
DENIAL_RE = re.compile(
    r"(적|일)\s*(이|은|도)?\s*없|아니|아뇨|없어요|없습니다|없었|그런\s*적"
    # '안 열었어요'(행동 부정)는 부정, '안 열려요'(증상)는 부정이 아니다
    r"|안\s*(열었|열어|했|쳤|찼|부딪|떨어뜨|깨뜨|깨졌)|(열|하|치|부딪치|떨어뜨리)지\s*않"
)


def _has_batchim(word: str) -> bool:
    ch = word.strip()[-1:] if word.strip() else ""
    return bool(ch) and "가" <= ch <= "힣" and (ord(ch) - 0xAC00) % 28 != 0


def josa(word: str, with_batchim: str, without: str) -> str:
    return word + (with_batchim if _has_batchim(word) else without)


def _clauses(texts: list[str]) -> list[str]:
    """부정한 절('동파는 아니고')을 뺀 나머지 절."""
    out = []
    for t in texts:
        for clause in CLAUSE_SPLIT.split(t):
            if clause.strip() and not DENIAL_RE.search(clause):
                out.append(clause)
    return out


def _kinds(clauses: list[str]) -> list[str]:
    joined = " ".join(clauses)
    kinds = [k for k, pattern in SYMPTOM_KINDS if re.search(pattern, joined)]
    return kinds or ["작동불량"]


def _matches_kind(cause: str, kinds: list[str]) -> bool:
    return any(w in cause for k in kinds for w in KIND_WORDS[k])


def _caveat_causes(it: dict) -> list[str]:
    out = []
    for c in it["임차인부담"]:
        name = c["원인"]
        if name in NON_FAULT_CAUSES:
            continue
        name = CAUSE_DISPLAY.get(name, name)
        if len(name) <= 8 and name not in out:
            out.append(name)
    return out[:3]


def decide_liability(item: dict | None, texts: list[str], move_in: date | None = None, today: date | None = None) -> dict:
    """비용 부담 판정. payer는 'SH' / '거주자' / '점검 후 결정' / '직원 확인 필요'."""
    if item is None:
        return _review(None, "기준표에서 해당 항목을 찾지 못했습니다.", ["P12"],
                       "말씀하신 내용은 수선유지 기준표에서 바로 판단하기 어려워, 담당 직원이 확인한 뒤 안내해 드리겠습니다.")
    if item["구역"] == "공용":
        return _review(item, "공용부분 시설로 관리주체 확인이 필요합니다.", ["P10"],
                       "말씀하신 시설은 공용부분이라 관리사무소에서 확인한 뒤 처리 방법을 안내해 드리겠습니다.")

    label = item_label(item)
    clauses = _clauses(texts)
    joined = " ".join(clauses)
    caveat = _caveat_causes(item)
    base = _base(item, label, caveat)

    # 1) 거주자가 귀책 사유를 직접 말한 경우
    hits = []
    for c in item["임차인부담"]:
        name = c["원인"]
        triggers = TENANT_TRIGGERS.get(name) or ([] if name in NON_FAULT_CAUSES or len(name) < 2 else [name])
        if any(t in joined for t in triggers):
            hits.append(CAUSE_DISPLAY.get(name, name))
    if hits:
        hits = list(dict.fromkeys(hits))
        cause_txt = "·".join(hits)
        principles = ["P09"] if any(h in ("파손", "깨짐", "고의적깨짐", "훼손", "사용 부주의") for h in hits) else []
        return {**base, "payer": TENANT, "tenant_cost_possible": True, "matched_cause": cause_txt,
                "reason": f"거주자 부담 사유({cause_txt})에 해당", "principles": principles,
                "say": f"수선유지 기준상 {label}의 {josa(cause_txt, '은', '는')} 거주자 부담 사유여서 수리 비용이 발생할 수 있습니다. "
                       "정확한 부담 주체는 현장 점검 후 확정됩니다."}

    landlord = item["임대인부담"]
    if not landlord:
        return {**base, "payer": TENANT, "tenant_cost_possible": True, "matched_cause": None,
                "reason": "임대인(SH) 부담 사유가 없는 항목",
                "say": f"수선유지 기준상 {josa(label, '은', '는')} 거주자 부담 항목이라 수리 비용이 발생할 수 있습니다."}

    # 2) 고장 유형과 임대인 부담 원인 비교 (입주 시점 단서 포함)
    kinds = _kinds(clauses)
    matched = [c for c in landlord if _matches_kind(c["원인"], kinds)]
    if matched:
        untimed = [c for c in matched if not c["시점"]]
        within = bool(move_in and today and 0 <= (today - move_in).days <= MOVE_IN_WINDOW_DAYS)
        if untimed or within:
            cause = (untimed or matched)[0]["원인"]
            when = "" if untimed else " 입주 후 1개월 이내라"
            say = f"수선유지 기준상 {label} {josa(cause, '은', '는')}{when} SH가 부담합니다."
            if caveat:
                say += f" 다만 점검 결과 {'·'.join(caveat)} 등으로 확인되면 거주자 부담 비용이 발생할 수 있습니다."
            return {**base, "payer": SH, "tenant_cost_possible": bool(caveat), "matched_cause": cause,
                    "reason": f"임대인 부담 사유({cause}){' · 입주 1개월 이내' if when else ''}",
                    "say": say}
        if any(_matches_kind(c["원인"], kinds) for c in item["임차인부담"]):
            cause = matched[0]["원인"]
            return {**base, "payer": TENANT, "tenant_cost_possible": True, "matched_cause": cause,
                    "reason": f"{cause}의 SH 부담은 입주 후 1개월까지 (입주일 경과)",
                    "say": f"수선유지 기준상 {label} {josa(cause, '은', '는')} 입주 후 1개월까지만 SH가 부담하여, "
                           "지금은 거주자 부담 비용이 발생할 수 있습니다. 정확한 부담 주체는 현장 점검 후 확정됩니다."}

    # 3) 원인에 따라 갈리는 경우
    return {**base, "payer": INSPECT, "tenant_cost_possible": bool(item["임차인부담"]), "matched_cause": None,
            "reason": "발화만으로 원인을 특정할 수 없음",
            "say": f"수선유지 기준상 {josa(label, '은', '는')} 원인에 따라 SH 또는 거주자 부담으로 나뉘어, 현장 점검 후 결정됩니다."}


def _base(item: dict, label: str, caveat: list[str]) -> dict:
    return {
        "item_id": item["id"],
        "item_label": label,
        "item_path": item_path(item),
        "zone": item["구역"],
        "source": item["출처"],
        "landlord_text": item["임대인부담_원문"],
        "tenant_text": item["임차인부담_원문"],
        "caveat_causes": caveat,
        "needs_review": False,
        "principles": [],
    }


def _review(item: dict | None, reason: str, principles: list[str], say: str) -> dict:
    base = _base(item, item_label(item), []) if item else {
        "item_id": None, "item_label": None, "item_path": None, "zone": None, "source": None,
        "landlord_text": None, "tenant_text": None, "caveat_causes": [],
    }
    return {**base, "payer": REVIEW, "tenant_cost_possible": False, "matched_cause": None,
            "needs_review": True, "reason": reason, "principles": principles, "say": say}


def principle_texts(ids: list[str]) -> list[dict]:
    ps = load_principles()
    return [{"id": i, "text": ps[i]["text"]} for i in ids if i in ps]
