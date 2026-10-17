import asyncio
import types
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

import ops_store
from config import llm, tenancy
from config.database import get_db, get_platform_db
from config.settings import settings
from config.tenancy import DEFAULT_COMPANY_ID, company_context, current_company_id
from config.tenancy_migration import client_doc, company_doc
from services.hr_module import (
    cron_service,
    email_service,
    interviewer_link_service as links,
    live_check_service,
    notification_settings_service as ns,
    scheduler,
    webhook_service,
    workflow_engine,
    workspace_service,
)

pytestmark = pytest.mark.anyio

API = "/api/v1"
PRODUCT_DEFAULTS = {
    "company_logo_url": "", "primary_color": "#4778f3", "accent_color": "#222022", "company_name": "",
    "company_slug": "", "terms_url": settings.TERMS_URL or "", "privacy_url": settings.PRIVACY_URL or "",
}


@pytest.fixture
def no_fallback():
    tenancy.use_fallback_company(None)
    yield
    tenancy.use_fallback_company(DEFAULT_COMPANY_ID)


@pytest.fixture
async def make_company():
    created: list[tuple[str, str]] = []

    async def _make(name: str | None = None, *, company_settings: dict | None = None):
        tag = uuid.uuid4().hex[:8]
        client_id, company_id, slug = f"cli_tp_{tag}", f"cmp_tp_{tag}", f"tp-{tag}"
        raw = get_platform_db()
        await raw.clients.insert_one(client_doc(client_id, f"TP Client {tag}", f"tp-client-{tag}"))
        doc = company_doc(company_id, client_id, name or f"TP Company {tag}", slug)
        if company_settings:
            doc["settings"] = company_settings
        await raw.companies.insert_one(dict(doc))
        created.append((company_id, client_id))
        return SimpleNamespace(
            company_id=company_id, client_id=client_id, name=doc["name"], slug=slug, doc=doc,
            headers={"Authorization": f"Bearer demo-admin-token@@{company_id}"},
        )

    yield _make

    raw = get_platform_db()
    names = [n for n in await raw.list_collection_names() if not n.startswith("system.")]
    for company_id, client_id in created:
        await asyncio.gather(*(raw[name].delete_many({"company_id": company_id}) for name in names))
        await raw.clients.delete_one({"client_id": client_id})


@pytest.fixture(autouse=True)
async def _clean_platform_cron_records():
    yield
    await get_platform_db().settings.delete_many({"key": {"$regex": "^cron_"}})


@pytest.fixture(autouse=True)
def _no_owner_alerts_or_platform_checks(monkeypatch):
    async def no_platform_checks(began):
        return None

    monkeypatch.setattr(cron_service, "_alert_job_failure", AsyncMock())
    monkeypatch.setattr(cron_service, "_run_platform_checks", no_platform_checks)


@pytest.fixture
def own_ip(monkeypatch):
    import shared.rate_limit as rate_limit

    ip = f"tp-{uuid.uuid4().hex[:10]}"
    monkeypatch.setattr(rate_limit, "client_ip", lambda request: ip)
    return ip


def _co(company):
    return company_context(company.company_id, company.doc)


def _tenant_kinds(path: str, method: str) -> set:
    from fastapi.routing import APIRoute

    from main import app

    def walk(dependant):
        for sub in dependant.dependencies:
            yield sub.call
            yield from walk(sub)

    for route in app.routes:
        if hasattr(route, "original_router"):
            candidates = [(route.include_context.prefix + inner.path, inner) for inner in route.original_router.routes]
        else:
            candidates = [(getattr(route, "path", ""), route)]
        for full_path, inner in candidates:
            if isinstance(inner, APIRoute) and full_path == path and method in inner.methods:
                return {getattr(call, "tenant_kind", None) for call in walk(inner.dependant)} - {None}
    return set()


async def test_both_interviewer_scorecard_verbs_name_the_interviewer_company():
    page = f"{API}/interviewer-scorecard/{{token}}"
    assert _tenant_kinds(page, "GET") == {"interviewer"}
    assert _tenant_kinds(page, "PUT") == {"interviewer"}


async def _seed_candidate(company, **extra) -> dict:
    with _co(company):
        db = get_db()
        job_id, candidate_id = f"tp-job-{uuid.uuid4().hex[:8]}", str(uuid.uuid4())
        await db.jobs.insert_one({"doc_type": "job", "job_id": job_id, "title": "Platform Engineer", "candidate_pipeline": []})
        candidate = {
            "doc_type": "candidate", "candidate_id": candidate_id, "job_id": job_id, "name": "Pat Tenant",
            "email": f"pat-{uuid.uuid4().hex[:6]}@example.com", "interview_mode": "external",
            "pipeline_stage": "interviewing", "status": "interviewing", **extra,
        }
        await db.candidates.insert_one(dict(candidate))
        return candidate


async def test_an_interviewer_link_opens_in_its_own_company_with_nothing_else_bound(
    client, make_company, no_fallback, monkeypatch,
):
    import routes.interviewer_scorecard as page

    ip = f"tp-{uuid.uuid4().hex[:10]}"
    monkeypatch.setattr(page, "_client_ip", lambda request: ip)
    company = await make_company()
    candidate = await _seed_candidate(company)
    with _co(company):
        token, _ = await links.create_link(
            get_db(), candidate=candidate, created_by="tester@example.com",
            interviewer_name="Ivy", interviewer_role="engineer", expires_in_days=7,
        )

    opened = await client.get(f"{API}/interviewer-scorecard/{token}")
    assert opened.status_code == 200, opened.text
    assert opened.json()["candidate_name"] == "Pat Tenant" and opened.json()["job_title"] == "Platform Engineer"

    unknown = await client.get(f"{API}/interviewer-scorecard/not-a-token-{uuid.uuid4().hex}")
    assert unknown.status_code == 404

    with company_context(DEFAULT_COMPANY_ID):
        with pytest.raises(links.LinkNotFound):
            await links.resolve_link(get_db(), token)


async def test_public_branding_resolves_a_company_in_the_documented_order(
    client, make_company, no_fallback, own_ip,
):
    bravo, charlie = await make_company("Bravo Hiring"), await make_company("Charlie Hiring")
    for company, color in ((bravo, "#111111"), (charlie, "#222222")):
        with _co(company):
            await get_db().branding_settings.insert_one({
                "_id": "singleton", "company_logo_url": f"https://logo.example/{color[1:]}.png",
                "primary_color": color, "accent_color": "#000000",
            })
    candidate = await _seed_candidate(charlie, secure_token=f"tok_tp_{uuid.uuid4().hex}")
    url = f"{API}/branding/public"

    anonymous = await client.get(url)
    assert anonymous.status_code == 200 and anonymous.json() == PRODUCT_DEFAULTS

    signed_in = (await client.get(url, headers=bravo.headers)).json()
    assert signed_in["primary_color"] == "#111111" and signed_in["company_logo_url"].endswith("111111.png")

    by_slug = (await client.get(url, params={"company": charlie.slug})).json()
    assert by_slug == {
        "company_logo_url": "https://logo.example/222222.png", "primary_color": "#222222",
        "accent_color": "#000000", "company_name": "Charlie Hiring", "company_slug": charlie.slug,
        "terms_url": PRODUCT_DEFAULTS["terms_url"], "privacy_url": PRODUCT_DEFAULTS["privacy_url"],
    }

    by_link = (await client.get(url, params={"kind": "candidate", "token": candidate["secure_token"]})).json()
    assert by_link["primary_color"] == "#222222" and by_link["company_name"] == "Charlie Hiring"

    assert (await client.get(url, params={"company": charlie.slug}, headers=bravo.headers)).json()["primary_color"] == "#111111"
    both = {"company": bravo.slug, "kind": "candidate", "token": candidate["secure_token"]}
    assert (await client.get(url, params=both)).json()["primary_color"] == "#111111"

    for params in (
        {"company": "no-such-company"}, {"company": "platform"},
        {"kind": "candidate", "token": "tok_does_not_exist"}, {"kind": "bogus", "token": "x"}, {"kind": "candidate"},
    ):
        response = await client.get(url, params=params)
        assert response.status_code == 200 and response.json() == PRODUCT_DEFAULTS, params
    stale = await client.get(url, headers={"Authorization": "Bearer not-a-real-token"})
    assert stale.status_code == 200 and stale.json() == PRODUCT_DEFAULTS


async def test_a_suspended_company_shows_the_defaults_on_the_public_branding_route(
    client, make_company, no_fallback, own_ip,
):
    company = await make_company("Dormant Co")
    with _co(company):
        await get_db().branding_settings.insert_one({"_id": "singleton", "primary_color": "#333333"})
    url = f"{API}/branding/public"
    assert (await client.get(url, params={"company": company.slug})).json()["primary_color"] == "#333333"

    await get_platform_db().companies.update_one({"company_id": company.company_id}, {"$set": {"status": "suspended"}})
    assert (await client.get(url, params={"company": company.slug})).json() == PRODUCT_DEFAULTS


async def test_public_branding_counts_lookups_but_not_the_free_paths(client, monkeypatch, no_fallback, own_ip):
    import routes.branding as branding

    monkeypatch.setattr(
        branding, "_lookup_throttle",
        branding.public_token_throttle("branding-test", ip_limit=3, param=None, window_seconds=86400),
    )
    url = f"{API}/branding/public"
    for _ in range(6):
        assert (await client.get(url)).status_code == 200
    codes = [(await client.get(url, params={"company": f"nobody-{i}"})).status_code for i in range(5)]
    assert codes == [200, 200, 200, 429, 429]


async def test_rating_config_follows_the_signed_in_company_then_the_link_then_the_default(
    client, make_company, no_fallback, own_ip,
):
    bravo, charlie = await make_company(), await make_company()
    review_token = f"tok_tp_{uuid.uuid4().hex}"
    with _co(bravo):
        db = get_db()
        await db.system_config.insert_one({"key": "performance_rating_scale", "scale_min": 1, "scale_max": 10})
        await db.performance_rating_dimensions.insert_one({
            "dimension_id": str(uuid.uuid4()), "name": "Bravo craft", "description": None,
            "created_by": "tester@example.com", "created_at": datetime.now(timezone.utc).isoformat(),
        })
        await db.performance_reviews.insert_one({
            "review_id": str(uuid.uuid4()), "secure_token": review_token, "reviewer_type": "self", "status": "pending",
        })
    url = f"{API}/performance/rating-config"
    built_in = {"scale_min": 1, "scale_max": 5, "dimensions": []}

    assert (await client.get(url)).json() == built_in
    assert (await client.get(url, params={"token": "tok_does_not_exist"})).json() == built_in

    by_link = (await client.get(url, params={"token": review_token})).json()
    assert by_link["scale_max"] == 10 and [d["name"] for d in by_link["dimensions"]] == ["Bravo craft"]

    signed_in = (await client.get(url, headers=bravo.headers)).json()
    assert signed_in["scale_max"] == 10 and [d["name"] for d in signed_in["dimensions"]] == ["Bravo craft"]

    assert (await client.get(url, headers=charlie.headers)).json() == built_in
    assert (await client.get(url, params={"token": review_token}, headers=charlie.headers)).json() == built_in


def _restrict_to(monkeypatch, *companies):
    ids = [c.company_id for c in companies]

    async def listing():
        raw = get_platform_db()
        return [
            {k: v for k, v in doc.items() if k != "_id"}
            async for doc in raw.companies.find({"company_id": {"$in": ids}}).sort("created_at", 1)
        ]

    monkeypatch.setattr(workspace_service, "list_active_companies", listing)


def _scripted_runner(monkeypatch, key="reminders", behaviour=None):
    seen: list[dict] = []

    async def runner():
        company_id = current_company_id()
        seen.append({"company": company_id, "db_company": get_db().company_id})
        if behaviour is not None:
            return await behaviour(company_id)
        return "ok", f"done {company_id}"

    monkeypatch.setattr(cron_service, "_RUNNERS", {**cron_service._RUNNERS, key: runner})
    return seen


async def test_a_job_runs_once_per_company_as_that_company(make_company, monkeypatch):
    bravo, charlie = await make_company(), await make_company()
    _restrict_to(monkeypatch, bravo, charlie)
    seen = _scripted_runner(monkeypatch)

    result = await cron_service.run_job("reminders")

    assert [s["company"] for s in seen] == [bravo.company_id, charlie.company_id]
    assert all(s["company"] == s["db_company"] for s in seen)
    assert result["status"] == "ok" and result["detail"] == "Ran for 2 of 2 companies."
    assert result["companies"] == {"total": 2, "served": 2, "failed": 0}

    raw = get_platform_db()
    for company in (bravo, charlie):
        with _co(company):
            db = get_db()
            runs = await db.cron_runs.find({"key": "reminders"}).to_list(length=10)
            assert [r["detail"] for r in runs] == [f"done {company.company_id}"]
            assert await db.audit_log.count_documents({"action": "cron_run"}) == 0
        stored = await raw.companies.find_one({"company_id": company.company_id})
        assert stored["cron"]["reminders"]
    record = await raw.settings.find_one({"key": "cron_reminders"})
    assert (record["companies_total"], record["companies_served"], record["companies_failed"]) == (2, 2, 0)

    with company_context(DEFAULT_COMPANY_ID):
        leaked = await get_db().cron_runs.count_documents({"detail": {"$regex": "^done cmp_tp_"}})
    assert leaked == 0


async def test_the_company_served_longest_ago_goes_first_and_each_job_has_its_own_turns(make_company, monkeypatch):
    bravo, charlie, delta = await make_company(), await make_company(), await make_company()
    raw = get_platform_db()
    await raw.companies.update_one({"company_id": bravo.company_id}, {"$set": {"cron.reminders": "2026-03-01T00:00:00+00:00"}})
    await raw.companies.update_one({"company_id": delta.company_id}, {"$set": {"cron.reminders": "2026-01-01T00:00:00+00:00"}})
    _restrict_to(monkeypatch, bravo, charlie, delta)
    seen = _scripted_runner(monkeypatch)

    await cron_service.run_job("reminders")
    assert [s["company"] for s in seen] == [charlie.company_id, delta.company_id, bravo.company_id]

    seen.clear()
    await cron_service.run_job("reminders")
    assert [s["company"] for s in seen] == [charlie.company_id, delta.company_id, bravo.company_id]

    stored = await raw.companies.find_one({"company_id": charlie.company_id})
    assert set(stored["cron"]) == {"reminders"}


async def test_a_run_stops_starting_companies_when_its_budget_is_spent_and_the_next_run_continues(
    make_company, monkeypatch,
):
    bravo, charlie, delta = await make_company(), await make_company(), await make_company()
    _restrict_to(monkeypatch, bravo, charlie, delta)
    clock = SimpleNamespace(now=0.0)
    monkeypatch.setattr(cron_service, "time", SimpleNamespace(monotonic=lambda: clock.now))

    async def takes_ten_seconds(company_id):
        clock.now += 10
        return "ok", f"done {company_id}"

    seen = _scripted_runner(monkeypatch, behaviour=takes_ten_seconds)

    first = await cron_service.run_job("reminders", budget_seconds=21)
    assert [s["company"] for s in seen] == [bravo.company_id, charlie.company_id]
    assert first["companies"] == {"total": 3, "served": 2, "failed": 0}
    assert first["status"] == "ok"
    assert first["detail"] == "Ran for 2 of 3 companies. The rest are served first on the next run."

    seen.clear()
    clock.now = 0.0
    await cron_service.run_job("reminders", budget_seconds=21)
    assert [s["company"] for s in seen] == [delta.company_id, bravo.company_id]


async def test_a_company_that_overruns_is_an_error_but_still_has_its_turn_recorded(make_company, monkeypatch):
    company = await make_company()
    _restrict_to(monkeypatch, company)

    async def never_finishes(company_id):
        await asyncio.sleep(5)

    _scripted_runner(monkeypatch, behaviour=never_finishes)
    result = await cron_service.run_job("reminders", budget_seconds=0.2)

    assert result["status"] == "error" and result["detail"].startswith("Stopped after")
    stored = await get_platform_db().companies.find_one({"company_id": company.company_id})
    assert stored["cron"]["reminders"]
    with _co(company):
        row = await get_db().cron_runs.find_one({"key": "reminders"})
    assert row["status"] == "error"


async def test_one_failing_company_does_not_stop_the_others(make_company, monkeypatch):
    bravo, charlie = await make_company(), await make_company()
    _restrict_to(monkeypatch, bravo, charlie)

    async def fails_for_bravo(company_id):
        if company_id == bravo.company_id:
            raise RuntimeError("smtp exploded at https://mail.example.test/?token=zzz")
        return "ok", "fine"

    _scripted_runner(monkeypatch, behaviour=fails_for_bravo)
    result = await cron_service.run_job("reminders")

    assert result["status"] == "error" and result["detail"] == "Ran for 2 of 2 companies, 1 with an error."
    assert result["companies"] == {"total": 2, "served": 2, "failed": 1}
    with _co(bravo):
        failed = await get_db().cron_runs.find_one({"key": "reminders"})
    with _co(charlie):
        fine = await get_db().cron_runs.find_one({"key": "reminders"})
    assert failed["status"] == "error" and "RuntimeError" in failed["detail"] and "zzz" not in failed["detail"]
    assert fine["status"] == "ok"
    with _co(bravo):
        assert await get_db().audit_log.count_documents({"action": "cron_run"}) == 1
    with _co(charlie):
        assert await get_db().audit_log.count_documents({"action": "cron_run"}) == 0


async def test_a_run_with_no_active_company_says_so(monkeypatch):
    async def nobody():
        return []

    monkeypatch.setattr(workspace_service, "list_active_companies", nobody)
    seen = _scripted_runner(monkeypatch)
    result = await cron_service.run_job("reminders")
    assert seen == []
    assert (result["status"], result["detail"]) == ("ok", "No active company to run for.")


async def test_the_cron_endpoint_runs_every_company_with_no_company_bound_and_status_shows_the_callers(
    client, make_company, monkeypatch, no_fallback, own_ip,
):
    secret = "tp-cron-secret-0123456789abcdef"
    monkeypatch.setattr(settings, "CRON_SECRET", secret)
    bravo, charlie = await make_company(), await make_company()
    _restrict_to(monkeypatch, bravo, charlie)

    def make(key):
        async def runner():
            return "ok", f"{key} done for {current_company_id()}"
        return runner

    monkeypatch.setattr(cron_service, "_RUNNERS", {key: make(key) for key in cron_service.JOB_KEYS})

    response = await client.get(f"{API}/cron/daily", headers={"Authorization": f"Bearer {secret}"})
    assert response.status_code == 200, response.text
    results = response.json()["results"]
    assert [r["key"] for r in results] == list(cron_service.JOB_KEYS)
    assert all(r["companies"] == {"total": 2, "served": 2, "failed": 0} for r in results)

    for company in (bravo, charlie):
        status = (await client.get(f"{API}/cron/status", headers=company.headers)).json()
        assert {j["key"]: j["last_detail"] for j in status["jobs"]} == {
            key: f"{key} done for {company.company_id}" for key in cron_service.JOB_KEYS
        }


async def test_the_manual_reminder_trigger_only_reaches_the_callers_company(client, make_company, monkeypatch):
    bravo = await make_company()
    stale = (datetime.now(timezone.utc) - timedelta(days=10)).isoformat()
    ours = await _seed_candidate(bravo, pipeline_stage="invited", status="invited", interview_mode="platform", invite_sent_at=stale)
    theirs = await _seed_candidate(
        SimpleNamespace(company_id=DEFAULT_COMPANY_ID, doc={}), pipeline_stage="invited", status="invited",
        interview_mode="platform", invite_sent_at=stale,
    )
    sent: list[str] = []

    async def fake_reminder(**kwargs):
        sent.append(kwargs["candidate_id"])
        return True

    monkeypatch.setattr(workflow_engine, "send_reminder_email", fake_reminder)
    try:
        response = await client.post(f"{API}/workflows/run-reminders", json={}, headers=bravo.headers)
        assert response.status_code == 200, response.text
        assert sent == [ours["candidate_id"]]
        with company_context(DEFAULT_COMPANY_ID):
            untouched = await get_db().candidates.find_one({"candidate_id": theirs["candidate_id"]})
        assert not untouched.get("last_reminder_sent_at")
    finally:
        with company_context(DEFAULT_COMPANY_ID):
            await get_db().candidates.delete_many({"candidate_id": theirs["candidate_id"]})
            await get_db().jobs.delete_many({"job_id": theirs["job_id"]})


async def test_the_job_board_sync_creates_and_dedupes_jobs_per_company(make_company, monkeypatch):
    bravo, charlie = await make_company(), await make_company()
    listing = {
        "title": "Tenant Engineer", "description": "Build things.", "company_name": "Board Co",
        "source_url": f"https://boards.example/{uuid.uuid4().hex}", "employment_type": "full-time",
        "location": "Remote", "is_remote": True,
    }

    async def fake_fetch(source_id, query, location, limit):
        return [dict(listing)]

    async def no_parse(*args, **kwargs):
        return None

    monkeypatch.setattr(scheduler, "list_sources", lambda: [{"id": "remotive", "configured": True}])
    monkeypatch.setattr(scheduler, "fetch_jobs", fake_fetch)
    monkeypatch.setattr(scheduler, "_parse_and_match_bg", no_parse)

    async def sync(company):
        with _co(company):
            return (await scheduler.sync_all_sources())["sources"][0]

    first = await sync(bravo)
    assert (first["imported"], first["skipped"]) == (1, 0)
    again = await sync(bravo)
    assert (again["imported"], again["skipped"]) == (0, 1)
    other = await sync(charlie)
    assert (other["imported"], other["skipped"]) == (1, 0)

    for company in (bravo, charlie):
        with _co(company):
            assert await get_db().jobs.count_documents({"source_url": listing["source_url"]}) == 1
    with company_context(DEFAULT_COMPANY_ID):
        assert await get_db().jobs.count_documents({"source_url": listing["source_url"]}) == 0


async def test_deleting_a_job_removes_its_vector_only_when_the_job_was_the_callers(
    client, admin_headers, make_company, monkeypatch,
):
    other = await make_company()
    mine, theirs = f"tp-job-{uuid.uuid4().hex[:8]}", f"tp-job-{uuid.uuid4().hex[:8]}"
    await get_db().jobs.insert_one({"doc_type": "job", "job_id": mine, "title": "Mine", "candidate_pipeline": []})
    with _co(other):
        await get_db().jobs.insert_one({"doc_type": "job", "job_id": theirs, "title": "Theirs", "candidate_pipeline": []})
    index = MagicMock()
    import config.database as database
    monkeypatch.setattr(database, "get_pinecone", lambda: index)

    try:
        assert (await client.delete(f"{API}/jobs/{mine}", headers=admin_headers)).status_code == 200
        index.delete.assert_called_once_with(ids=[mine], namespace="jobs")

        assert (await client.delete(f"{API}/jobs/{theirs}", headers=admin_headers)).status_code == 200
        index.delete.assert_called_once()
        with _co(other):
            assert await get_db().jobs.find_one({"job_id": theirs}) is not None
    finally:
        await get_db().jobs.delete_many({"job_id": mine})


async def test_an_unknown_model_override_is_a_400_on_every_route_that_takes_one(client, admin_headers):
    bad = "gpt-nope-9"
    cases = [
        ("post", f"{API}/jobs", {"json": {"title": "T", "description": "D", "model_override": bad}}),
        ("post", f"{API}/resumes/upload", {"files": {"file": ("cv.pdf", b"%PDF-1.4", "application/pdf")}, "data": {"model_override": bad}}),
        ("post", f"{API}/intel/resumes/upload-bulk", {"files": [("files", ("cv.pdf", b"%PDF-1.4", "application/pdf"))], "data": {"model_override": bad}}),
        ("post", f"{API}/coding/questions/generate", {"json": {"job_domain": "backend", "model_override": bad}}),
        ("post", f"{API}/offers/{uuid.uuid4()}/draft-letter", {"json": {"model_override": bad}}),
    ]
    for method, url, kwargs in cases:
        response = await getattr(client, method)(url, headers=admin_headers, **kwargs)
        assert response.status_code == 400, (url, response.status_code, response.text)
        assert "Unknown model" in response.json()["detail"], url


async def test_a_known_model_override_reaches_the_job_parser_and_a_blank_one_means_the_default(
    client, admin_headers, monkeypatch,
):
    import routes.jobs as jobs_routes

    handed_over = []

    async def fake_parse(job_id, title, description, model):
        handed_over.append(model)

    monkeypatch.setattr(jobs_routes, "_parse_and_match", fake_parse)
    created = []
    try:
        for override in ("claude-sonnet-5", "", None):
            body = {"title": "Override probe", "description": "D", "model_override": override}
            response = await client.post(f"{API}/jobs", json=body, headers=admin_headers)
            assert response.status_code == 200, response.text
            created.append(response.json()["job_id"])
    finally:
        await get_db().jobs.delete_many({"job_id": {"$in": created}})
    assert handed_over == ["claude-sonnet-5", None, None]


async def test_the_cost_ledger_books_a_spend_to_the_company_that_incurred_it(make_company):
    bravo, charlie = await make_company(), await make_company()

    with _co(bravo):
        llm.start_usage_tracking().update(cost_usd=0.5, llm_calls=1, prompt_tokens=10)
    with _co(charlie):
        await llm.record_cost("tp_ledger", "ref-1")
    with _co(bravo):
        assert await get_db().cost_ledger.count_documents({"source": "tp_ledger"}) == 1
    with _co(charlie):
        assert await get_db().cost_ledger.count_documents({"source": "tp_ledger"}) == 0


async def test_an_upsert_on_source_and_ref_never_crosses_companies(make_company):
    bravo, charlie = await make_company(), await make_company()

    async def spend(company, cost):
        with _co(company):
            llm.start_usage_tracking().update(cost_usd=cost, llm_calls=1)
            await llm.record_cost("tp_ledger", "shared-ref")

    async def rows(company):
        with _co(company):
            return [r["cost_usd"] for r in await get_db().cost_ledger.find({"source": "tp_ledger"}).to_list(length=10)]

    await spend(bravo, 0.5)
    await spend(charlie, 0.7)
    await spend(bravo, 0.9)
    assert await rows(bravo) == [0.9]
    assert await rows(charlie) == [0.7]


async def test_the_live_check_reaches_the_database_from_inside_a_company(make_company):
    company = await make_company()
    with _co(company):
        assert await live_check_service._check_mongodb() == (True, "Connected")


async def test_a_workflow_rule_only_fires_for_events_in_its_own_company(make_company, monkeypatch):
    bravo, charlie = await make_company(), await make_company()
    rule_ids = {}
    for company, address in ((bravo, "bravo@example.com"), (charlie, "charlie@example.com")):
        rule_ids[company.company_id] = f"tp-rule-{uuid.uuid4().hex[:8]}"
        with _co(company):
            await get_db().workflow_rules.insert_one({
                "rule_id": rule_ids[company.company_id], "name": f"Rule for {address}",
                "trigger_type": "candidate_invited", "is_active": True, "conditions": [],
                "action_type": "send_email", "action_params": {"to_email": address},
            })
    emailed: list[str] = []

    async def fake_reminder(**kwargs):
        emailed.append(kwargs["to_email"])
        return True

    monkeypatch.setattr(workflow_engine, "send_reminder_email", fake_reminder)

    with _co(bravo):
        applied = await workflow_engine.evaluate_and_apply_rules("candidate_invited", {"candidate_id": "c1"})
    assert applied == [rule_ids[bravo.company_id]] and emailed == ["bravo@example.com"]

    with _co(charlie):
        applied = await workflow_engine.evaluate_and_apply_rules("candidate_invited", {"candidate_id": "c2"})
    assert applied == [rule_ids[charlie.company_id]] and emailed == ["bravo@example.com", "charlie@example.com"]

    with company_context(DEFAULT_COMPANY_ID):
        found = await get_db().workflow_rules.count_documents({"rule_id": {"$in": list(rule_ids.values())}})
    assert found == 0


class _RecordingHttp:

    def __init__(self):
        self.posts: list[str] = []

    async def request(self, method, url, *, content=None, headers=None, **kwargs):
        self.posts.append(url)
        return types.SimpleNamespace(status_code=200)


async def test_a_webhook_only_receives_events_from_its_own_company(make_company, monkeypatch):
    ops = ops_store.install(monkeypatch)
    http = _RecordingHttp()
    monkeypatch.setattr(webhook_service, "safe_request", http.request)
    monkeypatch.setattr(webhook_service, "is_url_ssrf_safe", lambda url: True)
    bravo, charlie = await make_company(), await make_company()
    urls = {bravo.company_id: "https://hooks.example.test/bravo", charlie.company_id: "https://hooks.example.test/charlie"}
    for company in (bravo, charlie):
        with _co(company):
            await get_db().webhook_subscriptions.insert_one({
                "webhook_id": f"tp-wh-{uuid.uuid4().hex[:8]}", "url": urls[company.company_id], "event_types": ["*"],
                "secret": None, "is_active": True, "format": "raw",
                "created_by": "tester@example.com", "created_at": "2026-01-01T00:00:00+00:00",
            })

    with _co(bravo):
        await webhook_service.emit_event("job.created", {"job_id": "j1", "title": "T"})
    assert http.posts == [urls[bravo.company_id]]

    with _co(charlie):
        await webhook_service.fire_webhook_event("candidate.invited", {"candidate_id": "c1"})
    assert http.posts == [urls[bravo.company_id], urls[charlie.company_id]]

    assert sorted(d["company_id"] for d in ops.webhook_deliveries.docs) == sorted([bravo.company_id, charlie.company_id])


async def test_notification_throttle_keys_do_not_collide_across_companies(make_company, monkeypatch):
    ops = ops_store.install(monkeypatch)
    bravo, charlie = await make_company(), await make_company()
    mail: list[str] = []

    async def fake_send_email(**kwargs):
        mail.append(kwargs["to"])
        return True

    monkeypatch.setattr(email_service, "send_email", fake_send_email)
    for company, address in ((bravo, "alerts-bravo@example.com"), (charlie, "alerts-charlie@example.com")):
        with _co(company):
            await get_db().notification_settings.replace_one(
                {"_id": ns.SINGLETON_ID},
                {"_id": ns.SINGLETON_ID, "notify_email": address, "events": {"offer_declined": True}},
                upsert=True,
            )

    async def declined(company):
        with _co(company):
            return await ns.notify("offer_declined", {"offer_id": "offer-1"})

    assert await declined(bravo) is True
    assert await declined(charlie) is True
    assert await declined(bravo) is False
    assert await declined(charlie) is False
    assert mail == ["alerts-bravo@example.com", "alerts-charlie@example.com"]
    assert sorted(d["_id"] for d in ops.notification_log.docs) == sorted([
        f"{bravo.company_id}:offer_declined:offer-1", f"{charlie.company_id}:offer_declined:offer-1",
    ])
