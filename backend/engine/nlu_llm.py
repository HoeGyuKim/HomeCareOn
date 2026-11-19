"""LLM(Claude) 기반 NLU. 정해진 JSON 형식으로만 답하게 강제한다 (structured outputs).

LLM은 '이해'만 한다. 비용 부담 판정·티켓 생성 같은 결정은 하지 않는다.
"""
import json
import logging

import anthropic

from .. import config
from ..models import FACILITIES

log = logging.getLogger("homecareon.nlu.llm")
_client: anthropic.Anthropic | None = None


def _get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        _client = anthropic.Anthropic()
    return _client


def _nullable(schema: dict) -> dict:
    return {"anyOf": [schema, {"type": "null"}]}


def _ask_json(system: str, user: str, schema: dict) -> dict | None:
    resp = _get_client().messages.create(
        model=config.LLM_MODEL,
        max_tokens=16000,
        system=system,
        messages=[{"role": "user", "content": user}],
        output_config={
            "effort": config.LLM_EFFORT,
            "format": {"type": "json_schema", "schema": schema},
        },
    )
    if resp.stop_reason in ("refusal", "max_tokens"):
        log.warning("LLM 응답 사용 불가: stop_reason=%s", resp.stop_reason)
        return None
    text = next((b.text for b in resp.content if b.type == "text"), None)
    return json.loads(text) if text else None


# ---------------------------------------------------------------- 접수 정보 추출
EXTRACT_SYSTEM = """너는 SH 임대주택 시설물 고장 접수 전화에서 정보를 추출한다.
- 이번 발화에서 거주자가 말한 정보만 추출한다. 말하지 않은 항목은 null. 추측하지 않는다.
- dong(동), ho(호수)는 정수. 한글 숫자는 숫자로 바꾼다 (백삼 동 → 103, 천이백사 호 → 1204).
- 거주자가 정정하면 ('1204호, 아 아니 1205호') 마지막 값을 쓴다.
- 직전 질문을 참고해 짧은 답이 어느 항목인지 판단한다 (직전 질문이 '몇 호이신가요?'이고 답이 '1204요'면 ho=1204).
- facility는 보일러, 누수, 전기, 문·창호, 주방, 욕실, 가스, 기타 중 하나.
- symptom은 '온수 안 나옴', '물이 샘'처럼 짧은 명사구.
- error_code는 기기 화면의 숫자만, 앞자리 0을 살려서 ('에러 공삼' → '03')."""


def extract(text: str, known: dict, last_question: str) -> dict | None:
    schema = {
        "type": "object",
        "properties": {
            "dong": _nullable({"type": "integer"}),
            "ho": _nullable({"type": "integer"}),
            "facility": _nullable({"type": "string", "enum": FACILITIES}),
            "symptom": _nullable({"type": "string"}),
            "error_code": _nullable({"type": "string"}),
        },
        "required": ["dong", "ho", "facility", "symptom", "error_code"],
        "additionalProperties": False,
    }
    user = f"이미 아는 정보: {json.dumps(known, ensure_ascii=False)}\n직전 질문: {last_question}\n이번 발화: {text}"
    data = _ask_json(EXTRACT_SYSTEM, user, schema)
    if data is None:
        return None
    return {k: v for k, v in data.items() if v not in (None, "")}


# ---------------------------------------------------------------- 접수 의사 확인
def confirm_intent(question: str, text: str) -> str | None:
    system = (
        "너는 시설물 고장 접수 전화에서 거주자가 접수를 원하는지 판단한다. "
        "접수를 원하면 yes, 원하지 않거나 안내만 원하면 no, 판단할 수 없으면 unknown."
    )
    schema = {
        "type": "object",
        "properties": {"intent": {"type": "string", "enum": ["yes", "no", "unknown"]}},
        "required": ["intent"],
        "additionalProperties": False,
    }
    data = _ask_json(system, f"직전 질문: {question}\n거주자 답변: {text}", schema)
    intent = data.get("intent") if data else None
    return intent if intent in ("yes", "no") else None
