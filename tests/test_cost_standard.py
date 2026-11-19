"""수선유지 기준(knowledge/cost_standard) 검색·판정 테스트."""
from datetime import date

from backend.knowledge import cost_standard as cs

TODAY = date(2026, 11, 19)


def decide(text, move_in=None):
    return cs.decide_liability(cs.best_item(text), [text], move_in, TODAY)


def test_data_loaded():
    assert len(cs.load_items()) == 457
    assert "P09" in cs.load_principles()


def test_search_finds_component_items():
    assert cs.best_item("보일러가 안 켜져요")["id"].startswith("1-9-")
    assert cs.best_item("싱크대 아래에서 물이 새요")["id"] == "1-3-08"
    assert cs.best_item("현관 도어락이 안 열려요")["id"] == "1-2-01"
    assert cs.best_item("고양이가 아파요") is None


def test_landlord_default_with_tenant_caveat():
    d = decide("보일러가 안 켜져요")
    assert d["payer"] == "SH" and d["tenant_cost_possible"]
    assert "파손" in d["caveat_causes"] and "동파" in d["caveat_causes"]


def test_tenant_fault_from_utterance():
    assert decide("보일러가 얼어서 터졌어요")["payer"] == "거주자"
    d = decide("아이가 놀다가 방문 손잡이를 부러뜨렸어요")
    assert d["payer"] == "거주자" and d["principles"] == ["P09"]


def test_denied_fault_is_ignored():
    assert decide("동파는 아니고 그냥 갑자기 꺼졌어요 보일러가")["payer"] == "SH"
    assert decide("도어락이 안 열려요")["payer"] == "SH"  # '안 열려요'는 부정이 아니라 증상


def test_move_in_timing():
    assert decide("초인종이 안 울려요", move_in=date(2026, 11, 5))["payer"] == "SH"
    assert decide("초인종이 안 울려요", move_in=date(2020, 3, 1))["payer"] == "거주자"


def test_unclear_and_public():
    assert decide("차단기가 자꾸 내려가요")["payer"] == "점검 후 결정"
    assert decide("엘리베이터가 멈췄어요")["payer"] == "직원 확인 필요"
    assert decide("고양이가 아파요")["needs_review"]


def test_label_keeps_meaningful_parentheses():
    assert cs.item_label(cs.load_items()["1-9-05"]) == "개별보일러 열교환기(온수)"
    assert cs.item_label(cs.load_items()["1-1-20"]) == "방문 손잡이"
