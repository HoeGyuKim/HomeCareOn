"""HWP5 BodyText에서 본문 문단과 표(병합 셀 정보 포함)를 순서대로 추출해 JSON으로 저장."""
import json
import struct
import sys
import zlib

import olefile

PARA_HEADER, PARA_TEXT, CTRL_HEADER, LIST_HEADER, TABLE = 66, 67, 71, 72, 77
# 8 wchar(16바이트)를 차지하는 컨트롤 문자
WIDE_CTRL = {1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23}


def read_records(data):
    recs, pos = [], 0
    while pos < len(data):
        (h,) = struct.unpack_from("<I", data, pos)
        pos += 4
        tag, level, size = h & 0x3FF, (h >> 10) & 0x3FF, (h >> 20) & 0xFFF
        if size == 0xFFF:
            (size,) = struct.unpack_from("<I", data, pos)
            pos += 4
        recs.append((tag, level, data[pos:pos + size]))
        pos += size
    return recs


def decode_text(b):
    out, i, n = [], 0, len(b) // 2
    while i < n:
        (c,) = struct.unpack_from("<H", b, i * 2)
        if c in WIDE_CTRL:
            if c == 9:
                out.append("\t")
            i += 8
            continue
        if c == 10:
            out.append("\n")
        elif c == 13:
            pass
        elif c in (24, 30):
            out.append("-" if c == 24 else " ")
        elif c == 31:
            out.append(" ")
        elif c >= 32:
            out.append(chr(c))
        i += 1
    return "".join(out)


class Parser:
    def __init__(self, recs):
        self.recs = recs
        self.items = []  # 본문 순서대로 {"type": "para"|"table", ...}

    def subtree_end(self, i, level):
        j = i + 1
        while j < len(self.recs) and self.recs[j][1] > level:
            j += 1
        return j

    def paragraph(self, i, top):
        """i: PARA_HEADER. 반환: (텍스트, 표 목록, 다음 인덱스)."""
        level = self.recs[i][1]
        end = self.subtree_end(i, level)
        text, tables = "", []
        j = i + 1
        while j < end:
            tag, lv, data = self.recs[j]
            if lv == level + 1 and tag == PARA_TEXT:
                text += decode_text(data)
                j += 1
            elif lv == level + 1 and tag == CTRL_HEADER:
                cend = self.subtree_end(j, lv)
                if data[:4][::-1] == b"tbl ":
                    tables.append(self.table(j, cend))
                j = cend
            else:
                j += 1
        if top:
            if text.strip():
                self.items.append({"type": "para", "text": text.strip()})
            for t in tables:
                self.items.append(t)
        return text, tables, end

    def table(self, start, end):
        clevel = self.recs[start][1]
        rows = cols = None
        cells, cur = [], None
        j = start + 1
        while j < end:
            tag, lv, data = self.recs[j]
            if lv == clevel + 1 and tag == TABLE:
                rows, cols = struct.unpack_from("<HH", data, 4)
                j += 1
            elif lv == clevel + 1 and tag == LIST_HEADER:
                col, row, cs, rs = struct.unpack_from("<HHHH", data, 8)
                cur = {"row": row, "col": col, "rs": rs, "cs": cs, "text": "", "nested": []}
                cells.append(cur)
                j += 1
            elif lv == clevel + 1 and tag == PARA_HEADER and cur is not None:
                text, tables, j = self.paragraph(j, top=False)
                cur["text"] = (cur["text"] + "\n" + text).strip("\n") if cur["text"] else text
                cur["nested"].extend(tables)
            else:
                j += 1
        for c in cells:
            c["text"] = c["text"].strip()
            if not c["nested"]:
                del c["nested"]
        return {"type": "table", "rows": rows, "cols": cols, "cells": cells}

    def run(self):
        i = 0
        while i < len(self.recs):
            tag, lv, _ = self.recs[i]
            if tag == PARA_HEADER and lv == 0:
                _, _, i = self.paragraph(i, top=True)
            else:
                i += 1
        return self.items


def main():
    src, out = sys.argv[1], sys.argv[2]
    ole = olefile.OleFileIO(src)
    items = []
    k = 0
    while ole.exists(f"BodyText/Section{k}"):
        raw = ole.openstream(f"BodyText/Section{k}").read()
        items += Parser(read_records(zlib.decompress(raw, -15))).run()
        k += 1
    with open(out, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=1)
    n_tab = sum(1 for x in items if x["type"] == "table")
    print(f"sections={k} items={len(items)} tables={n_tab}")


if __name__ == "__main__":
    main()
