from datetime import datetime

import pytest
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

from backend import config
from backend.db import Base, make_session_factory
from backend.seed import seed_if_empty

NOW = datetime(2026, 11, 19, 10, 0)


@pytest.fixture(autouse=True)
def rules_only(monkeypatch):
    """테스트는 API 키 없이 규칙 기반 NLU로 돈다 (비용 0, 결과 고정)."""
    monkeypatch.setattr(config, "NLU_MODE", "rules")


@pytest.fixture
def now():
    return NOW


@pytest.fixture
def engine():
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(eng)
    with make_session_factory(eng)() as db:
        seed_if_empty(db, today=NOW.date())
    return eng


@pytest.fixture
def db(engine):
    with make_session_factory(engine)() as session:
        yield session
