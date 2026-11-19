"""제조사별 에러코드 매뉴얼 조회 (목업 데이터: knowledge/mock/error_codes.json)."""
import json
from functools import lru_cache

from ..config import MOCK_DIR


@lru_cache
def load_error_codes() -> dict:
    return json.loads((MOCK_DIR / "error_codes.json").read_text(encoding="utf-8"))


def error_meaning(manufacturer: str | None, code: str | None) -> str | None:
    """같은 코드라도 제조사마다 뜻이 다르다. '3'과 '03'은 같은 코드로 본다."""
    if not manufacturer or not code:
        return None
    table = load_error_codes().get(manufacturer, {})
    if code in table:
        return table[code]
    if code.isdigit():
        return next((v for k, v in table.items() if k.isdigit() and int(k) == int(code)), None)
    return None
