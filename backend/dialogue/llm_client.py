"""
Google Gemini API 연동 클라이언트 모듈 (gemini-flash-lite-latest)

기능:
1. 자연어 이해(NLU): 사용자의 비정형/구어체 발화에서 동, 호수, 고장 증상, 에러코드 등을 구조화된 JSON으로 추출
2. 자연어 응답 생성: 상태머신의 규칙과 RAG 판정 사실(Fact)을 기반으로 사람 상담원처럼 자연스럽고 친절한 대화체 문장 생성
"""
import os
import json
import urllib.request
from typing import Dict, Any, Optional
from pathlib import Path


def load_api_key() -> str:
    """환경변수 또는 .env 파일에서 GEMINI_API_KEY 로드"""
    api_key = os.getenv("GEMINI_API_KEY")
    if api_key:
        return api_key

    # 프로젝트 루트의 .env 파일 탐색
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
        """Gemini API에 요청을 보내고 텍스트 응답을 반환합니다."""
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
            # 타임아웃 또는 네트워크 장애 시 로그 출력
            print(f"[Gemini API Notice] {e}")
            return ""

    def extract_information(self, state: str, user_utterance: str, current_session: Dict[str, Any]) -> Dict[str, Any]:
        """
        사용자의 자유 발화에서 필요한 정보를 지능적으로 추출합니다.
        """
        system_instruction = (
            "너는 아파트/임대주택 시설물 민원 접수 센터의 지능형 자연어 파서(NLU)야. "
            "사용자의 발화에서 거주지(동, 호수), 설비명, 증상, 에러코드, 그리고 접수 진행 의사(yes/no)를 파악해 "
            "반드시 아래 JSON 형식으로만 응답해줘. 없는 정보는 null로 채워.\n"
            "JSON 형식: {\"dong\": \"...동\", \"ho\": \"...호\", \"device\": \"...\", \"symptom\": \"...\", \"error_code\": \"...\", \"intent\": \"affirmative|negative|unknown\"}"
        )

        user_prompt = f"현재 세션 상태: {state}\n현재까지의 정보: {json.dumps(current_session, ensure_ascii=False)}\n사용자 발화: \"{user_utterance}\""
        res_text = self.call_gemini(system_instruction, user_prompt, json_mode=True)
        if not res_text:
            return {}

        try:
            return json.loads(res_text)
        except Exception:
            return {}

    def generate_natural_reply(self, state: str, session: Dict[str, Any], fact_guidance: str, user_utterance: str) -> str:
        """
        주어진 팩트(기준표 판정, 상태 제약)를 바탕으로 거주자에게 할 친절한 한두 문장의 상담원 답변을 생성합니다.
        절대 허구의 약속(일정 확정 등)을 하지 않고 사실에만 근거해야 합니다.
        """
        system_instruction = (
            "너는 SH 시설물 민원 접수 센터의 전문적이고 따뜻한 AI 상담원이야. "
            "거주자의 입장에 공감하면서도 정중하고 명확하게 말해야 해.\n"
            "[원칙]\n"
            "1. 반드시 제공된 [팩트 및 지침]의 내용에만 근거해서 답해. 없는 규정이나 날짜를 지어내면 절대 안 됨.\n"
            "2. 방문 일정은 AI가 잡지 않고 '직원이 확인 후 문자로 안내한다'는 원칙을 지켜.\n"
            "3. 2~3문장 이내로 음성으로 듣기 편하게 부드러운 구어체('~해요', '~드리겠습니다')로 답해줘."
        )

        user_prompt = (
            f"[현재 상태]: {state}\n"
            f"[세대/설비 정보]: {json.dumps(session, ensure_ascii=False)}\n"
            f"[팩트 및 지침]: {fact_guidance}\n"
            f"[거주자가 방금 한 말]: \"{user_utterance}\"\n\n"
            "거주자에게 전달할 가장 적절하고 친절한 상담원 답변을 작성해 줘."
        )

        return self.call_gemini(system_instruction, user_prompt, json_mode=False)
