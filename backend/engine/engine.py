"""대화 오케스트레이터 (A 담당).

handle_turn(세션, 발화) → 응답 문장.
README 설계 원칙대로:
- 대화 흐름은 상태머신이 쥔다. LLM(nlu 모듈)은 발화 이해만 한다.
- 비용 부담 판정은 기준표(knowledge.cost_standard)가 하고, 근거를 티켓에 남긴다.
- 방문 일정은 AI가 잡지 않는다. 접수까지만 하고 일정은 직원이 문자로 안내한다.
- 판단이 어렵거나 인식이 반복 실패하면 '직원 확인 필요' 티켓으로 올린다.
응답 문장은 템플릿으로 만든다 (빠르고, 하지 않은 말을 지어낼 위험이 없음).
"""
import re
from datetime import datetime

from sqlalchemy.orm import Session as DB

from ..config import COMPLEX_NAME
from ..knowledge import cost_standard as cs
from ..knowledge import manuals
from ..models import Household
from ..tools import households, tickets
from . import nlu, nlu_rules
from .session import Session, State

GREETING = "안녕하세요, SH 시설물 접수센터입니다. 동과 호수를 말씀해 주세요."
CONFIRM_QUESTION = "접수해 드릴까요?"

ASK = {
    "dong_ho": "동과 호수를 말씀해 주세요. 예: 103동 1204호",
    "dong": "몇 동이신가요?",
    "ho": "몇 호이신가요?",
    "symptom": "어떤 문제가 있으신가요? 고장 난 설비와 증상을 말씀해 주세요.",
}

EMERGENCY_REPLY = (
    "가스 냄새나 화재가 의심되면 전기 스위치나 불꽃을 사용하지 마시고, 창문을 열어 환기한 뒤 "
    "가스 밸브를 잠그고 안전한 곳으로 대피해 주세요. 119 또는 도시가스사 긴급 신고 번호로 바로 연락하시고, "
    "관리사무소 담당 직원에게도 바로 전달하겠습니다."
)

# 기준표 중분류 → 설비 분류 (거주자가 설비 이름을 말하지 않았을 때 업체 추천·표시용)
GROUP_FACILITY = {"개별보일러": "보일러", "전기기구": "전기", "주방": "주방", "화장실": "욕실",
                  "가스": "가스", "현관,복도": "문·창호", "발코니": "문·창호"}
# 숫자 끝소리 받침: 0(영)·1(일)·3(삼)·6(육)·7(칠)·8(팔)은 받침이 있다 → '03은', '12는'
DIGIT_BATCHIM = set("013678")


def start(session_id: str) -> Session:
    s = Session(id=session_id, last_question=GREETING)
    s.transcript.append({"role": "ai", "text": GREETING})
    return s


def handle_turn(db: DB, s: Session, text: str, now: datetime | None = None) -> str:
    now = now or datetime.now()
    text = text.strip()
    s.transcript.append({"role": "user", "text": text})
    reply = _dispatch(db, s, text, now)
    s.last_question = reply
    s.transcript.append({"role": "ai", "text": reply})
    if s.ticket_id:
        tickets.save_transcript(db, s.ticket_id, s.transcript)
    return reply


def _dispatch(db: DB, s: Session, text: str, now: datetime) -> str:
    if s.state in (State.DONE, State.HANDOFF):
        return _after_end(s)
    if nlu_rules.is_emergency(text):
        return _escalate(db, s, now, "긴급: 가스·화재 등 위험 신고", EMERGENCY_REPLY, urgent=True)
    if s.state == State.HOUSEHOLD:
        return _on_household(db, s, text, now)
    if s.state == State.SYMPTOM:
        return _on_symptom(db, s, text, now)
    return _on_confirm(db, s, text, now)


# ---------------------------------------------------------------- 1. 세대 확인
def _on_household(db: DB, s: Session, text: str, now: datetime) -> str:
    got, s.last_nlu = nlu.extract(text, s.slots, s.last_question, s.expecting)
    address = {k: got[k] for k in ("dong", "ho") if k in got}
    problem = {k: got[k] for k in ("facility", "symptom", "error_code") if k in got}
    if not address and not problem:
        return _fail(db, s, now, "죄송해요, 잘 알아듣지 못했어요. " + ASK[s.expecting or "dong_ho"])

    s.slots.update(address)
    if problem:  # 첫 발화에 증상까지 말한 경우 기억해 둔다
        s.slots.update(problem)
        s.symptom_texts.append(text)

    missing = [k for k in ("dong", "ho") if not s.slots.get(k)]
    if missing:
        s.expecting = "dong_ho" if len(missing) == 2 else missing[0]
        s.fail_count = 0
        return ASK[s.expecting]

    error = _check_household(db, s, now)
    if error:
        return error
    dong, ho = s.slots["dong"], s.slots["ho"]
    if s.symptom_texts:
        return _guide(db, s, now, prefix=f"{dong}동 {ho}호 확인되었습니다.")
    s.state = State.SYMPTOM
    s.expecting = "symptom"
    return f"{dong}동 {ho}호 맞으시죠? 어떤 문제가 있으신가요?"


def _check_household(db: DB, s: Session, now: datetime) -> str | None:
    """동·호수가 실제 세대인지 확인한다. 없으면 실패 메시지."""
    household = households.find_household(db, s.slots["dong"], s.slots["ho"])
    if household is None:
        wrong = f"{s.slots.pop('dong')}동 {s.slots.pop('ho')}호"
        s.household_id = None
        s.state = State.HOUSEHOLD
        s.expecting = "dong_ho"
        return _fail(db, s, now, f"{wrong}는 {COMPLEX_NAME}에 등록되지 않은 세대예요. 동과 호수를 다시 말씀해 주세요.")
    s.household_id = household.id
    s.fail_count = 0
    return None


# ---------------------------------------------------------------- 2. 증상 파악
def _on_symptom(db: DB, s: Session, text: str, now: datetime) -> str:
    got, s.last_nlu = nlu.extract(text, s.slots, s.last_question, s.expecting)
    problem = {k: got[k] for k in ("facility", "symptom", "error_code") if k in got}

    if "dong" in got or "ho" in got:  # '아니요, 1205호요' 같은 세대 정정
        s.slots.update({k: got[k] for k in ("dong", "ho") if k in got})
        error = _check_household(db, s, now)
        if error:
            return error
        if not problem:
            return f"{s.slots['dong']}동 {s.slots['ho']}호로 확인했습니다. 어떤 문제가 있으신가요?"
    elif nlu_rules.denies(text) and not problem:  # '아니요' → 세대를 다시 묻는다
        s.slots.pop("dong", None)
        s.slots.pop("ho", None)
        s.household_id = None
        s.state = State.HOUSEHOLD
        s.expecting = "dong_ho"
        return "죄송합니다. 동과 호수를 다시 말씀해 주세요."

    s.slots.update(problem)
    s.symptom_texts.append(text)
    return _guide(db, s, now)


# ---------------------------------------------------------------- 3. 비용 부담 안내 → 접수 의사 확인
def _guide(db: DB, s: Session, now: datetime, prefix: str = "") -> str:
    household = db.get(Household, s.household_id)
    query = " ".join(filter(None, [s.slots.get("facility"), *s.symptom_texts]))
    item = cs.best_item(query)

    if item is None and not (s.slots.get("facility") or s.slots.get("error_code")):
        s.symptom_texts.clear()  # 알아듣지 못한 발화는 다음 검색에 섞지 않는다
        s.state, s.expecting = State.SYMPTOM, "symptom"
        return _fail(db, s, now, "어떤 설비에 어떤 문제가 있는지 조금 더 자세히 말씀해 주시겠어요? 예: 보일러가 켜지지 않아요")

    facility = s.slots.get("facility") or _facility_from_item(item)
    s.slots["facility"] = facility
    equipment = households.equipment_of(household, facility)
    s.equipment = households.equipment_text(equipment)
    code = s.slots.get("error_code")
    s.error_meaning = manuals.error_meaning(equipment.manufacturer, code) if (equipment and code) else None
    if not s.slots.get("symptom"):
        s.slots["symptom"] = s.error_meaning or "고장"

    s.liability = cs.decide_liability(item, s.symptom_texts, household.move_in_date, now.date())

    parts = [prefix] if prefix else []
    if code and s.error_meaning:
        parts.append(f"설치된 {facility}({equipment.manufacturer} {equipment.model}) 기준으로 "
                     f"에러 {_code_josa(code)} {s.error_meaning}입니다.")
    elif code:
        parts.append(f"에러 {_code_josa(code)} 설치된 설비 매뉴얼에서 확인되지 않아 점검 때 확인하겠습니다.")
    parts.append(s.liability["say"])
    parts.append(CONFIRM_QUESTION)

    s.state = State.CONFIRM
    s.expecting = "confirm"
    s.fail_count = 0
    return " ".join(parts)


def _facility_from_item(item: dict | None) -> str:
    if item is None:
        return "기타"
    if item["중분류"] in GROUP_FACILITY:
        return GROUP_FACILITY[item["중분류"]]
    path = cs.item_path(item)
    if "배관" in path:
        return "누수"
    if any(w in path for w in ("샷시", "창호", "문")):
        return "문·창호"
    return "기타"


def _code_josa(code: str) -> str:
    return code + ("은" if code[-1:] in DIGIT_BATCHIM else "는")


# ---------------------------------------------------------------- 4. 접수 의사 확인 → 5. 마무리
def _on_confirm(db: DB, s: Session, text: str, now: datetime) -> str:
    intent, s.last_nlu = nlu.confirm_intent(s.last_question, text)
    if intent == "yes":
        review = bool(s.liability and s.liability.get("needs_review"))
        ticket = _create_ticket(db, s, now, status="직원 확인 필요" if review else "접수",
                                review_reason=s.liability["reason"] if review else None, outcome="접수 희망")
        s.ticket_id = ticket.id
        s.state, s.outcome, s.expecting = State.DONE, "접수", None
        return (f"접수되었습니다. 접수번호는 {ticket.id}번입니다. "
                "담당 직원이 확인한 뒤 방문 일정을 문자로 안내해 드리겠습니다.")
    if intent == "no":
        s.state, s.outcome, s.expecting = State.DONE, "안내만", None
        return "알겠습니다. 접수하지 않고 안내만 드렸습니다. 필요하시면 언제든 다시 연락해 주세요."
    return _fail(db, s, now, "접수를 원하시면 '네', 안내만 들으시려면 '아니요'라고 말씀해 주세요.")


def _after_end(s: Session) -> str:
    if s.state == State.HANDOFF:
        return "담당 직원이 내용을 확인한 뒤 연락드리겠습니다."
    if s.outcome == "접수":
        return "접수가 완료되었습니다. 방문 일정은 담당 직원이 문자로 안내해 드리겠습니다. 감사합니다."
    return "다른 문의는 [새로 접수] 버튼을 눌러 다시 시작해 주세요. 감사합니다."


# ---------------------------------------------------------------- 실패·직원 확인 필요
def _fail(db: DB, s: Session, now: datetime, message: str) -> str:
    s.fail_count += 1
    if s.fail_count >= 2:
        return _escalate(db, s, now, "인식 2회 연속 실패",
                         "여러 번 정확히 알아듣지 못해 죄송합니다. 담당 직원이 내용을 확인한 뒤 연락드리겠습니다.")
    return message


def _escalate(db: DB, s: Session, now: datetime, reason: str, reply: str, urgent: bool = False) -> str:
    ticket = _create_ticket(db, s, now, status="직원 확인 필요", review_reason=reason, urgent=urgent, outcome="직원 확인 필요")
    s.ticket_id = ticket.id
    s.state, s.outcome, s.expecting = State.HANDOFF, "직원 확인 필요", None
    return reply


def _create_ticket(db: DB, s: Session, now: datetime, *, status: str, review_reason: str | None,
                   outcome: str, urgent: bool = False):
    household = db.get(Household, s.household_id) if s.household_id else None
    return tickets.create_ticket(
        db,
        household_id=s.household_id,
        facility=s.slots.get("facility"),
        symptom=s.slots.get("symptom"),
        error_code=s.slots.get("error_code"),
        error_meaning=s.error_meaning,
        equipment=s.equipment,
        liability=s.liability,
        summary=build_summary(s, household, outcome),
        transcript=s.transcript,
        status=status,
        now=now,
        urgent=urgent,
        review_reason=review_reason,
    )


def build_summary(s: Session, household: Household | None, outcome: str) -> str:
    """통화 요약 (README 티켓 상세). 템플릿으로 만들어 지어낸 내용이 들어가지 않게 한다."""
    lines = []
    if household:
        lines.append(f"세대: {household.dong}동 {household.ho}호 ({household.resident_name}, "
                     f"입주 {household.move_in_date:%Y-%m-%d})")
    elif s.slots.get("dong") or s.slots.get("ho"):
        lines.append(f"세대: 확인 안 됨 ({s.slots.get('dong', '?')}동 {s.slots.get('ho', '?')}호라고 말함)")
    if s.equipment:
        lines.append(f"설비: {s.equipment}")
    if s.slots.get("facility") or s.slots.get("symptom"):
        symptom = f"{s.slots.get('facility', '-')} - {s.slots.get('symptom', '-')}"
        if s.slots.get("error_code"):
            symptom += f", 에러 {s.slots['error_code']}" + (f"({s.error_meaning})" if s.error_meaning else "")
        lines.append(f"증상: {symptom}")
    if s.symptom_texts:
        lines.append("거주자 설명: " + " / ".join(f'"{t}"' for t in s.symptom_texts)[:300])
    if s.liability:
        liab = s.liability
        note = " (거주자 비용 발생 가능성 함께 안내)" if liab.get("tenant_cost_possible") else ""
        lines.append(f"비용 부담 안내: {liab['payer']}{note} - {liab['reason']}")
        if liab.get("item_id"):
            lines.append(f"기준 항목: {liab['item_path']} [{liab['item_id']}]")
    lines.append(f"거주자 의사: {outcome}")
    return "\n".join(lines)
