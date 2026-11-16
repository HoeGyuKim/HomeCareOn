"""
직접 키보드로 챗봇과 대화하며 대화 엔진을 테스트할 수 있는 대화형 CLI 도구
실행 방법: python -m backend.dialogue.cli
"""
import sys
from backend.dialogue.orchestrator import DialogueOrchestrator
from backend.dialogue.state import DialogueState


def run_interactive_cli():
    print("=" * 60)
    print("  [HomeCareOn] AI 음성 민원 접수 대화 오케스트레이터 테스트 CLI")
    print("  종료하려면 'exit' 또는 'q'를 입력하세요.")
    print("=" * 60)

    orc = DialogueOrchestrator()
    first_reply = orc.start_call()
    print(f"\n[AI 상담원] {first_reply}")

    while True:
        try:
            user_input = input("\n[거주자] ").strip()
        except (KeyboardInterrupt, EOFError):
            print("\n통화를 종료합니다.")
            break

        if not user_input:
            continue

        if user_input.lower() in ["exit", "q", "quit", "종료"]:
            print("\n테스트를 종료합니다.")
            break

        reply = orc.handle_utterance(user_input)
        print(f"\n[AI 상담원] {reply}")

        # 통화가 끝난 경우 세션 요약 출력
        if orc.state in [DialogueState.TICKET_ISSUED, DialogueState.CLOSED]:
            print("\n" + "-" * 50)
            print("  📋 [통화 세션 종료 데이터]")
            summary = orc.get_summary()["session"]
            print(f"  - 세대: {summary.get('building')} {summary.get('unit')}")
            print(f"  - 고객명: {summary.get('resident_name')} ({summary.get('phone')})")
            print(f"  - 설비 모델: {summary.get('device_model')}")
            print(f"  - 증상/에러: {summary.get('symptom')} (코드: {summary.get('error_code')})")
            print(f"  - 비용 판정: {summary.get('liability_party')}")
            print(f"  - 판정 근거: {summary.get('liability_reason')}")
            if summary.get('ticket_id'):
                print(f"  - 발행 티켓: {summary.get('ticket_id')}")
            print("-" * 50)
            break


if __name__ == "__main__":
    run_interactive_cli()
