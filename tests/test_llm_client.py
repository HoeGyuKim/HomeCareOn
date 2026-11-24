"""Gemini 안정화: 제한 시간·실패 후 규칙 모드 전환·모델 고정 (실제 네트워크 호출 없음)."""
import io
import json
import urllib.error

import pytest

from backend.dialogue import llm_client as L


@pytest.fixture(autouse=True)
def reset_state(monkeypatch):
    monkeypatch.setattr(L, "_down_until", 0.0)
    monkeypatch.setattr(L, "_last_error", "")


def client():
    c = L.GeminiClient()
    c.api_key = "test-key"
    return c


def ok_response(text):
    body = json.dumps({"candidates": [{"content": {"parts": [{"text": text}]}}]}).encode()

    class R(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    return R(body)


def test_model_is_pinned_not_latest_alias():
    assert "latest" not in L.GEMINI_MODEL
    assert L.GeminiClient().model_name == L.GEMINI_MODEL


def test_timeout_uses_setting_and_enters_cooldown(monkeypatch):
    seen = {}

    def fake_urlopen(req, timeout):
        seen["timeout"] = timeout
        raise TimeoutError("The read operation timed out")

    monkeypatch.setattr(L.urllib.request, "urlopen", fake_urlopen)
    assert client().call_gemini("s", "u") == ""
    assert seen["timeout"] == L.GEMINI_TIMEOUT
    status = L.llm_status()
    assert status["available"] is False and "시간 초과" in status["last_error"]


def test_during_cooldown_no_call_is_made(monkeypatch):
    calls = []
    monkeypatch.setattr(L.urllib.request, "urlopen", lambda req, timeout: calls.append(1) or ok_response("안녕하세요."))
    monkeypatch.setattr(L, "_down_until", L.time.time() + 60)
    assert client().call_gemini("s", "u") == "" and calls == []


def test_server_overload_enters_cooldown(monkeypatch):
    def fake_urlopen(req, timeout):
        raise urllib.error.HTTPError(req.full_url, 503, "Service Unavailable", {}, None)

    monkeypatch.setattr(L.urllib.request, "urlopen", fake_urlopen)
    assert client().call_gemini("s", "u") == ""
    assert L.llm_status()["available"] is False


def test_bad_request_does_not_enter_cooldown(monkeypatch):
    def fake_urlopen(req, timeout):
        raise urllib.error.HTTPError(req.full_url, 400, "Bad Request", {}, None)

    monkeypatch.setattr(L.urllib.request, "urlopen", fake_urlopen)
    assert client().call_gemini("s", "u") == ""
    assert L.llm_status()["available"] is True


def test_normal_response(monkeypatch):
    monkeypatch.setattr(L.urllib.request, "urlopen", lambda req, timeout: ok_response("네, 확인했어요."))
    assert client().call_gemini("s", "u") == "네, 확인했어요."
    assert L.llm_status()["available"] is True
