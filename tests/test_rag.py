"""수선유지 RAG 시나리오 테스트: 검색(어떤 항목인가)과 판정(누가 내는가).

새 시나리오는 CASES에 한 줄씩 추가한다. 검색이 틀리면 knowledge/cost_standard/aliases.csv에
거주자 표현을 추가하고, 판정이 틀리면 backend/rag/causes.py 의 원인 패턴을 고친다.
"""
from datetime import date

import pytest

from backend.rag import MGMT_FEE, SH_REPAIR, SITE_CHECK, TENANT_PAY, decide, defect_type_of, search_policy

TODAY = date(2026, 11, 24)
OLD = "2021-04-10"      # 입주 5년 차
NEW = "2026-11-10"      # 입주 2주 차

# (증상, 경위, 입주일, 기대 항목 id, 기대 판정)
CASES = [
    ("보일러에서 온수가 안 나와요", "어제부터 그랬고 충격 주거나 만진 적은 없어요", OLD, "1-9-11", SH_REPAIR),
    ("보일러가 안 돼요", "추워서 얼어버린 것 같아요", OLD, "1-9-11", TENANT_PAY),
    ("보일러 난방이 안 돼요", "잘 모르겠어요", OLD, "1-9-11", SH_REPAIR),
    ("욕실 천장에서 물이 새요", "위층에서 새는 것 같아요", OLD, "1-4-04", SH_REPAIR),
    ("변기가 막혔어요", "휴지를 많이 넣었어요", OLD, "1-4-23", TENANT_PAY),
    ("세면대 물이 안 내려가요", "머리카락이 걸린 것 같아요", OLD, "1-4-15", TENANT_PAY),
    # 부주의 표현이 있어도 표에 있는 원인(막힘)으로 먼저 판정해야 한다
    ("세면대 물이 안 빠져요", "실수로 뭘 빠뜨렸어요", OLD, "1-4-15", TENANT_PAY),
    ("세면대 배수구가 막혔어요", "아이가 장난감을 넣었어요", OLD, "1-4-15", TENANT_PAY),
    # 손모(사용 중 닳음)는 양쪽 칸에 있지만 노후는 임대인 칸에만 있다
    ("세면대 밑 배수관에서 물이 새요", "오래돼서 그런 것 같아요", OLD, "1-4-15", SH_REPAIR),
    ("현관 도어록이 안 열려요", "건전지 갈아도 안 돼요", OLD, "1-2-01", SH_REPAIR),
    ("현관 열쇠 도어록이 고장났어요", "그냥 갑자기 안 돼요", NEW, "1-2-06", SH_REPAIR),
    ("현관 열쇠 도어록이 고장났어요", "그냥 갑자기 안 돼요", OLD, "1-2-06", TENANT_PAY),
    ("창문 유리가 깨졌어요", "애가 공 던져서 깨졌어요", OLD, "1-1-10", TENANT_PAY),
    ("창문 유리에 금이 갔어요", "오래돼서 저절로 금이 갔어요", OLD, "1-1-10", SH_REPAIR),
    ("창문 잠금장치가 고장났어요", "오래돼서 헐거워요", OLD, "1-1-12", SH_REPAIR),
    ("방충망이 찢어졌어요", "고양이가 긁었어요", OLD, "1-1-09", TENANT_PAY),
    ("싱크대 수도꼭지에서 물이 새요", "오래 써서 그런지 계속 새요", OLD, "1-3-07", SH_REPAIR),
    ("렌지후드가 안 돌아가요", "갑자기 멈췄어요", OLD, "1-3-17", SH_REPAIR),
    ("가스레인지 불이 안 켜져요", "오래돼서 그런 것 같아요", OLD, "1-3-21", SH_REPAIR),
    ("에어컨이 안 돼요", "가스가 빠진 것 같아요", OLD, "1-8-11", TENANT_PAY),
    # 욕실 배기팬 작동불량은 부품 단종일 때만 SH, 그 외 작동불량은 거주자 → 점검 후 결정
    ("환풍기가 안 돌아요", "소리만 나고 안 돌아요", OLD, "1-4-29", SITE_CHECK),
    ("환풍기가 안 돌아요", "오래돼서 그런 것 같아요", OLD, "1-4-29", SH_REPAIR),
    ("인터폰이 안 돼요", "화면이 안 켜져요", OLD, "1-7-13", SH_REPAIR),
    ("베란다 배수구가 막혔어요", "물이 안 빠져요", OLD, "1-5-05", TENANT_PAY),
    ("벽지에 곰팡이가 생겼어요", "결로 때문인 것 같아요", OLD, "1-1-02", SITE_CHECK),
    ("베란다 창문이 깨졌어요", "태풍 때 깨졌어요", OLD, "1-1-08", SH_REPAIR),
    ("엘리베이터가 멈췄어요", "", OLD, "3-8-27", SH_REPAIR),
    ("복도 전등이 나갔어요", "", OLD, "4-1-01", MGMT_FEE),
]


@pytest.mark.parametrize("symptom,cause,move_in,item_id,verdict", CASES, ids=[c[0] + "/" + c[1] for c in CASES])
def test_search_and_decide(symptom, cause, move_in, item_id, verdict):
    cands = search_policy(symptom)
    assert cands, "후보 없음"
    assert cands[0]["id"] == item_id, f"검색 1순위 {cands[0]}"
    d = decide(item_id, cause, symptom, move_in, today=TODAY)
    assert d.verdict == verdict, d.explanation
    assert d.basis.startswith("[별표2]")
    assert d.explanation


def test_explanation_reads_both_columns_of_table():
    """안내 문장은 항상 기준표의 임대인·임차인 칸을 함께 읽어 준다."""
    d = decide("1-4-15", "실수로 뭘 빠뜨렸어요", "세면대 물이 안 빠져요", OLD, today=TODAY)
    assert d.decided_by == "막힘"
    assert "기준표상" in d.explanation
    assert "노후" in d.explanation and "막힘" in d.explanation   # 임대인 칸, 임차인 칸
    d = decide("1-4-15", "망치로 쳐서 깨뜨렸어요", "세면대 배수관이 깨졌어요", OLD, today=TODAY)
    assert d.verdict == TENANT_PAY and "P09" in d.principles   # 표에 '파손' 칸이 없으면 제2장 원칙
    assert "기준표상" in d.explanation


def test_unknown_facility_returns_nothing():
    assert search_policy("안녕하세요 그냥 전화했어요") == []


def test_negated_carelessness_is_not_damage():
    d = decide("1-9-11", "떨어뜨린 적 없고 그냥 안 돼요", "보일러가 안 돼요", OLD, today=TODAY)
    assert d.verdict == SH_REPAIR


def test_unknown_cause_is_site_check():
    d = decide("1-1-13", "", "", OLD, today=TODAY)
    assert d.verdict == SITE_CHECK


def test_defect_type_mapping():
    assert defect_type_of("1-9-11") == "HVAC"
    assert defect_type_of("1-4-23") == "LEAK_PIPE"
    assert defect_type_of("1-7-04") == "ELECTRIC"
    assert defect_type_of("1-1-10") == "DOOR_WINDOW"
    assert defect_type_of("1-1-02") == "WALL_FLOOR"
    assert defect_type_of("3-8-27") == "COMMON"
