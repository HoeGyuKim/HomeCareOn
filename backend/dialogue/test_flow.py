"""
대화 오케스트레이터 개선 시나리오 시뮬레이션 테스트
"""
from backend.dialogue.orchestrator import DialogueOrchestrator


def test_improved_dialogue_scenario():
    print("\n=== [개선된 사용자 중심 민원 접수 시나리오 테스트] ===")
    orc = DialogueOrchestrator(use_llm=True)

    # 1. 통화 시작: 동·호수 및 계약자 성함 질문
    prompt = orc.start_call()
    print(f"AI: {prompt}\n")

    # 2. 고객 발화: 동·호수와 본인 성함 함께 전달
    user1 = "103동 1204호 홍길동입니다."
    print(f"거주자: {user1}")
    reply1 = orc.handle_utterance(user1)
    print(f"AI: {reply1}\n")

    # 3. 고객 발화: 에러코드 없이 일상적인 고장 설명
    user2 = "보일러에서 온수가 갑자기 안 나와서요."
    print(f"거주자: {user2}")
    reply2 = orc.handle_utterance(user2)
    print(f"AI: {reply2}\n")

    # 4. 고객 발화: 전화상 고장 경위/부주의 여부 답변
    user3 = "어제 저녁부터 그랬고요, 충격 주거나 만진 적은 없고 그냥 갑자기 안 나와요."
    print(f"거주자: {user3}")
    reply3 = orc.handle_utterance(user3)
    print(f"AI: {reply3}\n")

    # 5. 고객 발화: 방문 접수 동의
    user4 = "네, 방문 접수해 주세요."
    print(f"거주자: {user4}")
    reply4 = orc.handle_utterance(user4)
    print(f"AI: {reply4}\n")

    # 검증
    summary = orc.get_summary()
    session = summary["session"]
    print("=== [세션 검증 결과] ===")
    print(f"  ✓ 거주자 본인 확인: {session['resident_name']} (DB 일치: {session['is_resident_verified']})")
    print(f"  ✓ 대상 설비: {session['device_category']}")
    print(f"  ✓ 고장 경위: {session['cause_detail']}")
    print(f"  ✓ 판정 결과: {session['liability_party']}")
    print(f"  ✓ 발행 티켓: {session['ticket_id']}")
    assert session['is_resident_verified'] is True
    assert session['ticket_id'] is not None
    print("\n🎉 모든 개선 시나리오가 자연스럽게 성공했습니다!")


if __name__ == "__main__":
    test_improved_dialogue_scenario()
