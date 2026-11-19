"""NLU 선택기: 규칙 기반과 LLM 기반을 상황에 따라 고른다.

- 접수 정보 추출: LLM 사용 가능하면 LLM (자유 발화라 이해력이 중요), 실패하면 규칙
- 접수 의사 확인: 규칙 먼저 (즉시 응답), 애매할 때만 LLM
각 함수는 (결과, 처리 방식) 을 돌려준다. 처리 방식은 "rules" 또는 "llm".
"""
import logging

from .. import config
from . import nlu_llm, nlu_rules

log = logging.getLogger("homecareon.nlu")


def extract(text: str, known: dict, last_question: str, expecting: str | None) -> tuple[dict, str]:
    if config.llm_enabled():
        try:
            got = nlu_llm.extract(text, known, last_question)
            if got is not None:
                if "error_code" in got:
                    got["error_code"] = nlu_rules.normalize_error_code(got["error_code"])
                return got, "llm"
        except Exception as e:  # 네트워크·키 오류 등 → 규칙 기반으로 대체
            log.warning("LLM 추출 실패, 규칙 기반으로 대체: %s", e)
    return nlu_rules.extract(text, expecting), "rules"


def confirm_intent(question: str, text: str) -> tuple[str | None, str]:
    intent = nlu_rules.confirm_intent(text)
    if intent is not None or not config.llm_enabled():
        return intent, "rules"
    try:
        return nlu_llm.confirm_intent(question, text), "llm"
    except Exception as e:
        log.warning("LLM 접수 의사 판단 실패: %s", e)
        return None, "rules"
