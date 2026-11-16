"""
Google Gemini API 연동 클라이언트 모듈 (개선 버전)
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
        body = {"contents": contents}
        if json_mode:
            body["generationConfig"] = {"responseMimeType": "application/json"}

        data = json.dumps(body).encode("utf-8")
        req = urllib.request.Request(self.base_url, data=data, headers={"Content-Type": "application/json"})

        try:
            with urllib.request.urlopen(req, timeout=12) as response:
                result = json.loads(response.read().decode("utf-8"))
                return result["candidates"][0]["content"]["parts"][0]["text"].strip()
        except Exception as e:
            print(f"[Gemini API Notice] {e}")
            return ""

    def extract_information(self, state: str, user_utterance: str, current_session: Dict[str, Any]) -> Dict[str, Any]:
        """
        사용자의 발화에서 동, 호수, 성함, 설비, 증상, 고장경위/부주의 여부, 의도를 추출합니다.
        """
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
        """
        상담원의 지침과 사실(Fact)을 기반으로 자연스럽고 친절한 대화체 문장을 생성합니다.
        """
        system_instruction = (
            "너는 SH 시설물 민원 접수 센터의 전문적이고 따뜻한 AI 상담원이야.\n"
            "[절대 지켜야 할 원칙]\n"
            "1. 거주자는 일반인(어르신, 주부 등)이므로 에러코드, 모델명 같은 어려운 전문/기술 용어는 먼저 묻지 마. "
            "   그냥 '어떤 시설물에 문제가 있으신가요?'라고만 쉽게 물어봐.\n"
            "2. 제공된 [팩트 및 지침]의 내용에만 근거해서 답해. 없는 일정이나 가짜 규정을 지어내면 절대 안 됨.\n"
            "3. 방문 일정은 AI가 정하지 않고 '담당 직원이 확인 후 문자로 방문 일정을 안내한다'고 답해.\n"
            "4. 전화상으로 고장 경위나 혹시 파손/충격/동파 같은 상황이 있었는지 자연스럽고 부담 없게 물어봐.\n"
            "5. 2~3문장 이내로 편안하고 부드러운 음성 대화체('~해요', '~드릴게요')로 답변해줘."
        )

        user_prompt = (
            f"[현재 상태]: {state}\n"
            f"[세대/설비 정보]: {json.dumps(session, ensure_ascii=False)}\n"
            f"[상담 지침 및 팩트]: {fact_guidance}\n"
            f"[거주자가 방금 한 말]: \"{user_utterance}\"\n\n"
            "거주자에게 답할 가장 적절하고 자연스러운 상담원 답변을 작성해 줘."
        )

        return self.call_gemini(system_instruction, user_prompt, json_mode=False)
