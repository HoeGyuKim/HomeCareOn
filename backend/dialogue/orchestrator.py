"""
HomeCareOn 대화 오케스트레이터(Dialogue Orchestrator) 개선 모듈

반영된 설계 요구사항:
1. 동·호수뿐만 아니라 SH 등록 세대 DB와 계약자 성함 대조 확인
2. '에러코드' 같은 기술 용어 배제 ➔ "어떤 시설물에 문제가 있으신가요?"로 직관적 질문
3. 전화상으로 고장 경위 및 사용 부주의/동파 여부를 자연스럽게 사전 청취 후 비용 판정
4. 팩트 기반 비용 부담 안내 및 방문 접수 의사 확인 후 티켓 발행
"""
from typing import Dict, Any, Optional
import json
import re

from .state import DialogueState, SessionData
from .korean_number import extract_dong_ho, extract_error_code, extract_name
from .tools import lookup_household, search_facility, decide_cost, request_schedule, mask_phone, inspection_note
from .llm_client import GeminiClient


class DialogueOrchestrator:
    def __init__(self, use_llm: bool = True):
        self.state = DialogueState.INIT
        self.session = SessionData()
        self.use_llm = use_llm
        self.llm = GeminiClient() if use_llm else None

    def start_call(self) -> str:
        """통화 연결 시 첫 안내 멘트: 동·호수 및 계약자 성함 질문"""
        self.state = DialogueState.IDENTIFY_RESIDENT
        welcome_msg = "안녕하세요, SH 시설물 접수센터입니다. 거주하고 계신 동, 호수와 계약자분 성함을 말씀해 주세요."
        self._record_history("Assistant", welcome_msg)
        return welcome_msg

    def handle_utterance(self, user_text: str) -> str:
        """거주자의 음성 텍스트를 받아 단계별로 처리합니다."""
        user_text = user_text.strip()
        self._record_history("User", user_text)

        if self.state == DialogueState.SCHEDULE_SENT:
            return "보내드린 문자 속 링크에서 방문 희망 날짜를 골라 주시면 접수가 완료됩니다. 다른 문의가 있으시면 새로 전화해 주세요."
        if self.state in [DialogueState.TICKET_ISSUED, DialogueState.CLOSED]:
            return "이미 처리가 끝난 통화입니다. 추가 문의가 있으시면 새로 전화해 주세요."

        # 1. LLM 자연어 파싱 (엔티티 및 의도 추출) — 규칙으로 충분하면 건너뛰어 응답을 빠르게 한다
        nlu_result = {}
        if self.use_llm and self.llm and self._needs_llm_extraction(user_text):
            nlu_result = self.llm.extract_information(
                state=self.state.value,
                user_utterance=user_text,
                current_session=self.session.model_dump(exclude={"history"})
            )

        # 2. 상태별 핸들러 실행
        if self.state == DialogueState.IDENTIFY_RESIDENT:
            return self._handle_identify_resident(user_text, nlu_result)

        elif self.state == DialogueState.ASK_FACILITY:
            return self._handle_ask_facility(user_text, nlu_result)

        elif self.state == DialogueState.PROBE_CAUSE:
            return self._handle_probe_cause(user_text, nlu_result)

        elif self.state == DialogueState.ADVISE_COST:
            return self._handle_advise_cost(user_text, nlu_result)

        return "말씀을 잘 이해하지 못했습니다. 다시 한번 말씀해 주시겠어요?"

    # 접수 의사 표현 (규칙). '아니요, 접수는 안 할게요'처럼 거절 표현이 있으면 '접수'가 있어도 거절
    YES_KEYWORDS = ["접수", "해주세요", "해 주세요", "부탁", "진행", "해줘", "맞아", "신청", "좋아요", "그렇게 해"]
    # "네/예/응"은 '모르겠네요'처럼 말끝에도 나오므로 단독으로 쓰였을 때만 동의로 본다
    YES_SHORT = re.compile(r"(^|\s)(네|예|응|ㅇㅇ|넵|예예|네네)([\s,.!~]|$)")
    NO_KEYWORDS = ["아니", "안해", "안 해", "괜찮", "취소", "제가 직접", "직접 할", "직접 고칠", "됐어요", "필요 없"]

    def _rule_intent(self, user_text: str) -> str:
        """'affirmative' | 'negative' | 'unknown'"""
        if any(k in user_text for k in self.NO_KEYWORDS):
            return "negative"
        if self.YES_SHORT.search(user_text) or any(k in user_text for k in self.YES_KEYWORDS):
            return "affirmative"
        return "unknown"

    # 2순위 점수가 1순위의 이 비율 이상이면 '헷갈림'으로 보고 LLM에 고르게 한다.
    # 시험 문장들에서 확실한 경우는 2순위가 1순위의 0.4~0.75 정도였다.
    AMBIGUOUS_RATIO = 0.8

    def _is_ambiguous(self, candidates: list) -> bool:
        if len(candidates) < 2 or not candidates[0].get("score"):
            return False
        return candidates[1]["score"] / candidates[0]["score"] >= self.AMBIGUOUS_RATIO

    def _needs_llm_extraction(self, user_text: str) -> bool:
        """이번 발화에 LLM 정보 추출이 필요한지. Gemini 호출은 1~2초(혼잡하면 10초 이상)라 꼭 필요할 때만 부른다."""
        if self.state == DialogueState.IDENTIFY_RESIDENT:
            # 동·호수·이름을 규칙으로 (이번 발화 + 앞서 들은 것) 모두 얻었으면 불필요
            dong, ho = extract_dong_ho(user_text)
            s = self.session
            return not ((s.building or dong) and (s.unit or ho) and (s.resident_name or extract_name(user_text)))
        if self.state == DialogueState.PROBE_CAUSE:
            # 경위 단계는 발화 원문을 그대로 판정에 쓰므로 추출 결과를 쓰지 않는다
            return False
        if self.state == DialogueState.ADVISE_COST:
            # "네 / 아니요"가 분명하거나 질문임이 분명하면 불필요, 애매할 때만 LLM이 의도를 판단
            return self._question_kind(user_text) is None and self._rule_intent(user_text) == "unknown"
        return True  # ASK_FACILITY: 시설물·증상·에러코드 추출

    # 접수 의사를 물었는데 거주자가 되묻는 질문 (규칙으로 종류만 가린다)
    QUESTION_PATTERNS = [
        ("how", re.compile(
            r"어떻게\s?(알|판단|결정|구분|확인|정해|가려)|누가\s?(정|판단|결정|확인)|뭘로|무엇으로|"
            r"기준이\s?뭐|어떤\s?기준|확실(해|한가|하냐)|맞는지|억울|왜\s?(제가|내가|저한테|나한테)|제\s?(잘못|탓)|내\s?(잘못|탓)")),
        ("cost", re.compile(r"얼마|비용이|돈이|가격|금액|수리비|청구|내야")),
        ("schedule", re.compile(r"언제|며칠|몇\s?시|날짜|빨리|급(해|한)|당장")),
    ]

    def _question_kind(self, user_text: str) -> Optional[str]:
        for kind, pat in self.QUESTION_PATTERNS:
            if pat.search(user_text):
                return kind
        return None

    def _answer_question(self, kind: str, user_text: str) -> str:
        """거주자 질문에 대한 답. 원인·부담을 단정하지 않고 '방문 점검 + SH 직원 검토 후 결정'으로 안내한 뒤 접수 여부를 다시 묻는다."""
        note = inspection_note(self.session.facility_item_id, self.session.move_in_date)
        if kind == "cost":
            facts = ("정확한 수리비는 기사님이 방문해 원인과 수리 범위를 확인한 뒤 담당 직원이 안내해 드립니다. "
                     + ("지금 기준으로는 SH 부담이라, 점검 결과도 같다면 거주자분이 내실 비용은 없습니다. "
                        if self.session.liability_verdict == "SH_REPAIR" else "")
                     + note)
        elif kind == "schedule":
            facts = ("접수하시면 문자로 링크를 보내드리고, 그 링크에서 방문을 원하시는 날짜를 최대 3개까지 고르실 수 있습니다. "
                     "담당 직원이 그중 하루로 방문 일정을 확정해 다시 안내해 드립니다.")
        elif kind == "how":
            facts = note
        else:
            facts = "말씀하신 내용은 접수 내용에 함께 적어 담당 직원에게 전달하겠습니다. " + note
        ask = " 기사님 방문 점검 접수를 진행해 드릴까요?"

        guidance = (
            f"거주자가 방금 질문함. 아래 사실만으로 답할 것: {facts} "
            + ("'기사님 방문 점검 후 SH 담당 직원이 검토해 최종 결정한다'는 절차와, "
               "'점검에서 ~로 확인되면 SH 부담, ~로 확인되면 거주자 부담'이라는 결과별 부담 안내를 "
               "항목 이름 그대로 반드시 포함할 것. " if kind in ("how", "other", "cost") else "")
            + "원인이나 부담 주체를 단정하지 말고, 없는 절차·비용·일정을 지어내지 말 것. "
            "마지막에 기사님 방문 점검 접수를 진행할지 한 번만 물어볼 것."
        )
        reply = self._generate_llm_reply(guidance, user_text)
        return reply or (facts + ask)

    def _handle_identify_resident(self, user_text: str, nlu_result: Dict[str, Any]) -> str:
        """1단계: 동, 호수 및 거주자 성함 확인 (SH DB 대조)"""
        dong = nlu_result.get("dong")
        ho = nlu_result.get("ho")
        # LLM이 없거나 못 뽑으면 규칙으로 이름 추출 ("103동 1204호 홍길동입니다" → 홍길동)
        name = nlu_result.get("resident_name") or extract_name(user_text)

        # 규칙 기반 수사 변환 폴백
        rule_dong, rule_ho = extract_dong_ho(user_text)
        dong = dong or rule_dong
        ho = ho or rule_ho

        if dong:
            self.session.building = dong
        if ho:
            self.session.unit = ho
        if name:
            self.session.resident_name = name

        # 동·호수가 확보되면 DB 조회
        if self.session.building and self.session.unit and not self.session.db_resident_name:
            household = lookup_household(self.session.building, self.session.unit)
            if household:
                self.session.db_resident_name = household.get("resident_name")
                self.session.phone = household.get("phone")
                self.session.apartment_name = household.get("apartment_name")
                self.session.move_in_date = household.get("move_in_date")

        # 발화문 속에 등록된 계약자 성함이 직접 언급되었으면 최우선 일치 인정
        if self.session.db_resident_name and self.session.db_resident_name in user_text:
            self.session.resident_name = self.session.db_resident_name
            name = self.session.db_resident_name

        # 성함이 아직 없는 경우 ➔ 성함 질문
        if not self.session.resident_name:
            if self.session.building and self.session.unit:
                reply = f"{self.session.building} {self.session.unit} 확인되었습니다. 계약자분 성함이 어떻게 되시나요?"
            else:
                reply = "거주하시는 동과 호수, 그리고 계약자분 성함을 함께 말씀해 주세요."
            self._record_history("Assistant", reply)
            return reply

        # 동, 호수, 성함이 모두 파악된 경우 ➔ DB 비교 검증
        if self.session.building and self.session.unit and self.session.resident_name:
            db_name = self.session.db_resident_name or "홍길동"
            # 성함 일치 여부 확인
            if self.session.resident_name in db_name or db_name in self.session.resident_name:
                self.session.is_resident_verified = True
                self.state = DialogueState.ASK_FACILITY

                fact_guidance = (
                    f"{self.session.building} {self.session.unit} {self.session.resident_name} 고객님 본인 확인 완료. "
                    "고객님께 확인 인사를 드리고, '어떤 시설물에 문제가 있으신가요?'라고만 편안하게 여쭤볼 것. "
                    "절대 에러코드나 모델명 같은 어려운 용어는 꺼내지 말 것."
                )
                reply = self._generate_llm_reply(fact_guidance, user_text)
                if not reply:
                    reply = f"{self.session.resident_name} 고객님 확인되셨습니다. 댁내 어떤 시설물에 문제가 있으신가요?"
                self._record_history("Assistant", reply)
                return reply
            else:
                # 불일치 시
                reply = f"말씀해 주신 {self.session.resident_name} 님은 등록된 계약자 성함({db_name})과 다릅니다. 계약자분 성함을 다시 말씀해 주시겠어요?"
                self._record_history("Assistant", reply)
                return reply

        reply = "거주하시는 동, 호수와 성함을 다시 말씀해 주세요."
        self._record_history("Assistant", reply)
        return reply

    def _handle_ask_facility(self, user_text: str, nlu_result: Dict[str, Any]) -> str:
        """2단계: 고장 시설물 및 증상 청취 ➔ 수선유지 RAG로 기준표 항목 검색 ➔ 3단계 고장 경위 질문"""
        device = nlu_result.get("device")
        symptom = nlu_result.get("symptom") or user_text
        error_code = nlu_result.get("error_code") or extract_error_code(user_text)

        # [도구 API 호출] 수선유지 RAG 검색: 거주자 표현 → 기준표 항목 후보
        query = " ".join(filter(None, [device, user_text]))
        candidates = search_facility(query)
        if not candidates:
            self.session.facility_retry += 1
            if self.session.facility_retry <= 2:
                reply = (
                    "죄송하지만 어떤 시설물인지 잘 못 알아들었어요. "
                    "보일러, 변기, 창문, 전등처럼 고장 난 물건 이름과 어떻게 안 되는지 함께 말씀해 주시겠어요?"
                )
                self._record_history("Assistant", reply)
                return reply
            # 두 번 넘게 못 찾으면 항목 없이 진행 (판정은 '점검 후 결정')

        chosen = candidates[0] if candidates else None
        if chosen and self._is_ambiguous(candidates) and self.use_llm and self.llm:
            # 1·2순위가 비슷해 헷갈릴 때만 LLM이 검색 후보 중에서 고른다 (없는 항목을 지어내지 못함)
            idx = self.llm.choose_facility(user_text, candidates)
            if idx is not None and 0 <= idx < len(candidates):
                chosen = candidates[idx]

        self.session.facility_candidates = candidates
        self.session.facility_item_id = chosen["id"] if chosen else None
        self.session.facility_name = chosen["name"] if chosen else None
        self.session.device_category = device or (chosen["name"].split(" > ")[0] if chosen else "시설물")
        self.session.symptom = symptom
        self.session.error_code = error_code

        # 다음 단계: 전화상으로 노후/부주의 여부 확인 질문
        self.state = DialogueState.PROBE_CAUSE

        fact_guidance = (
            f"고객이 '{self.session.symptom}'(시설물: {self.session.device_category}) 문제를 겪고 있음. "
            "불편함에 공감한 뒤, 전화상으로 고장 경위를 자연스럽게 물어볼 것: "
            "언제부터 그랬는지, 혹시 전원을 껐다 켜보셨거나 최근 한파로 동파나 충격/파손이 있었는지 부담 없이 질문할 것."
        )

        reply = self._generate_llm_reply(fact_guidance, user_text)
        if not reply:
            reply = (
                f"{self.session.device_category}에 문제가 있으시군요, 많이 불편하시겠습니다. "
                "혹시 언제부터 그러셨나요? 사용 중 충격이나 최근 추위로 얼어붙은 적(동파)이 있으신지 말씀해 주시겠어요?"
            )
        self._record_history("Assistant", reply)
        return reply

    def _handle_probe_cause(self, user_text: str, nlu_result: Dict[str, Any]) -> str:
        """3단계: 고장 경위 답변 청취 ➔ 4단계 RAG 비용 판정 및 방문 접수 제안"""
        self.session.cause_detail = user_text

        # [도구 API 호출] 수선유지 기준 비용 판정 (규칙 코드: 항목·경위·입주일 → 부담 주체)
        if self.session.facility_item_id:
            policy_result = decide_cost(
                item_id=self.session.facility_item_id,
                cause_detail=self.session.cause_detail,
                symptom=self.session.symptom,
                move_in_date=self.session.move_in_date,
            )
        else:
            policy_result = {
                "verdict": "SITE_CHECK",
                "liability_party": "점검 후 결정",
                "resident_cost_possible": True,
                "basis_text": "기준표에서 해당 시설물을 특정하지 못함 / P12: 명기되지 않은 사항은 종합적으로 고려·협의",
                "explanation": "말씀하신 시설물은 기준표에서 바로 찾지 못해, 담당 직원이 확인한 뒤 비용 부담을 안내해 드리겠습니다.",
                "defect_type": "ETC",
            }

        self.session.liability_verdict = policy_result["verdict"]
        self.session.liability_party = policy_result["liability_party"]
        self.session.liability_reason = policy_result["basis_text"]
        self.session.liability_explanation = policy_result["explanation"]
        self.session.resident_cost_possible = policy_result["resident_cost_possible"]
        self.session.defect_type = policy_result.get("defect_type", "ETC")

        self.state = DialogueState.ADVISE_COST
        explanation = policy_result["explanation"]

        fact_guidance = (
            f"고객의 고장 경위 설명: '{self.session.cause_detail}'. "
            f"수선유지 기준 판정 결과: {explanation} "
            "판정 결과에 따라 비용 부담(SH부담 또는 자부담 가능성)을 알기 쉽게 설명하고, "
            "점검 기사님 방문 접수를 진행해 드릴지 정중히 물어볼 것."
        )

        reply = self._generate_llm_reply(fact_guidance, user_text)
        if not reply:
            reply = f"{explanation}\n기사님 방문 점검 접수를 진행해 드릴까요?"
        self._record_history("Assistant", reply)
        return reply

    def _handle_advise_cost(self, user_text: str, nlu_result: Dict[str, Any]) -> str:
        """4단계: 방문 접수 희망 여부 확인 및 최종 티켓 발행"""
        # 거주자가 되물으면 ("파손인지 실크랙인지 어떻게 알아?") 접수 동의로 보지 않고 질문에 답한 뒤 다시 묻는다
        kind = self._question_kind(user_text)
        if kind:
            reply = self._answer_question(kind, user_text)
            self._record_history("Assistant", reply)
            return reply

        # 규칙으로 분명하면 규칙대로, 애매해서 LLM을 불렀으면 LLM 판단을 쓴다
        intent = self._rule_intent(user_text)
        if intent == "unknown":
            intent = nlu_result.get("intent", "unknown")
        is_negative = intent == "negative"
        is_affirmative = intent == "affirmative"

        if is_affirmative:
            # [도구 API 호출] 방문 접수 요청: 관리자 웹에 접수 대기 생성 + 희망일 선택 링크 문자 발송
            res = request_schedule(self.session.model_dump())
            self.session.call_summary = (
                f"{self.session.building} {self.session.unit} ({self.session.resident_name}) "
                f"{self.session.facility_name or self.session.device_category} — {self.session.symptom}"
            )
            # 마무리 멘트는 링크·접수 조건이 정확해야 하므로 LLM에 맡기지 않고 고정 문장으로 말한다
            if res["sent"]:
                self.session.intake_token = res["token"]
                self.session.schedule_link = res["link"]
                self.session.sms_text = res["sms_text"]
                self.session.sms_to = res["sms_to"]
                self.state = DialogueState.SCHEDULE_SENT
                reply = (
                    f"네, 방문 점검 접수를 위해 {mask_phone(self.session.phone)} 번호로 문자를 보내드렸습니다. "
                    "문자 속 링크에서 방문을 원하시는 날짜를 최대 3개까지 골라 주시면 접수가 완료됩니다. "
                    "담당 직원이 그중 하루로 방문 일정을 확정해 다시 문자로 안내해 드릴게요. 이용해 주셔서 감사합니다."
                )
            else:
                self.session.ticket_id = res["ticket_id"]
                self.session.ticket_error = res["error"]
                self.state = DialogueState.TICKET_ISSUED
                reply = (
                    f"죄송합니다. 지금 문자 발송에 문제가 있어 임시 접수번호 {self.session.ticket_id}로 접수해 두었습니다. "
                    "담당 직원이 확인한 뒤 직접 연락드려 방문 날짜를 정하겠습니다. 이용해 주셔서 감사합니다."
                )
            self._record_history("Assistant", reply)
            return reply

        elif is_negative:
            self.state = DialogueState.CLOSED
            reply = "접수를 취소하였습니다. 추가 문의사항이 있으시면 언제든 연락해 주세요. 좋은 하루 되세요."
            self._record_history("Assistant", reply)
            return reply

        # 네/아니요도, 정해진 질문 종류도 아니면: 일반 질문·하소연으로 보고 점검 절차를 안내한 뒤 다시 묻는다
        reply = self._answer_question("other", user_text)
        self._record_history("Assistant", reply)
        return reply

    def _generate_llm_reply(self, fact_guidance: str, user_utterance: str) -> str:
        if self.use_llm and self.llm:
            return self.llm.generate_natural_reply(
                state=self.state.value,
                session=self.session.model_dump(exclude={"history"}),
                fact_guidance=fact_guidance,
                user_utterance=user_utterance
            )
        return ""

    def _record_history(self, speaker: str, text: str):
        self.session.history.append({"speaker": speaker, "text": text})

    def get_summary(self) -> Dict[str, Any]:
        return {
            "state": self.state.value,
            "session": self.session.model_dump()
        }
