"""
Google Gemini API 연동 클라이언트 모듈 (개선 버전)
"""
import os
import json
import socket
import time
import urllib.error
import urllib.request
from typing import Dict, Any, Optional
from pathlib import Path


def get_env_path() -> Path:
    current_dir = Path(__file__).resolve().parent
    return current_dir.parent.parent / ".env"


def load_api_key() -> str:
    api_key = os.getenv("GEMINI_API_KEY")
    if api_key:
        return api_key

    env_file = get_env_path()
    if env_file.exists():
        with open(env_file, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("GEMINI_API_KEY="):
                    return line.split("=", 1)[1].strip()

    return ""


def save_api_key(api_key: str) -> None:
    """사용자가 입력한 API 키를 로컬 .env 파일에 안전하게 저장합니다."""
    env_file = get_env_path()
    lines = []
    found = False
    if env_file.exists():
        with open(env_file, "r", encoding="utf-8") as f:
            for line in f:
                if line.strip().startswith("GEMINI_API_KEY="):
                    lines.append(f"GEMINI_API_KEY={api_key.strip()}\n")
                    found = True
                else:
                    lines.append(line)

    if not found:
        lines.append(f"GEMINI_API_KEY={api_key.strip()}\n")

    with open(env_file, "w", encoding="utf-8") as f:
        f.writelines(lines)


def _setting(name: str, default: str) -> str:
    """환경변수 → 저장소 루트 .env → 기본값 순으로 설정값을 읽는다."""
    if os.getenv(name):
        return os.environ[name]
    env_file = get_env_path()
    if env_file.exists():
        with open(env_file, "r", encoding="utf-8") as f:
            for line in f:
                if line.strip().startswith(f"{name}="):
                    return line.split("=", 1)[1].strip()
    return default


# ── Gemini 안정화 설정 ──
# 모델은 '-latest' 별칭 대신 버전을 고정한다 (별칭은 모델이 바뀌어도 모르고 지나감. 26.11.24 기준 -latest = 3.5-flash-lite)
GEMINI_MODEL = _setting("GEMINI_MODEL", "gemini-3.5-flash-lite")
# 한 번 호출을 기다리는 최대 시간(초). 넘으면 규칙 문장으로 답한다. 정상 응답은 보통 1~2초
GEMINI_TIMEOUT = float(_setting("GEMINI_TIMEOUT", "4"))
# 시간 초과·서버 오류(5xx, 429)가 나면 이 시간(초) 동안 Gemini를 부르지 않고 바로 규칙 모드로 답한다
GEMINI_COOLDOWN = float(_setting("GEMINI_COOLDOWN", "60"))

# 프로세스 전체가 공유하는 상태: Gemini가 혼잡하면 다른 통화도 기다리지 않게 한다
_down_until = 0.0
_last_error = ""


def llm_status() -> Dict[str, Any]:
    """지금 Gemini를 쓰는지 (헬스 체크·화면 표시용)."""
    left = max(0.0, _down_until - time.time())
    return {"model": GEMINI_MODEL, "timeout": GEMINI_TIMEOUT, "available": left == 0,
            "cooldown_left": round(left, 1), "last_error": _last_error}


def _mark_down(reason: str) -> None:
    global _down_until, _last_error
    _down_until = time.time() + GEMINI_COOLDOWN
    _last_error = reason
    print(f"[Gemini] {reason} → {GEMINI_COOLDOWN:g}초 동안 규칙 모드로 응답")


class GeminiClient:
    def __init__(self, model_name: Optional[str] = None):
        self.api_key = load_api_key()
        self.model_name = model_name or GEMINI_MODEL
        self.base_url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model_name}:generateContent?key={self.api_key}"

    def call_gemini(self, system_instruction: str, user_prompt: str, json_mode: bool = False) -> str:
        if not self.api_key:
            return ""
        if time.time() < _down_until:
            return ""  # 최근 실패 후 쉬는 중: 기다리지 않고 규칙 문장으로

        contents = [{"parts": [{"text": f"System: {system_instruction}\n\nUser: {user_prompt}"}]}]
        body: Dict[str, Any] = {"contents": contents}

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
            with urllib.request.urlopen(req, timeout=GEMINI_TIMEOUT) as response:
                result = json.loads(response.read().decode("utf-8"))
                candidates = result.get("candidates", [])
                if not candidates:
                    return ""

                candidate = candidates[0]
                parts = candidate.get("content", {}).get("parts", [])
                full_text = "".join(p.get("text", "") for p in parts if "text" in p).strip()

                if not json_mode and full_text:
                    full_text = self._ensure_complete_sentence(full_text)

                return full_text
        except urllib.error.HTTPError as e:
            if e.code >= 500 or e.code == 429:  # 혼잡·서버 오류 → 잠시 쉼
                _mark_down(f"HTTP {e.code}")
            else:  # 400 등 요청 문제는 쉬어도 낫지 않으므로 알리기만 함
                print(f"[Gemini API Notice] HTTP {e.code}")
            return ""
        except (TimeoutError, socket.timeout, urllib.error.URLError) as e:
            _mark_down(f"시간 초과({GEMINI_TIMEOUT:g}초)" if "timed out" in str(e) or isinstance(e, TimeoutError) else f"연결 실패: {e}")
            return ""
        except Exception as e:
            print(f"[Gemini API Notice] {e}")
            return ""

    def _ensure_complete_sentence(self, text: str) -> str:
        valid_endings = ('.', '!', '?', '요', '다', '죠', '까', '음', '임')
        trimmed = text.strip()
        if not trimmed:
            return text

        if trimmed.endswith(valid_endings):
            return trimmed

        # 잘린 문장은 마지막으로 끝난 문장까지만 쓴다.
        # (예전처럼 "방문 접수를 도와드릴까요?"를 덧붙이면 접수 질문 단계가 아닌데도 접수를 묻게 됨)
        last_dot = max(trimmed.rfind('.'), trimmed.rfind('!'), trimmed.rfind('?'), trimmed.rfind('\n'))
        if last_dot > 0:
            return trimmed[:last_dot + 1].strip()
        return ""  # 온전한 문장이 하나도 없으면 빈 문자열 → 오케스트레이터가 규칙 기반 문장을 씀

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

    def choose_facility(self, user_utterance: str, candidates: list) -> Optional[int]:
        """RAG 검색 후보 중 거주자 말에 가장 맞는 항목 번호를 고른다. 못 고르면 None (1순위 사용)."""
        listing = "\n".join(f"{i}. {c['name']}" for i, c in enumerate(candidates))
        system_instruction = (
            "너는 SH 임대주택 시설물 분류기야. 거주자가 말한 고장 시설물이 아래 후보 중 몇 번에 가장 가까운지 고른다. "
            "후보에 없는 것을 만들어 내지 말고, 반드시 JSON {\"index\": 번호} 로만 답해. 판단이 어려우면 {\"index\": 0}."
        )
        user_prompt = f"거주자 발화: \"{user_utterance}\"\n후보:\n{listing}"
        res_text = self.call_gemini(system_instruction, user_prompt, json_mode=True)
        try:
            idx = int(json.loads(res_text).get("index"))
            return idx if 0 <= idx < len(candidates) else None
        except Exception:
            return None

    def generate_natural_reply(self, state: str, session: Dict[str, Any], fact_guidance: str, user_utterance: str) -> str:
        system_instruction = (
            "너는 SH 시설물 민원 접수 센터의 전문적이고 따뜻한 AI 상담원이야.\n"
            "[절대 지켜야 할 원칙]\n"
            "1. 거주자는 일반인이므로 에러코드, 모델명 같은 어려운 전문/기술 용어는 먼저 묻지 마. "
            "   그냥 '어떤 시설물에 문제가 있으신가요?'라고만 쉽게 물어봐.\n"
            "2. 제공된 [팩트 및 지침]의 내용에만 근거해서 답해. 없는 일정이나 가짜 규정을 지어내면 절대 안 됨.\n"
            "3. 방문 날짜는 AI가 정하거나 약속하지 마. 접수에 동의하면 거주자가 문자 링크에서 희망 날짜를 고른다.\n"
            "4. 고장 경위나 파손/충격/동파 여부는 [상담 지침]이 물어보라고 할 때만 자연스럽고 부담 없게 물어봐.\n"
            "5. 반드시 문장을 끝까지 온전하게 완성해. 질문은 [상담 지침]이 시킨 것 하나만 하고, "
            "지침에 없으면 방문 접수 의사를 묻지 마.\n"
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
