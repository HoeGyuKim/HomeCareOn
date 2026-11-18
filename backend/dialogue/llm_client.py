"""
Google Gemini API 연동 클라이언트 모듈 (토큰 잘림 방지 및 안정성 강화 버전)
"""
import os
import json
import urllib.request
from typing import Dict, Any, Optional
from pathlib import Path


def load_api_key() -> str:
    api_key = os.getenv("GEMINI_API_KEY")
    if api_key:
        return api_key

    current_dir = Path(__file__).resolve().parent
    env_file = current_dir.parent.parent / ".env"
    if env_file.exists():
        with open(env_file, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("GEMINI_API_KEY="):
                    return line.split("=", 1)[1].strip()

    return ""


class GeminiClient:
    def __init__(self, model_name: str = "gemini-flash-lite-latest"):
        self.api_key = load_api_key()
        self.model_name = model_name
        self.base_url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model_name}:generateContent?key={self.api_key}"

    def call_gemini(self, system_instruction: str, user_prompt: str, json_mode: bool = False) -> str:
        if not self.api_key:
            return ""

        contents = [{"parts": [{"text": f"System: {system_instruction}\n\nUser: {user_prompt}"}]}]
        body: Dict[str, Any] = {"contents": contents}

        # 토큰 잘림 방지를 위해 maxOutputTokens를 넉넉하게 2048로 명시 설정
        generation_config: Dict[str, Any] = {
            "maxOutputTokens": 2048,
            "temperature": 0.7,
        }
        if json_mode:
            generation_config["responseMimeType"] = "application/json"

        body["generationConfig"] = generation_config

        data = json.dumps(body).encode("utf-8")
        req = urllib.request.Request(self.base_url, data=data, headers={"Content-Type": "application/json"})

        try:
            with urllib.request.urlopen(req, timeout=12) as response:
                result = json.loads(response.read().decode("utf-8"))
                candidates = result.get("candidates", [])
                if not candidates:
                    return ""

                candidate = candidates[0]
                # parts가 여러 개로 분할되어 반환되는 경우 모든 텍스트를 누락 없이 결합
                parts = candidate.get("content", {}).get("parts", [])
                full_text = "".join(p.get("text", "") for p in parts if "text" in p).strip()

                # 문장 중간 잘림(예: '꼼', '하', '드' 등으로 끝남) 감지 및 후처리
                if not json_mode and full_text:
                    full_text = self._ensure_complete_sentence(full_text)

                return full_text
        except Exception as e:
            print(f"[Gemini API Notice] {e}")
            return ""

    def _ensure_complete_sentence(self, text: str) -> str:
        """응답이 문장 부호나 종결 어미 없이 비정상적으로 잘렸는지 검사하여 보정합니다."""
        valid_endings = ('.', '!', '?', '요', '다', '죠', '까', '음', '임')
        trimmed = text.strip()
        if not trimmed:
            return text

        # 정상 종결인 경우 그대로 반환
        if trimmed.endswith(valid_endings):
            return trimmed

        # 마지막 불완전한 단어/토막을 찾고 자연스러운 질문/안내로 보정
        last_dot = max(trimmed.rfind('.'), trimmed.rfind('!'), trimmed.rfind('?'), trimmed.rfind('\n'))
        if last_dot > len(trimmed) // 2:
            # 앞선 완성된 문장까지만 취하고 방문 접수 질문 추가
            clean_prefix = trimmed[:last_dot + 1].strip()
            return f"{clean_prefix}\n\n점검 기사님 방문 접수를 도와드릴까요?"

        return f"{trimmed}꼼히 확인 후 점검 기사님 방문 접수를 도와드릴까요?"

    def extract_information(self, state: str, user_utterance: str, current_session: Dict[str, Any]) -> Dict[str, Any]:
        system_instruction = (
            "너는 SH공사 임대주택 시설물 민원 전화 접수 시스템의 지능형 자연어 파서(NLU)야. "
            "사용자의 발화에서 아래 항목들을 파악해 반드시 유효한 JSON 형식으로만 응답해줘. "
            "언급되지 않은 항목은 null로 설정해.\n"
            "JSON 형식:\n"
            "{\n"
            "  \"dong\": \"...동\",\n"
            "  \"ho\": \"...호\",\n"
            "  \"resident_name\": \"...성함\",\n"
            "  \"device\": \"...고장 시설물/기기\",\n"
            "  \"symptom\": \"...고장 증상\",\n"
            "  \"cause_detail\": \"...고장 발생 상황 및 경위(언제부터, 충격/파손/부주의 여부 등)\",\n"
            "  \"intent\": \"affirmative|negative|unknown\"\n"
            "}"
        )

        user_prompt = (
            f"현재 세션 단계: {state}\n"
            f"현재까지 기록된 세션 정보: {json.dumps(current_session, ensure_ascii=False)}\n"
            f"거주자 발화: \"{user_utterance}\""
        )
        res_text = self.call_gemini(system_instruction, user_prompt, json_mode=True)
        if not res_text:
            return {}

        try:
            return json.loads(res_text)
        except Exception:
            return {}

    def generate_natural_reply(self, state: str, session: Dict[str, Any], fact_guidance: str, user_utterance: str) -> str:
        system_instruction = (
            "너는 SH 시설물 민원 접수 센터의 전문적이고 따뜻한 AI 상담원이야.\n"
            "[절대 지켜야 할 원칙]\n"
            "1. 거주자는 일반인이므로 에러코드, 모델명 같은 어려운 전문/기술 용어는 먼저 묻지 마. "
            "   그냥 '어떤 시설물에 문제가 있으신가요?'라고만 쉽게 물어봐.\n"
            "2. 제공된 [팩트 및 지침]의 내용에만 근거해서 답해. 없는 일정이나 가짜 규정을 지어내면 절대 안 됨.\n"
            "3. 방문 일정은 AI가 정하지 않고 '담당 직원이 확인 후 문자로 방문 일정을 안내한다'고 답해.\n"
            "4. 전화상으로 고장 경위나 혹시 파손/충격/동파 같은 상황이 있었는지 자연스럽고 부담 없게 물어봐.\n"
            "5. 반드시 문장을 끝까지 온전하게 완성해. 문장이 중간에 잘리지 않도록 주의하고, 마지막에는 방문 접수 의사를 물어봐.\n"
            "6. 2~3문장 이내로 편안하고 부드러운 음성 대화체('~해요', '~드릴게요')로 답변해줘."
        )

        user_prompt = (
            f"[현재 상태]: {state}\n"
            f"[세대/설비 정보]: {json.dumps(session, ensure_ascii=False)}\n"
            f"[상담 지침 및 팩트]: {fact_guidance}\n"
            f"[거주자가 방금 한 말]: \"{user_utterance}\"\n\n"
            "거주자에게 답할 가장 적절하고 자연스러운 상담원 답변을 끝까지 완성해서 작성해 줘."
        )

        return self.call_gemini(system_instruction, user_prompt, json_mode=False)
