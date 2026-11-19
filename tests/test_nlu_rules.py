from backend.engine.korean_numbers import normalize_korean_numbers, parse_code, parse_sino_korean
from backend.engine.nlu_rules import confirm_intent, extract, normalize_error_code


def test_parse_sino_korean():
    assert parse_sino_korean("백삼") == 103
    assert parse_sino_korean("천이백사") == 1204
    assert parse_sino_korean("이공이") == 202


def test_normalize_with_spaces_and_ordinary_words():
    assert normalize_korean_numbers("백삼 동 천이백사 호요") == "103동 1204호요"
    assert normalize_korean_numbers("위치 이동") == "위치 이동"  # 이동(移動)은 그대로
    assert normalize_korean_numbers("세탁기 호스") == "세탁기 호스"


def test_error_code_keeps_leading_zero():
    assert parse_code("공삼") == "03"
    assert extract("보일러에 에러 공삼이 뜨고 온수가 안 나와요", None)["error_code"] == "03"
    assert extract("에러코드 11 떠요", None)["error_code"] == "11"
    assert extract("E03 표시", None)["error_code"] == "03"
    assert extract("에러가 이상해요", None).get("error_code") is None
    assert normalize_error_code("Er 03") == "03"


def test_extract_address_and_symptom():
    got = extract("101동 202호 보일러가 안 켜지고 에러 11이 깜빡거려요", "dong_ho")
    assert (got["dong"], got["ho"], got["facility"], got["error_code"]) == (101, 202, "보일러", "11")
    assert extract("1204요", "ho") == {"ho": 1204}


def test_confirm_intent():
    assert confirm_intent("네, 접수해 주세요") == "yes"
    assert confirm_intent("네") == "yes"
    assert confirm_intent("아니요, 안내만 들을게요") == "no"
    assert confirm_intent("접수 안 할게요") == "no"
    assert confirm_intent("음") is None
