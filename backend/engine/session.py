"""대화 세션 상태 (A 담당).

README 대화 단계: 세대 확인 → 증상 파악 → 비용 부담 안내 → 접수 의사 확인 → 마무리
비용 부담 안내와 접수 의사 확인은 한 번의 AI 발화("...SH가 부담합니다. 접수해 드릴까요?")로 이어진다.
"""
from dataclasses import dataclass, field
from enum import Enum


class State(str, Enum):
    HOUSEHOLD = "household"  # 세대 확인 (동·호수)
    SYMPTOM = "symptom"  # 증상 파악
    CONFIRM = "confirm"  # 비용 부담 안내 후 접수 의사 확인
    DONE = "done"  # 마무리 (접수했거나 안내만 받음)
    HANDOFF = "handoff"  # 직원 확인 필요로 넘김


STEP = {State.HOUSEHOLD: 0, State.SYMPTOM: 1, State.CONFIRM: 2, State.DONE: 3, State.HANDOFF: -1}


@dataclass
class Session:
    id: str
    state: State = State.HOUSEHOLD
    slots: dict = field(default_factory=dict)  # dong, ho, facility, symptom, error_code
    expecting: str | None = "dong_ho"  # 직전 질문이 묻는 항목 (규칙 NLU가 짧은 답을 해석할 때 사용)
    last_question: str = ""  # 직전 AI 발화 (LLM NLU에 함께 전달)
    household_id: int | None = None
    equipment: str | None = None
    error_meaning: str | None = None
    symptom_texts: list[str] = field(default_factory=list)  # 증상을 말한 발화 (기준 검색·판정 입력)
    liability: dict | None = None
    outcome: str | None = None  # 접수 / 안내만 / 직원 확인 필요
    fail_count: int = 0
    ticket_id: int | None = None
    last_nlu: str | None = None  # 이번 턴을 처리한 방식: "rules" / "llm"
    transcript: list[dict] = field(default_factory=list)
