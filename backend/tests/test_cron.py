import asyncio
import json
import re
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

import ops_store
from config.database import get_db, get_platform_db
from config.settings import settings
from config.tenancy import DEFAULT_COMPANY_ID
from services.hr_module import cron_service, email_delivery_service, email_service, workspace_service
import routes.cron as cron_routes

pytestmark = pytest.mark.anyio

SECRET = "cron-secret-for-tests-0123456789"
AUTH = {"Authorization": f"Bearer {SECRET}"}
REPO = Path(__file__).resolve().parents[2]
ENDPOINTS = [
    "/api/v1/cron/daily", "/api/v1/cron/reminders", "/api/v1/cron/external-reminders", "/api/v1/cron/job-sync",
    "/api/v1/cron/retention",
]
ALL_JOBS = ["reminders", "external_reminders", "job_sync", "retention"]


@pytest.fixture(autouse=True)
def _own_ip_bucket(monkeypatch):
    import shared.rate_limit as rate_limit

    ip = f"test-{uuid.uuid4().hex[:10]}"
    monkeypatch.setattr(rate_limit, "client_ip", lambda request: ip)


@pytest.fixture(autouse=True)
async def _only_the_default_company(monkeypatch):
    async def default_only():
        return [{"company_id": DEFAULT_COMPANY_ID, "name": "Default", "settings": {}}]

    monkeypatch.setattr(workspace_service, "list_active_companies", default_only)

    async def no_platform_checks(began):
        return None

    monkeypatch.setattr(cron_service, "_run_platform_checks", no_platform_checks)
    monkeypatch.setattr(cron_service, "_alert_job_failure", AsyncMock())
    yield
    raw = get_platform_db()
    await raw.settings.delete_many({"key": {"$regex": "^cron_"}})
    await raw.companies.update_one({"company_id": DEFAULT_COMPANY_ID}, {"$unset": {"cron": ""}})


@pytest.fixture
def ops(monkeypatch):
    return ops_store.install(monkeypatch)


@pytest.fixture
def secret(monkeypatch):
    monkeypatch.setattr(settings, "CRON_SECRET", SECRET)


@pytest.fixture
def runners(monkeypatch):
    plan = {
        "reminders": ("ok", "Sent 2 reminder(s)."),
        "external_reminders": ("ok", "Sent 1 reminder(s)."),
        "job_sync": ("ok", "Imported 3 job(s)."),
        "retention": ("ok", "Erased 0 candidate(s) and 0 resume(s)."),
    }
    ran: list[str] = []

    def make(key):
        async def runner():
            ran.append(key)
            outcome = plan[key]
            if isinstance(outcome, Exception):
                raise outcome
            return outcome
        return runner

    monkeypatch.setattr(cron_service, "_RUNNERS", {key: make(key) for key in plan})
    return types_ns(plan=plan, ran=ran)


def types_ns(**kw):
    from types import SimpleNamespace
    return SimpleNamespace(**kw)


@pytest.mark.parametrize("path", ENDPOINTS)
async def test_the_endpoints_are_disabled_while_the_secret_is_unset(client, monkeypatch, ops, runners, path):
    monkeypatch.setattr(settings, "CRON_SECRET", "")
    for headers in ({}, {"Authorization": "Bearer "}, {"Authorization": "Bearer anything"}):
        response = await client.get(path, headers=headers)
        assert response.status_code == 503
        assert isinstance(response.json()["detail"], str) and "CRON_SECRET" in response.json()["detail"]
    assert runners.ran == []


@pytest.mark.parametrize("path", ENDPOINTS)
@pytest.mark.parametrize("headers", [
    {},
    {"Authorization": "Bearer wrong"},
    {"Authorization": SECRET},
    {"Authorization": f"Basic {SECRET}"},
    {"Authorization": f"Bearer {SECRET}x"},
    {"Authorization": "Bearer "},
])
async def test_wrong_or_missing_credentials_are_401_and_run_nothing(client, secret, ops, runners, path, headers):
    response = await client.get(path, headers=headers)
    assert response.status_code == 401
    assert isinstance(response.json()["detail"], str)
    assert runners.ran == []


async def test_an_admin_token_is_not_a_cron_credential(client, secret, ops, runners, admin_headers):
    assert (await client.get("/api/v1/cron/daily", headers=admin_headers)).status_code == 401
    assert runners.ran == []


async def test_the_secret_is_compared_in_constant_time(client, secret, ops, runners, monkeypatch):
    calls = []
    real = cron_routes.hmac.compare_digest

    def spy(a, b):
        calls.append((type(a), type(b)))
        return real(a, b)

    monkeypatch.setattr(cron_routes.hmac, "compare_digest", spy)
    assert (await client.get("/api/v1/cron/daily", headers=AUTH)).status_code == 200
    assert calls == [(bytes, bytes)]


async def test_daily_runs_every_job_each_in_its_own_try_except(client, secret, ops, runners):
    runners.plan["reminders"] = RuntimeError("smtp exploded at https://mail.example.test/?token=zzz")
    response = await client.get("/api/v1/cron/daily", headers=AUTH)
    assert response.status_code == 200
    results = {r["key"]: r for r in response.json()["results"]}
    assert list(results) == ALL_JOBS
    assert results["reminders"]["status"] == "error" and "RuntimeError" in results["reminders"]["detail"]
    assert "zzz" not in results["reminders"]["detail"]
    assert results["external_reminders"]["status"] == "ok" and results["job_sync"]["status"] == "ok"
    assert results["retention"]["status"] == "ok"
    assert runners.ran == ALL_JOBS


async def test_every_run_is_recorded_with_the_documented_fields(client, secret, ops, runners):
    await client.get("/api/v1/cron/daily", headers=AUTH)
    rows = ops.cron_runs.docs
    assert [r["key"] for r in rows] == ALL_JOBS
    for row in rows:
        assert set(row) >= {"key", "started_at", "finished_at", "status", "detail"}
        assert row["status"] == "ok" and row["started_at"] <= row["finished_at"]


async def test_each_job_has_its_own_endpoint(client, secret, ops, runners):
    for path, key in (
        ("/api/v1/cron/reminders", "reminders"),
        ("/api/v1/cron/external-reminders", "external_reminders"),
        ("/api/v1/cron/job-sync", "job_sync"),
        ("/api/v1/cron/retention", "retention"),
    ):
        response = await client.get(path, headers=AUTH)
        assert response.status_code == 200
        assert [r["key"] for r in response.json()["results"]] == [key]
    assert runners.ran == ALL_JOBS


async def test_a_failed_run_is_audited_without_an_actor(client, secret, ops, runners):
    runners.plan["job_sync"] = RuntimeError("the board did not answer")
    started = datetime.now(timezone.utc).isoformat()
    await client.get("/api/v1/cron/job-sync", headers=AUTH)
    row = await get_db().audit_log.find_one({"action": "cron_run", "created_at": {"$gte": started}})
    assert row is not None and row["actor_email"] is None and row["actor_role"] == "cron"
    assert row["resource_id"] == "job_sync" and row["details"]["jobs"] == [{"key": "job_sync", "status": "error"}]


async def test_a_successful_run_is_logged_but_not_audited(client, secret, ops, runners):
    started = datetime.now(timezone.utc).isoformat()
    before = await get_db().audit_log.count_documents({"action": "cron_run", "created_at": {"$gte": started}})
    await client.get("/api/v1/cron/job-sync", headers=AUTH)
    after = await get_db().audit_log.count_documents({"action": "cron_run", "created_at": {"$gte": started}})
    assert after == before
    assert ops.cron_runs.docs and ops.cron_runs.docs[-1]["status"] == "ok"
    assert "expires_at" in ops.cron_runs.docs[-1]


async def test_a_job_that_overruns_its_budget_is_recorded_as_an_error(ops, monkeypatch):
    async def slow():
        await asyncio.sleep(5)
        return "ok", "never"

    monkeypatch.setattr(cron_service, "_RUNNERS", {**cron_service._RUNNERS, "reminders": slow})
    result = await cron_service.run_job("reminders", budget_seconds=0.1)
    assert result["status"] == "error" and "Stopped after" in result["detail"]
    assert ops.cron_runs.docs[0]["status"] == "error"


async def test_the_daily_time_shares_fit_inside_the_function_limit():
    assert set(cron_service.DAILY_BUDGET_SECONDS) == set(cron_service.JOB_KEYS)
    assert sum(cron_service.DAILY_BUDGET_SECONDS.values()) < 60
    vercel = json.loads((REPO / "vercel.json").read_text(encoding="utf-8"))
    limit = vercel["functions"]["api/index.py"]["maxDuration"]
    assert limit >= sum(cron_service.DAILY_BUDGET_SECONDS.values())
    assert cron_service.DAILY_TOTAL_SECONDS < 60 and limit >= cron_service.DAILY_TOTAL_SECONDS


async def test_the_reminders_job_runs_the_existing_logic(ops, monkeypatch):
    from services.hr_module import workflow_engine

    async def fake_pending(*args, **kwargs):
        return 4

    monkeypatch.setattr(workflow_engine, "send_pending_reminders", fake_pending)
    monkeypatch.setattr(email_delivery_service, "current_provider", lambda: "smtp")
    result = await cron_service.run_job("reminders")
    assert (result["status"], result["detail"]) == ("ok", "Sent 4 reminder(s).")


async def test_a_mail_job_says_so_when_no_provider_could_deliver_anything(ops, monkeypatch):
    from services.hr_module import workflow_engine

    async def fake_pending(*args, **kwargs):
        return 3

    monkeypatch.setattr(workflow_engine, "send_pending_reminders", fake_pending)
    monkeypatch.setattr(email_delivery_service, "current_provider", lambda: None)
    result = await cron_service.run_job("reminders")
    assert result["status"] == "ok"
    assert result["detail"] == "Sent 3 reminder(s). No email provider is configured, so they were only written to the server log."

    quiet = {"considered": 0, "sent": 0, "failed": 0, "skipped": 0}

    async def nothing_to_send(*args, **kwargs):
        return quiet

    monkeypatch.setattr(cron_service, "send_external_interview_reminders", nothing_to_send)
    assert (await cron_service.run_job("external_reminders"))["detail"] == "Sent 0 reminder(s)."


async def test_the_job_sync_runs_the_existing_logic(ops, monkeypatch):
    from services.hr_module import scheduler

    async def fake_sync():
        return {"ran": True, "sources": [
            {"source": "remotive", "imported": 2, "skipped": 1, "error": None},
            {"source": "jobicy", "imported": 0, "skipped": 0, "error": "Jobicy request failed: boom"},
        ]}

    monkeypatch.setattr(scheduler, "sync_all_sources", fake_sync)
    result = await cron_service.run_job("job_sync")
    assert result["status"] == "error"
    assert result["detail"] == "Imported 2 job(s), skipped 1 duplicate(s) from 2 source(s); failed: jobicy."


async def test_summarise_sync():
    assert cron_service.summarise_sync({"ran": False, "reason": "database unavailable", "sources": []})[0] == "error"
    assert cron_service.summarise_sync({"ran": True, "sources": []}) == ("ok", "No job source is configured to sync.")
    status, detail = cron_service.summarise_sync({"ran": True, "sources": [{"source": "a", "imported": 1, "skipped": 0, "error": None}]})
    assert status == "ok" and detail.startswith("Imported 1 job(s)")


async def test_status_needs_an_admin(client, standard_headers, ops):
    assert (await client.get("/api/v1/cron/status", headers=standard_headers)).status_code == 403
    assert (await client.get("/api/v1/cron/status")).status_code == 401


async def test_status_reports_enabled_and_every_job_before_any_run(client, admin_headers, ops, monkeypatch):
    monkeypatch.setattr(settings, "CRON_SECRET", "")
    body = (await client.get("/api/v1/cron/status", headers=admin_headers)).json()
    assert body["enabled"] is False
    assert [j["key"] for j in body["jobs"]] == ALL_JOBS
    for job in body["jobs"]:
        assert job["label"]
        assert (job["last_run_at"], job["last_status"], job["last_detail"]) == (None, None, None)

    monkeypatch.setattr(settings, "CRON_SECRET", SECRET)
    assert (await client.get("/api/v1/cron/status", headers=admin_headers)).json()["enabled"] is True


async def test_status_reads_back_the_latest_run_of_each_job(client, admin_headers, secret, ops, runners):
    await client.get("/api/v1/cron/daily", headers=AUTH)
    runners.plan["job_sync"] = ("error", "Imported 0 job(s); failed: remotive.")
    await client.get("/api/v1/cron/job-sync", headers=AUTH)

    jobs = {j["key"]: j for j in (await client.get("/api/v1/cron/status", headers=admin_headers)).json()["jobs"]}
    assert set(jobs["reminders"]) == {"key", "label", "last_run_at", "last_status", "last_detail"}
    assert jobs["reminders"]["last_status"] == "ok" and jobs["reminders"]["last_detail"] == "Sent 2 reminder(s)."
    assert jobs["job_sync"]["last_status"] == "error"
    assert jobs["job_sync"]["last_detail"] == "Imported 0 job(s); failed: remotive."
    assert jobs["job_sync"]["last_run_at"] >= jobs["reminders"]["last_run_at"]


def _external(hours_ahead: float, **fields) -> dict:
    start = datetime.now(timezone.utc) + timedelta(hours=hours_ahead)
    doc = {
        "doc_type": "candidate", "candidate_id": f"cand-rem-{uuid.uuid4().hex[:8]}", "job_id": "job-rem",
        "name": "Reminder Person", "email": f"rem-{uuid.uuid4().hex[:6]}@example.com",
        "interview_mode": "external", "pipeline_stage": "interviewing", "status": "interviewing",
        "external_interview": {
            "platform": "meet", "platform_label": "Google Meet", "join_url": "https://meet.google.com/abc-defg-hij",
            "scheduled_start_at": start.isoformat(), "duration_minutes": 45, "status": "scheduled",
            "notes": "Bring your portfolio", "display_timezone": "Asia/Kolkata",
        },
    }
    for key, value in fields.items():
        if key == "external_interview":
            doc["external_interview"].update(value)
        else:
            doc[key] = value
    return doc


@pytest.fixture
async def reminders(monkeypatch):
    sent: list[dict] = []
    state = {"result": True}

    async def fake_reminder(**kwargs):
        sent.append(kwargs)
        return state["result"]

    monkeypatch.setattr(email_service, "send_external_interview_reminder_email", fake_reminder)
    monkeypatch.setattr(email_delivery_service, "current_provider", lambda: "smtp")
    db = get_db()
    ids: list[str] = []

    async def seed(doc):
        await db.candidates.insert_one(dict(doc))
        ids.append(doc["candidate_id"])
        return doc

    async def stored(candidate_id):
        return await db.candidates.find_one({"candidate_id": candidate_id})

    def mine():
        return {s["candidate_id"] for s in sent if s["candidate_id"] in ids}

    yield types_ns(seed=seed, stored=stored, sent=sent, state=state, mine=mine)
    await db.candidates.delete_many({"candidate_id": {"$in": ids}})


async def test_only_interviews_starting_within_a_day_get_one_reminder(reminders, ops):
    eligible = await reminders.seed(_external(5))
    other_offset = await reminders.seed(_external(3, external_interview={
        "scheduled_start_at": (datetime.now(timezone.utc) + timedelta(hours=3)).astimezone(timezone(timedelta(hours=5, minutes=30))).isoformat(),
    }))
    skipped = {
        "too far": await reminders.seed(_external(30)),
        "already reminded": await reminders.seed(_external(4, external_interview={"reminder_sent_at": "2026-01-01T00:00:00+00:00"})),
        "no show": await reminders.seed(_external(4, external_interview={"status": "no_show"})),
        "reviewed": await reminders.seed(_external(4, external_review={"overall": 4})),
        "hired": await reminders.seed(_external(4, pipeline_stage="hired")),
        "past": await reminders.seed(_external(-1)),
        "no email": await reminders.seed(_external(4, email="")),
        "platform interview": await reminders.seed(_external(4, interview_mode="platform")),
    }

    result = await cron_service.send_external_interview_reminders()
    assert reminders.mine() == {eligible["candidate_id"], other_offset["candidate_id"]}
    assert result["sent"] >= 2 and result["failed"] == 0

    for candidate in (eligible, other_offset):
        assert (await reminders.stored(candidate["candidate_id"]))["external_interview"]["reminder_sent_at"]
    for reason, candidate in skipped.items():
        stored = await reminders.stored(candidate["candidate_id"])
        assert not stored["external_interview"].get("reminder_sent_at") or reason == "already reminded", reason


async def test_the_reminder_carries_the_meeting_details_and_nothing_else(reminders, ops):
    candidate = await reminders.seed(_external(6))
    await cron_service.send_external_interview_reminders()
    call = next(s for s in reminders.sent if s["candidate_id"] == candidate["candidate_id"])
    assert call["to_email"] == candidate["email"] and call["platform_label"] == "Google Meet"
    assert call["join_url"] == "https://meet.google.com/abc-defg-hij" and call["duration_minutes"] == 45
    assert call["notes"] == "Bring your portfolio" and call["display_timezone"] == "Asia/Kolkata"
    assert not ({"score", "report", "recommendation", "review", "summary"} & set(call))


async def test_the_reminder_for_an_interview_in_person_carries_the_place_and_no_link(reminders, ops):
    candidate = await reminders.seed(_external(6, external_interview={
        "platform": "physical", "platform_label": "In person", "join_url": None, "location": "12 High Street, Lahore",
    }))
    result = await cron_service.send_external_interview_reminders()
    call = next(s for s in reminders.sent if s["candidate_id"] == candidate["candidate_id"])
    assert call["location"] == "12 High Street, Lahore" and call["join_url"] is None and call["platform_label"] == "In person"
    assert call["to_email"] == candidate["email"] and result["failed"] == 0
    assert (await reminders.stored(candidate["candidate_id"]))["external_interview"]["reminder_sent_at"]


async def test_an_interview_with_neither_a_link_nor_a_place_has_nothing_to_remind_about(reminders, ops):
    candidate = await reminders.seed(_external(6, external_interview={"join_url": None, "location": None}))
    await cron_service.send_external_interview_reminders()
    assert candidate["candidate_id"] not in reminders.mine()
    assert not (await reminders.stored(candidate["candidate_id"]))["external_interview"].get("reminder_sent_at")


async def test_a_candidate_is_reminded_only_once(reminders, ops):
    candidate = await reminders.seed(_external(5))
    await cron_service.send_external_interview_reminders()
    await cron_service.send_external_interview_reminders()
    assert [s["candidate_id"] for s in reminders.sent].count(candidate["candidate_id"]) == 1


async def test_a_failed_send_gives_the_claim_back_so_the_next_run_retries(reminders, ops):
    candidate = await reminders.seed(_external(5))
    reminders.state["result"] = False
    first = await cron_service.send_external_interview_reminders()
    assert first["failed"] >= 1
    assert not (await reminders.stored(candidate["candidate_id"]))["external_interview"].get("reminder_sent_at")

    reminders.state["result"] = True
    await cron_service.send_external_interview_reminders()
    assert (await reminders.stored(candidate["candidate_id"]))["external_interview"]["reminder_sent_at"]
    assert [s["candidate_id"] for s in reminders.sent].count(candidate["candidate_id"]) == 2


async def test_a_send_that_raises_is_a_failed_reminder_not_a_failed_run(reminders, ops, monkeypatch):
    candidate = await reminders.seed(_external(5))

    async def boom(**kwargs):
        raise RuntimeError("smtp down")

    monkeypatch.setattr(email_service, "send_external_interview_reminder_email", boom)
    result = await cron_service.send_external_interview_reminders()
    assert result["failed"] >= 1
    assert not (await reminders.stored(candidate["candidate_id"]))["external_interview"].get("reminder_sent_at")


async def test_moving_the_interview_clears_the_reminder_stamp(client, admin_headers, reminders, ops):
    db = get_db()
    job_id = f"job-rem-{uuid.uuid4().hex[:6]}"
    await db.jobs.insert_one({"doc_type": "job", "job_id": job_id, "title": "Role", "company_name": "Co", "candidate_pipeline": []})
    candidate = await reminders.seed(_external(5, job_id=job_id, external_interview={"reminder_sent_at": "2026-01-01T00:00:00+00:00"}))
    cid = candidate["candidate_id"]
    try:
        new_start = (datetime.now(timezone.utc) + timedelta(hours=8)).isoformat()
        response = await client.patch(
            f"/api/v1/candidates/{cid}/external-interview",
            json={"scheduled_start_at": new_start, "send_email": False}, headers=admin_headers,
        )
        assert response.status_code == 200, response.text
        assert "reminder_sent_at" not in (await reminders.stored(cid))["external_interview"]
        await cron_service.send_external_interview_reminders()
        assert cid in reminders.mine()
    finally:
        await db.jobs.delete_one({"job_id": job_id})
        await db.audit_log.delete_many({"resource_id": cid})


async def test_the_external_reminders_job_reports_its_counts(reminders, ops):
    await reminders.seed(_external(5))
    result = await cron_service.run_job("external_reminders")
    assert result["status"] == "ok" and result["detail"].startswith("Sent ") and "reminder(s)" in result["detail"]


@pytest.fixture
def outbox(monkeypatch):
    sent: list[dict] = []

    async def fake_send_email(**kwargs):
        sent.append(kwargs)
        return True

    monkeypatch.setattr(email_service, "send_email", fake_send_email)
    return sent


async def test_the_reminder_email_holds_the_meeting_details_only(outbox):
    start = (datetime.now(timezone.utc) + timedelta(hours=20)).replace(microsecond=0)
    await email_service.send_external_interview_reminder_email(
        to_email="cand@example.com", candidate_name="Asha <b>Rao</b>", job_title="Backend Engineer",
        company_name="Acme", platform_label="Google Meet", join_url="https://meet.google.com/abc-defg-hij?x=1&y=2",
        scheduled_start_at=start.isoformat(), duration_minutes=45,
        notes="Bring <script>alert(1)</script> your portfolio", display_timezone="Asia/Kolkata",
        candidate_id="c1", job_id="j1",
    )
    mail = outbox[0]
    assert mail["to"] == "cand@example.com" and mail["template"] == "external_interview_reminder"
    assert mail["subject"] == "Reminder: your interview for Backend Engineer"
    text, html = mail["text_body"], mail["html_body"]
    for expected in ("Google Meet", "UTC", "Asia/Kolkata", "https://meet.google.com/abc-defg-hij?x=1&y=2",
                     "Bring <script>alert(1)</script> your portfolio", "45 minutes", "Acme"):
        assert expected in text, expected
    assert "<script>" not in html and "&lt;script&gt;" in html and "&lt;b&gt;" in html
    assert "x=1&amp;y=2" in html
    for banned in ("score", "recommendation", "report", "rating", "review"):
        assert banned not in text.lower() and banned not in html.lower(), banned
    assert chr(0x2014) not in text + html + mail["subject"]


async def test_the_reminder_email_without_a_note_has_no_note_block(outbox):
    await email_service.send_external_interview_reminder_email(
        to_email="c@example.com", candidate_name="A", job_title="Role", company_name=None,
        platform_label="Zoom", join_url="https://zoom.us/j/1", scheduled_start_at="2026-12-01T10:00:00+00:00",
        duration_minutes=30,
    )
    assert "note from the recruiter" not in outbox[0]["text_body"].lower()
    assert "note from the recruiter" not in outbox[0]["html_body"].lower()


async def test_vercel_json_declares_one_daily_cron_and_keeps_its_rewrites():
    config = json.loads((REPO / "vercel.json").read_text(encoding="utf-8"))
    assert config["crons"] == [{"path": "/api/v1/cron/daily", "schedule": "0 8 * * *"}]
    sources = [r["source"] for r in config["rewrites"]]
    assert sources == ["/health", "/api/(.*)", "/(.*)"]

    path = config["crons"][0]["path"]
    first = next(r for r in config["rewrites"] if re.fullmatch(r["source"], path))
    assert first["destination"] == "/api/index"


async def test_the_cron_path_is_a_route_that_exists():
    from main import app

    paths = app.openapi()["paths"]
    assert "get" in paths["/api/v1/cron/daily"] and "/api/v1/cron/status" in paths


async def test_the_startup_audit_names_a_missing_cron_secret_only_on_a_serverless_host(monkeypatch):
    from config.settings import validate_runtime_config

    for name in ("VERCEL", "AWS_LAMBDA_FUNCTION_NAME"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(settings, "CRON_SECRET", "")
    assert not any("CRON_SECRET" in w for w in validate_runtime_config())

    monkeypatch.setenv("VERCEL", "1")
    assert any("CRON_SECRET" in w for w in validate_runtime_config())

    monkeypatch.setattr(settings, "CRON_SECRET", SECRET)
    assert not any("CRON_SECRET" in w for w in validate_runtime_config())


async def test_cron_secret_is_documented_and_defaults_to_disabled():
    assert type(settings).model_fields["CRON_SECRET"].default == ""
    assert "CRON_SECRET" in (REPO / "backend" / ".env.example").read_text(encoding="utf-8")
    assert "CRON_SECRET" in (REPO / "README.md").read_text(encoding="utf-8")
