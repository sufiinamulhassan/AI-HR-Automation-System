import asyncio
import time
import types
import uuid
from datetime import datetime, timezone

import pytest

from config.database import get_db
from config.settings import settings
from services.hr_module import live_check_service as lc

pytestmark = pytest.mark.anyio

URL = "/api/v1/system/live-check"
ANTHROPIC_KEY = "sk-ant-live-check-key-0001"
OPENAI_KEY = "sk-live-check-openai-key-0002"
PINECONE_KEY = "pcsk_live-check-pinecone-0003"


class FakeNet:

    def __init__(self):
        self.calls: list[dict] = []
        self.answers: dict[str, object] = {}

    async def __call__(self, url, *, headers=None, params=None, timeout=None):
        self.calls.append({"url": url, "headers": dict(headers or {}), "params": dict(params or {})})
        for fragment, answer in self.answers.items():
            if fragment in url:
                if isinstance(answer, Exception):
                    raise answer
                if isinstance(answer, tuple):
                    await asyncio.sleep(answer[1])
                    return types.SimpleNamespace(status_code=200)
                return types.SimpleNamespace(status_code=answer)
        return types.SimpleNamespace(status_code=200)


class FakeIndex:
    def __init__(self, stats=None, error=None):
        self.stats, self.error = stats or {"total_vector_count": 42}, error

    def describe_index_stats(self):
        if self.error:
            raise self.error
        return self.stats


@pytest.fixture
def net(monkeypatch):
    fake = FakeNet()
    monkeypatch.setattr(lc, "_http_get", fake)
    return fake


@pytest.fixture
def configured(monkeypatch, net):
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", ANTHROPIC_KEY)
    monkeypatch.setattr(settings, "OPENAI_API_KEY", OPENAI_KEY)
    monkeypatch.setattr(settings, "PINECONE_API_KEY", PINECONE_KEY)
    monkeypatch.setattr(settings, "PINECONE_INDEX_NAME", "hr-bot-live")
    monkeypatch.setattr(settings, "CODE_SANDBOX_PROVIDER", "judge0")
    monkeypatch.setattr(settings, "JUDGE0_API_URL", "http://judge0.test")
    monkeypatch.setattr(settings, "JUDGE0_API_HOST", "")
    monkeypatch.setattr(lc, "get_pinecone", lambda: FakeIndex())
    return net


@pytest.fixture
async def fresh_limit():
    db = get_db()
    await db.rate_limits.delete_many({"_id": {"$regex": "^live_check:"}})
    yield
    await db.rate_limits.delete_many({"_id": {"$regex": "^live_check:"}})


def _by_key(response) -> dict:
    return {r["key"]: r for r in response.json()["results"]}


async def test_live_check_needs_an_admin(client, standard_headers, fresh_limit):
    assert (await client.post(URL, headers=standard_headers)).status_code == 403
    assert (await client.post(URL)).status_code == 401


async def test_every_service_reports_ok_when_it_answers(client, admin_headers, configured, fresh_limit):
    response = await client.post(URL, headers=admin_headers)
    assert response.status_code == 200
    body = response.json()
    assert datetime.fromisoformat(body["checked_at"]).tzinfo is not None
    assert [r["key"] for r in body["results"]] == ["mongodb", "anthropic", "openai", "pinecone", "code_sandbox"]
    for result in body["results"]:
        assert set(result) == {"key", "label", "ok", "detail", "latency_ms"}
        assert result["ok"] is True, result
        assert isinstance(result["detail"], str) and result["detail"]
        assert isinstance(result["latency_ms"], int) and result["latency_ms"] >= 0
    results = _by_key(response)
    assert results["mongodb"]["detail"] == "Connected"
    assert results["pinecone"]["detail"] == "Vector index reachable"
    assert "42" not in results["pinecone"]["detail"] and "hr-bot-live" not in results["pinecone"]["detail"]
    assert "Judge0" in results["code_sandbox"]["label"]


async def test_the_checks_are_read_only_requests_to_the_model_lists_and_the_sandbox(client, admin_headers, configured, fresh_limit):
    await client.post(URL, headers=admin_headers)
    urls = sorted(call["url"] for call in configured.calls)
    assert urls == [
        "http://judge0.test/about", "https://api.anthropic.com/v1/models", "https://api.openai.com/v1/models",
    ]
    anthropic = next(c for c in configured.calls if "anthropic" in c["url"])
    assert anthropic["headers"]["x-api-key"] == ANTHROPIC_KEY and anthropic["params"] == {"limit": 1}
    openai = next(c for c in configured.calls if "openai" in c["url"])
    assert openai["headers"]["Authorization"] == f"Bearer {OPENAI_KEY}"


async def test_a_missing_configuration_is_reported_not_called(client, admin_headers, net, monkeypatch, fresh_limit):
    for name in ("ANTHROPIC_API_KEY", "OPENAI_API_KEY", "PINECONE_API_KEY", "JUDGE0_API_URL", "PISTON_API_URL"):
        monkeypatch.setattr(settings, name, "")
    response = await client.post(URL, headers=admin_headers)
    results = _by_key(response)
    for key in ("anthropic", "openai", "pinecone", "code_sandbox"):
        assert results[key]["ok"] is False and results[key]["detail"] == "Not configured", key
        assert results[key]["latency_ms"] == 0
    assert results["mongodb"]["ok"] is True
    assert net.calls == []


async def test_a_rejected_key_is_not_ok_and_says_so(client, admin_headers, configured, fresh_limit):
    configured.answers = {"anthropic": 401, "openai": 403, "/about": 500}
    results = _by_key(await client.post(URL, headers=admin_headers))
    assert results["anthropic"]["ok"] is False and "rejected" in results["anthropic"]["detail"] and "401" in results["anthropic"]["detail"]
    assert results["openai"]["ok"] is False and "403" in results["openai"]["detail"]
    assert results["code_sandbox"]["ok"] is False and "HTTP 500" in results["code_sandbox"]["detail"]
    assert results["mongodb"]["ok"] is True and results["pinecone"]["ok"] is True


async def test_errors_never_echo_a_key_or_a_url_query(client, admin_headers, configured, monkeypatch, fresh_limit):
    configured.answers = {
        "anthropic": RuntimeError(f"failed with {ANTHROPIC_KEY} at https://api.anthropic.com/v1/models?token=abc999"),
        "openai": ConnectionError(f"Bearer {OPENAI_KEY} refused"),
    }
    broken = FakeIndex(error=RuntimeError(f"index rejected {PINECONE_KEY}"))
    monkeypatch.setattr(lc, "get_pinecone", lambda: broken)
    response = await client.post(URL, headers=admin_headers)
    for leak in (ANTHROPIC_KEY, OPENAI_KEY, PINECONE_KEY, "abc999"):
        assert leak not in response.text
    results = _by_key(response)
    assert results["anthropic"]["ok"] is False and results["openai"]["ok"] is False and results["pinecone"]["ok"] is False
    assert results["anthropic"]["detail"].startswith("RuntimeError")


async def test_a_check_that_hangs_is_cut_off_and_the_others_still_report(client, admin_headers, configured, monkeypatch, fresh_limit):
    monkeypatch.setattr(lc, "CHECK_TIMEOUT_SECONDS", 0.5)
    configured.answers = {"anthropic": ("sleep", 30)}
    started = time.monotonic()
    results = _by_key(await client.post(URL, headers=admin_headers))
    assert time.monotonic() - started < 3
    assert results["anthropic"]["ok"] is False and results["anthropic"]["detail"] == "No answer within 0.5 seconds"
    assert results["openai"]["ok"] is True and results["mongodb"]["ok"] is True


async def test_the_checks_run_at_the_same_time(client, admin_headers, configured, fresh_limit):
    configured.answers = {"anthropic": ("sleep", 0.6), "openai": ("sleep", 0.6), "/about": ("sleep", 0.6)}
    started = time.monotonic()
    response = await client.post(URL, headers=admin_headers)
    assert response.status_code == 200
    assert time.monotonic() - started < 1.5


async def test_the_default_timeout_is_eight_seconds():
    assert lc.CHECK_TIMEOUT_SECONDS == 8.0


async def test_pinecone_with_a_key_but_no_open_index(client, admin_headers, configured, monkeypatch, fresh_limit):
    monkeypatch.setattr(lc, "get_pinecone", lambda: None)
    result = _by_key(await client.post(URL, headers=admin_headers))["pinecone"]
    assert result["ok"] is False and "could not be opened" in result["detail"]


async def test_the_piston_sandbox_is_checked_at_its_runtimes_endpoint(client, admin_headers, configured, monkeypatch, fresh_limit):
    monkeypatch.setattr(settings, "CODE_SANDBOX_PROVIDER", "piston")
    monkeypatch.setattr(settings, "PISTON_API_URL", "http://piston.test/api/v2/")
    monkeypatch.setattr(settings, "PISTON_API_KEY", "piston-secret-key-1")
    result = _by_key(await client.post(URL, headers=admin_headers))["code_sandbox"]
    assert result["ok"] is True and "Piston" in result["label"]
    call = next(c for c in configured.calls if "piston" in c["url"])
    assert call["url"] == "http://piston.test/api/v2/runtimes"
    assert call["headers"] == {"Authorization": "Bearer piston-secret-key-1"}


async def test_the_hosted_judge0_variant_sends_its_rapidapi_headers(client, admin_headers, configured, monkeypatch, fresh_limit):
    monkeypatch.setattr(settings, "JUDGE0_API_HOST", "judge0-ce.p.rapidapi.com")
    monkeypatch.setattr(settings, "JUDGE0_API_KEY", "rapid-key-000111")
    await client.post(URL, headers=admin_headers)
    call = next(c for c in configured.calls if c["url"].endswith("/about"))
    assert call["headers"] == {"X-RapidAPI-Host": "judge0-ce.p.rapidapi.com", "X-RapidAPI-Key": "rapid-key-000111"}


async def test_a_database_that_is_not_connected_is_reported(client, admin_headers, configured, monkeypatch, fresh_limit):
    monkeypatch.setattr(lc, "get_db", lambda: None)
    result = _by_key(await client.post(URL, headers=admin_headers))["mongodb"]
    assert result["ok"] is False and result["detail"] == "The database is not connected"


async def test_six_checks_in_ten_minutes_then_a_429_with_a_string_detail(client, admin_headers, configured, fresh_limit):
    for _ in range(6):
        assert (await client.post(URL, headers=admin_headers)).status_code == 200
    limited = await client.post(URL, headers=admin_headers)
    assert limited.status_code == 429
    assert isinstance(limited.json()["detail"], str) and limited.json()["detail"]


async def test_a_run_is_audited_with_the_failing_services(client, admin_headers, configured, fresh_limit):
    configured.answers = {"openai": 401}
    started = datetime.now(timezone.utc).isoformat()
    await client.post(URL, headers=admin_headers)
    row = await get_db().audit_log.find_one({"action": "live_check", "created_at": {"$gte": started}})
    assert row is not None and row["actor_email"] == "demo-admin@hirely.ai"
    assert row["details"] == {"failed": ["openai"]}
    assert OPENAI_KEY not in str(row)
