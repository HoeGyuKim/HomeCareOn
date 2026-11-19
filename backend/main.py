"""FastAPI 앱. 실행: uvicorn backend.main:app --reload"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import inspect
from sqlalchemy.engine import Engine

from . import config
from .api import admin, chat
from .db import Base, make_engine, make_session_factory
from .seed import seed_if_empty

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")


def check_schema(engine: Engine) -> None:
    """예전 구조로 만든 DB 파일이 남아 있으면 알아보기 쉬운 메시지로 멈춘다."""
    insp = inspect(engine)
    for table in Base.metadata.sorted_tables:
        if insp.has_table(table.name):
            existing = {c["name"] for c in insp.get_columns(table.name)}
            missing = sorted(c.name for c in table.columns if c.name not in existing)
            if missing:
                raise RuntimeError(
                    f"DB 구조가 코드와 다릅니다 ({table.name} 테이블에 {', '.join(missing)} 없음). "
                    "서버를 끄고 backend/db.sqlite3 파일을 지운 뒤 다시 실행하세요."
                )


def create_app(engine: Engine | None = None) -> FastAPI:
    engine = engine or make_engine()
    session_factory = make_session_factory(engine)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        check_schema(engine)
        Base.metadata.create_all(engine)
        with session_factory() as db:
            seed_if_empty(db)
        yield

    app = FastAPI(title="HomeCareOn API", description="AI 음성 기반 주거시설 민원 접수 및 유지보수 연계 시스템", lifespan=lifespan)
    app.state.SessionLocal = session_factory
    app.state.sessions = {}  # 대화 세션 (MVP: 메모리 보관, 서버 재시작 시 사라짐)

    app.include_router(chat.router)
    app.include_router(admin.router)

    @app.get("/api/health")
    def health():
        return {
            "ok": True,
            "nlu_mode": "llm" if config.llm_enabled() else "rules",
            "llm_model": config.LLM_MODEL if config.llm_enabled() else None,
        }

    @app.get("/", include_in_schema=False)
    def index():
        return RedirectResponse("/resident/")

    app.mount("/common", StaticFiles(directory=config.FRONTEND_DIR / "common"), name="common")
    app.mount("/resident", StaticFiles(directory=config.FRONTEND_DIR / "resident", html=True), name="resident")
    app.mount("/admin", StaticFiles(directory=config.FRONTEND_DIR / "admin", html=True), name="admin")
    return app


app = create_app()
