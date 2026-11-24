"""비용부담 기준 데이터 로드.

knowledge/cost_standard/ 의 items.jsonl, principles.jsonl 을 읽고,
aliases.csv(사람이 채우는 구어 표현)를 읽을 때마다 합친다. 그래서 별칭을 고치면
build_cost_standard.py 를 다시 돌리지 않아도 서버 재시작만으로 반영된다.
"""
from __future__ import annotations

import csv
import json
import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
COST_STANDARD_DIR = ROOT / "knowledge" / "cost_standard"


@dataclass
class Cause:
    text: str               # 원문 원인 (예: "작동불량")
    condition: str | None   # 괄호 단서 원문 (예: "입주후 1개월내")
    timing: str | None      # "입주후1개월" | "입주시만" | None


@dataclass
class Item:
    id: str
    zone: str               # 전용 | 공용
    major: str              # 대분류
    minor: str              # 중분류
    path: list[str]         # 항목 경로
    landlord_raw: str
    tenant_raw: str
    note: str
    ref: str | None         # 준용
    landlord: list[Cause]
    tenant: list[Cause]
    source: str
    aliases: list[str] = field(default_factory=list)

    @property
    def name(self) -> str:
        """화면·안내용 이름. 예: '개별보일러 > 기타부품'. 긴 괄호 설명은 뺀다."""
        parts = [self.minor] + [p for p in self.path if p != self.minor]
        parts = [re.sub(r"\s*\([^)]{10,}\)", "", p) for p in parts]
        return " > ".join(parts)

    @property
    def full_path(self) -> str:
        return " > ".join([self.major, self.minor, *self.path])


@dataclass
class Principle:
    id: str
    kind: str   # 조항 | 용어 | 일람표 주석
    chapter: str
    section: str
    text: str


def _causes(raw: list[dict]) -> list[Cause]:
    return [Cause(c["원인"], c.get("조건"), c.get("시점")) for c in raw]


def load_aliases(path: Path) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    if not path.exists():
        return out
    with open(path, encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            item_id = (row.get("id") or "").strip()
            if not item_id or item_id.startswith("#"):
                continue
            out.setdefault(item_id, []).extend(
                a.strip() for a in (row.get("별칭") or "").split("|") if a.strip()
            )
    return out


@lru_cache(maxsize=1)
def load_items(data_dir: Path = COST_STANDARD_DIR) -> tuple[Item, ...]:
    aliases = load_aliases(data_dir / "aliases.csv")
    items = []
    with open(data_dir / "items.jsonl", encoding="utf-8") as f:
        for line in f:
            r = json.loads(line)
            items.append(Item(
                id=r["id"], zone=r["구역"], major=r["대분류"], minor=r["중분류"], path=r["항목"],
                landlord_raw=r["임대인부담_원문"], tenant_raw=r["임차인부담_원문"],
                note=r["비고"], ref=r["준용"],
                landlord=_causes(r["임대인부담"]), tenant=_causes(r["임차인부담"]),
                source=r["출처"],
                aliases=list(dict.fromkeys(r.get("별칭", []) + aliases.get(r["id"], []))),
            ))
    unknown = set(aliases) - {i.id for i in items}
    if unknown:
        raise ValueError(f"aliases.csv에 없는 항목 id: {sorted(unknown)}")
    return tuple(items)


@lru_cache(maxsize=1)
def load_principles(data_dir: Path = COST_STANDARD_DIR) -> dict[str, Principle]:
    out = {}
    with open(data_dir / "principles.jsonl", encoding="utf-8") as f:
        for line in f:
            r = json.loads(line)
            out[r["id"]] = Principle(r["id"], r["구분"], r["장"], r["절"], r["text"])
    return out


def get_item(item_id: str) -> Item | None:
    return next((i for i in load_items() if i.id == item_id), None)
