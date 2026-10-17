import json

import pytest
from httpx import ASGITransport, AsyncClient

from config.settings import settings
from main import app
from services.hr_module import platform_ai
from services.hr_module import platform_service as svc
from shared.auth import require_platform_admin

pytestmark = pytest.mark.anyio

ANTHROPIC_KEY = "sk-ant-api03-SECRETSECRETSECRET-ab12"
OPENAI_KEY = "sk-proj-VERYSECRETVALUE-cd34"
SINCE = "2026-10-01T00:00:00+00:00"
UNTIL = "2026-11-01T00:00:00+00:00"


@pytest.fixture(autouse=True)
def keys(monkeypatch):
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", ANTHROPIC_KEY)
    monkeypatch.setattr(settings, "OPENAI_API_KEY", OPENAI_KEY)
    monkeypatch.setattr(settings, "DEFAULT_LLM_MODEL", "claude-haiku-4-5")
    monkeypatch.setattr(settings, "RESUME_CLASSIFICATION_MODEL", "claude-haiku-4-5")
    monkeypatch.setattr(settings, "RESUME_EMBEDDING_MODEL", "text-embedding-3-small")


def company(cid="cmp_a", name="Alpha", **settings_doc):
    return {"company_id": cid, "name": name, "slug": cid[4:], "client_id": "cli_1", "settings": settings_doc}


def test_a_key_is_named_and_masked_never_returned():
    status = platform_ai.key_status()
    assert [(k["id"], k["env_var"], k["configured"], k["scope"]) for k in status] == [
        ("anthropic", "ANTHROPIC_API_KEY", True, "platform"),
        ("openai", "OPENAI_API_KEY", True, "platform"),
    ]
    assert status[0]["mask"] == "********ab12"
    assert status[1]["mask"] == "********cd34"
    blob = json.dumps(status)
    assert ANTHROPIC_KEY not in blob and OPENAI_KEY not in blob
    assert "SECRETSECRET" not in blob and "VERYSECRET" not in blob


def test_a_key_that_is_not_set_says_so(monkeypatch):
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "")
    anthropic = platform_ai.key_status()[0]
    assert anthropic["configured"] is False and anthropic["mask"] is None


def test_every_ai_job_is_listed_with_its_model_provider_and_key():
    jobs, default = platform_ai.describe(company())
    from config.llm import TASKS
    assert [j["key"] for j in jobs] == list(TASKS)
    assert default == "claude-haiku-4-5"
    by_key = {j["key"]: j for j in jobs}
    assert (by_key["interview"]["model"], by_key["interview"]["provider"], by_key["interview"]["key_env"]) == (
        "claude-haiku-4-5", "anthropic", "ANTHROPIC_API_KEY")
    for task in ("speech", "transcription", "embedding"):
        assert (by_key[task]["provider"], by_key[task]["key_env"]) == ("openai", "OPENAI_API_KEY")
    assert not any(j["custom"] for j in jobs)


def test_a_companys_own_choice_for_a_job_moves_that_job_to_the_other_key():
    jobs, default = platform_ai.describe(company(task_models={"interview": "gpt-5-mini", "resume": "claude-sonnet-5-5"}))
    by_key = {j["key"]: j for j in jobs}
    assert (by_key["interview"]["model_name"], by_key["interview"]["provider"], by_key["interview"]["custom"]) == (
        "GPT-5 Mini", "openai", True)
    assert by_key["interview"]["default_model"] == default
    assert (by_key["resume"]["provider"], by_key["resume"]["custom"]) == ("anthropic", True)
    assert by_key["scenario"]["custom"] is False and by_key["scenario"]["provider"] == "anthropic"


def test_a_companys_default_model_is_what_its_unset_jobs_follow():
    jobs, default = platform_ai.describe(company(default_llm_model="gpt-4.1-mini"))
    assert default == "gpt-4.1-mini"
    by_key = {j["key"]: j for j in jobs}
    assert (by_key["job_description"]["model"], by_key["job_description"]["provider"]) == ("gpt-4.1-mini", "openai")
    assert by_key["code_quality"]["model"] == settings.CODE_EVAL_MODEL


def test_a_job_on_a_provider_without_a_key_is_not_ready(monkeypatch):
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "")
    jobs, _ = platform_ai.describe(company(task_models={"interview": "gpt-5-mini"}))
    by_key = {j["key"]: j for j in jobs}
    assert by_key["interview"]["ready"] is False
    assert by_key["embedding"]["ready"] is False
    assert by_key["scenario"]["ready"] is True


def test_describing_a_company_leaves_no_company_bound():
    from config import tenancy
    before = tenancy.current_company_id()
    platform_ai.describe(company())
    assert tenancy.current_company_id() == before


class FakeCursor:
    def __init__(self, rows):
        self.rows = rows

    async def to_list(self, length=None):
        return self.rows


class LedgerRaw:

    def __init__(self, chat=(), voice=(), totals=(), embedding=()):
        self.pipelines = []
        self._answers = {"chat": list(chat), "embedding": list(embedding), "voice": list(voice), "totals": list(totals)}
        self.cost_ledger = self

    def aggregate(self, pipeline, *args, **kwargs):
        self.pipelines.append(pipeline)
        stages = {next(iter(s)) for s in pipeline}
        match = pipeline[0]["$match"]
        if "$unwind" in stages:
            kind = "chat" if pipeline[1]["$project"]["m"] == {"$objectToArray": "$models"} else "embedding"
        elif match.get("cost_type") == {"$in": ["tts", "stt"]}:
            kind = "voice"
        else:
            kind = "totals"
        return FakeCursor(self._answers[kind])


def chat(cid, model, calls, tin, tout, cost):
    return {"_id": {"company": cid, "model": model}, "calls": calls, "tokens_in": tin, "tokens_out": tout, "cost": cost}


async def test_the_ledger_is_read_in_four_grouped_aggregates_however_many_companies():
    raw = LedgerRaw()
    ids = [f"cmp_{i}" for i in range(40)]
    await platform_ai.usage_by_company(raw, ids, SINCE, None)
    assert len(raw.pipelines) == 4
    for pipeline in raw.pipelines:
        assert pipeline[0]["$match"]["company_id"] == {"$in": ids}


async def test_a_window_has_no_upper_bound_and_a_month_is_half_open():
    window, month = LedgerRaw(), LedgerRaw()
    await platform_ai.usage_by_company(window, ["cmp_a"], SINCE, None)
    await platform_ai.usage_by_company(month, ["cmp_a"], SINCE, UNTIL)
    assert all(p[0]["$match"]["created_at"] == {"$gte": SINCE} for p in window.pipelines)
    assert all(p[0]["$match"]["created_at"] == {"$gte": SINCE, "$lt": UNTIL} for p in month.pipelines)


async def test_chat_models_are_unrolled_from_the_per_model_map_of_each_row():
    raw = LedgerRaw()
    await platform_ai.usage_by_company(raw, ["cmp_a"], SINCE, None)
    chat_pipeline = next(p for p in raw.pipelines if any("$unwind" in s for s in p) and "models" in p[0]["$match"])
    assert chat_pipeline[0]["$match"]["models"] == {"$type": "object"}
    assert chat_pipeline[1]["$project"]["m"] == {"$objectToArray": "$models"}


async def test_embedding_models_are_unrolled_from_their_own_map():
    raw = LedgerRaw()
    await platform_ai.usage_by_company(raw, ["cmp_a"], SINCE, None)
    embedding_pipeline = next(p for p in raw.pipelines if "embedding_models" in p[0]["$match"])
    assert embedding_pipeline[0]["$match"]["embedding_models"] == {"$type": "object"}
    assert embedding_pipeline[1]["$project"]["m"] == {"$objectToArray": "$embedding_models"}


async def test_models_are_shaped_per_company_with_their_provider_and_cost():
    raw = LedgerRaw(
        chat=[chat("cmp_a", "claude-haiku-4-5", 55, 66103, 47133, 0.301768), chat("cmp_a", "gpt-5-mini", 4, 1000, 500, 0.0013),
              chat("cmp_b", "claude-haiku-4-5", 2, 400, 200, 0.0014)],
        voice=[{"_id": {"company": "cmp_a", "type": "tts", "model": "gpt-4o-mini-tts"}, "calls": 12, "cost": 0.05},
               {"_id": {"company": "cmp_a", "type": "stt", "model": "whisper-1"}, "calls": 9, "cost": 0.02}],
        totals=[{"_id": "cmp_a", "cost": 0.303068 + 0.0004, "embedding_calls": 55, "embedding_tokens": 22095},
                {"_id": "cmp_b", "cost": 0.0014, "embedding_calls": 0, "embedding_tokens": 0}],
    )
    used = await platform_ai.usage_by_company(raw, ["cmp_a", "cmp_b", "cmp_c"], SINCE, None)

    assert [(r["kind"], r["name"], r["provider"]) for r in used["cmp_a"]] == [
        ("chat", "Claude Haiku 4.5", "anthropic"),
        ("speech", "GPT-4o Mini TTS", "openai"),
        ("transcription", "Whisper", "openai"),
        ("chat", "GPT-5 Mini", "openai"),
        ("embedding", "Text Embedding 3 Small", "openai"),
    ]
    haiku = used["cmp_a"][0]
    assert (haiku["calls"], haiku["tokens_in"], haiku["tokens_out"], haiku["cost_usd"]) == (55, 66103, 47133, 0.301768)
    embeddings = used["cmp_a"][-1]
    assert embeddings["model"] == "text-embedding-3-small" and embeddings["calls"] == 55 and embeddings["tokens_in"] == 22095
    assert embeddings["cost_usd"] == pytest.approx(0.0004, abs=1e-6)
    assert [r["name"] for r in used["cmp_b"]] == ["Claude Haiku 4.5"]
    assert used["cmp_c"] == []


async def test_embeddings_are_shown_under_the_model_that_made_them():
    raw = LedgerRaw(
        embedding=[{"_id": {"company": "cmp_a", "model": "text-embedding-3-large"}, "calls": 10, "tokens": 5000, "cost": 0.00065}],
        totals=[{"_id": "cmp_a", "cost": 0.00065, "embedding_calls": 10, "embedding_tokens": 5000}],
    )
    used = (await platform_ai.usage_by_company(raw, ["cmp_a"], SINCE, None))["cmp_a"]
    assert [(r["kind"], r["model"], r["name"], r["calls"], r["tokens_in"], r["cost_usd"]) for r in used] == [
        ("embedding", "text-embedding-3-large", "Text Embedding 3 Large", 10, 5000, 0.00065)]


async def test_embeddings_from_before_the_model_was_recorded_join_the_platform_default():
    raw = LedgerRaw(
        embedding=[{"_id": {"company": "cmp_a", "model": "text-embedding-3-large"}, "calls": 10, "tokens": 5000, "cost": 0.00065}],
        totals=[{"_id": "cmp_a", "cost": 0.00065 + 0.00002, "embedding_calls": 15, "embedding_tokens": 6000}],
    )
    used = (await platform_ai.usage_by_company(raw, ["cmp_a"], SINCE, None))["cmp_a"]
    by_model = {r["model"]: r for r in used}
    assert set(by_model) == {"text-embedding-3-large", "text-embedding-3-small"}
    large, small = by_model["text-embedding-3-large"], by_model["text-embedding-3-small"]
    assert (large["calls"], large["tokens_in"]) == (10, 5000)
    assert (small["calls"], small["tokens_in"]) == (5, 1000)
    assert small["cost_usd"] == pytest.approx(0.00002, abs=1e-6)
    assert sum(r["calls"] for r in used) == 15


async def test_nothing_is_added_when_every_embedding_call_was_recorded_by_model():
    raw = LedgerRaw(
        embedding=[{"_id": {"company": "cmp_a", "model": "text-embedding-3-small"}, "calls": 7, "tokens": 700, "cost": 0.000014}],
        totals=[{"_id": "cmp_a", "cost": 0.000014, "embedding_calls": 7, "embedding_tokens": 700}],
    )
    used = (await platform_ai.usage_by_company(raw, ["cmp_a"], SINCE, None))["cmp_a"]
    assert [(r["model"], r["calls"]) for r in used] == [("text-embedding-3-small", 7)]


async def test_a_model_nobody_listed_is_shown_by_its_id_and_routed_by_its_prefix():
    raw = LedgerRaw(chat=[chat("cmp_a", "claude-haiku-4-0", 1, 10, 5, 0.001), chat("cmp_a", "ft:custom-model", 1, 10, 5, 0.002)])
    used = (await platform_ai.usage_by_company(raw, ["cmp_a"], SINCE, None))["cmp_a"]
    assert {(r["name"], r["provider"]) for r in used} == {("claude-haiku-4-0", "anthropic"), ("ft:custom-model", "openai")}


async def test_no_companies_means_no_reads():
    raw = LedgerRaw()
    assert await platform_ai.usage_by_company(raw, [], SINCE, None) == {}
    assert raw.pipelines == []


async def test_the_overview_sums_each_keys_traffic_and_orders_companies_by_spend():
    raw = LedgerRaw(
        chat=[chat("cmp_a", "claude-haiku-4-5", 10, 100, 50, 0.01), chat("cmp_b", "gpt-5-mini", 5, 100, 50, 0.5),
              chat("cmp_b", "claude-haiku-4-5", 3, 100, 50, 0.02)],
        totals=[{"_id": "cmp_a", "cost": 0.01, "embedding_calls": 0}, {"_id": "cmp_b", "cost": 0.52, "embedding_calls": 0}],
    )
    companies = [company("cmp_a", "Alpha"), company("cmp_b", "Bravo", task_models={"interview": "gpt-5-mini"}),
                 company("cmp_c", "Charlie")]
    data = await platform_ai.overview(raw, [{"client_id": "cli_1", "name": "Acme"}], companies, SINCE, None)

    assert [c["name"] for c in data["companies"]] == ["Bravo", "Alpha", "Charlie"]
    bravo = data["companies"][0]
    assert (bravo["client_name"], bravo["custom_jobs"], bravo["default_model"], bravo["cost_usd"]) == ("Acme", 1, "claude-haiku-4-5", 0.52)
    assert bravo["providers"]["openai"] == {"calls": 5, "cost_usd": 0.5}
    assert bravo["providers"]["anthropic"] == {"calls": 3, "cost_usd": 0.02}

    keys = {k["id"]: k for k in data["keys"]}
    assert (keys["anthropic"]["companies"], keys["anthropic"]["calls"], keys["anthropic"]["cost_usd"]) == (2, 13, 0.03)
    assert (keys["openai"]["companies"], keys["openai"]["calls"], keys["openai"]["cost_usd"]) == (1, 5, 0.5)
    assert [(m["name"], m["calls"], m["cost_usd"]) for m in keys["anthropic"]["models"]] == [("Claude Haiku 4.5", 13, 0.03)]
    assert [(m["name"], m["calls"]) for m in keys["openai"]["models"]] == [("GPT-5 Mini", 5)]
    assert all(len(c["jobs"]) == 13 for c in data["companies"])
    assert sum(j["custom"] for j in bravo["jobs"]) == 1
    assert ANTHROPIC_KEY not in json.dumps(data) and OPENAI_KEY not in json.dumps(data)


async def test_one_companys_detail_has_its_jobs_its_traffic_and_the_keys():
    raw = LedgerRaw(chat=[chat("cmp_a", "claude-haiku-4-5", 4, 10, 5, 0.004)], totals=[{"_id": "cmp_a", "cost": 0.004, "embedding_calls": 0}])
    detail = await platform_ai.company_ai(raw, company(task_models={"interview": "gpt-5-mini"}), SINCE, None)
    assert detail["default_model"] == "claude-haiku-4-5" and detail["default_name"] == "Claude Haiku 4.5"
    assert len(detail["jobs"]) == 13 and sum(j["custom"] for j in detail["jobs"]) == 1
    assert [u["name"] for u in detail["used"]] == ["Claude Haiku 4.5"]
    keys = {k["id"]: k for k in detail["keys"]}
    assert (keys["anthropic"]["calls"], keys["openai"]["calls"]) == (4, 0)
    assert [m["name"] for m in keys["anthropic"]["models"]] == ["Claude Haiku 4.5"] and keys["openai"]["models"] == []


@pytest.fixture
async def http(monkeypatch):
    async def fake_ai_models(period):
        return {"keys": platform_ai.key_status(), "companies": [], "period": svc.as_period(period).payload()}

    monkeypatch.setattr(svc, "ai_models", fake_ai_models)
    monkeypatch.setattr(svc, "CACHE_SECONDS", 0)
    monkeypatch.setattr(svc, "_raw", lambda: object())
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as client:
        yield client
    app.dependency_overrides.pop(require_platform_admin, None)


async def test_the_route_is_for_platform_owners_only(http):
    assert (await http.get("/api/v1/platform/ai")).status_code in (401, 403)


async def test_the_route_answers_a_platform_owner_with_keys_masked(http):
    app.dependency_overrides[require_platform_admin] = lambda: {"email": "owner@example.com", "is_platform_admin": True}
    response = await http.get("/api/v1/platform/ai?window=7")
    assert response.status_code == 200
    body = response.json()
    assert [k["id"] for k in body["keys"]] == ["anthropic", "openai"]
    assert body["period"]["kind"] == "window" and "computed_at" in body
    assert ANTHROPIC_KEY not in response.text and OPENAI_KEY not in response.text


async def test_the_route_refuses_a_window_the_console_does_not_offer(http):
    app.dependency_overrides[require_platform_admin] = lambda: {"email": "owner@example.com", "is_platform_admin": True}
    assert (await http.get("/api/v1/platform/ai?window=11")).status_code == 422
