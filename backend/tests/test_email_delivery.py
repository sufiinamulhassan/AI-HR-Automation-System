import asyncio
import re
import ssl
import sys
import types
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from config.database import get_db
from config.settings import settings
from services.hr_module import email_delivery_service, email_service
from services.hr_module.permissions import (
    DEFAULT_ROLE_PERMISSIONS,
    PERMISSION_CATALOG,
    _STANDARD_PERMISSIONS,
)

pytestmark = pytest.mark.anyio

BASE = "/api/v1/email-delivery"
ADMIN_EMAIL = "demo-admin@hirely.ai"
PASSWORD_MARKER = "pw-marker-Zq81xT"
USERNAME_MARKER = "user-marker-Kd29vB"


def _iso(days: float = 0.0) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()


def _far(i: int) -> str:
    return (datetime(2999, 12, 31, 23, 59, 59, tzinfo=timezone.utc) - timedelta(seconds=i)).isoformat()


@pytest.fixture(autouse=True)
async def fresh_test_send_window():
    db = get_db()

    async def _reset():
        base = int(datetime.now(timezone.utc).timestamp() // 600) * 600
        for email in (ADMIN_EMAIL, "demo-superadmin@hirely.ai"):
            for offset in (-600, 0, 600):
                await db.rate_limits.delete_one({"_id": f"email_test_send:{email}:{base + offset}"})
                await db.rate_limits.delete_one({"_id": f"email_verify:{email}:{base + offset}"})

    await _reset()
    yield
    await _reset()


@pytest.fixture
def smtp(monkeypatch):
    monkeypatch.setattr(settings, "AWS_SES_ENABLED", False)
    monkeypatch.setattr(settings, "EMAIL_HOST", "smtp.delivery-test.example")
    monkeypatch.setattr(settings, "EMAIL_USERNAME", USERNAME_MARKER)
    monkeypatch.setattr(settings, "EMAIL_PASSWORD", PASSWORD_MARKER)
    monkeypatch.setattr(settings, "EMAIL_FROM", "hr-test@delivery-test.example")


@pytest.fixture
def no_provider(monkeypatch):
    monkeypatch.setattr(settings, "AWS_SES_ENABLED", False)
    monkeypatch.setattr(settings, "EMAIL_HOST", "")


@pytest.fixture
def mail(monkeypatch):
    state = {"sent": [], "outcomes": {}}

    async def fake_send_email(**kwargs):
        state["sent"].append(kwargs)
        return state["outcomes"].get(kwargs["to"], True)

    monkeypatch.setattr(email_service, "send_email", fake_send_email)
    return state


@pytest.fixture
async def log_rows():
    db = get_db()
    ids: list = []
    yield ids
    for _id in ids:
        await db.email_log.delete_one({"_id": _id})


@pytest.fixture
async def candidate_ids():
    db = get_db()
    ids: list = []
    yield ids
    for cid in ids:
        await db.candidates.delete_one({"candidate_id": cid})


@pytest.fixture
async def audit_rows():
    db = get_db()
    started = _iso()
    actions: list[str] = []
    yield started, actions
    for action in actions:
        async for row in db.audit_log.find({"action": action, "created_at": {"$gte": started}}, {"_id": 1}):
            await db.audit_log.delete_one({"_id": row["_id"]})


async def _seed_log(db, log_rows, **fields) -> str:
    row = {
        "to": f"seed-{uuid.uuid4().hex[:8]}@example.com",
        "subject": "Seeded subject",
        "template": None,
        "candidate_id": None,
        "job_id": None,
        "status": "sent",
        "created_at": _iso(),
    }
    row.update(fields)
    res = await db.email_log.insert_one(row)
    log_rows.append(res.inserted_id)
    return str(res.inserted_id)


async def _seed_candidate(db, candidate_ids, *, email=None, token=None, **overrides) -> dict:
    cid = f"cand-edh-{uuid.uuid4().hex[:10]}"
    doc = {
        "doc_type": "candidate",
        "candidate_id": cid,
        "job_id": f"job-edh-{uuid.uuid4().hex[:6]}",
        "name": "Delivery Test",
        "email": email if email is not None else f"{cid}@example.com",
        "secure_token": token or f"tok_{uuid.uuid4().hex[:12]}",
        "token_status": "active",
        "status": "invited",
        "invite_sent_at": _iso(-1),
        "invite_expires_at": _iso(5),
        "invite_resent_count": 0,
        "created_at": _iso(-1),
    }
    doc.update(overrides)
    await db.candidates.insert_one(doc)
    candidate_ids.append(cid)
    return doc


async def _seed_failed_invite(db, log_rows, cand: dict, **fields) -> str:
    return await _seed_log(
        db, log_rows, to=cand["email"], template="interview_invitation", status="failed",
        candidate_id=cand["candidate_id"], created_at=_iso(-0.5), **fields,
    )


CALLS = [
    ("get", "/health", None),
    ("post", "/verify", None),
    ("post", "/test-send", {"to": "someone@example.com"}),
    ("post", "/resend-failed", {"log_ids": []}),
    ("post", "/resend-waiting", {"limit": 1}),
]


async def _call(client, method, path, body, headers=None):
    fn = getattr(client, method)
    kwargs = {"headers": headers} if headers is not None else {}
    if body is not None:
        kwargs["json"] = body
    return await fn(f"{BASE}{path}", **kwargs)


@pytest.mark.parametrize("method,path,body", CALLS)
async def test_requires_authentication(client, method, path, body):
    resp = await _call(client, method, path, body)
    assert resp.status_code == 401


@pytest.mark.parametrize("method,path,body", CALLS)
async def test_standard_user_is_forbidden(client, standard_headers, method, path, body):
    resp = await _call(client, method, path, body, standard_headers)
    assert resp.status_code == 403
    assert "Admin access required" in resp.json()["detail"]


async def test_admin_and_superadmin_pass_the_gate(client, admin_headers, superadmin_headers):
    assert (await client.get(f"{BASE}/health", headers=admin_headers)).status_code == 200
    assert (await client.get(f"{BASE}/health", headers=superadmin_headers)).status_code == 200


async def test_admin_role_without_the_permission_is_still_forbidden(client, admin_headers):
    db = get_db()
    await db.roles.insert_one({
        "role_name": "admin",
        "permissions": [p for p in DEFAULT_ROLE_PERMISSIONS["admin"] if p != "email:manage"],
    })
    try:
        for method, path, body in CALLS:
            resp = await _call(client, method, path, body, admin_headers)
            assert resp.status_code == 403, f"{method} {path}: {resp.text}"
            assert "email:manage" in resp.json()["detail"]
    finally:
        await db.roles.delete_one({"role_name": "admin"})


async def test_permission_is_registered_for_admin_roles_only():
    assert "email:manage" in PERMISSION_CATALOG
    assert "email:manage" in DEFAULT_ROLE_PERMISSIONS["admin"]
    assert "email:manage" in DEFAULT_ROLE_PERMISSIONS["superadmin"]
    assert "email:manage" not in DEFAULT_ROLE_PERMISSIONS["standard"]
    assert "email:manage" not in _STANDARD_PERMISSIONS


async def test_health_when_nothing_is_configured(client, admin_headers, no_provider):
    body = (await client.get(f"{BASE}/health", headers=admin_headers)).json()
    assert body["configured"] is False
    assert body["provider"] is None
    assert body["from_address"] is None
    assert body["host"] is None
    assert set(body["last_7d"]) == {"sent", "failed", "console_only"}


PLATFORM_HEADERS = {"Authorization": "Bearer demo-platform-token"}


async def test_health_reports_smtp_host_without_credentials(client, smtp):
    resp = await client.get(f"{BASE}/health", headers=PLATFORM_HEADERS)
    body = resp.json()
    assert body["configured"] is True
    assert body["provider"] == "smtp"
    assert body["from_address"] == "hr-test@delivery-test.example"
    assert body["host"] == "smtp.delivery-test.example"
    assert PASSWORD_MARKER not in resp.text
    assert USERNAME_MARKER not in resp.text


async def test_a_company_admin_is_not_told_the_shared_mail_host(client, admin_headers, smtp):
    resp = await client.get(f"{BASE}/health", headers=admin_headers)
    body = resp.json()
    assert body["configured"] is True and body["provider"] == "smtp"
    assert body["host"] is None
    assert "smtp.delivery-test.example" not in resp.text
    assert PASSWORD_MARKER not in resp.text and USERNAME_MARKER not in resp.text


async def test_health_reduces_a_url_style_host_to_the_hostname(client, smtp, monkeypatch):
    monkeypatch.setattr(settings, "EMAIL_HOST", f"smtps://{USERNAME_MARKER}:{PASSWORD_MARKER}@mail.delivery-test.example:465/x")
    resp = await client.get(f"{BASE}/health", headers=PLATFORM_HEADERS)
    assert resp.json()["host"] == "mail.delivery-test.example"
    assert PASSWORD_MARKER not in resp.text
    assert USERNAME_MARKER not in resp.text


async def test_health_ses_provider_has_no_host(client, admin_headers, no_provider, monkeypatch):
    monkeypatch.setattr(settings, "AWS_SES_ENABLED", True)
    monkeypatch.setattr(settings, "EMAIL_HOST", "smtp.ignored.example")
    body = (await client.get(f"{BASE}/health", headers=admin_headers)).json()
    assert body["configured"] is True
    assert body["provider"] == "ses"
    assert body["host"] is None


async def test_health_counts_the_last_seven_days_by_outcome(client, admin_headers, log_rows):
    db = get_db()
    before = (await client.get(f"{BASE}/health", headers=admin_headers)).json()["last_7d"]

    recent, old = _iso(-1), _iso(-10)
    for status, n in (("sent", 3), ("failed", 2), ("not_sent", 2), ("queued", 1)):
        for _ in range(n):
            await _seed_log(db, log_rows, status=status, created_at=recent)
    for status in ("sent", "sent", "failed", "not_sent"):
        await _seed_log(db, log_rows, status=status, created_at=old)

    after = (await client.get(f"{BASE}/health", headers=admin_headers)).json()["last_7d"]
    assert after["sent"] - before["sent"] == 3
    assert after["failed"] - before["failed"] == 2
    assert after["console_only"] - before["console_only"] == 2


async def test_recent_failures_are_newest_first_with_a_derived_kind(client, admin_headers, log_rows):
    db = get_db()
    marker = uuid.uuid4().hex[:8]
    plan = [
        ("interview_invitation", "invite"),
        ("interview_status", "status"),
        ("rejection", "status"),
        ("offer_letter", "offer"),
        ("assessment_invitation", "other"),
        ("otp", "other"),
        (None, "other"),
        ("reminder", "other"),
    ]
    expected = []
    for i, (template, kind) in enumerate(plan):
        log_id = await _seed_log(
            db, log_rows, status="failed", template=template, created_at=_far(i),
            to=f"{marker}-{i}@example.com", subject=f"Subject {marker} {i}",
            candidate_id=f"cand-{marker}-{i}",
        )
        expected.append((log_id, kind, i))
    ok_id = await _seed_log(db, log_rows, status="sent", created_at=_far(-5))

    body = (await client.get(f"{BASE}/health", headers=admin_headers)).json()
    failures = body["recent_failures"]
    assert len(failures) <= 20
    assert ok_id not in {f["log_id"] for f in failures}
    top = failures[: len(plan)]
    assert [f["log_id"] for f in top] == [e[0] for e in expected]
    for failure, (_, kind, i) in zip(top, expected):
        assert failure["kind"] == kind
        assert failure["to"] == f"{marker}-{i}@example.com"
        assert failure["subject"] == f"Subject {marker} {i}"
        assert failure["candidate_id"] == f"cand-{marker}-{i}"
        assert failure["created_at"] == _far(i)
        assert set(failure) == {"log_id", "to", "subject", "kind", "candidate_id", "created_at", "error", "hint"}
        assert failure["error"] is None
        assert failure["hint"] is None


async def test_recent_failures_are_capped_at_twenty(client, admin_headers, log_rows):
    db = get_db()
    ids = [await _seed_log(db, log_rows, status="failed", created_at=_far(i)) for i in range(22)]
    failures = (await client.get(f"{BASE}/health", headers=admin_headers)).json()["recent_failures"]
    assert len(failures) == 20
    assert [f["log_id"] for f in failures] == ids[:20]


async def test_health_never_leaks_secrets_even_from_stored_errors(client, admin_headers, smtp, log_rows):
    db = get_db()
    await _seed_log(
        db, log_rows, status="failed", created_at=_far(0), template="interview_invitation",
        error=f"535 Authentication failed for {USERNAME_MARKER} using password {PASSWORD_MARKER}",
    )
    resp = await client.get(f"{BASE}/health", headers=admin_headers)
    assert resp.status_code == 200
    assert PASSWORD_MARKER not in resp.text
    top = resp.json()["recent_failures"][0]
    assert "***" in top["error"]
    assert "Authentication failed" in top["error"]


async def test_failed_send_records_a_scrubbed_error_on_the_log_row(smtp, monkeypatch, log_rows):
    import aiosmtplib

    async def boom(*args, **kwargs):
        raise RuntimeError(f"login rejected, password was {PASSWORD_MARKER}")

    monkeypatch.setattr(aiosmtplib, "send", boom)
    db = get_db()
    to = f"errlog-{uuid.uuid4().hex[:8]}@example.com"
    ok = await email_service.send_email(
        to=to, subject="s", html_body="<p>x</p>", text_body="x", db=db, template="test_send",
    )
    row = await db.email_log.find_one({"to": to})
    assert row is not None
    log_rows.append(row["_id"])
    assert ok is False
    assert row["status"] == "failed"
    assert "login rejected" in row["error"]
    assert PASSWORD_MARKER not in row["error"]


async def test_test_send_delivered(client, admin_headers, smtp, mail, audit_rows):
    _, actions = audit_rows
    actions.append("email_test_send")
    to = f"probe-{uuid.uuid4().hex[:8]}@example.com"
    resp = await client.post(f"{BASE}/test-send", json={"to": to}, headers=admin_headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["delivered"] is True
    assert body["status"] == "sent"
    assert to in body["detail"]
    assert PASSWORD_MARKER not in resp.text and USERNAME_MARKER not in resp.text

    assert len(mail["sent"]) == 1
    call = mail["sent"][0]
    assert call["to"] == to
    assert call["template"] == "test_send"
    assert call["text_body"] and call["html_body"] and call["subject"]
    assert PASSWORD_MARKER not in call["text_body"] + call["html_body"]


async def test_test_send_not_delivered_reports_the_logged_reason(client, admin_headers, smtp, monkeypatch, audit_rows, log_rows):
    _, actions = audit_rows
    actions.append("email_test_send")
    db = get_db()
    to = f"probe-{uuid.uuid4().hex[:8]}@example.com"

    async def failing_send(**kwargs):
        res = await db.email_log.insert_one({
            "to": kwargs["to"], "subject": kwargs["subject"], "template": kwargs["template"],
            "candidate_id": None, "job_id": None, "status": "failed", "created_at": _iso(),
            "error": f"SMTPConnectError: refused (password {PASSWORD_MARKER})",
        })
        log_rows.append(res.inserted_id)
        return False

    monkeypatch.setattr(email_service, "send_email", failing_send)
    resp = await client.post(f"{BASE}/test-send", json={"to": to}, headers=admin_headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["delivered"] is False
    assert body["status"] == "failed"
    assert "SMTPConnectError" in body["detail"]
    assert PASSWORD_MARKER not in resp.text


async def test_test_send_not_delivered_without_a_logged_reason(client, admin_headers, smtp, mail, audit_rows):
    _, actions = audit_rows
    actions.append("email_test_send")
    to = f"probe-{uuid.uuid4().hex[:8]}@example.com"
    mail["outcomes"][to] = False
    body = (await client.post(f"{BASE}/test-send", json={"to": to}, headers=admin_headers)).json()
    assert body["delivered"] is False
    assert body["status"] == "failed"
    assert body["detail"]


async def test_test_send_survives_an_exception_from_the_sender(client, admin_headers, smtp, monkeypatch, audit_rows):
    _, actions = audit_rows
    actions.append("email_test_send")

    async def raising(**kwargs):
        raise RuntimeError(f"transport blew up {PASSWORD_MARKER}")

    monkeypatch.setattr(email_service, "send_email", raising)
    resp = await client.post(f"{BASE}/test-send", json={"to": "probe@example.com"}, headers=admin_headers)
    assert resp.status_code == 200
    assert resp.json()["delivered"] is False
    assert resp.json()["status"] == "failed"
    assert PASSWORD_MARKER not in resp.text


async def test_test_send_without_a_provider_reports_it_and_sends_nothing(client, admin_headers, no_provider, mail, audit_rows):
    _, actions = audit_rows
    actions.append("email_test_send")
    resp = await client.post(f"{BASE}/test-send", json={"to": "probe@example.com"}, headers=admin_headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["delivered"] is False
    assert body["status"] == "not_configured"
    assert "No email provider is configured" in body["detail"]
    assert mail["sent"] == []


async def test_test_send_rejects_a_bad_address(client, admin_headers, mail):
    resp = await client.post(f"{BASE}/test-send", json={"to": "not-an-email"}, headers=admin_headers)
    assert resp.status_code == 422
    assert mail["sent"] == []


async def test_test_send_is_audited(client, admin_headers, smtp, mail, audit_rows):
    started, actions = audit_rows
    actions.append("email_test_send")
    to = f"audited-{uuid.uuid4().hex[:8]}@example.com"
    await client.post(f"{BASE}/test-send", json={"to": to}, headers=admin_headers)
    row = await get_db().audit_log.find_one({"action": "email_test_send", "details.to": to, "created_at": {"$gte": started}})
    assert row is not None
    assert row["actor_email"] == ADMIN_EMAIL
    assert row["resource_type"] == "email_delivery"
    assert row["details"]["delivered"] is True


async def test_test_send_is_rate_limited_per_admin(client, admin_headers, no_provider, mail, audit_rows):
    _, actions = audit_rows
    actions.append("email_test_send")
    for i in range(5):
        resp = await client.post(f"{BASE}/test-send", json={"to": f"probe{i}@example.com"}, headers=admin_headers)
        assert resp.status_code == 200, f"call {i + 1}: {resp.text}"
    limited = await client.post(f"{BASE}/test-send", json={"to": "probe6@example.com"}, headers=admin_headers)
    assert limited.status_code == 429


async def test_resend_failed_resends_with_the_current_link(client, admin_headers, smtp, mail, log_rows, candidate_ids, audit_rows):
    _, actions = audit_rows
    actions.append("email_resend_failed")
    db = get_db()
    cand = await _seed_candidate(db, candidate_ids, token="tok_oldlink000001")
    log_id = await _seed_failed_invite(db, log_rows, cand)
    await db.candidates.update_one({"candidate_id": cand["candidate_id"]}, {"$set": {"secure_token": "tok_newlink000002"}})

    resp = await client.post(f"{BASE}/resend-failed", json={"log_ids": [log_id]}, headers=admin_headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert (body["attempted"], body["delivered"], body["failed"], body["skipped"]) == (1, 1, 0, 0)
    assert body["results"] == [{"log_id": log_id, "outcome": "delivered", "reason": None}]

    assert len(mail["sent"]) == 1
    call = mail["sent"][0]
    assert call["to"] == cand["email"]
    assert call["template"] == "interview_invitation"
    assert call["candidate_id"] == cand["candidate_id"]
    assert "/interview/tok_newlink000002" in call["text_body"]
    assert "tok_oldlink000001" not in call["text_body"] + call["html_body"]

    stored = await db.candidates.find_one({"candidate_id": cand["candidate_id"]})
    assert stored["invite_resent_count"] == 1
    assert stored["last_resent_by"] == ADMIN_EMAIL
    assert stored["invite_email_delivered"] is True


async def test_resend_failed_counts_delivered_and_failed_separately(client, admin_headers, smtp, mail, log_rows, candidate_ids, audit_rows):
    _, actions = audit_rows
    actions.append("email_resend_failed")
    db = get_db()
    good = await _seed_candidate(db, candidate_ids)
    bad = await _seed_candidate(db, candidate_ids)
    good_log = await _seed_failed_invite(db, log_rows, good)
    bad_log = await _seed_failed_invite(db, log_rows, bad)
    mail["outcomes"][bad["email"]] = False

    resp = await client.post(f"{BASE}/resend-failed", json={"log_ids": [good_log, bad_log]}, headers=admin_headers)
    body = resp.json()
    assert (body["attempted"], body["delivered"], body["failed"], body["skipped"]) == (2, 1, 1, 0)
    outcomes = {r["log_id"]: r["outcome"] for r in body["results"]}
    assert outcomes == {good_log: "delivered", bad_log: "failed"}

    assert (await db.candidates.find_one({"candidate_id": good["candidate_id"]}))["invite_resent_count"] == 1
    assert (await db.candidates.find_one({"candidate_id": bad["candidate_id"]}))["invite_resent_count"] == 0


async def test_resend_failed_skips_everything_that_is_not_an_eligible_invite(client, admin_headers, smtp, mail, log_rows, candidate_ids, audit_rows):
    _, actions = audit_rows
    actions.append("email_resend_failed")
    db = get_db()
    reasons: dict[str, str] = {}

    ok_cand = await _seed_candidate(db, candidate_ids)
    ok_log = await _seed_failed_invite(db, log_rows, ok_cand)

    for template in ("interview_status", "offer_letter", "reminder", None):
        cand = await _seed_candidate(db, candidate_ids)
        reasons[await _seed_log(
            db, log_rows, to=cand["email"], template=template, status="failed",
            candidate_id=cand["candidate_id"],
        )] = "not_an_invite"

    cand = await _seed_candidate(db, candidate_ids)
    for status in ("sent", "not_sent"):
        reasons[await _seed_log(
            db, log_rows, to=cand["email"], template="interview_invitation", status=status,
            candidate_id=cand["candidate_id"],
        )] = "not_failed"

    reasons["not-an-objectid"] = "invalid_log_id"
    reasons[uuid.uuid4().hex[:24]] = "log_not_found"

    reasons[await _seed_log(db, log_rows, template="interview_invitation", status="failed", candidate_id=None)] = "no_candidate"
    reasons[await _seed_log(
        db, log_rows, template="interview_invitation", status="failed", candidate_id=f"cand-missing-{uuid.uuid4().hex[:6]}",
    )] = "candidate_not_found"

    no_email = await _seed_candidate(db, candidate_ids, email="")
    reasons[await _seed_failed_invite(db, log_rows, no_email)] = "no_email"

    done = await _seed_candidate(db, candidate_ids, token_status="consumed", status="completed")
    reasons[await _seed_failed_invite(db, log_rows, done)] = "interview_already_completed"

    expired = await _seed_candidate(db, candidate_ids, invite_expires_at=_iso(-2))
    reasons[await _seed_failed_invite(db, log_rows, expired)] = "invite_expired"

    superseded = await _seed_candidate(db, candidate_ids)
    reasons[await _seed_failed_invite(db, log_rows, superseded)] = "already_delivered_since"
    await _seed_log(
        db, log_rows, to=superseded["email"], template="interview_invitation", status="sent",
        candidate_id=superseded["candidate_id"], created_at=_iso(-0.1),
    )

    dup_cand = await _seed_candidate(db, candidate_ids)
    first_dup = await _seed_failed_invite(db, log_rows, dup_cand)
    second_dup = await _seed_failed_invite(db, log_rows, dup_cand)
    reasons[second_dup] = "duplicate_candidate"

    ids = [ok_log, first_dup, *reasons]
    assert len(ids) <= 25
    resp = await client.post(f"{BASE}/resend-failed", json={"log_ids": ids}, headers=admin_headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["attempted"] == 2 and body["delivered"] == 2 and body["failed"] == 0
    assert body["skipped"] == len(reasons)
    got = {r["log_id"]: (r["outcome"], r["reason"]) for r in body["results"]}
    assert got[ok_log] == ("delivered", None)
    assert got[first_dup] == ("delivered", None)
    for log_id, reason in reasons.items():
        assert got[log_id] == ("skipped", reason), log_id
    assert {c["to"] for c in mail["sent"]} == {ok_cand["email"], dup_cand["email"]}


async def test_resend_failed_enforces_the_per_call_cap(client, admin_headers, smtp, mail):
    too_many_ids = [uuid.uuid4().hex[:24] for _ in range(26)]
    resp = await client.post(f"{BASE}/resend-failed", json={"log_ids": too_many_ids}, headers=admin_headers)
    assert resp.status_code == 400

    assert (await client.post(f"{BASE}/resend-failed", json={"limit": 26}, headers=admin_headers)).status_code == 400
    assert (await client.post(f"{BASE}/resend-failed", json={"limit": 0}, headers=admin_headers)).status_code == 400
    assert (await client.post(f"{BASE}/resend-failed", json={"log_ids": ["x"], "limit": 100}, headers=admin_headers)).status_code == 400
    assert mail["sent"] == []


async def test_resend_failed_accepts_exactly_the_cap(client, admin_headers, smtp, mail, audit_rows):
    _, actions = audit_rows
    actions.append("email_resend_failed")
    ids = [uuid.uuid4().hex[:24] for _ in range(25)]
    resp = await client.post(f"{BASE}/resend-failed", json={"log_ids": ids}, headers=admin_headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert (body["attempted"], body["skipped"]) == (0, 25)
    assert mail["sent"] == []


async def test_resend_failed_with_an_empty_list_does_nothing(client, admin_headers, smtp, mail, audit_rows):
    _, actions = audit_rows
    actions.append("email_resend_failed")
    resp = await client.post(f"{BASE}/resend-failed", json={"log_ids": []}, headers=admin_headers)
    body = resp.json()
    assert (body["attempted"], body["delivered"], body["failed"], body["skipped"]) == (0, 0, 0, 0)
    assert mail["sent"] == []


async def test_resend_failed_auto_picks_newest_failed_invite_per_candidate(client, admin_headers, smtp, mail, log_rows, candidate_ids, audit_rows):
    _, actions = audit_rows
    actions.append("email_resend_failed")
    db = get_db()
    a = await _seed_candidate(db, candidate_ids)
    b = await _seed_candidate(db, candidate_ids)
    c = await _seed_candidate(db, candidate_ids)

    def row(cand, i):
        return _seed_log(
            db, log_rows, to=cand["email"], template="interview_invitation", status="failed",
            candidate_id=cand["candidate_id"], created_at=_far(i),
        )

    a_newest = await row(a, 0)
    await row(a, 1)
    b_log = await row(b, 2)
    await row(c, 3)

    resp = await client.post(f"{BASE}/resend-failed", json={"limit": 2}, headers=admin_headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert (body["attempted"], body["delivered"], body["skipped"]) == (2, 2, 0)
    assert [r["log_id"] for r in body["results"]] == [a_newest, b_log]
    assert {m["to"] for m in mail["sent"]} == {a["email"], b["email"]}
    assert len(mail["sent"]) == 2


async def test_resend_failed_without_a_provider_skips_everything(client, admin_headers, no_provider, mail, log_rows, candidate_ids, audit_rows):
    _, actions = audit_rows
    actions.append("email_resend_failed")
    db = get_db()
    cand = await _seed_candidate(db, candidate_ids)
    log_id = await _seed_failed_invite(db, log_rows, cand)
    resp = await client.post(f"{BASE}/resend-failed", json={"log_ids": [log_id]}, headers=admin_headers)
    body = resp.json()
    assert (body["attempted"], body["delivered"], body["failed"], body["skipped"]) == (0, 0, 0, 1)
    assert body["results"][0]["reason"] == "no_email_provider_configured"
    assert mail["sent"] == []


async def test_resend_failed_is_audited(client, admin_headers, smtp, mail, log_rows, candidate_ids, audit_rows):
    started, actions = audit_rows
    actions.append("email_resend_failed")
    db = get_db()
    cand = await _seed_candidate(db, candidate_ids)
    log_id = await _seed_failed_invite(db, log_rows, cand)
    await client.post(f"{BASE}/resend-failed", json={"log_ids": [log_id]}, headers=admin_headers)

    row = await db.audit_log.find_one({"action": "email_resend_failed", "created_at": {"$gte": started}})
    assert row is not None
    assert row["actor_email"] == ADMIN_EMAIL
    assert row["resource_type"] == "email_delivery"
    assert row["details"] == {"mode": "log_ids", "attempted": 1, "delivered": 1, "failed": 0, "skipped": 0}


@pytest.fixture
def smtp_client(monkeypatch, mail):
    import aiosmtplib

    state: dict = {"calls": [], "init": None, "fail": {}, "hang": False}

    class FakeSMTP:
        def __init__(self, **kwargs):
            state["init"] = kwargs

        async def connect(self, **kwargs):
            state["calls"].append("connect")
            if state["hang"]:
                await asyncio.sleep(30)
            if "connect" in state["fail"]:
                raise state["fail"]["connect"]

        async def login(self, username, password, **kwargs):
            state["calls"].append(("login", username, password))
            if "login" in state["fail"]:
                raise state["fail"]["login"]

        async def quit(self):
            state["calls"].append("quit")

        def close(self):
            state["calls"].append("close")

    async def never_send(*args, **kwargs):
        raise AssertionError("verify must not send a message")

    monkeypatch.setattr(aiosmtplib, "SMTP", FakeSMTP)
    monkeypatch.setattr(aiosmtplib, "send", never_send)
    return state


def _fake_boto3(monkeypatch, *, quota=None, error=None) -> dict:
    seen: dict = {}

    class Client:
        def get_send_quota(self):
            if error is not None:
                raise error
            return quota

    module = types.ModuleType("boto3")

    def client(service, region_name=None):
        seen["service"], seen["region"] = service, region_name
        return Client()

    module.client = client
    monkeypatch.setitem(sys.modules, "boto3", module)
    return seen


async def _verify(client, headers):
    return await client.post(f"{BASE}/verify", headers=headers)


async def test_verify_smtp_connects_signs_in_and_quits_without_sending(client, admin_headers, smtp, smtp_client, mail, audit_rows):
    _, actions = audit_rows
    actions.append("email_verify")
    resp = await _verify(client, admin_headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert set(body) == {"ok", "provider", "detail"}
    assert body["ok"] is True
    assert body["provider"] == "smtp"
    assert "smtp.delivery-test.example" not in resp.text
    assert "the mail server" in body["detail"]
    assert "No message was sent" in body["detail"]
    assert PASSWORD_MARKER not in resp.text and USERNAME_MARKER not in resp.text

    assert smtp_client["calls"] == ["connect", ("login", USERNAME_MARKER, PASSWORD_MARKER), "quit"]
    assert mail["sent"] == []


@pytest.mark.parametrize("use_tls", [True, False])
async def test_verify_smtp_respects_the_tls_setting_and_the_ten_second_timeout(client, admin_headers, smtp, smtp_client, monkeypatch, audit_rows, use_tls):
    _, actions = audit_rows
    actions.append("email_verify")
    monkeypatch.setattr(settings, "EMAIL_USE_TLS", use_tls)
    monkeypatch.setattr(settings, "EMAIL_PORT", 2525)
    await _verify(client, admin_headers)
    init = smtp_client["init"]
    assert init["use_tls"] is use_tls
    assert init["hostname"] == "smtp.delivery-test.example"
    assert init["port"] == 2525
    assert init["timeout"] == 10


async def test_verify_smtp_without_a_username_skips_the_sign_in(client, admin_headers, smtp, smtp_client, monkeypatch, audit_rows):
    _, actions = audit_rows
    actions.append("email_verify")
    monkeypatch.setattr(settings, "EMAIL_USERNAME", "")
    body = (await _verify(client, admin_headers)).json()
    assert body["ok"] is True
    assert smtp_client["calls"] == ["connect", "quit"]
    assert "signing in was not checked" in body["detail"]


async def test_verify_smtp_rejected_login_is_a_200_with_a_plain_reason(client, admin_headers, smtp, smtp_client, audit_rows):
    _, actions = audit_rows
    actions.append("email_verify")
    smtp_client["fail"]["login"] = RuntimeError(
        f"SMTPAuthenticationError: (535, '5.7.8 Username and Password not accepted for {USERNAME_MARKER} / {PASSWORD_MARKER}')"
    )
    resp = await _verify(client, admin_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is False
    assert body["provider"] == "smtp"
    assert "App Password" in body["detail"]
    assert PASSWORD_MARKER not in resp.text and USERNAME_MARKER not in resp.text
    assert "close" in smtp_client["calls"], "a failed check must not leave the connection open"


@pytest.mark.parametrize("error,expected", [
    (ConnectionRefusedError("[Errno 111] Connect call failed ('10.0.0.5', 587)"), "unreachable or blocked"),
    (OSError("[Errno -2] Name or service not known"), "unreachable or blocked"),
    (ssl.SSLError("[SSL: WRONG_VERSION_NUMBER] wrong version number (_ssl.c:1006)"), "TLS setting"),
    (RuntimeError("something nobody has seen before"), "something nobody has seen before"),
])
async def test_verify_smtp_connection_errors_are_translated(client, admin_headers, smtp, smtp_client, audit_rows, error, expected):
    _, actions = audit_rows
    actions.append("email_verify")
    smtp_client["fail"]["connect"] = error
    resp = await _verify(client, admin_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is False
    assert expected in body["detail"]


async def test_verify_smtp_times_out_instead_of_hanging(client, admin_headers, smtp, smtp_client, monkeypatch, audit_rows):
    _, actions = audit_rows
    actions.append("email_verify")
    monkeypatch.setattr(email_delivery_service, "VERIFY_TIMEOUT_SECONDS", 0.05)
    smtp_client["hang"] = True
    resp = await _verify(client, admin_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is False
    assert body["provider"] == "smtp"
    assert "did not answer" in body["detail"]
    assert "close" in smtp_client["calls"]


async def test_verify_with_nothing_configured(client, admin_headers, no_provider, mail, audit_rows):
    _, actions = audit_rows
    actions.append("email_verify")
    resp = await _verify(client, admin_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is False
    assert body["provider"] is None
    assert "No email provider is configured" in body["detail"]
    assert mail["sent"] == []


async def test_verify_ses_reads_the_send_quota(client, admin_headers, no_provider, monkeypatch, mail, audit_rows):
    _, actions = audit_rows
    actions.append("email_verify")
    monkeypatch.setattr(settings, "AWS_SES_ENABLED", True)
    monkeypatch.setattr(settings, "AWS_SES_REGION", "eu-west-1")
    seen = _fake_boto3(monkeypatch, quota={"Max24HourSend": 200.0, "SentLast24Hours": 12.0})
    resp = await _verify(client, admin_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert body["provider"] == "ses"
    assert "12 of 200" in body["detail"]
    assert "No message was sent" in body["detail"]
    assert seen == {"service": "ses", "region": "eu-west-1"}
    assert mail["sent"] == []


async def test_verify_ses_without_boto3_says_so(client, admin_headers, no_provider, monkeypatch, audit_rows):
    _, actions = audit_rows
    actions.append("email_verify")
    monkeypatch.setattr(settings, "AWS_SES_ENABLED", True)
    monkeypatch.setitem(sys.modules, "boto3", None)
    resp = await _verify(client, admin_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is False
    assert body["provider"] == "ses"
    assert "boto3" in body["detail"]


async def test_verify_ses_failure_is_reported_not_raised(client, admin_headers, no_provider, monkeypatch, audit_rows):
    _, actions = audit_rows
    actions.append("email_verify")
    monkeypatch.setattr(settings, "AWS_SES_ENABLED", True)
    _fake_boto3(monkeypatch, error=RuntimeError("Unable to locate credentials"))
    resp = await _verify(client, admin_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is False
    assert body["provider"] == "ses"
    assert "AWS credentials" in body["detail"]


async def test_verify_is_audited(client, admin_headers, smtp, smtp_client, audit_rows):
    started, actions = audit_rows
    actions.append("email_verify")
    await _verify(client, admin_headers)
    row = await get_db().audit_log.find_one({"action": "email_verify", "created_at": {"$gte": started}})
    assert row is not None
    assert row["actor_email"] == ADMIN_EMAIL
    assert row["resource_type"] == "email_delivery"
    assert row["details"] == {"ok": True, "provider": "smtp"}


async def test_verify_is_rate_limited_like_test_send(client, admin_headers, no_provider, audit_rows):
    _, actions = audit_rows
    actions.append("email_verify")
    for i in range(5):
        resp = await _verify(client, admin_headers)
        assert resp.status_code == 200, f"call {i + 1}: {resp.text}"
    assert (await _verify(client, admin_headers)).status_code == 429


@pytest.mark.parametrize("text,expected", [
    ("SMTPAuthenticationError: (535, '5.7.8 Username and Password not accepted')", "App Password"),
    ("535 Authentication failed for someone", "App Password"),
    ("534-5.7.9 Application-specific password required", "App Password"),
    ("[Errno 111] Connect call failed ('10.0.0.5', 587)", "unreachable or blocked"),
    ("ConnectionRefusedError: Connection refused", "unreachable or blocked"),
    ("TimeoutError: timed out", "unreachable or blocked"),
    ("[Errno -2] Name or service not known", "unreachable or blocked"),
    ("[Errno 11001] getaddrinfo failed", "unreachable or blocked"),
    ("[SSL: WRONG_VERSION_NUMBER] wrong version number (_ssl.c:1006)", "TLS setting"),
    ("SMTPNotSupported: STARTTLS extension not supported by server.", "TLS setting"),
    ("ssl.SSLCertVerificationError: certificate verify failed", "TLS setting"),
])
async def test_hint_for_error_maps_common_failures_to_one_sentence(text, expected):
    hint = email_delivery_service.hint_for_error(text)
    assert hint is not None and expected in hint
    assert hint.endswith(".") and hint.count(". ") == 0 and "\n" not in hint


@pytest.mark.parametrize("text", [None, "", "Mailbox unavailable", "SMTPRecipientsRefused: no such user"])
async def test_hint_for_error_is_none_when_nothing_matches(text):
    assert email_delivery_service.hint_for_error(text) is None


async def test_health_failed_rows_carry_a_hint_or_null(client, admin_headers, log_rows):
    db = get_db()
    plan = [
        ("535 Authentication failed", "App Password"),
        ("Connect call failed ('10.0.0.5', 587)", "unreachable or blocked"),
        ("[SSL: WRONG_VERSION_NUMBER] wrong version number", "TLS setting"),
        ("Mailbox unavailable", None),
        (None, None),
    ]
    ids = []
    for i, (error, _) in enumerate(plan):
        fields = {"status": "failed", "created_at": _far(i)}
        if error is not None:
            fields["error"] = error
        ids.append(await _seed_log(db, log_rows, **fields))

    failures = (await client.get(f"{BASE}/health", headers=admin_headers)).json()["recent_failures"]
    by_id = {f["log_id"]: f for f in failures}
    for log_id, (_, expected) in zip(ids, plan):
        hint = by_id[log_id]["hint"]
        if expected is None:
            assert hint is None
        else:
            assert hint is not None and expected in hint


@pytest.fixture
def clean_config(monkeypatch, smtp):
    monkeypatch.setattr(settings, "DEBUG", False)
    monkeypatch.setattr(settings, "FRONTEND_URL", "https://hire.acme-corp.example")
    monkeypatch.setattr(settings, "EMAIL_FROM_NAME", "Acme Hiring")
    monkeypatch.setattr(settings, "EMAIL_FROM", "hiring@acme-corp.example")
    monkeypatch.setattr(settings, "EMAIL_HOST", "smtp.acme-corp.example")


def _codes(body: dict) -> list[str]:
    return [w["code"] for w in body["warnings"]]


async def test_health_reports_sender_link_and_waiting_fields(client, admin_headers, clean_config):
    body = (await client.get(f"{BASE}/health", headers=admin_headers)).json()
    assert body["from_name"] == "Acme Hiring"
    assert body["from_address"] == "hiring@acme-corp.example"
    assert body["frontend_url"] == "https://hire.acme-corp.example"
    assert body["warnings"] == []
    assert isinstance(body["waiting_invites"], int) and body["waiting_invites"] >= 0
    assert {"configured", "provider", "from_address", "host", "last_7d", "recent_failures"} <= set(body)


async def test_health_from_name_is_null_when_nothing_is_configured(client, admin_headers, no_provider):
    body = (await client.get(f"{BASE}/health", headers=admin_headers)).json()
    assert body["from_name"] is None
    assert isinstance(body["warnings"], list)


@pytest.mark.parametrize("url", ["http://localhost:5173", "http://127.0.0.1:8000", "https://localhost", "http://0.0.0.0:3000"])
async def test_health_warns_when_candidate_links_point_at_localhost(client, admin_headers, clean_config, monkeypatch, url):
    monkeypatch.setattr(settings, "FRONTEND_URL", url)
    body = (await client.get(f"{BASE}/health", headers=admin_headers)).json()
    assert _codes(body) == ["frontend_url_local"]
    warning = body["warnings"][0]
    assert set(warning) == {"code", "message"}
    assert url in warning["message"]


async def test_health_does_not_warn_about_localhost_in_debug_or_for_a_public_url(client, admin_headers, clean_config, monkeypatch):
    monkeypatch.setattr(settings, "FRONTEND_URL", "http://localhost:5173")
    monkeypatch.setattr(settings, "DEBUG", True)
    assert _codes((await client.get(f"{BASE}/health", headers=admin_headers)).json()) == []

    monkeypatch.setattr(settings, "DEBUG", False)
    monkeypatch.setattr(settings, "FRONTEND_URL", "https://localhost-hiring.acme-corp.example")
    assert _codes((await client.get(f"{BASE}/health", headers=admin_headers)).json()) == []


async def test_health_warns_about_a_placeholder_sender_name(client, admin_headers, clean_config, monkeypatch):
    monkeypatch.setattr(settings, "EMAIL_FROM_NAME", "HR Platform")
    assert _codes((await client.get(f"{BASE}/health", headers=admin_headers)).json()) == ["from_name_placeholder"]


@pytest.mark.parametrize("sender", ["hr@company.com", "noreply@example.com", ""])
async def test_health_warns_about_a_placeholder_sender_address(client, admin_headers, clean_config, monkeypatch, sender):
    monkeypatch.setattr(settings, "EMAIL_FROM", sender)
    assert _codes((await client.get(f"{BASE}/health", headers=admin_headers)).json()) == ["from_address_placeholder"]


async def test_health_warns_when_ses_is_on_but_boto3_is_missing(client, admin_headers, clean_config, monkeypatch):
    monkeypatch.setattr(settings, "AWS_SES_ENABLED", True)
    monkeypatch.setitem(sys.modules, "boto3", None)
    body = (await client.get(f"{BASE}/health", headers=admin_headers)).json()
    assert body["provider"] == "ses"
    assert _codes(body) == ["ses_boto3_missing"]

    _fake_boto3(monkeypatch, quota={})
    assert _codes((await client.get(f"{BASE}/health", headers=admin_headers)).json()) == []


async def test_health_ignores_a_missing_boto3_when_ses_is_off(client, admin_headers, clean_config, monkeypatch):
    monkeypatch.setitem(sys.modules, "boto3", None)
    assert _codes((await client.get(f"{BASE}/health", headers=admin_headers)).json()) == []


@pytest.mark.parametrize("host", ["smtp.gmail.com", "SMTP.GMAIL.COM", "smtp-relay.gmail.com", "smtp.googlemail.com"])
async def test_health_warns_that_gmail_needs_an_app_password(client, admin_headers, clean_config, monkeypatch, host):
    monkeypatch.setattr(settings, "EMAIL_HOST", host)
    body = (await client.get(f"{BASE}/health", headers=admin_headers)).json()
    assert _codes(body) == ["google_app_password"]
    assert "App Password" in body["warnings"][0]["message"]


async def test_health_gmail_warning_only_applies_to_smtp(client, admin_headers, clean_config, monkeypatch):
    monkeypatch.setattr(settings, "EMAIL_HOST", "smtp.gmail.com")
    monkeypatch.setattr(settings, "AWS_SES_ENABLED", True)
    _fake_boto3(monkeypatch, quota={})
    assert _codes((await client.get(f"{BASE}/health", headers=admin_headers)).json()) == []


async def test_health_lists_every_applicable_warning_in_a_stable_order(client, admin_headers, clean_config, monkeypatch):
    monkeypatch.setattr(settings, "FRONTEND_URL", "http://localhost:5173")
    monkeypatch.setattr(settings, "EMAIL_FROM_NAME", "HR Platform")
    monkeypatch.setattr(settings, "EMAIL_FROM", "hr@company.com")
    monkeypatch.setattr(settings, "EMAIL_HOST", "smtp.gmail.com")
    assert _codes((await client.get(f"{BASE}/health", headers=admin_headers)).json()) == [
        "frontend_url_local", "from_name_placeholder", "from_address_placeholder", "google_app_password",
    ]


async def _seed_waiting(db, candidate_ids, **overrides) -> dict:
    fields = {"pipeline_stage": "invited"}
    fields.update(overrides)
    return await _seed_candidate(db, candidate_ids, **fields)


async def test_waiting_invites_counts_only_unsent_platform_invites_with_a_usable_link(client, admin_headers, candidate_ids):
    db = get_db()
    before = (await client.get(f"{BASE}/health", headers=admin_headers)).json()["waiting_invites"]

    await _seed_waiting(db, candidate_ids)
    await _seed_waiting(db, candidate_ids, invite_email_delivered=False)
    await _seed_waiting(db, candidate_ids, interview_mode="platform")
    await _seed_waiting(db, candidate_ids, invite_expires_at=None)

    await _seed_waiting(db, candidate_ids, interview_mode="external")
    await _seed_waiting(db, candidate_ids, invite_email_delivered=True)
    await _seed_waiting(db, candidate_ids, pipeline_stage="interviewing")
    await _seed_waiting(db, candidate_ids, token_status="consumed")
    await _seed_waiting(db, candidate_ids, token_status="unused")
    await _seed_waiting(db, candidate_ids, invite_expires_at=_iso(-1))
    await _seed_waiting(db, candidate_ids, email="")

    after = (await client.get(f"{BASE}/health", headers=admin_headers)).json()["waiting_invites"]
    assert after - before == 4


@pytest.fixture
def isolate_waiting(monkeypatch):
    def _apply(marker: str) -> None:
        original = email_delivery_service._waiting_filter

        def patched() -> dict:
            query = original()
            query["job_id"] = {"$regex": f"^job-edh-{re.escape(marker)}-"}
            return query

        monkeypatch.setattr(email_delivery_service, "_waiting_filter", patched)

    return _apply


def _job(marker: str, i: int = 0) -> str:
    return f"job-edh-{marker}-{i}"


async def test_resend_waiting_sends_marks_delivered_and_reports_counts(client, admin_headers, smtp, mail, candidate_ids, isolate_waiting, audit_rows):
    _, actions = audit_rows
    actions.append("email_resend_waiting")
    db = get_db()
    marker = uuid.uuid4().hex[:8]
    isolate_waiting(marker)
    waiting = [await _seed_waiting(db, candidate_ids, job_id=_job(marker, i)) for i in range(3)]
    external = await _seed_waiting(db, candidate_ids, job_id=_job(marker, 9), interview_mode="external")
    already = await _seed_waiting(db, candidate_ids, job_id=_job(marker, 8), invite_email_delivered=True)

    resp = await client.post(f"{BASE}/resend-waiting", headers=admin_headers)
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"attempted": 3, "sent": 3, "failed": 0, "skipped": 0, "remaining": 0}

    assert sorted(m["to"] for m in mail["sent"]) == sorted(c["email"] for c in waiting)
    assert {m["template"] for m in mail["sent"]} == {"interview_invitation"}
    for cand in waiting:
        stored = await db.candidates.find_one({"candidate_id": cand["candidate_id"]})
        assert stored["invite_email_delivered"] is True
        assert stored["invite_resent_count"] == 1
        assert stored["last_resent_by"] == ADMIN_EMAIL
    sent_bodies = {m["to"]: m["text_body"] for m in mail["sent"]}
    for cand in waiting:
        assert f"/interview/{cand['secure_token']}" in sent_bodies[cand["email"]]

    assert external["email"] not in {m["to"] for m in mail["sent"]}
    assert already["email"] not in {m["to"] for m in mail["sent"]}
    assert "invite_email_delivered" not in await db.candidates.find_one({"candidate_id": external["candidate_id"]}, {"invite_email_delivered": 1})

    mail["sent"].clear()
    again = await client.post(f"{BASE}/resend-waiting", json={}, headers=admin_headers)
    assert again.json() == {"attempted": 0, "sent": 0, "failed": 0, "skipped": 0, "remaining": 0}
    assert mail["sent"] == []


async def test_resend_waiting_never_sends_the_ai_link_to_an_external_candidate(client, admin_headers, smtp, mail, candidate_ids, isolate_waiting, audit_rows):
    _, actions = audit_rows
    actions.append("email_resend_waiting")
    db = get_db()
    marker = uuid.uuid4().hex[:8]
    isolate_waiting(marker)
    external = await _seed_waiting(db, candidate_ids, job_id=_job(marker), interview_mode="external")

    assert await email_delivery_service.list_waiting_invites(db) == []
    resp = await client.post(f"{BASE}/resend-waiting", json={"limit": 25}, headers=admin_headers)
    assert resp.json() == {"attempted": 0, "sent": 0, "failed": 0, "skipped": 0, "remaining": 0}
    assert mail["sent"] == []
    stored = await db.candidates.find_one({"candidate_id": external["candidate_id"]})
    assert stored.get("invite_email_delivered") is None and stored["invite_resent_count"] == 0


async def test_resend_waiting_honours_the_limit_and_sends_the_oldest_first(client, admin_headers, smtp, mail, candidate_ids, isolate_waiting, audit_rows):
    _, actions = audit_rows
    actions.append("email_resend_waiting")
    db = get_db()
    marker = uuid.uuid4().hex[:8]
    isolate_waiting(marker)
    newest = await _seed_waiting(db, candidate_ids, job_id=_job(marker, 0), created_at=_iso(-1))
    middle = await _seed_waiting(db, candidate_ids, job_id=_job(marker, 1), created_at=_iso(-2))
    oldest = await _seed_waiting(db, candidate_ids, job_id=_job(marker, 2), created_at=_iso(-3))

    resp = await client.post(f"{BASE}/resend-waiting", json={"limit": 2}, headers=admin_headers)
    assert resp.json() == {"attempted": 2, "sent": 2, "failed": 0, "skipped": 0, "remaining": 1}
    assert {m["to"] for m in mail["sent"]} == {oldest["email"], middle["email"]}
    assert newest["email"] not in {m["to"] for m in mail["sent"]}


async def test_resend_waiting_keeps_a_failed_send_waiting(client, admin_headers, smtp, mail, candidate_ids, isolate_waiting, audit_rows):
    _, actions = audit_rows
    actions.append("email_resend_waiting")
    db = get_db()
    marker = uuid.uuid4().hex[:8]
    isolate_waiting(marker)
    good = await _seed_waiting(db, candidate_ids, job_id=_job(marker, 0))
    bad = await _seed_waiting(db, candidate_ids, job_id=_job(marker, 1))
    mail["outcomes"][bad["email"]] = False

    resp = await client.post(f"{BASE}/resend-waiting", json={"limit": 5}, headers=admin_headers)
    assert resp.json() == {"attempted": 2, "sent": 1, "failed": 1, "skipped": 0, "remaining": 1}
    assert (await db.candidates.find_one({"candidate_id": good["candidate_id"]}))["invite_email_delivered"] is True
    stored_bad = await db.candidates.find_one({"candidate_id": bad["candidate_id"]})
    assert stored_bad.get("invite_email_delivered") is None
    assert stored_bad["invite_resent_count"] == 0


async def test_resend_waiting_without_a_provider_sends_nothing_and_marks_nothing(client, admin_headers, no_provider, mail, candidate_ids, isolate_waiting, audit_rows):
    _, actions = audit_rows
    actions.append("email_resend_waiting")
    db = get_db()
    marker = uuid.uuid4().hex[:8]
    isolate_waiting(marker)
    cand = await _seed_waiting(db, candidate_ids, job_id=_job(marker))

    resp = await client.post(f"{BASE}/resend-waiting", json={"limit": 5}, headers=admin_headers)
    assert resp.json() == {"attempted": 0, "sent": 0, "failed": 0, "skipped": 1, "remaining": 1}
    assert mail["sent"] == []
    assert (await db.candidates.find_one({"candidate_id": cand["candidate_id"]})).get("invite_email_delivered") is None


async def test_resend_waiting_enforces_the_per_call_cap(client, admin_headers, smtp, mail):
    for bad in (0, 26, -3):
        resp = await client.post(f"{BASE}/resend-waiting", json={"limit": bad}, headers=admin_headers)
        assert resp.status_code == 400, f"limit={bad}"
    assert mail["sent"] == []


async def test_resend_waiting_accepts_exactly_the_cap(client, admin_headers, smtp, mail, isolate_waiting, audit_rows):
    _, actions = audit_rows
    actions.append("email_resend_waiting")
    isolate_waiting(uuid.uuid4().hex[:8])
    resp = await client.post(f"{BASE}/resend-waiting", json={"limit": 25}, headers=admin_headers)
    assert resp.status_code == 200, resp.text


async def test_resend_waiting_is_audited(client, admin_headers, smtp, mail, candidate_ids, isolate_waiting, audit_rows):
    started, actions = audit_rows
    actions.append("email_resend_waiting")
    db = get_db()
    marker = uuid.uuid4().hex[:8]
    isolate_waiting(marker)
    await _seed_waiting(db, candidate_ids, job_id=_job(marker))
    await client.post(f"{BASE}/resend-waiting", json={"limit": 5}, headers=admin_headers)

    row = await db.audit_log.find_one({"action": "email_resend_waiting", "created_at": {"$gte": started}})
    assert row is not None
    assert row["actor_email"] == ADMIN_EMAIL
    assert row["resource_type"] == "email_delivery"
    assert row["details"] == {"attempted": 1, "sent": 1, "failed": 0, "skipped": 0, "remaining": 0}
