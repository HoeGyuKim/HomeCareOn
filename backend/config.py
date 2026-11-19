"""환경 설정. 환경변수로 덮어쓸 수 있다."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND_DIR = ROOT / "backend"
FRONTEND_DIR = ROOT / "frontend"
KNOWLEDGE_DIR = ROOT / "knowledge"
COST_STANDARD_DIR = KNOWLEDGE_DIR / "cost_standard"  # 실제 SH 비용부담 기준 (B가 생성)
MOCK_DIR = KNOWLEDGE_DIR / "mock"  # 목업: 제조사 에러코드, MVP용 검색 별칭

# db.sqlite3는 기존 .gitignore에 이미 들어 있어 커밋되지 않는다
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{(BACKEND_DIR / 'db.sqlite3').as_posix()}")

# NLU(자연어 이해) 방식
#   auto  : ANTHROPIC_API_KEY가 있으면 LLM, 없으면 규칙 기반 (기본값)
#   rules : 항상 규칙 기반 (API 키 없이 동작, 비용 0)
#   llm   : 항상 LLM 사용 (실패하면 규칙 기반으로 대체)
NLU_MODE = os.getenv("NLU_MODE", "auto")
LLM_MODEL = os.getenv("LLM_MODEL", "claude-opus-5-5")
LLM_EFFORT = os.getenv("LLM_EFFORT", "low")  # 음성 응답 지연을 줄이기 위해 기본 low

COMPLEX_NAME = "잠실 SH아파트"


def llm_enabled() -> bool:
    if NLU_MODE == "rules":
        return False
    if NLU_MODE == "llm":
        return True
    return bool(os.getenv("ANTHROPIC_API_KEY"))
