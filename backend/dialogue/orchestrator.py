"""
HomeCareOn 대화 오케스트레이터(Dialogue Orchestrator) 핵심 모듈

설계 원칙 (README):
1. 대화 흐름은 상태머신(State Machine)이 엄격하게 통제한다.
2. 비용 부담 판정은 임의로 지어내지 않고, RAG/도구 API 결과를 근거로 안내한다.
3. 방문 일정 확정은 AI가 하지 않고, 티켓 생성 후 SH 직원에게 위임한다.
"""
from typing import Dict, Any, Tuple
import re

from .state import DialogueState, SessionData
from .korean_number import extract_dong_ho, extract_error_code
from .tools_mock import lookup_household, search_policy_and_decide, create_ticket


class DialogueOrchestrator:
    """
    민원 접수 통화 대화의 전 과정을 지휘하는 오케스트레이터 클래스
    """

    def __init__(self):
        self.state = DialogueState.INIT
        self.session = SessionData()

    def start_call(self) -> str:
        """통화 연결 시 첫 안내 멘트를 출력합니다."""
        self.state = DialogueState.ASK_DONG_HO
        welcome_msg = "안녕하세요, SH 시설물 접수센터입니다. 거주하고 계신 동과 호수를 말씀해 주세요."
        self._record_history("Assistant", welcome_msg)
        return welcome_msg

    def handle_utterance(self, user_text: str) -> str:
        """거주자의 음성 텍스트를 받아 현재 상태에 맞는 로직을 실행하고 답변을 반환합니다."""
        user_text = user_text.strip()
        self._record_history("User", user_text)

        # 1. 종료 상태인 경우
        if self.state in [DialogueState.TICKET_ISSUED, DialogueState.CLOSED]:
            return "이미 민원 접수 처리가 완료된 통화입니다. 추가 문의가 있으시면 새로 전화해 주세요."

        # 2. 동·호수 질문 상태
        if self.state == DialogueState.ASK_DONG_HO:
            return self._handle_ask_dong_ho(user_text)

        # 3. 증상 및 에러코드 질문 상태
        elif self.state == DialogueState.ASK_SYMPTOM:
            return self._handle_ask_symptom(user_text)

        # 4. 접수 진행 여부 확인 상태
        elif self.state == DialogueState.CONFIRM_RECEIPT:
            return self._handle_confirm_receipt(user_text)

        return "말씀을 잘 이해하지 못했습니다. 다시 한번 말씀해 주시겠어요?"

    def _handle_ask_dong_ho(self, user_text: str) -> str:
        """동과 호수 추출 및 세대 DB 조회 처리"""
        dong, ho = extract_dong_ho(user_text)

        # 기존 세션에 이미 동이나 호가 저장되어 있는 경우 보완
        if dong:
            self.session.building = dong
        if ho:
            self.session.unit = ho

        # 동과 호수 둘 다 파악된 경우 -> 세대 DB 조회 후 다음 단계
        if self.session.building and self.session.unit:
            # [도구 API 호출] C 파트 세대 정보 조회
            household_info = lookup_household(self.session.building, self.session.unit)
            self.session.resident_name = household_info.get("resident_name")
            self.session.phone = household_info.get("phone")
            self.session.move_in_date = household_info.get("move_in_date")

            self.state = DialogueState.ASK_SYMPTOM
            reply = (
                f"{self.session.building} {self.session.unit} 맞으시죠? "
                "어떤 시설물에 문제가 있으신가요? "
                "고장 증상이나 계기판에 표시된 에러코드를 말씀해 주세요."
            )
            self._record_history("Assistant", reply)
            return reply

        # 하나만 파악된 경우 추가 질문
        if self.session.building and not self.session.unit:
            reply = f"{self.session.building} 몇 호에 거주하시나요?"
            self._record_history("Assistant", reply)
            return reply

        if not self.session.building and self.session.unit:
            reply = f"{self.session.unit} 거주 중이시군요. 몇 동이신가요?"
            self._record_history("Assistant", reply)
            return reply

        # 둘 다 모르는 경우
        reply = "정확한 동과 호수를 말씀해 주시겠어요? (예: 103동 1204호)"
        self._record_history("Assistant", reply)
        return reply

    def _handle_ask_symptom(self, user_text: str) -> str:
        """고장 증상 파악 및 RAG 비용 판정 질의"""
        self.session.symptom = user_text
        self.session.error_code = extract_error_code(user_text)

        # 설비 카테고리 간이 추정 (추후 LLM 슬롯 필링과 연계)
        if "보일러" in user_text or "온수" in user_text:
            self.session.device_category = "개별보일러"
            self.session.device_model = "경동나비엔 NCB353-20K"
        elif "후드" in user_text or "환풍기" in user_text:
            self.session.device_category = "렌지후드"
            self.session.device_model = "하츠 RHD-60"
        else:
            self.session.device_category = "기타 전용설비"

        # [도구 API 호출] B 파트 수선유지 RAG 비용 판정 질의
        policy_result = search_policy_and_decide(
            device_category=self.session.device_category,
            symptom=self.session.symptom,
            error_code=self.session.error_code,
            move_in_date=self.session.move_in_date
        )

        self.session.liability_party = policy_result["liability_party"]
        self.session.liability_reason = policy_result["basis_text"]
        self.session.resident_cost_possible = policy_result["resident_cost_possible"]

        self.state = DialogueState.CONFIRM_RECEIPT
        explanation = policy_result["explanation"]
        reply = f"{explanation}\n점검 기사님 방문 접수를 진행해 드릴까요?"
        self._record_history("Assistant", reply)
        return reply

    def _handle_confirm_receipt(self, user_text: str) -> str:
        """접수 진행 여부 확인 및 최종 티켓 발행"""
        yes_keywords = ["네", "예", "응", "어", "접수", "해주세요", "부탁", "진행", "해줘", "맞아"]
        no_keywords = ["아니", "안해", "괜찮", "취소", "내가", "직접"]

        # 긍정 응답인 경우: 티켓 생성
        if any(k in user_text for k in yes_keywords):
            # [도구 API 호출] C 파트 관리자 티켓 생성
            ticket_res = create_ticket(self.session.model_dump())
            self.session.ticket_id = ticket_res["ticket_id"]
            self.session.call_summary = f"{self.session.building} {self.session.unit} {self.session.device_category} 고장({self.session.symptom}) 접수"

            self.state = DialogueState.TICKET_ISSUED
            reply = (
                f"접수가 정상적으로 완료되었습니다. (티켓번호: {self.session.ticket_id})\n"
                "담당 직원이 접수 내용을 확인한 후, 방문 일정을 문자로 안내해 드리겠습니다. "
                "감사합니다."
            )
            self._record_history("Assistant", reply)
            return reply

        # 부정 응답인 경우: 단순 안내로 종료
        elif any(k in user_text for k in no_keywords):
            self.state = DialogueState.CLOSED
            reply = "접수를 취소하였습니다. 추가로 도움이 필요하시면 언제든 다시 연락해 주세요. 좋은 하루 되세요."
            self._record_history("Assistant", reply)
            return reply

        # 모호한 응답인 경우 재확인
        reply = "기사님 방문 점검 접수를 진행해 드릴까요? (네 또는 아니요로 말씀해 주세요)"
        self._record_history("Assistant", reply)
        return reply

    def _record_history(self, speaker: str, text: str):
        """대화 히스토리에 발화 기록"""
        self.session.history.append({"speaker": speaker, "text": text})

    def get_summary(self) -> Dict[str, Any]:
        """현재 통화 세션의 최종 데이터를 반환합니다."""
        return {
            "state": self.state.value,
            "session": self.session.model_dump()
        }
