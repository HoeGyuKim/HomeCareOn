"""대화 엔진 + 수선유지 RAG 통합 시나리오 (LLM 없이 규칙 모드, 관리자 웹 등록 없이)."""
import pytest

from backend.dialogue import tools
from backend.dialogue.orchestrator import DialogueOrchestrator
from backend.dialogue.state import DialogueState


@pytest.fixture(autouse=True)
def no_web(monkeypatch):
    monkeypatch.setattr(tools, "WEB_URL", "")


def talk(*lines):
    orc = DialogueOrchestrator(use_llm=False)
    replies = [orc.start_call()]
    for line in lines:
        replies.append(orc.handle_utterance(line))
    return orc, replies


def test_boiler_aging_is_sh_and_ticket_issued():
    orc, replies = talk(
        "103동 1204호 홍길동입니다.",
        "보일러에서 온수가 갑자기 안 나와서요.",
        "어제 저녁부터 그랬고요, 충격 주거나 만진 적은 없고 그냥 갑자기 안 나와요.",
        "네, 방문 접수해 주세요.",
    )
    s = orc.session
    assert s.is_resident_verified and s.resident_name == "홍길동"
    assert s.apartment_name == "한빛센트럴"
    assert s.facility_item_id == "1-9-11"
    assert s.defect_type == "HVAC"
    assert s.liability_verdict == "SH_REPAIR"
    assert "SH 부담" in replies[3]
    # 웹 주소를 비웠으므로 문자를 못 보내고 임시 접수번호로 끝난다
    assert orc.state == DialogueState.TICKET_ISSUED and s.ticket_id and s.ticket_error
    assert "임시 접수번호" in replies[4]


def test_name_in_separate_turn():
    orc, replies = talk("백삼 동 천이백사 호요", "홍길동이요")
    assert orc.session.building == "103동" and orc.session.unit == "1204호"
    assert orc.state == DialogueState.ASK_FACILITY


def test_damage_is_tenant_and_decline_closes_call():
    orc, replies = talk(
        "103동 1204호 홍길동입니다",
        "창문 유리가 깨졌어요",
        "애가 공 던지다가 깨뜨렸어요",
        "아니요, 제가 직접 고칠게요",
    )
    assert orc.session.liability_verdict == "TENANT_PAY"
    assert "거주자 부담" in replies[3]
    assert orc.state == DialogueState.CLOSED
    assert orc.session.ticket_id is None


def test_unknown_facility_asks_again():
    orc, replies = talk("103동 1204호 홍길동입니다", "그냥 좀 이상해서 전화했어요")
    assert orc.state == DialogueState.ASK_FACILITY
    assert "시설물" in replies[2]
    orc.handle_utterance("변기가 막혔어요")
    assert orc.state == DialogueState.PROBE_CAUSE
    assert orc.session.facility_item_id == "1-4-23"


def test_recent_move_in_malfunction_is_sh():
    orc, replies = talk(
        "105동 1501호 김민수입니다",
        "현관 열쇠 도어록이 고장났어요",
        "그냥 갑자기 안 돼요",
    )
    assert orc.session.liability_verdict == "SH_REPAIR"


def test_consent_sends_schedule_link_and_ends(monkeypatch):
    """접수 동의 → 관리자 웹에 접수 대기 생성 + 희망일 링크 문자 → 고정 문장으로 통화 종료."""
    sent = {}

    def fake_request(session):
        sent["payload"] = session
        return {"sent": True, "token": "tok123", "link": "http://web/s/tok123",
                "sms_text": "[SH 시설물 접수] ...", "sms_to": session["phone"]}

    monkeypatch.setattr("backend.dialogue.orchestrator.request_schedule", fake_request)
    orc, replies = talk(
        "103동 1204호 홍길동입니다",
        "세면대 밑 배관에서 물이 새요",
        "오래돼서 그런 것 같아요",
        "네 진행해 주세요",
    )
    s = orc.session
    assert orc.state == DialogueState.SCHEDULE_SENT
    assert s.schedule_link == "http://web/s/tok123" and s.sms_to == "010-5678-1234"
    assert "010-****-1234" in replies[4] and "최대 3개" in replies[4] and "접수가 완료" in replies[4]
    assert not replies[4].rstrip().endswith("?")          # 통화를 끝내는 문장 (다시 묻지 않음)
    assert "보내드린 문자" in orc.handle_utterance("네?")   # 종료 후 말을 걸어도 링크 안내만


# ── Gemini 호출 줄이기: 규칙으로 충분하면 LLM 정보 추출·후보 선택을 건너뛴다 ──

class CountingLLM:
    """Gemini 대신 호출 횟수만 세는 가짜 LLM (응답은 비워서 규칙 문장이 쓰이게 함)."""

    def __init__(self):
        self.calls = {"extract": 0, "choose": 0, "reply": 0}

    def extract_information(self, **kw):
        self.calls["extract"] += 1
        return {}

    def choose_facility(self, *a, **kw):
        self.calls["choose"] += 1
        return None

    def generate_natural_reply(self, **kw):
        self.calls["reply"] += 1
        return ""


def llm_orc():
    orc = DialogueOrchestrator(use_llm=False)
    orc.use_llm, orc.llm = True, CountingLLM()
    orc.start_call()
    return orc


def test_identify_skips_extraction_when_rules_find_everything():
    orc = llm_orc()
    orc.handle_utterance("103동 1204호 홍길동입니다")
    assert orc.llm.calls["extract"] == 0 and orc.state == DialogueState.ASK_FACILITY


def test_identify_name_in_later_turn_skips_extraction():
    orc = llm_orc()
    orc.handle_utterance("103동 1204호요")       # 이름이 없으니 LLM 추출 1번
    assert orc.llm.calls["extract"] == 1
    orc.handle_utterance("홍길동이요")            # 이름을 규칙으로 찾았으니 건너뜀
    assert orc.llm.calls["extract"] == 1 and orc.state == DialogueState.ASK_FACILITY


def test_identify_uses_llm_when_rules_miss():
    orc = llm_orc()
    orc.handle_utterance("저 여기 백삼동 사는 사람인데요")
    assert orc.llm.calls["extract"] == 1


def test_probe_cause_never_extracts():
    orc = llm_orc()
    for t in ["103동 1204호 홍길동입니다", "보일러에서 온수가 안 나와요"]:
        orc.handle_utterance(t)
    before = orc.llm.calls["extract"]
    orc.handle_utterance("오래돼서 그런 것 같아요")
    assert orc.llm.calls["extract"] == before and orc.state == DialogueState.ADVISE_COST


def test_clear_candidate_skips_choose_facility():
    orc = llm_orc()
    orc.handle_utterance("103동 1204호 홍길동입니다")
    orc.handle_utterance("렌지후드가 안 돌아가요")   # 1순위 68.6 vs 2순위 28.6
    assert orc.llm.calls["choose"] == 0 and orc.session.facility_item_id == "1-3-17"


def test_ambiguous_candidate_asks_llm():
    orc = llm_orc()
    assert orc._is_ambiguous([{"score": 10.0}, {"score": 9.0}])
    assert not orc._is_ambiguous([{"score": 10.0}, {"score": 5.0}])


@pytest.mark.parametrize("text,intent", [
    ("네 진행해 주세요", "affirmative"),
    ("ㅇㅇ 진행해줘", "affirmative"),
    ("네", "affirmative"),
    ("아니요, 제가 직접 고칠게요", "negative"),
    ("아니요 접수는 안 할게요", "negative"),
    ("어떻게 해야 할지 모르겠네요", "unknown"),   # '네'가 말끝에 있어도 동의 아님
    ("비용이 얼마나 나올까요", "unknown"),
])
def test_rule_intent(text, intent):
    assert DialogueOrchestrator(use_llm=False)._rule_intent(text) == intent


def test_advise_cost_skips_extraction_when_answer_is_clear(monkeypatch):
    monkeypatch.setattr("backend.dialogue.orchestrator.request_schedule",
                        lambda s: {"sent": True, "token": "t", "link": "l", "sms_text": "x", "sms_to": s["phone"]})
    orc = llm_orc()
    for t in ["103동 1204호 홍길동입니다", "렌지후드가 안 돌아가요", "갑자기 멈췄어요"]:
        orc.handle_utterance(t)
    before = orc.llm.calls["extract"]
    orc.handle_utterance("네 진행해 주세요")
    assert orc.llm.calls["extract"] == before and orc.state == DialogueState.SCHEDULE_SENT


def test_advise_cost_uses_llm_when_answer_is_unclear():
    orc = llm_orc()
    for t in ["103동 1204호 홍길동입니다", "렌지후드가 안 돌아가요", "갑자기 멈췄어요"]:
        orc.handle_utterance(t)
    before = orc.llm.calls["extract"]
    orc.handle_utterance("음 글쎄요 생각 좀 해볼게요")   # 네/아니요도 질문도 아님 → LLM이 의도 판단
    assert orc.llm.calls["extract"] == before + 1 and orc.state == DialogueState.ADVISE_COST



# ── 접수 의사를 물었을 때 거주자가 되묻는 질문 ──

def to_advise(*lines):
    orc = DialogueOrchestrator(use_llm=False)
    orc.start_call()
    for t in ("103동 1204호 홍길동입니다", *lines):
        orc.handle_utterance(t)
    assert orc.state == DialogueState.ADVISE_COST
    return orc


def test_how_question_explains_inspection_and_asks_again(monkeypatch):
    called = []
    monkeypatch.setattr("backend.dialogue.orchestrator.request_schedule", lambda s: called.append(s))
    orc = to_advise("변기가 깨졌어요", "몰라 그냥 오늘 앉았는데 부셔졌어 몸무게는 120키로야")
    reply = orc.handle_utterance("파손인지 자연적 실크랙인지 어떻게 알아")
    assert "기사님이 방문해" in reply and "SH 담당 직원이 점검 결과를 검토" in reply
    assert "자연적 실크랙으로 확인되면 SH 부담" in reply and "파손, 깨짐으로 확인되면 거주자 부담" in reply
    assert reply.rstrip().endswith("진행해 드릴까요?")
    assert orc.state == DialogueState.ADVISE_COST and not called   # 질문은 접수 동의가 아님


def test_cost_question_when_sh_pays():
    orc = to_advise("보일러에서 온수가 안 나와요", "오래돼서 그런 것 같아요")
    reply = orc.handle_utterance("수리비는 얼마나 나와요?")
    assert "정확한 수리비는" in reply and "내실 비용은 없습니다" in reply


def test_schedule_question_even_with_yes_word(monkeypatch):
    called = []
    monkeypatch.setattr("backend.dialogue.orchestrator.request_schedule", lambda s: called.append(s))
    orc = to_advise("보일러에서 온수가 안 나와요", "오래돼서 그런 것 같아요")
    reply = orc.handle_utterance("네 근데 언제 와요?")
    assert "최대 3개" in reply and orc.state == DialogueState.ADVISE_COST and not called


def test_question_skips_llm_extraction():
    orc = llm_orc()
    for t in ["103동 1204호 홍길동입니다", "변기가 깨졌어요", "모르겠어요"]:
        orc.handle_utterance(t)
    before = dict(orc.llm.calls)
    reply = orc.handle_utterance("파손인지 실크랙인지 어떻게 알아요?")
    assert orc.llm.calls["extract"] == before["extract"]          # 질문 종류는 규칙으로 판별
    assert orc.llm.calls["reply"] == before["reply"] + 1           # 답변 문장만 LLM이 다듬음 (가짜 LLM은 빈 답 → 규칙 문장)
    assert "점검" in reply
