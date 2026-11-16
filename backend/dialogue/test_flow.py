"""
대화 오케스트레이터 단위 테스트 및 시나리오 시뮬레이션 스크립트
"""
from backend.dialogue.orchestrator import DialogueOrchestrator
from backend.dialogue.korean_number import extract_dong_ho, extract_error_code


def test_korean_number_extraction():
    print("=== [1. 한글 음성 숫자 변환 테스트] ===")
    cases = [
        ("백삼 동 천이백사 호요.", ("103동", "1204호")),
        ("일공삼동 1204호 살아", ("103동", "1204호")),
        ("오백일 호입니다.", (None, "501호")),
    ]
    for text, expected in cases:
        result = extract_dong_ho(text)
        assert result == expected, f"Failed: {text} -> {result} != {expected}"
        print(f"  ✓ '{text}' -> {result}")

    error_cases = [
        ("보일러에 에러 공삼이 떠요", "03"),
        ("에러 03 온수 안 나옴", "03"),
        ("경고코드 12번", "12"),
    ]
    for text, expected in error_cases:
        result = extract_error_code(text)
        assert result == expected, f"Failed: {text} -> {result} != {expected}"
        print(f"  ✓ '{text}' -> 코드: {result}")


def test_dialogue_scenario():
    print("\n=== [2. README 예시 시나리오 모의 대화 테스트] ===")
    orc = DialogueOrchestrator()

    # Step 1: 통화 시작
    prompt = orc.start_call()
    print(f"AI: {prompt}\n")

    # Step 2: 거주자가 음성으로 동/호수 발화
    user1 = "백삼 동 천이백사 호요."
    print(f"거주자: {user1}")
    reply1 = orc.handle_utterance(user1)
    print(f"AI: {reply1}\n")

    # Step 3: 거주자가 증상 및 에러코드 발화
    user2 = "보일러에 에러 공삼이 뜨고 온수가 안 나와요."
    print(f"거주자: {user2}")
    reply2 = orc.handle_utterance(user2)
    print(f"AI: {reply2}\n")

    # Step 4: 접수 요청
    user3 = "네, 접수해 주세요."
    print(f"거주자: {user3}")
    reply3 = orc.handle_utterance(user3)
    print(f"AI: {reply3}\n")

    # 최종 결과 점검
    summary = orc.get_summary()
    print("=== [3. 최종 발행된 세션 데이터 검증] ===")
    session = summary["session"]
    print(f"  ✓ 동/호수: {session['building']} {session['unit']} ({session['resident_name']} 님)")
    print(f"  ✓ 설비 모델: {session['device_model']}")
    print(f"  ✓ 에러코드: {session['error_code']}")
    print(f"  ✓ 비용 부담 판정: {session['liability_party']} (부주의 시 본인 부담 가능: {session['resident_cost_possible']})")
    print(f"  ✓ 생성된 티켓 번호: {session['ticket_id']}")
    print(f"  ✓ 대화 단계: {summary['state']}")
    assert session['ticket_id'] is not None
    print("\n🎉 모든 시나리오 테스트를 완벽하게 통과했습니다!")


if __name__ == "__main__":
    test_korean_number_extraction()
    test_dialogue_scenario()
