import copy
import re
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from httpx import ASGITransport, AsyncClient

import config.database as database
from config import llm, tenancy
from config.settings import Settings, settings
from config.tenancy import DEFAULT_COMPANY_ID, company_context
from fake_mongo import FakeRaw
from main import app
from services.hr_module import model_task_service as svc
from shared import auth as auth_module, quotas

pytestmark = pytest.mark.anyio

A, B = "cmp_a", "cmp_b"
API = "/api/v1/model-tasks"
ADMIN = {"Authorization": f"Bearer demo-admin-token@@{A}"}
STANDARD = {"Authorization": f"Bearer demo-standard-token@@{A}"}
LARGE = "text-embedding-3-large"
BACKEND = Path(__file__).resolve().parents[2]


def _company(**task_models):
    return {"settings": {"task_models": task_models, "default_llm_model": "claude-sonnet-5-5"}}


def test_a_requests_own_model_beats_the_company_choice_which_beats_the_default():
    with company_context("cmp_x", company=_company(interview="gpt-5.4")):
        assert llm.model_for("interview", "claude-opus-5-5") == "claude-opus-5-5"
        assert llm.model_for("interview") == "gpt-5.4"
        assert llm.model_for("interview_guide") == "claude-sonnet-5-5"


def test_a_job_with_its_own_platform_setting_falls_back_to_that_not_the_company_default(monkeypatch):
    monkeypatch.setattr(settings, "RESUME_CLASSIFICATION_MODEL", "claude-haiku-4-5")
    monkeypatch.setattr(settings, "CODE_EVAL_MODEL", "claude-sonnet-5")
    with company_context("cmp_x", company=_company()):
        assert llm.model_for("resume") == "claude-haiku-4-5"
        assert llm.model_for("code_quality") == "claude-sonnet-5"
    with company_context("cmp_x", company=_company(resume="gpt-5-nano")):
        assert llm.model_for("resume") == "gpt-5-nano"


def test_one_companys_choice_never_reaches_another():
    with company_context("cmp_x", company=_company(interview="gpt-5.4")):
        assert llm.model_for("interview") == "gpt-5.4"
    with company_context("cmp_y", company={"settings": {}}):
        assert llm.model_for("interview") == settings.DEFAULT_LLM_MODEL


def test_an_empty_or_malformed_stored_choice_is_ignored():
    for bad in ("", None, 7, ["gpt-5"]):
        with company_context("cmp_x", company={"settings": {"task_models": {"interview": bad}}}):
            assert llm.model_for("interview") == settings.DEFAULT_LLM_MODEL
    with company_context("cmp_x", company={"settings": {"task_models": "nonsense"}}):
        assert llm.task_override("interview") is None
        assert llm.model_for("interview") == settings.DEFAULT_LLM_MODEL


def test_an_unknown_job_is_a_programming_error_not_a_silent_default():
    with pytest.raises(KeyError):
        llm.model_for("no_such_job")


def test_every_job_has_a_label_a_group_a_known_kind_and_a_real_setting():
    for key, spec in llm.TASKS.items():
        assert spec["label"] and chr(0x2014) not in spec["label"], key
        assert spec["group"] in {"Interview", "Hiring", "Coding"}, key
        assert spec["kind"] in svc.KINDS, key
        assert "setting" not in spec or spec["setting"] in Settings.model_fields, key


def test_every_platform_default_is_offered_in_its_picker():
    defaults = Settings.model_fields
    for key, spec in llm.TASKS.items():
        offered = {o["id"] for o in llm.task_options(spec["kind"])}
        fallback = defaults[spec["setting"]].default if "setting" in spec else defaults["DEFAULT_LLM_MODEL"].default
        assert fallback in offered, f"{key}: default {fallback} is not offered"


def test_every_job_is_wired_to_its_choice_in_the_code_that_runs_it():
    sources = "\n".join(
        path.read_text(encoding="utf-8")
        for folder in ("services", "routes", "agents")
        for path in (BACKEND / folder).rglob("*.py")
        if path.name not in {"model_task_service.py"}
    )
    for key in llm.TASKS:
        assert re.search(rf"model_for\(\s*[\"']{key}[\"']", sources) or key == "embedding", f"{key} is read nowhere"
    assert "embedding_model()" in (BACKEND / "config" / "llm.py").read_text(encoding="utf-8")


def test_the_embedding_models_on_offer_all_fit_the_index():
    assert {m["id"] for m in llm.EMBEDDING_MODELS} == {"text-embedding-3-small", "text-embedding-3-large", "text-embedding-ada-002"}
    assert all(m["id"] in llm._EMBED_PRICING for m in llm.EMBEDDING_MODELS)


def test_chat_options_carry_a_price_and_availability_follows_the_key(monkeypatch):
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "")
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "sk-ant-test")
    rows = svc.list_tasks()
    chat = {o["id"]: o for o in rows["options"]["chat"]}
    assert chat["claude-haiku-5-5"]["price_label"] == "$0.10 / $0.50 per 1M tokens"
    assert chat["claude-haiku-5-5"]["available"] is True
    assert chat["gpt-5.4"]["available"] is False
    assert all(not o["available"] for o in rows["options"]["embedding"])


class _Embeddings:
    def __init__(self):
        self.captured = {}

    async def create(self, **kwargs):
        self.captured = kwargs
        return SimpleNamespace(data=[SimpleNamespace(embedding=[0.25] * 4)], usage=SimpleNamespace(total_tokens=3))


async def test_the_embedding_call_uses_the_companys_model_and_asks_the_large_one_for_the_index_width(monkeypatch):
    fake = SimpleNamespace(embeddings=_Embeddings())
    monkeypatch.setattr(llm, "get_openai_client", lambda: fake)
    with company_context("cmp_x", company=_company(embedding=LARGE)):
        await llm.get_embedding("hello")
    assert fake.embeddings.captured["model"] == LARGE
    assert fake.embeddings.captured["dimensions"] == settings.EMBEDDING_DIMENSIONS

    with company_context("cmp_x", company=_company(embedding="text-embedding-ada-002")):
        await llm.get_embedding("hello")
    assert fake.embeddings.captured["model"] == "text-embedding-ada-002"
    assert "dimensions" not in fake.embeddings.captured

    with company_context("cmp_x", company=_company()):
        await llm.get_embedding("hello")
    assert fake.embeddings.captured == {"model": settings.RESUME_EMBEDDING_MODEL, "input": "hello"}


def test_a_stored_embedding_is_current_only_for_the_model_in_use():
    with company_context("cmp_x", company=_company()):
        assert llm.embedding_is_current(None) is True
        assert llm.embedding_is_current(settings.RESUME_EMBEDDING_MODEL) is True
        assert llm.embedding_is_current(LARGE) is False
    with company_context("cmp_x", company=_company(embedding=LARGE)):
        assert llm.embedding_is_current(None) is False
        assert llm.embedding_is_current(LARGE) is True


class _Index:

    def __init__(self):
        self.upserts = []

    def upsert(self, vectors, namespace=""):
        for v in vectors:
            self.upserts.append({"id": v["id"], "namespace": namespace, "metadata": v["metadata"], "values": v["values"]})


@pytest.fixture
async def world(monkeypatch):
    raw = FakeRaw()
    raw.add("companies", {"company_id": A, "name": "Acme", "status": "active", "settings": {}}, A)
    index = _Index()
    monkeypatch.setattr(database, "_db", raw)
    monkeypatch.setattr(svc, "get_pinecone", lambda: index)
    monkeypatch.setattr(quotas, "check_ai_action", AsyncMock())

    real_bind = auth_module.bind_company

    def bind_stored(company_id, company):
        stored = next((d for d in raw["companies"].docs if d["company_id"] == company_id), None)
        real_bind(company_id, {**company, "settings": copy.deepcopy((stored or {}).get("settings") or {})})

    monkeypatch.setattr(auth_module, "bind_company", bind_stored)
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "sk-test")
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "sk-ant-test")
    tenancy.use_fallback_company(None)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as client:
        yield SimpleNamespace(raw=raw, index=index, client=client)
    tenancy.use_fallback_company(DEFAULT_COMPANY_ID)


def _stored(world, company=A):
    (doc,) = [d for d in world.raw["companies"].docs if d["company_id"] == company]
    return (doc.get("settings") or {}).get("task_models") or {}


async def test_an_admin_sees_every_job_with_the_model_it_runs_on(world):
    response = await world.client.get(API, headers=ADMIN)
    assert response.status_code == 200, response.text
    body = response.json()
    assert [t["key"] for t in body["tasks"]] == list(llm.TASKS)
    interview = next(t for t in body["tasks"] if t["key"] == "interview")
    assert interview["override"] is None
    assert interview["model"] == interview["default_model"] == body["default_model"]
    assert set(body["options"]) == set(svc.KINDS)
    assert chr(0x2014) not in response.text


async def test_only_an_admin_may_read_or_change_it(world):
    for method, path, payload in (
        ("get", API, None), ("put", f"{API}/interview", {"model": "gpt-5.4"}),
        ("get", f"{API}/embedding/status", None), ("post", f"{API}/embedding/reindex", None),
    ):
        assert (await world.client.request(method, path, json=payload, headers=STANDARD)).status_code == 403, path
        assert (await world.client.request(method, path, json=payload)).status_code == 401, path
    assert _stored(world) == {}


async def test_choosing_a_model_stores_it_on_the_company_and_audits_it(world):
    response = await world.client.put(f"{API}/interview", json={"model": "gpt-5.4"}, headers=ADMIN)
    assert response.status_code == 200, response.text
    row = response.json()
    assert row["model"] == "gpt-5.4" and row["override"] == "gpt-5.4" and row["model_name"] == "GPT-5.4"
    assert row["price_label"] == "$2.50 / $15 per 1M tokens"
    assert _stored(world) == {"interview": "gpt-5.4"}
    (audit,) = world.raw.rows("audit_log", action="task_model_change")
    assert audit["details"]["task"] == "interview" and audit["details"]["to"] == "gpt-5.4"
    again = (await world.client.get(API, headers=ADMIN)).json()
    assert next(t for t in again["tasks"] if t["key"] == "interview")["model"] == "gpt-5.4"


async def test_clearing_a_choice_returns_the_job_to_its_default(world):
    await world.client.put(f"{API}/resume", json={"model": "gpt-5-nano"}, headers=ADMIN)
    assert _stored(world) == {"resume": "gpt-5-nano"}
    for cleared in ({"model": None}, {"model": ""}, {}):
        await world.client.put(f"{API}/resume", json={"model": "gpt-5-nano"}, headers=ADMIN)
        response = await world.client.put(f"{API}/resume", json=cleared, headers=ADMIN)
        assert response.status_code == 200 and response.json()["override"] is None, cleared
        assert _stored(world) == {}
        assert response.json()["model"] == settings.RESUME_CLASSIFICATION_MODEL


async def test_a_bad_choice_is_refused_and_nothing_changes(world):
    before = world.raw.snapshot(A)
    cases = [
        ("interview", "no-such-model", "Unknown model"),
        ("interview", "text-embedding-3-small", "Unknown model"),
        ("embedding", "gpt-5.4", "Unknown model"),
        ("speech", "whisper-1", "Unknown model"),
        ("transcription", "tts-1", "Unknown model"),
    ]
    for task, model, fragment in cases:
        response = await world.client.put(f"{API}/{task}", json={"model": model}, headers=ADMIN)
        assert response.status_code == 400 and fragment in response.json()["detail"], (task, model)
    assert (await world.client.put(f"{API}/no_such_job", json={"model": "gpt-5.4"}, headers=ADMIN)).status_code == 404
    assert world.raw.snapshot(A) == before


async def test_a_model_whose_provider_has_no_key_is_refused_with_a_plain_reason(world, monkeypatch):
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "")
    response = await world.client.put(f"{API}/interview", json={"model": "gpt-5.4"}, headers=ADMIN)
    assert response.status_code == 400
    assert response.json()["detail"] == "OpenAI is not set up on this platform, so GPT-5.4 cannot be used yet"
    assert _stored(world) == {}
    assert (await world.client.put(f"{API}/interview", json={"model": "claude-haiku-5-5"}, headers=ADMIN)).status_code == 200


async def test_speech_and_transcription_take_their_own_models(world):
    assert (await world.client.put(f"{API}/speech", json={"model": "tts-1-hd"}, headers=ADMIN)).status_code == 200
    assert (await world.client.put(f"{API}/transcription", json={"model": "gpt-4o-mini-transcribe"}, headers=ADMIN)).status_code == 200
    assert _stored(world) == {"speech": "tts-1-hd", "transcription": "gpt-4o-mini-transcribe"}


def _resume(world, rid, model=None, **extra):
    doc = {
        "doc_type": "resume", "resume_id": rid, "processing_status": "processed", "text": f"CV text {rid}",
        "classification": {"job_domain": "devops", "skills": ["k8s"], "seniority_level": "senior"},
        "embedding": [0.1, 0.2], **extra,
    }
    if model:
        doc["embedding_model"] = model
    world.raw.add("resumes", doc, A)


def _job(world, jid, model=None, **extra):
    doc = {
        "doc_type": "job", "job_id": jid, "title": f"Job {jid}", "description": "Do things",
        "parsed_criteria": {"job_domain": "devops", "experience_level": "senior", "skills": ["k8s"]},
        "embedding": [0.1, 0.2], **extra,
    }
    if model:
        doc["embedding_model"] = model
    world.raw.add("jobs", doc, A)


def _use_large(world):
    world.raw["companies"].docs[0]["settings"] = {"task_models": {"embedding": LARGE}}


async def test_nothing_is_stale_while_the_platform_default_is_in_use(world):
    _resume(world, "r1")
    _resume(world, "r2", model=settings.RESUME_EMBEDDING_MODEL)
    _job(world, "j1")
    status = (await world.client.get(f"{API}/embedding/status", headers=ADMIN)).json()
    assert status == {
        "model": settings.RESUME_EMBEDDING_MODEL, "platform_default": settings.RESUME_EMBEDDING_MODEL,
        "stale_jobs": 0, "stale_resumes": 0, "stale_total": 0,
    }


async def test_switching_the_model_makes_everything_stored_before_it_stale(world):
    _resume(world, "r1")
    _resume(world, "r2", model=LARGE)
    _resume(world, "r3", processing_status="failed")
    _resume(world, "r4", text="")
    _job(world, "j1")
    _job(world, "j2", model=LARGE)
    _job(world, "j3", embedding=[])
    _use_large(world)
    status = (await world.client.get(f"{API}/embedding/status", headers=ADMIN)).json()
    assert status["model"] == LARGE
    assert (status["stale_resumes"], status["stale_jobs"], status["stale_total"]) == (1, 1, 2)


async def test_a_document_stored_with_no_usable_vector_is_counted_even_on_the_platform_default(world):
    _resume(world, "ok", model=settings.RESUME_EMBEDDING_MODEL)
    _resume(world, "zeros", embedding=[0.0, 0.0])
    _resume(world, "empty", embedding=[])
    _resume(world, "failed", embedding=[0.0, 0.0], processing_status="failed")
    _job(world, "j-ok")
    _job(world, "j-zeros", embedding=[0.0, 0.0])
    _job(world, "j-unparsed", embedding=[])
    status = (await world.client.get(f"{API}/embedding/status", headers=ADMIN)).json()
    assert (status["stale_resumes"], status["stale_jobs"], status["stale_total"]) == (2, 1, 3)


async def test_reindex_gives_a_blank_document_its_vector_and_leaves_the_rest_alone(world, monkeypatch):
    async def fake_embedding(text):
        return [0.5] * 4

    monkeypatch.setattr(svc, "get_embedding", fake_embedding)
    _resume(world, "good", model=settings.RESUME_EMBEDDING_MODEL)
    _resume(world, "zeros", embedding=[0.0, 0.0])
    _resume(world, "empty", embedding=[])

    body = (await world.client.post(f"{API}/embedding/reindex", params={"cursor": "resumes:"}, headers=ADMIN)).json()
    assert (body["processed"], body["failed"], body["remaining"], body["done"]) == (2, 0, 0, True)
    assert {u["id"] for u in world.index.upserts} == {"zeros", "empty"}
    by_id = {d["resume_id"]: d for d in world.raw["resumes"].docs}
    assert by_id["zeros"]["embedding"] == [0.5] * 4 and by_id["empty"]["embedding"] == [0.5] * 4
    assert by_id["zeros"]["embedding_model"] == settings.RESUME_EMBEDDING_MODEL
    assert by_id["good"]["embedding"] == [0.1, 0.2]


async def test_reindex_walks_jobs_then_cvs_and_stamps_what_it_re_embeds(world, monkeypatch):
    async def fake_embedding(text):
        return [0.5] * 4

    monkeypatch.setattr(svc, "get_embedding", fake_embedding)
    for n in range(3):
        _resume(world, f"r{n}")
    for n in range(2):
        _job(world, f"j{n}")
    _use_large(world)

    cursor, seen, calls = None, [], 0
    while True:
        params = {"limit": 2, **({"cursor": cursor} if cursor else {})}
        response = await world.client.post(f"{API}/embedding/reindex", params=params, headers=ADMIN)
        assert response.status_code == 200, response.text
        body = response.json()
        calls += 1
        seen.append((body["processed"], body["failed"]))
        assert body["model"] == LARGE
        if body["done"]:
            assert body["next_cursor"] is None and body["remaining"] == 0
            break
        cursor = body["next_cursor"]
        assert calls < 10, "the walk did not end"

    assert sum(p for p, _ in seen) == 5 and sum(f for _, f in seen) == 0
    assert {(u["id"], u["namespace"]) for u in world.index.upserts} == {
        ("j0", "jobs"), ("j1", "jobs"), ("r0", ""), ("r1", ""), ("r2", ""),
    }
    for upsert in world.index.upserts:
        assert upsert["metadata"]["embedding_model"] == LARGE and upsert["metadata"]["company_id"] == A
        assert upsert["values"] == [0.5] * 4
    resume = next(u for u in world.index.upserts if u["id"] == "r0")["metadata"]
    assert resume["doc_type"] == "resume" and resume["job_domain"] == "devops" and resume["skills"] == ["k8s"]
    job = next(u for u in world.index.upserts if u["id"] == "j0")["metadata"]
    assert job["doc_type"] == "job" and job["experience_level"] == "senior"
    assert all(d["embedding_model"] == LARGE and d["embedding"] == [0.5] * 4 for d in world.raw["resumes"].docs + world.raw["jobs"].docs)


async def test_a_document_that_will_not_embed_is_counted_and_walked_past(world, monkeypatch):
    async def flaky(text):
        return [0.0] * 4 if "r1" in text else [0.5] * 4

    monkeypatch.setattr(svc, "get_embedding", flaky)
    for n in range(3):
        _resume(world, f"r{n}")
    _use_large(world)

    cursor, processed, failed, calls = "resumes:", 0, 0, 0
    while True:
        body = (await world.client.post(f"{API}/embedding/reindex", params={"limit": 1, "cursor": cursor}, headers=ADMIN)).json()
        processed, failed, calls = processed + body["processed"], failed + body["failed"], calls + 1
        if body["done"]:
            break
        cursor = body["next_cursor"]
        assert calls < 10
    assert (processed, failed) == (2, 1)
    assert body["remaining"] == 1
    r1 = next(d for d in world.raw["resumes"].docs if d["resume_id"] == "r1")
    assert r1.get("embedding_model") is None and r1["embedding"] == [0.1, 0.2]
    assert {u["id"] for u in world.index.upserts} == {"r0", "r2"}


async def test_reindex_only_touches_the_asking_company(world, monkeypatch):
    async def fake_embedding(text):
        return [0.5] * 4

    monkeypatch.setattr(svc, "get_embedding", fake_embedding)
    _resume(world, "mine")
    world.raw.add("resumes", {
        "doc_type": "resume", "resume_id": "theirs", "processing_status": "processed", "text": "other company",
        "classification": {}, "embedding": [9.0],
    }, B)
    _use_large(world)
    await world.client.post(f"{API}/embedding/reindex", params={"cursor": "resumes:"}, headers=ADMIN)
    theirs = next(d for d in world.raw["resumes"].docs if d["resume_id"] == "theirs")
    assert "embedding_model" not in theirs and theirs["embedding"] == [9.0]
    assert [u["id"] for u in world.index.upserts] == ["mine"]


async def test_reindex_rejects_a_cursor_it_did_not_issue_and_an_oversized_batch(world):
    assert (await world.client.post(f"{API}/embedding/reindex", params={"cursor": "elsewhere:1"}, headers=ADMIN)).status_code == 400
    assert (await world.client.post(f"{API}/embedding/reindex", params={"limit": 500}, headers=ADMIN)).status_code == 422
    assert (await world.client.post(f"{API}/embedding/reindex", params={"limit": 0}, headers=ADMIN)).status_code == 422
