"""
직접 키보드로 챗봇과 대화하며 대화 엔진을 테스트할 수 있는 대화형 CLI 도구
실행 방법: python -m backend.dialogue.cli
"""
import sys
from backend.dialogue.orchestrator import DialogueOrchestrator
from backend.dialogue.state import DialogueState
from backend.dialogue.llm_client import load_api_key, save_api_key


def run_interactive_cli():
    print("=" * 65)
    print("  [HomeCareOn] AI 음성 민원 접수 대화 오케스트레이터 테스트 CLI")
    print("  종료하려면 'exit' 또는 'q'를 입력하세요.")
    print("=" * 65)

    # 1. API 키 확인 및 없을 경우 대화형 입력 지원
    current_key = load_api_key()
    if not current_key:
        print("\n  [Gemini API 키 안내]")
        print("  현재 저장된 Gemini API 키가 없습니다.")
        print("  - 팀원에게 전달받은 키(또는 본인 키)를 입력하시면 .env 파일에 자동 저장됩니다.")
        print("  - 키 없이 실행하시려면 그냥 [Enter]를 누르세요. (기본 룰베이스 모드로 실행)")
        print("-" * 65)
        user_input_key = input("  Gemini API 키 입력: ").strip()
        if user_input_key:
            save_api_key(user_input_key)
            print("  ✓ API 키가 로컬에 안전하게 저장되었습니다! AI 모드로 시작합니다.\n")
        else:
            print("  ✓ 키 입력 없이 기본 룰베이스(규칙) 모드로 시작합니다.\n")

    orc = DialogueOrchestrator(use_llm=True)
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
            print(f"  - 고객명: {summary.get('resident_name')} (본인확인: {summary.get('is_resident_verified')})")
            print(f"  - 설비 분류: {summary.get('device_category')}")
            print(f"  - 증상 내용: {summary.get('symptom')}")
            print(f"  - 경위/부주의: {summary.get('cause_detail')}")
            print(f"  - 비용 판정: {summary.get('liability_party')}")
            print(f"  - 판정 근거: {summary.get('liability_reason')}")
            if summary.get('ticket_id'):
                print(f"  - 발행 티켓: {summary.get('ticket_id')}")
            print("-" * 50)
            break


if __name__ == "__main__":
    run_interactive_cli()
