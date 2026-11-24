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
    assert orc.state == DialogueState.TICKET_ISSUED and s.ticket_id
    assert s.ticket_registered is False and s.ticket_error  # 웹 주소를 비웠으므로 로컬 번호


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
