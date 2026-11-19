"""대화 시나리오 테스트. README 대화 단계: 세대 확인 → 증상 파악 → 비용 부담 안내 → 접수 의사 확인 → 마무리."""
from backend.engine import engine as eng
from backend.engine.session import State
from backend.models import Notification, Ticket


def talk(db, now, *utterances, sid="t"):
    s = eng.start(sid)
    replies = [eng.handle_turn(db, s, u, now=now) for u in utterances]
    return s, replies


def test_readme_dialogue(db, now):
    """README '대화 예시' 그대로."""
    s, r = talk(db, now, "백삼 동 천이백사 호요.", "보일러에 에러 공삼이 뜨고 온수가 안 나와요.", "네, 접수해 주세요.")
    assert r[0] == "103동 1204호 맞으시죠? 어떤 문제가 있으신가요?"
    assert "에러 03은 점화 불량입니다" in r[1]  # 103동 1204호 = C사 보일러, C사 03 = 점화 불량
    assert "SH가 부담합니다" in r[1] and "거주자 부담 비용이 발생할 수 있습니다" in r[1]
    assert r[1].endswith("접수해 드릴까요?")
    assert r[2].startswith("접수되었습니다.") and "방문 일정을 문자로 안내" in r[2]
    assert s.state == State.DONE and s.outcome == "접수"

    t = db.get(Ticket, s.ticket_id)
    assert t.status == "접수" and t.payer_initial == "SH" and t.tenant_cost_possible
    assert t.item_id.startswith("1-9-")  # 개별보일러 항목
    assert t.error_code == "03" and t.error_meaning == "점화 불량"
    assert t.equipment.startswith("보일러 C사")
    assert "거주자 의사: 접수 희망" in t.summary and t.transcript[-1]["text"] == r[2]
    assert t.visit_at is None  # 방문 일정은 AI가 잡지 않는다


def test_decline_creates_no_ticket(db, now):
    s, r = talk(db, now, "101동 202호 보일러가 안 켜지고 에러 11이 깜빡거려요", "아니요, 안내만 들을게요")
    assert "101동 202호 확인되었습니다" in r[0] and "에러 11은 점화 불량" in r[0]  # 첫 발화에 증상까지
    assert s.state == State.DONE and s.outcome == "안내만" and s.ticket_id is None
    assert db.query(Ticket).count() == 0


def test_frozen_boiler_is_tenant_cost(db, now):
    s, r = talk(db, now, "103동 1502호요", "보일러가 얼어서 터졌어요", "네")
    assert s.liability["payer"] == "거주자" and "동파" in s.liability["matched_cause"]
    assert db.get(Ticket, s.ticket_id).payer_initial == "거주자"


def test_denied_cause_is_not_counted(db, now):
    s, _ = talk(db, now, "103동 1502호요", "동파는 아니고 그냥 갑자기 꺼졌어요 보일러가")
    assert s.liability["payer"] == "SH"


def test_move_in_within_one_month(db, now):
    """현관문차임벨 작동불량: 입주 후 1개월 이내 SH, 이후 거주자."""
    recent, _ = talk(db, now, "105동 1502호요", "초인종이 안 울려요")  # 시드: 입주 12일 전
    old, _ = talk(db, now, "103동 1204호요", "초인종이 안 울려요")
    assert recent.liability["payer"] == "SH" and "입주 1개월 이내" in recent.liability["reason"]
    assert old.liability["payer"] == "거주자"


def test_household_correction(db, now):
    s, r = talk(db, now, "103동 1204호", "아니요 1203호요", "싱크대 아래에서 물이 새요")
    assert r[1] == "103동 1203호로 확인했습니다. 어떤 문제가 있으신가요?"
    assert s.slots["ho"] == 1203 and s.state == State.CONFIRM


def test_household_denial_asks_again(db, now):
    s, r = talk(db, now, "103동 1204호", "아니요")
    assert s.state == State.HOUSEHOLD and "다시 말씀해" in r[1]


def test_short_answers(db, now):
    s, r = talk(db, now, "103동이요", "1204요")
    assert r[0] == "몇 호이신가요?" and s.state == State.SYMPTOM


def test_unknown_household(db, now):
    s, r = talk(db, now, "109동 202호요")
    assert "등록되지 않은 세대" in r[0] and s.state == State.HOUSEHOLD


def test_repeated_failure_goes_to_staff(db, now):
    s, r = talk(db, now, "103동 1204호", "음", "고양이가 아파요")
    assert s.state == State.HANDOFF and "담당 직원" in r[-1]
    t = db.get(Ticket, s.ticket_id)
    assert t.status == "직원 확인 필요" and t.review_reason == "인식 2회 연속 실패"


def test_public_facility_needs_staff_review(db, now):
    s, r = talk(db, now, "103동 1204호", "엘리베이터가 멈췄어요", "네 접수해 주세요")
    assert s.liability["payer"] == "직원 확인 필요"
    assert db.get(Ticket, s.ticket_id).status == "직원 확인 필요"


def test_emergency(db, now):
    s, r = talk(db, now, "가스 냄새가 나요")
    assert s.state == State.HANDOFF and "119" in r[0]
    assert db.get(Ticket, s.ticket_id).urgent


def test_unclear_confirm_answer_asks_again(db, now):
    s, r = talk(db, now, "103동 1204호", "보일러가 안 켜져요", "음")
    assert s.state == State.CONFIRM and "'네'" in r[-1]


def test_no_notification_until_staff_schedules(db, now):
    talk(db, now, "103동 1204호", "보일러가 안 켜져요", "네")
    assert db.query(Notification).count() == 0
