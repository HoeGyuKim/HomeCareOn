"""한글 숫자 → 아라비아 숫자. STT가 '백삼 동 천이백사 호', '에러 공삼'처럼 받아 적는 경우를 처리한다."""
import re

DIGITS = {"영": 0, "공": 0, "일": 1, "이": 2, "삼": 3, "사": 4, "오": 5, "육": 6, "륙": 6, "칠": 7, "팔": 8, "구": 9}
UNITS = {"십": 10, "백": 100, "천": 1000}
KOR_NUM = "[영공일이삼사오육륙칠팔구십백천]+"


def parse_sino_korean(s: str) -> int | None:
    """'백삼' → 103, '천이백사' → 1204, '이공이' → 202."""
    if not s or any(ch not in DIGITS and ch not in UNITS for ch in s):
        return None
    if not any(ch in UNITS for ch in s):  # 한 자리씩 읽은 경우: 이공이 → 202
        return int("".join(str(DIGITS[ch]) for ch in s))
    total, cur = 0, 0
    for ch in s:
        if ch in DIGITS:
            cur = DIGITS[ch]
        else:
            total += (cur or 1) * UNITS[ch]
            cur = 0
    return total + cur


def parse_code(token: str) -> str | None:
    """에러코드는 앞자리 0을 살린다: '03' → '03', '공삼' → '03', '십일' → '11'."""
    if token.isdigit():
        return token
    if token and all(ch in DIGITS for ch in token):
        return "".join(str(DIGITS[ch]) for ch in token)
    v = parse_sino_korean(token)
    return str(v) if v is not None else None


_DONG = re.compile(rf"({KOR_NUM})\s?동(?!안)")
_HO = re.compile(rf"({KOR_NUM})\s?호(?![스텔수실선])")


def normalize_korean_numbers(text: str) -> str:
    """'동'·'호' 앞의 한글 숫자만 바꾼다 (띄어 써도 됨). 100 미만이면 '이동' 같은 일반 단어로 보고 둔다."""

    def repl(suffix: str):
        def _r(m: re.Match) -> str:
            v = parse_sino_korean(m.group(1))
            return f"{v}{suffix}" if v is not None and v >= 100 else m.group(0)

        return _r

    text = _DONG.sub(repl("동"), text)
    return _HO.sub(repl("호"), text)
