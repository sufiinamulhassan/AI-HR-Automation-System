import ast
import asyncio
import importlib.util
import re
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient

from config import llm, tenancy
from config.settings import settings
from config.tenancy import (
    DEFAULT_COMPANY_ID,
    NO_MATCH,
    TenantContextMissing,
    TenantScopeMiddleware,
    company_context,
    current_company_id,
)
from services.hr_module import (
    cron_service,
    email_service,
    jd_intel,
    matcher,
    resume_intel,
    vector_scope,
    workspace_service,
)
from shared.auth import get_current_user, get_optional_user
from shared.utils import require_selectable_model

pytestmark = pytest.mark.anyio

BACKEND = Path(__file__).resolve().parents[2]


def _backend_sources():
    for path in BACKEND.rglob("*.py"):
        rel = path.relative_to(BACKEND).as_posix()
        if rel.split("/")[0] in {"venv", "tests", "__pycache__", "seed", "scripts"}:
            continue
        yield rel, ast.parse(path.read_text(encoding="utf-8"))


@pytest.fixture
def no_fallback():
    tenancy.use_fallback_company(None)
    yield
    tenancy.use_fallback_company(DEFAULT_COMPANY_ID)


def _platform_model_clause():
    model = settings.RESUME_EMBEDDING_MODEL
    return {"$or": [{"embedding_model": model}, {"embedding_model": {"$exists": False}}]}


def test_a_query_filter_is_the_doc_type_the_asking_company_and_its_embedding_model():
    with company_context("cmp_tp_x"):
        assert vector_scope.query_filter("resume") == {"$and": [
            {"doc_type": "resume"}, {"company_id": "cmp_tp_x"}, _platform_model_clause(),
        ]}
        assert vector_scope.query_filter("job") == {"$and": [
            {"doc_type": "job"}, {"company_id": "cmp_tp_x"}, _platform_model_clause(),
        ]}


def test_only_the_default_company_also_matches_untagged_vectors(monkeypatch):
    with company_context(DEFAULT_COMPANY_ID):
        assert vector_scope.query_filter("job") == {"$and": [
            {"doc_type": "job"},
            {"$or": [{"company_id": DEFAULT_COMPANY_ID}, {"company_id": {"$exists": False}}]},
            _platform_model_clause(),
        ]}
    with company_context("cmp_tp_x"):
        assert "$exists" not in str(vector_scope.query_filter("job")["$and"][1])

    monkeypatch.setattr(vector_scope, "MATCH_UNTAGGED_FOR_DEFAULT", False)
    with company_context(DEFAULT_COMPANY_ID):
        assert vector_scope.query_filter("job")["$and"][:2] == [
            {"doc_type": "job"}, {"company_id": DEFAULT_COMPANY_ID},
        ]


def test_a_company_on_another_embedding_model_searches_only_that_models_vectors():
    chosen = "text-embedding-3-large"
    assert chosen != settings.RESUME_EMBEDDING_MODEL
    with company_context("cmp_tp_x", company={"settings": {"task_models": {"embedding": chosen}}}):
        assert vector_scope.query_filter("resume")["$and"][2] == {"embedding_model": chosen}
        assert vector_scope.vector_metadata({"doc_type": "resume"})["embedding_model"] == chosen
    with company_context("cmp_tp_y"):
        assert vector_scope.vector_metadata({"doc_type": "resume"})["embedding_model"] == settings.RESUME_EMBEDDING_MODEL


def test_a_vector_query_or_write_with_no_company_fails_closed(no_fallback):
    with pytest.raises(TenantContextMissing):
        vector_scope.query_filter("resume")
    with pytest.raises(TenantContextMissing):
        vector_scope.vector_metadata({"doc_type": "resume"})


def test_a_link_that_named_no_company_finds_nothing_and_writes_nothing():
    with company_context(NO_MATCH):
        assert vector_scope.query_filter("resume")["$and"][1] == {"company_id": NO_MATCH}
        with pytest.raises(TenantContextMissing):
            vector_scope.vector_metadata({"doc_type": "resume"})


def test_metadata_is_stamped_without_changing_what_was_given():
    original = {"doc_type": "job", "skills": ["a"]}
    with company_context("cmp_tp_x"):
        stamped = vector_scope.vector_metadata(original)
    assert stamped == {
        "doc_type": "job", "skills": ["a"], "company_id": "cmp_tp_x",
        "embedding_model": settings.RESUME_EMBEDDING_MODEL,
    }
    assert original == {"doc_type": "job", "skills": ["a"]}


def _matching_pinecone(matches):
    pc = MagicMock()
    pc.query.return_value = MagicMock(matches=matches)
    return pc


async def test_the_matcher_queries_inside_the_asking_company(monkeypatch):
    pc = _matching_pinecone([])
    db = MagicMock()
    db.jobs.find_one = AsyncMock(return_value={"deadline_at": None})
    monkeypatch.setattr(matcher, "get_pinecone", lambda: pc)
    monkeypatch.setattr(matcher, "get_db", lambda: db)

    with company_context("cmp_tp_x"):
        await matcher.match_jd_to_resume_pool("job-1", {}, [0.1])
        await matcher.match_resume_to_jds("res-1", [0.1], {})

    filters = [call.kwargs["filter"] for call in pc.query.call_args_list]
    assert filters == [
        {"$and": [{"doc_type": "resume"}, {"company_id": "cmp_tp_x"}, _platform_model_clause()]},
        {"$and": [{"doc_type": "job"}, {"company_id": "cmp_tp_x"}, _platform_model_clause()]},
    ]


async def test_a_resume_vector_with_no_resume_in_the_company_is_never_put_in_a_pipeline(monkeypatch):
    pc = _matching_pinecone([
        {"id": "res-real", "score": 0.9, "metadata": {"job_domain": "devops"}},
        {"id": "res-ghost", "score": 0.9, "metadata": {"job_domain": "devops"}},
    ])
    db = MagicMock()
    db.jobs.find_one = AsyncMock(return_value={"deadline_at": None})
    db.jobs.update_one = AsyncMock()
    db.resumes.find.return_value.to_list = AsyncMock(return_value=[{"resume_id": "res-real"}])
    monkeypatch.setattr(matcher, "get_pinecone", lambda: pc)
    monkeypatch.setattr(matcher, "get_db", lambda: db)

    with company_context("cmp_tp_x"):
        matches = await matcher.match_jd_to_resume_pool("job-1", {"required_domain": "devops"}, [0.1])

    assert [m["resume_id"] for m in matches] == ["res-real"]
    db.jobs.update_one.assert_awaited_once()
    assert db.jobs.update_one.await_args.args[1]["$push"]["candidate_pipeline"]["resume_id"] == "res-real"


async def test_a_job_that_is_not_in_the_company_gets_no_matches(monkeypatch):
    pc = _matching_pinecone([{"id": "res-1", "score": 0.9, "metadata": {"job_domain": "devops"}}])
    db = MagicMock()
    db.jobs.find_one = AsyncMock(return_value=None)
    db.jobs.update_one = AsyncMock()
    monkeypatch.setattr(matcher, "get_pinecone", lambda: pc)
    monkeypatch.setattr(matcher, "get_db", lambda: db)

    with company_context("cmp_tp_x"):
        assert await matcher.match_jd_to_resume_pool("someone-elses-job", {"required_domain": "devops"}, [0.1]) == []
    pc.query.assert_not_called()
    db.jobs.update_one.assert_not_called()


async def test_a_job_vector_with_no_job_in_the_company_is_never_matched_to_a_resume(monkeypatch):
    pc = _matching_pinecone([
        {"id": "job-real", "score": 0.9, "metadata": {"job_domain": "devops", "experience_level": "mid"}},
        {"id": "job-ghost", "score": 0.9, "metadata": {"job_domain": "devops", "experience_level": "mid"}},
    ])
    db = MagicMock()
    db.jobs.update_one = AsyncMock()
    db.jobs.find.return_value.to_list = AsyncMock(return_value=[{"job_id": "job-real", "deadline_at": None}])
    monkeypatch.setattr(matcher, "get_pinecone", lambda: pc)
    monkeypatch.setattr(matcher, "get_db", lambda: db)

    with company_context("cmp_tp_x"):
        matches = await matcher.match_resume_to_jds("res-1", [0.1], {"job_domain": "devops", "seniority_level": "mid"})

    assert [m["job_id"] for m in matches] == ["job-real"]
    db.jobs.update_one.assert_awaited_once()


async def test_a_jd_vector_is_written_with_its_company(monkeypatch):
    pc = MagicMock()
    monkeypatch.setattr(jd_intel, "get_pinecone", lambda: pc)
    monkeypatch.setattr(jd_intel, "get_db", lambda: None)
    monkeypatch.setattr(jd_intel, "get_prompt_override", AsyncMock(return_value=None))
    monkeypatch.setattr(jd_intel, "get_embedding", AsyncMock(return_value=[0.1] * 4))
    monkeypatch.setattr(jd_intel, "ask_llm", AsyncMock(return_value="{}"))

    with company_context("cmp_tp_x"):
        await jd_intel.parse_jd("job-1", "Title", "Description")

    metadata = pc.upsert.call_args.kwargs["vectors"][0]["metadata"]
    assert metadata["company_id"] == "cmp_tp_x" and metadata["doc_type"] == "job"
    assert pc.upsert.call_args.kwargs["namespace"] == "jobs"


async def test_a_resume_vector_is_written_with_its_company(monkeypatch):
    pc = MagicMock()
    monkeypatch.setattr(resume_intel, "get_pinecone", lambda: pc)
    monkeypatch.setattr(resume_intel, "get_db", lambda: None)
    state = {
        "resume_id": "res-1", "text": "Jane Doe\nEngineer", "classification": {}, "embedding": [0.1] * 4,
        "filename": "jane.pdf", "raw_bytes": b"",
    }

    with company_context("cmp_tp_y"):
        await resume_intel.store_resume(state)
    assert pc.upsert.call_args.kwargs["vectors"][0]["metadata"]["company_id"] == "cmp_tp_y"


async def test_a_vector_write_with_no_company_bound_is_refused(monkeypatch, no_fallback):
    pc = MagicMock()
    monkeypatch.setattr(resume_intel, "get_pinecone", lambda: pc)
    monkeypatch.setattr(resume_intel, "get_db", lambda: None)
    state = {"resume_id": "res-1", "text": "x", "classification": {}, "embedding": [0.1], "filename": "a.pdf", "raw_bytes": b""}
    with pytest.raises(TenantContextMissing):
        await resume_intel.store_resume(state)
    pc.upsert.assert_not_called()


def _load_backfill():
    path = BACKEND / "scripts" / "backfill_pinecone_company.py"
    spec = importlib.util.spec_from_file_location("backfill_pinecone_company", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FakeIndex:

    def __init__(self, vectors):
        self.vectors = vectors
        self.updates = []

    def fetch(self, ids, namespace=""):
        return {"vectors": {i: {"metadata": dict(self.vectors[(namespace, i)])} for i in ids if (namespace, i) in self.vectors}}

    def update(self, id, set_metadata, namespace=""):
        self.vectors[(namespace, id)].update(set_metadata)
        self.updates.append((namespace, id, dict(set_metadata)))


def _index():
    return FakeIndex({
        ("", "res-old"): {"doc_type": "resume"},
        ("", "res-tagged"): {"doc_type": "resume", "company_id": "cmp_other"},
        ("jobs", "job-old"): {"doc_type": "job"},
    })


async def test_the_backfill_is_a_dry_run_unless_told_to_apply():
    script = _load_backfill()
    index = _index()
    tallies = await script.backfill(index, ["res-old", "res-tagged", "res-gone"], ["job-old"], "cmp_default", apply=False)
    resumes, jobs = tallies
    assert (resumes.seen, resumes.already_tagged, resumes.missing, resumes.to_tag) == (3, 1, 1, ["res-old"])
    assert (jobs.seen, jobs.to_tag) == (1, ["job-old"])
    assert index.updates == []


async def test_the_backfill_tags_only_untagged_vectors_and_is_safe_to_repeat():
    script = _load_backfill()
    index = _index()
    await script.backfill(index, ["res-old", "res-tagged", "res-gone"], ["job-old"], "cmp_default", apply=True)
    assert index.vectors[("", "res-old")]["company_id"] == "cmp_default"
    assert index.vectors[("", "res-tagged")]["company_id"] == "cmp_other"
    assert index.vectors[("jobs", "job-old")]["company_id"] == "cmp_default"
    assert sorted((ns, i) for ns, i, _ in index.updates) == [("", "res-old"), ("jobs", "job-old")]

    index.updates.clear()
    await script.backfill(index, ["res-old", "res-tagged", "res-gone"], ["job-old"], "cmp_default", apply=True)
    assert index.updates == []


async def test_the_backfill_survives_one_vector_that_cannot_be_tagged(capsys):
    script = _load_backfill()
    index = _index()
    real_update = index.update

    def flaky(id, set_metadata, namespace=""):
        if id == "res-old":
            raise RuntimeError("pinecone said no")
        return real_update(id, set_metadata, namespace)

    index.update = flaky
    resumes, jobs = await script.backfill(index, ["res-old"], ["job-old"], "cmp_default", apply=True)
    assert (resumes.failed, resumes.tagged, jobs.tagged) == (1, 0, 1)


def test_the_backfill_defaults_to_the_default_company():
    script = _load_backfill()
    assert script.parse_args([]).company == DEFAULT_COMPANY_ID
    assert script.parse_args([]).apply is False
    assert script.parse_args(["--apply"]).apply is True


def test_the_default_model_is_the_bound_companys_choice_else_the_platform_default(monkeypatch):
    monkeypatch.setattr(settings, "DEFAULT_LLM_MODEL", "claude-haiku-4-5")
    assert llm.default_model() == "claude-haiku-4-5"
    with company_context("cmp_tp_a", {"settings": {"default_llm_model": "claude-sonnet-5"}}):
        assert llm.default_model() == "claude-sonnet-5"
    with company_context("cmp_tp_b", {"settings": {}}):
        assert llm.default_model() == "claude-haiku-4-5"
    with company_context("cmp_tp_c", {"settings": {"default_llm_model": ""}}):
        assert llm.default_model() == "claude-haiku-4-5"

    monkeypatch.setattr(settings, "DEFAULT_LLM_MODEL", "claude-opus-5")
    with company_context("cmp_tp_a", {"settings": {"default_llm_model": "claude-sonnet-5"}}):
        assert llm.default_model() == "claude-sonnet-5"
    with company_context("cmp_tp_b", {"settings": {}}):
        assert llm.default_model() == "claude-opus-5"


async def test_ask_llm_uses_the_companys_model_and_an_explicit_model_still_wins(monkeypatch):
    monkeypatch.setattr(settings, "DEFAULT_LLM_MODEL", "claude-haiku-4-5")
    used = []

    async def fake(**kwargs):
        used.append(kwargs["model_id"])
        return "ok"

    monkeypatch.setattr(llm, "_ask_anthropic", fake)
    with company_context("cmp_tp_a", {"settings": {"default_llm_model": "claude-sonnet-5"}}):
        await llm.ask_llm("hello")
        await llm.ask_llm("hello", model="claude-opus-5")
    with company_context("cmp_tp_b", {"settings": {}}):
        await llm.ask_llm("hello")
    assert used == ["claude-sonnet-5", "claude-opus-5", "claude-haiku-4-5"]


async def test_a_service_that_names_no_model_gets_the_companys_default(monkeypatch):
    monkeypatch.setattr(settings, "DEFAULT_LLM_MODEL", "claude-haiku-4-5")
    seen = {}

    async def fake_ask(**kwargs):
        seen["model"] = kwargs["model"]
        return "{}"

    monkeypatch.setattr(jd_intel, "ask_llm", fake_ask)
    monkeypatch.setattr(jd_intel, "get_pinecone", lambda: None)
    monkeypatch.setattr(jd_intel, "get_db", lambda: None)
    monkeypatch.setattr(jd_intel, "get_prompt_override", AsyncMock(return_value=None))
    monkeypatch.setattr(jd_intel, "get_embedding", AsyncMock(return_value=[0.1]))

    with company_context("cmp_tp_a", {"settings": {"default_llm_model": "claude-sonnet-5"}}):
        await jd_intel.parse_jd("job-1", "T", "D")
    assert seen["model"] == "claude-sonnet-5"
    with company_context("cmp_tp_a", {"settings": {"default_llm_model": "claude-sonnet-5"}}):
        await jd_intel.parse_jd("job-1", "T", "D", "claude-opus-5")
    assert seen["model"] == "claude-opus-5"


def test_nothing_outside_the_llm_layer_reads_the_platform_model_directly():
    allowed = {
        "config/llm.py",
        "config/settings.py",
        "config/database.py",
        "routes/auth.py",
    }
    offenders = [
        rel for rel, tree in _backend_sources()
        if rel not in allowed and any(isinstance(n, ast.Attribute) and n.attr == "DEFAULT_LLM_MODEL" for n in ast.walk(tree))
    ]
    assert not offenders, f"read default_model() from config.llm instead: {offenders}"


def test_a_model_override_must_be_a_model_the_picker_offers():
    assert require_selectable_model(None) is None
    assert require_selectable_model("") is None
    assert require_selectable_model("   ") is None
    for model_id in llm.SELECTABLE_MODEL_IDS:
        assert require_selectable_model(model_id) == model_id
    for bad in ("gpt-nope", "claude-haiku-4-5 ", "../etc", "gpt-4o-2024-08-06", "gpt-5-pro"):
        with pytest.raises(HTTPException) as exc:
            require_selectable_model(bad)
        assert exc.value.status_code == 400
        assert isinstance(exc.value.detail, str) and chr(0x2014) not in exc.value.detail


class _Ledger:
    def __init__(self):
        self.rows = []

    async def insert_one(self, row):
        self.rows.append(dict(row))

    async def update_one(self, flt, update, upsert=False):
        for row in self.rows:
            if all(row.get(k) == v for k, v in flt.items()):
                row.update(update["$set"])
                return
        if upsert:
            self.rows.append({**flt, **update["$set"]})


@pytest.fixture
def ledgers(monkeypatch):
    import config.database as database

    by_company: dict[str, _Ledger] = {}

    def fake_get_db():
        company_id = tenancy.bind_db(object()).company_id
        return SimpleNamespace(company_id=company_id, cost_ledger=by_company.setdefault(company_id, _Ledger()))

    monkeypatch.setattr(database, "get_db", fake_get_db)
    return by_company


async def test_spend_is_booked_to_the_company_that_incurred_it_even_if_flushed_elsewhere(ledgers):
    with company_context("cmp_tp_a"):
        acc = llm.start_usage_tracking()
        acc.update(cost_usd=0.5, llm_calls=1)
    assert acc["company_id"] == "cmp_tp_a"

    with company_context("cmp_tp_b"):
        await llm.record_cost("tp_ledger", "ref-1")

    assert [r["ref_id"] for r in ledgers["cmp_tp_a"].rows] == ["ref-1"]
    assert "cmp_tp_b" not in ledgers
    assert llm._usage_ctx.get() is None


async def test_the_same_source_and_ref_in_two_companies_are_two_ledger_rows(ledgers):
    for company_id, cost in (("cmp_tp_a", 0.5), ("cmp_tp_b", 0.7)):
        with company_context(company_id):
            llm.start_usage_tracking().update(cost_usd=cost, llm_calls=1)
            await llm.record_cost("jd_parse", "same-ref")
    assert [r["cost_usd"] for r in ledgers["cmp_tp_a"].rows] == [0.5]
    assert [r["cost_usd"] for r in ledgers["cmp_tp_b"].rows] == [0.7]


async def test_spend_with_no_company_to_book_it_to_is_dropped_not_guessed(ledgers, no_fallback):
    acc = llm.start_usage_tracking()
    acc.update(cost_usd=0.5, llm_calls=1)
    assert acc["company_id"] is None
    assert await llm.record_cost("tp_ledger", "ref-1") is acc
    assert ledgers == {}
    assert llm._usage_ctx.get() is None


def test_resetting_usage_tracking_drops_a_leftover_accumulator():
    with company_context("cmp_tp_a"):
        llm.start_usage_tracking()
    assert llm._usage_ctx.get() is not None
    llm.reset_usage_tracking()
    assert llm._usage_ctx.get() is None


def test_mail_is_sent_in_the_companys_name_else_the_platforms(monkeypatch):
    monkeypatch.setattr(settings, "EMAIL_FROM_NAME", "HR Platform")
    assert email_service.sender_name() == "HR Platform"
    with company_context("cmp_tp_a", {"name": "Acme Hiring"}):
        assert email_service.sender_name() == "Acme Hiring"
    with company_context("cmp_platform", {"name": "Platform Operations", "kind": "platform"}):
        assert email_service.sender_name() == "HR Platform"
    with company_context("cmp_tp_a", {"name": "   "}):
        assert email_service.sender_name() == "HR Platform"


def test_an_install_that_never_named_its_company_keeps_signing_as_the_platform(monkeypatch):
    monkeypatch.setattr(settings, "EMAIL_FROM_NAME", "Acme Recruiting")
    with company_context(DEFAULT_COMPANY_ID, {"name": "Default"}):
        assert email_service.sender_name() == "Acme Recruiting"
    with company_context(DEFAULT_COMPANY_ID, {"name": "Real Company Ltd"}):
        assert email_service.sender_name() == "Real Company Ltd"
    with company_context("cmp_tp_a", {"name": "Default"}):
        assert email_service.sender_name() == "Default"


def test_a_company_name_cannot_inject_a_header(monkeypatch):
    with company_context("cmp_tp_a", {"name": "Evil Co\r\nBcc: spy@example.com"}):
        name = email_service.sender_name()
        msg = email_service._build_mime(to="a@b.co", subject="s", html_body="<p>x</p>", text_body="x")
    assert "\n" not in name and "\r" not in name
    assert msg["Bcc"] is None


def test_the_from_header_carries_the_company_name_and_the_platform_address(monkeypatch):
    monkeypatch.setattr(settings, "EMAIL_FROM", "hr@platform.example")
    monkeypatch.setattr(settings, "EMAIL_FROM_NAME", "HR Platform")
    plain = email_service._build_mime(to="a@b.co", subject="s", html_body="<p>x</p>", text_body="x")
    assert plain["From"] == "HR Platform <hr@platform.example>"
    with company_context("cmp_tp_a", {"name": "Acme, Inc."}):
        msg = email_service._build_mime(to="a@b.co", subject="s", html_body="<p>x</p>", text_body="x")
    assert msg["From"] == '"Acme, Inc." <hr@platform.example>'


async def test_the_sign_off_is_the_company_name_and_escaped_in_html(monkeypatch):
    monkeypatch.setattr(settings, "EMAIL_FROM_NAME", "HR Platform")
    sent = []

    async def fake_send_email(**kwargs):
        sent.append(kwargs)
        return True

    monkeypatch.setattr(email_service, "send_email", fake_send_email)
    monkeypatch.setattr(email_service, "get_template_override", AsyncMock(return_value=None))

    async def invite():
        await email_service.send_invite_email(
            to_email="c@example.com", candidate_name="Cand", job_title="Role", company_name="Hiring Co",
            secure_token="tok_x",
        )

    with company_context("cmp_tp_a", {"name": "Acme <Hiring> & Co"}):
        await invite()
    await invite()

    in_company, no_company = sent
    assert in_company["text_body"].rstrip().endswith("Best regards,\nAcme <Hiring> & Co")
    assert "Acme &lt;Hiring&gt; &amp; Co" in in_company["html_body"] and "<Hiring>" not in in_company["html_body"]
    assert no_company["text_body"].rstrip().endswith("Best regards,\nHR Platform")


def test_no_sign_off_still_reads_the_platform_name_directly():
    allowed = {
        "config/settings.py", "services/hr_module/email_service.py", "services/hr_module/email_delivery_service.py",
        "services/hr_module/mail_brand.py",
    }
    offenders = [
        rel for rel, tree in _backend_sources()
        if rel not in allowed and any(isinstance(n, ast.Attribute) and n.attr == "EMAIL_FROM_NAME" for n in ast.walk(tree))
    ]
    assert offenders == []


def _whoami_app():
    app = FastAPI()
    app.add_middleware(TenantScopeMiddleware)

    @app.get("/who")
    async def who(user: dict | None = Depends(get_optional_user)):
        return {"email": user and user["email"], "company": current_company_id()}

    return app


async def _get_who(headers=None):
    async with AsyncClient(transport=ASGITransport(app=_whoami_app()), base_url="http://t") as client:
        return await client.get("/who", headers=headers or {})


async def test_optional_sign_in_binds_the_company_of_a_valid_token(no_fallback):
    response = await _get_who({"Authorization": "Bearer demo-admin-token@@cmp_tp_a"})
    assert response.status_code == 200
    assert response.json() == {"email": "demo-admin@hirely.ai", "company": "cmp_tp_a"}


async def test_optional_sign_in_never_raises_and_binds_nothing_without_a_valid_token(no_fallback):
    for headers in ({}, {"Authorization": "Bearer garbage"}, {"Authorization": "Bearer "}, {"Authorization": "Basic abc"}):
        response = await _get_who(headers)
        assert response.status_code == 200, headers
        assert response.json() == {"email": None, "company": None}, headers


async def test_companies_come_out_oldest_served_first_and_never_served_before_all(monkeypatch):
    async def listing():
        return [
            {"company_id": "cmp_b", "cron": {"reminders": "2026-03-01T00:00:00+00:00"}},
            {"company_id": "cmp_a", "cron": {"reminders": "2026-01-01T00:00:00+00:00", "job_sync": "2026-09-01T00:00:00+00:00"}},
            {"company_id": "cmp_never"},
            {"company_id": "cmp_c", "cron": {"job_sync": "2026-02-01T00:00:00+00:00"}},
        ]

    monkeypatch.setattr(workspace_service, "list_active_companies", listing)
    assert [c["company_id"] for c in await workspace_service.companies_due("reminders")] == [
        "cmp_never", "cmp_c", "cmp_a", "cmp_b",
    ]
    assert [c["company_id"] for c in await workspace_service.companies_due("job_sync")] == [
        "cmp_b", "cmp_never", "cmp_c", "cmp_a",
    ]


def test_a_run_over_one_company_reads_as_that_companys_own_result():
    one = [{"company_id": "cmp_a", "status": "ok", "detail": "Sent 4 reminder(s)."}]
    assert cron_service._summarise_companies(one, 1) == ("ok", "Sent 4 reminder(s).")
    assert cron_service._summarise_companies([], 0) == ("ok", "No active company to run for.")


def test_a_run_over_several_companies_counts_them_and_says_what_is_left():
    ok, bad = {"status": "ok", "detail": "x"}, {"status": "error", "detail": "y"}
    assert cron_service._summarise_companies([ok, ok], 2) == ("ok", "Ran for 2 of 2 companies.")
    assert cron_service._summarise_companies([ok, bad], 2) == ("error", "Ran for 2 of 2 companies, 1 with an error.")
    assert cron_service._summarise_companies([ok], 3) == (
        "ok", "Ran for 1 of 3 companies. The rest are served first on the next run.",
    )


def _work_app(started, work):
    app = FastAPI()
    app.add_middleware(TenantScopeMiddleware)

    @app.post("/task")
    async def task_route(user: dict = Depends(get_current_user)):
        started.append(asyncio.create_task(work()))
        return {"started": True}

    @app.post("/queued")
    async def queued_route(tasks: BackgroundTasks, user: dict = Depends(get_current_user)):
        tasks.add_task(work)
        return {"queued": True}

    return app


def _headers(company_id):
    return {"Authorization": f"Bearer demo-admin-token@@{company_id}"}


async def test_a_task_started_in_a_request_keeps_that_companys_binding_after_the_response_returned(no_fallback):
    gate = asyncio.Event()
    seen: dict[str, tuple] = {}
    started: list[asyncio.Task] = []

    async def work():
        await gate.wait()
        company_id = current_company_id()
        seen[company_id] = (company_id, tenancy.bind_db(object()).company_id)

    app = _work_app(started, work)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as client:
        first, second = await asyncio.gather(
            client.post("/task", headers=_headers("cmp_tp_a")),
            client.post("/task", headers=_headers("cmp_tp_b")),
        )

    assert first.status_code == second.status_code == 200
    assert seen == {}, "both responses are back and neither task body has run yet"
    assert current_company_id() is None, "the requests' own bindings are gone"

    gate.set()
    await asyncio.gather(*started)
    assert seen == {"cmp_tp_a": ("cmp_tp_a", "cmp_tp_a"), "cmp_tp_b": ("cmp_tp_b", "cmp_tp_b")}


async def test_a_task_started_with_no_company_bound_fails_closed(no_fallback):
    async def work():
        return tenancy.bind_db(object())

    with pytest.raises(TenantContextMissing):
        await asyncio.create_task(work())


async def test_a_background_task_runs_after_the_response_and_as_the_requests_company(no_fallback):
    events: list = []

    async def work():
        events.append(("task", current_company_id()))

    app = _work_app([], work)

    async def spy(scope, receive, send):
        async def tell(message):
            if message["type"] == "http.response.body" and not message.get("more_body"):
                events.append("response sent")
            await send(message)

        await app(scope, receive, tell)

    async with AsyncClient(transport=ASGITransport(app=spy), base_url="http://t") as client:
        response = await client.post("/queued", headers=_headers("cmp_tp_a"))

    assert response.status_code == 200
    assert events == ["response sent", ("task", "cmp_tp_a")]


async def test_a_task_that_outlives_a_company_context_keeps_the_company_it_was_started_in(no_fallback):
    gate = asyncio.Event()
    seen = []

    async def work():
        await gate.wait()
        seen.append(current_company_id())

    with company_context("cmp_tp_a"):
        task = asyncio.create_task(work())
    with company_context("cmp_tp_b"):
        await asyncio.sleep(0)
        gate.set()
        await task
    assert seen == ["cmp_tp_a"]


def test_the_scheduler_hands_its_timers_to_cron_service():
    source = (BACKEND / "services" / "hr_module" / "scheduler.py").read_text(encoding="utf-8")
    timers = source[source.index("def start_scheduler"):]
    assert 'cron_service.run_job("job_sync"' in timers and 'cron_service.run_job("reminders"' in timers
    assert not re.search(r"await\s+(sync_all_sources|send_pending_reminders)\(", timers)


async def test_a_ledger_row_records_which_embedding_model_made_its_vectors(ledgers):
    with company_context("cmp_tp_a"):
        llm.start_usage_tracking()
        llm._record_embed("text-embedding-3-small", SimpleNamespace(total_tokens=1000))
        llm._record_embed("text-embedding-3-large", SimpleNamespace(total_tokens=200))
        await llm.record_cost("resume_bulk", "ref-embed")

    (row,) = ledgers["cmp_tp_a"].rows
    assert row["embedding_calls"] == 2 and row["embedding_tokens"] == 1200
    assert {m: (s["calls"], s["tokens"]) for m, s in row["embedding_models"].items()} == {
        "text-embedding-3-small": (1, 1000), "text-embedding-3-large": (1, 200)}
    assert row["models"] == {}
