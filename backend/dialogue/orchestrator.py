"""
HomeCareOn 대화 오케스트레이터(Dialogue Orchestrator) 핵심 모듈 (LLM 연동 버전)

설계 원칙 (README):
1. 대화 흐름은 상태머신(State Machine)이 엄격하게 통제한다.
2. 자연어 이해와 자연스러운 응대는 최신 Gemini LLM이 담당한다.
3. 비용 부담 판정은 임의로 지어내지 않고, RAG/도구 API 결과를 근거로 안내한다.
4. 방문 일정 확정은 AI가 하지 않고, 티켓 생성 후 SH 직원에게 위임한다.
5. 네트워크 장애나 API 지연 시에도 규칙 기반 템플릿으로 안전하게 폴백(Fallback)한다.
"""
from typing import Dict, Any, Optional
import json

from .state import DialogueState, SessionData
from .korean_number import extract_dong_ho, extract_error_code
from .tools_mock import lookup_household, search_policy_and_decide, create_ticket
from .llm_client import GeminiClient


class DialogueOrchestrator:
    """
    민원 접수 통화 대화의 전 과정을 지휘하는 오케스트레이터 클래스 (LLM 하이브리드)
    """

    def __init__(self, use_llm: bool = True):
        self.state = DialogueState.INIT
        self.session = SessionData()
        self.use_llm = use_llm
        self.llm = GeminiClient() if use_llm else None

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

        # 2. LLM을 통한 지능형 정보 추출 (사용 가능한 경우)
        nlu_result = {}
        if self.use_llm and self.llm:
            nlu_result = self.llm.extract_information(
                state=self.state.value,
                user_utterance=user_text,
                current_session=self.session.model_dump(exclude={"history"})
            )

        # 3. 상태별 처리 진행
        if self.state == DialogueState.ASK_DONG_HO:
            return self._handle_ask_dong_ho(user_text, nlu_result)

        elif self.state == DialogueState.ASK_SYMPTOM:
            return self._handle_ask_symptom(user_text, nlu_result)

        elif self.state == DialogueState.CONFIRM_RECEIPT:
            return self._handle_confirm_receipt(user_text, nlu_result)

        return "말씀을 잘 이해하지 못했습니다. 다시 한번 말씀해 주시겠어요?"

    def _handle_ask_dong_ho(self, user_text: str, nlu_result: Dict[str, Any]) -> str:
        """동과 호수 추출 및 세대 DB 조회 처리"""
        # LLM 추출 결과 우선 확인
        dong = nlu_result.get("dong")
        ho = nlu_result.get("ho")

        # LLM이 못 찾았거나 미사용 시 규칙 기반(한글 수사 변환기) 폴백
        rule_dong, rule_ho = extract_dong_ho(user_text)
        dong = dong or rule_dong
        ho = ho or rule_ho

        if dong:
            self.session.building = dong
        if ho:
            self.session.unit = ho

        # 동과 호수가 모두 확보된 경우 -> 세대 DB 조회
        if self.session.building and self.session.unit:
            household_info = lookup_household(self.session.building, self.session.unit)
            self.session.resident_name = household_info.get("resident_name")
            self.session.phone = household_info.get("phone")
            self.session.move_in_date = household_info.get("move_in_date")

            # 혹시 첫 발화에서 고장 증상도 함께 말한 경우 (복합 발화 처리)
            if nlu_result.get("symptom") or nlu_result.get("device"):
                # 바로 증상 처리 단계로 연계
                self.state = DialogueState.ASK_SYMPTOM
                return self._handle_ask_symptom(user_text, nlu_result)

            self.state = DialogueState.ASK_SYMPTOM
            fact_guidance = (
                f"{self.session.building} {self.session.unit} 확인됨. "
                "거주자에게 확인 인사 후, 어떤 시설물에 어떤 문제가 생겼는지 고장 증상과 에러코드를 편하게 말씀해 달라고 요청할 것."
            )
            
            # LLM을 통한 자연스러운 답변 생성
            reply = ""
            if self.use_llm and self.llm:
                reply = self.llm.generate_natural_reply(
                    state=self.state.value,
                    session=self.session.model_dump(exclude={"history"}),
                    fact_guidance=fact_guidance,
                    user_utterance=user_text
                )

            if not reply:
                reply = (
                    f"{self.session.building} {self.session.unit} 맞으시죠? "
                    "어떤 시설물에 문제가 있으신가요? 고장 증상이나 계기판에 표시된 에러코드를 말씀해 주세요."
                )

            self._record_history("Assistant", reply)
            return reply

        # 동만 있거나 호만 있는 경우
        if self.session.building and not self.session.unit:
            reply = f"{self.session.building} 몇 호에 거주하시나요?"
            self._record_history("Assistant", reply)
            return reply

        if not self.session.building and self.session.unit:
            reply = f"{self.session.unit} 거주 중이시군요. 몇 동이신가요?"
            self._record_history("Assistant", reply)
            return reply

        reply = "정확한 동과 호수를 말씀해 주시겠어요? (예: 103동 1204호)"
        self._record_history("Assistant", reply)
        return reply

    def _handle_ask_symptom(self, user_text: str, nlu_result: Dict[str, Any]) -> str:
        """고장 증상 파악 및 RAG 비용 판정 질의"""
        symptom = nlu_result.get("symptom") or user_text
        device = nlu_result.get("device")
        error_code = nlu_result.get("error_code") or extract_error_code(user_text)

        self.session.symptom = symptom
        self.session.error_code = error_code

        # 설비 분류 매칭
        if device and "보일러" in device or "보일러" in user_text or "온수" in user_text:
            self.session.device_category = "개별보일러"
            self.session.device_model = "경동나비엔 NCB353-20K"
        elif device and "후드" in device or "후드" in user_text:
            self.session.device_category = "렌지후드"
            self.session.device_model = "하츠 RHD-60"
        else:
            self.session.device_category = device or "기타 시설물"

        # [도구 API 호출] B 파트 수선유지 RAG 비용 판정
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

        fact_guidance = (
            f"거주자의 고장 증상: {self.session.symptom} (에러코드: {self.session.error_code or '없음'}). "
            f"수선유지 기준 판정 결과: {explanation} "
            "이 판정 결과를 거주자가 이해하기 쉽게 공감하며 설명하고, 기사님 방문 접수를 진행해 드릴지 정중히 물어볼 것."
        )

        reply = ""
        if self.use_llm and self.llm:
            reply = self.llm.generate_natural_reply(
                state=self.state.value,
                session=self.session.model_dump(exclude={"history"}),
                fact_guidance=fact_guidance,
                user_utterance=user_text
            )

        if not reply:
            reply = f"{explanation}\n점검 기사님 방문 접수를 진행해 드릴까요?"

        self._record_history("Assistant", reply)
        return reply

    def _handle_confirm_receipt(self, user_text: str, nlu_result: Dict[str, Any]) -> str:
        """접수 진행 여부 확인 및 최종 티켓 발행"""
        intent = nlu_result.get("intent", "unknown")

        yes_keywords = ["네", "예", "응", "어", "접수", "해주세요", "부탁", "진행", "해줘", "맞아", "신청"]
        no_keywords = ["아니", "안해", "괜찮", "취소", "내가", "직접"]

        is_affirmative = (intent == "affirmative") or any(k in user_text for k in yes_keywords)
        is_negative = (intent == "negative") or any(k in user_text for k in no_keywords)

        if is_affirmative:
            ticket_res = create_ticket(self.session.model_dump())
            self.session.ticket_id = ticket_res["ticket_id"]
            self.session.call_summary = f"{self.session.building} {self.session.unit} {self.session.device_category} 고장({self.session.symptom}) 접수"

            self.state = DialogueState.TICKET_ISSUED
            fact_guidance = (
                f"접수 완료됨. 티켓번호: {self.session.ticket_id}. "
                "담당 직원이 확인한 후 방문 일정을 문자로 안내해 드릴 예정임을 정중하고 감사하게 안내할 것. "
                "방문 일정 날짜를 임의로 정해주지 말 것."
            )

            reply = ""
            if self.use_llm and self.llm:
                reply = self.llm.generate_natural_reply(
                    state=self.state.value,
                    session=self.session.model_dump(exclude={"history"}),
                    fact_guidance=fact_guidance,
                    user_utterance=user_text
                )

            if not reply:
                reply = (
                    f"접수가 정상적으로 완료되었습니다. (티켓번호: {self.session.ticket_id})\n"
                    "담당 직원이 접수 내용을 확인한 후, 방문 일정을 문자로 안내해 드리겠습니다. 감사합니다."
                )

            self._record_history("Assistant", reply)
            return reply

        elif is_negative:
            self.state = DialogueState.CLOSED
            reply = "접수를 취소하였습니다. 추가로 도움이 필요하시면 언제든 다시 연락해 주세요. 좋은 하루 되세요."
            self._record_history("Assistant", reply)
            return reply

        reply = "기사님 방문 점검 접수를 진행해 드릴까요? (네 또는 아니요로 말씀해 주세요)"
        self._record_history("Assistant", reply)
        return reply

    def _record_history(self, speaker: str, text: str):
        self.session.history.append({"speaker": speaker, "text": text})

    def get_summary(self) -> Dict[str, Any]:
        return {
            "state": self.state.value,
            "session": self.session.model_dump()
        }
