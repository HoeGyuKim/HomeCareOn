"""SH 「시설물 수선비 비용부담 기준」 HWP → RAG용 구조화 데이터.

사용법:
    python knowledge/tools/build_cost_standard.py <기준.hwp> [출력폴더]

출력 (기본 knowledge/cost_standard/):
    items.csv         [별표2] 일람표를 항목 1개 = 1행으로 펼친 표 (검수용, 엑셀로 열림)
    items.jsonl       같은 내용 + 원인 키워드 분해 + 임베딩용 문장 (RAG 입력)
    principles.jsonl  본문(제1~3장) 조항과 [별표1] 용어 정의, 일람표 주석

별칭은 aliases.csv(id, 별칭)에 사람이 따로 적는다. 재생성해도 지워지지 않고 items.*에 합쳐진다.
"""
import csv
import json
import re
import sys
import zlib
from pathlib import Path

import olefile

sys.path.insert(0, str(Path(__file__).parent))
from hwp_tables import Parser, read_records  # noqa: E402

SOURCE_NAME = "시설물 수선비 비용부담 기준(임대아파트 및 기타주택) 2026"
YEAR = 2026
CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳"


# ---------- 공통 ----------

def load_items(hwp_path):
    ole = olefile.OleFileIO(str(hwp_path))
    items, k = [], 0
    while ole.exists(f"BodyText/Section{k}"):
        raw = ole.openstream(f"BodyText/Section{k}").read()
        items += Parser(read_records(zlib.decompress(raw, -15))).run()
        k += 1
    return items


def clean(text):
    """줄바꿈 제거, 정렬용 자간 띄움(예: '가 버 너', '바    닥') 복원."""
    text = text.replace("\n", " ").replace("‧", "·")
    # 한 글자씩 2칸 이상 띄운 것: '바    닥' → '바닥'
    text = re.sub(r"(?<![가-힣A-Za-z])([가-힣])\s{2,}([가-힣])(?![가-힣])", r"\1\2", text)
    # 한 글자 토큰이 3개 이상 이어진 것: '가 버 너' → '가버너'
    text = re.sub(
        r"(?<![가-힣])[가-힣](?: [가-힣](?![가-힣])){2,}",
        lambda m: m.group(0).replace(" ", ""),
        text,
    )
    text = re.sub(r"P\. C\. B", "PCB", text)
    return re.sub(r"\s+", " ", text).strip()


def split_causes(text):
    """'작동불량(입주후 1개월내), 노후,부식' → [{'원인': '작동불량', '조건': '입주후 1개월내'}, ...]"""
    if text in ("", "-"):
        return []
    text = re.sub(r"(?<=[가-힣])\.\s+(?=[가-힣])", ",", text)  # 원문 오타 '손모. 작동불량'
    parts, depth, cur = [], 0, ""
    for ch in text:
        if ch in "(（":
            depth += 1
        elif ch in ")）":
            depth -= 1
        if ch in ",，" and depth == 0:
            parts.append(cur)
            cur = ""
        else:
            cur += ch
    parts.append(cur)
    out = []
    for p in (x.strip() for x in parts):
        if not p or p == "-":
            continue
        m = re.match(r"^(.*?)\s*\((.+)\)\s*$", p)
        if m and m.group(1):
            cause, cond = m.group(1).strip(), m.group(2).strip()
        else:
            cause, cond = p, None
        out.append({"원인": cause, "조건": cond, "시점": timing(cond)})
    return out


def timing(cond):
    """입주일과 비교해야 하는 단서를 정규화. '입주후1개월' | '입주시만' | None"""
    if not cond:
        return None
    c = cond.replace(" ", "")
    if re.search(r"입주(후|시)1개월", c):
        return "입주후1개월"
    if "입주시만" in c:
        return "입주시만"
    return None


# ---------- [별표2] 일람표 ----------

def header_columns(table):
    """헤더 행에서 임대인/임차인/비고 열 번호를 찾는다. 헤더가 없으면 None."""
    cols = {}
    for c in table["cells"]:
        if c["row"] != 0:
            continue
        t = clean(c["text"])
        if t.startswith("임대인부담"):
            cols["landlord"] = c["col"]
        elif t.startswith("임차인부담"):
            cols["tenant"] = c["col"]
        elif t.replace(" ", "") == "비고":
            cols["note"] = c["col"]
    return cols if len(cols) == 3 else None


def table_rows(table, cols):
    """병합 셀을 펼쳐 (행 번호, 행의 열별 셀 dict)를 돌려준다. 같은 셀이 여러 칸을 덮으면 같은 dict."""
    grid = {}
    for c in table["cells"]:
        for r in range(c["row"], c["row"] + c["rs"]):
            for k in range(c["col"], c["col"] + c["cs"]):
                grid[(r, k)] = c
    start = 1 if header_columns(table) else 0
    for r in range(start, table["rows"]):
        yield r, [grid.get((r, k)) for k in range(table["cols"])]


def build_items(items):
    start = next(i for i, x in enumerate(items) if x["type"] == "para" and x["text"].startswith("[별표2]"))
    end = next(i for i, x in enumerate(items) if x["type"] == "para" and x["text"].startswith("[별표3]"))
    major = minor = None
    major_no = minor_no = 0
    seq = {}
    last_cols = None
    rows, notes = [], []

    for x in items[start + 1:end]:
        if x["type"] == "para":
            t = clean(x["text"])
            m1 = re.match(r"^(\d)\.\s*(.+)$", t)
            m2 = re.match(r"^(\d)\)\s*(.+)$", t)
            if m1:
                major_no, major = int(m1.group(1)), m1.group(2)
                minor_no, minor = 0, None
                if ":" in major:  # '6. 임대상가시설물 : 아파트 보수기준에 준합니다.'
                    name, body = (s.strip() for s in major.split(":", 1))
                    major = name
                    notes.append({"분류": f"{major_no}. {name}", "text": f"{name}: {body}"})
            elif m2:
                minor_no, minor = int(m2.group(1)), m2.group(2)
            else:
                notes.append({"분류": f"{major_no}. {major} > {minor_no}) {minor}", "text": t})
            continue

        cols = header_columns(x)
        if cols is None:
            if x["rows"] == 2 and x["cols"] == 2:  # 목차 표
                continue
            if last_cols is None:
                raise ValueError("헤더 없는 첫 표")
            cols = last_cols
        last_cols = cols
        n_item_cols = cols["landlord"]

        for _, row in table_rows(x, cols):
            path = []
            for c in row[:n_item_cols]:
                t = clean(c["text"]) if c else ""
                if t and (not path or path[-1] != t):
                    path.append(t)
            land_cell, ten_cell, note_cell = row[cols["landlord"]], row[cols["tenant"]], row[cols["note"]]
            land = clean(land_cell["text"]) if land_cell else ""
            ten = clean(ten_cell["text"]) if ten_cell else ""
            note = clean(note_cell["text"]) if note_cell else ""
            ref = None
            if land_cell is not None and land_cell is ten_cell:  # 임대인·임차인 칸이 합쳐진 '준용' 행
                ref, land, ten = land, "", ""
            if not path:
                continue
            key = (major_no, minor_no)
            seq[key] = seq.get(key, 0) + 1
            rows.append({
                "id": f"{major_no}-{minor_no}-{seq[key]:02d}",
                "구역": "전용" if major_no == 1 else "공용",
                "대분류": major,
                "중분류": minor,
                "항목": path,
                "임대인부담_원문": land,
                "임차인부담_원문": ten,
                "비고": note,
                "준용": ref,
            })
    return rows, notes


def sentence(r):
    loc = f"{r['대분류']} > {r['중분류']} > {' > '.join(r['항목'])}"
    if r["준용"]:
        return f"{loc}: {r['준용']}."
    land = r["임대인부담_원문"] or "해당 없음"
    ten = r["임차인부담_원문"] or "해당 없음"
    payer = "임차인(관리비 공동부담 포함)" if r["구역"] == "공용" else "임차인"
    s = f"{loc}: 임대인(SH) 부담 - {land}. {payer} 부담 - {ten}."
    if r["비고"]:
        s += f" 비고: {r['비고']}."
    if r.get("별칭"):
        s += f" 다른 표현: {', '.join(r['별칭'])}."
    return s


def load_aliases(path):
    aliases = {}
    if path.exists():
        with open(path, encoding="utf-8-sig", newline="") as f:
            for row in csv.DictReader(f):
                if row.get("id") and row.get("별칭"):
                    aliases.setdefault(row["id"].strip(), []).extend(
                        a.strip() for a in row["별칭"].split("|") if a.strip()
                    )
    return aliases


# ---------- 본문 조항, [별표1] 용어 ----------

def build_principles(items):
    out = []
    chapter = section = None
    cur = None

    def flush():
        nonlocal cur
        if cur:
            cur["text"] = " ".join(cur["text"])
            out.append(cur)
        cur = None

    for x in items:
        if x["type"] == "para" and x["text"].startswith("[별표1]"):
            break
        if x["type"] != "para":
            continue
        t = clean(x["text"])
        if re.match(r"^제\d장", t):
            flush()
            chapter, section = t, None
        elif chapter is None:
            continue
        elif re.match(r"^\d\.\s", t):
            flush()
            section = t
        elif re.match(r"^\d\)\s?", t):
            flush()
            cur = {"구분": "조항", "장": chapter, "절": section, "text": [t]}
        elif cur is not None:
            cur["text"].append(t)
        else:  # 번호 없는 절 본문 (예: '1. 목적' 아래 문단)
            cur = {"구분": "조항", "장": chapter, "절": section, "text": [t]}
    flush()

    # [별표1] 용어 정의: 표 한 칸에 ①~⑲가 이어져 있다
    i = next(i for i, x in enumerate(items) if x["type"] == "para" and x["text"].startswith("[별표1]"))
    term_text = clean(items[i + 1]["cells"][0]["text"])
    for chunk in re.split(f"(?=[{CIRCLED}])", term_text):
        chunk = chunk.strip()
        if not chunk:
            continue
        m = re.match(f"^[{CIRCLED}]\\s*(.+?)\\s*:\\s*(.+)$", chunk)
        if m:
            out.append({"구분": "용어", "장": "[별표1] 용어의 정의", "절": m.group(1),
                        "text": f"{m.group(1)}: {m.group(2)}"})
    for n, p in enumerate(out, 1):
        p["id"] = f"P{n:02d}"
    return out


# ---------- 출력 ----------

def main():
    sys.stdout.reconfigure(encoding="utf-8")
    hwp = Path(sys.argv[1])
    out_dir = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(__file__).resolve().parents[1] / "cost_standard"
    out_dir.mkdir(parents=True, exist_ok=True)

    items = load_items(hwp)
    rows, notes = build_items(items)
    aliases = load_aliases(out_dir / "aliases.csv")
    unknown = set(aliases) - {r["id"] for r in rows}
    if unknown:
        print("경고: aliases.csv에 없는 id", sorted(unknown))

    with open(out_dir / "items.jsonl", "w", encoding="utf-8") as f:
        for r in rows:
            r["별칭"] = aliases.get(r["id"], [])
            rec = {
                **r,
                "임대인부담": split_causes(r["임대인부담_원문"]),
                "임차인부담": split_causes(r["임차인부담_원문"]),
                "출처": f"{SOURCE_NAME} [별표2] {r['대분류']} > {r['중분류']}",
                "기준연도": YEAR,
                "text": sentence(r),
            }
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")

    with open(out_dir / "items.csv", "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["id", "구역", "대분류", "중분류", "항목1", "항목2", "항목3",
                    "임대인부담", "임차인부담", "비고", "준용", "별칭"])
        for r in rows:
            p = (r["항목"] + ["", "", ""])[:3]
            w.writerow([r["id"], r["구역"], r["대분류"], r["중분류"], *p,
                        r["임대인부담_원문"], r["임차인부담_원문"], r["비고"], r["준용"] or "",
                        " | ".join(r["별칭"])])

    principles = build_principles(items)
    for n, note in enumerate(notes, 1):
        principles.append({"id": f"N{n:02d}", "구분": "일람표 주석", "장": "[별표2]", "절": note["분류"],
                           "text": note["text"]})
    with open(out_dir / "principles.jsonl", "w", encoding="utf-8") as f:
        for p in principles:
            f.write(json.dumps({**p, "출처": SOURCE_NAME, "기준연도": YEAR}, ensure_ascii=False) + "\n")

    if not (out_dir / "aliases.csv").exists():
        with open(out_dir / "aliases.csv", "w", encoding="utf-8-sig", newline="") as f:
            csv.writer(f).writerow(["id", "별칭"])

    print(f"items={len(rows)} principles={len(principles)} → {out_dir}")


if __name__ == "__main__":
    main()
