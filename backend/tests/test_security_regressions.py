"""
Security regression tests — MVP2 §6.2 #13.

The §6.2 audit found that items #1 (demo-auth bypass), #3 (login/OTP rate
limiting) and #4 (invite-link expiry) were all genuinely FIXED but had **no
test behind any of them**: "this is real, working, enforced code with no
regression test". A 459-passing suite would have stayed green if any of the
three were reverted. These are the three missing tests, plus coverage for the
startup config guard added in the same pass.

Every test here manipulates `settings` directly and restores it in a finally
block — `settings` is a process-wide singleton and a leaked value would
silently change how every later test in the session authenticates.
"""
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from config.settings import (
    audit_security_config,
    settings,
    validate_runtime_config,
    validate_security_config,
)

pytestmark = pytest.mark.anyio


async def test_demo_token_rejected_when_allow_demo_auth_is_off(client):
    """`Bearer demo-admin-token` must be worthless with the flag off.

    This is the whole of MVP1 P0 #1: without the gate, that literal string
    grants superadmin to anyone who types it.
    """
    original = settings.ALLOW_DEMO_AUTH
    settings.ALLOW_DEMO_AUTH = False
    try:
        r = await client.get("/api/v1/auth/me", headers={"Authorization": "Bearer demo-admin-token"})
        assert r.status_code == 401, (
            "demo-token bypass is still active with ALLOW_DEMO_AUTH=False — "
            "this is an unauthenticated privilege escalation"
        )

        r = await client.get("/api/v1/jobs", headers={"Authorization": "Bearer demo-superadmin-token"})
        assert r.status_code == 401
    finally:
        settings.ALLOW_DEMO_AUTH = original


async def test_demo_token_accepted_only_when_flag_is_on(client, admin_headers):
    """The rest of the suite depends on the bypass working when enabled —
    assert that explicitly so the test above can't pass for the wrong reason."""
    assert settings.ALLOW_DEMO_AUTH is True
    r = await client.get("/api/v1/auth/me", headers=admin_headers)
    assert r.status_code == 200


async def test_login_rate_limit_returns_429(client, setup_test_db):
    """Exceed LOGIN_RATE_LIMIT within the window and expect a 429.

    Deliberately uses a unique address per run so the per-email counter starts
    clean, and a low limit so the test is quick. Without this, OTP and password
    guessing are unbounded (MVP1 P0 #3).
    """
    db = setup_test_db
    email = f"ratelimit-{uuid.uuid4().hex[:8]}@example.com"

    original_limit = settings.LOGIN_RATE_LIMIT
    settings.LOGIN_RATE_LIMIT = 3
    try:
        await db.rate_limits.delete_many({"_id": {"$regex": "^login:"}})

        statuses = []
        for _ in range(settings.LOGIN_RATE_LIMIT + 3):
            r = await client.post("/api/v1/auth/login", json={"email": email, "password": "wrong-password"})
            statuses.append(r.status_code)

        assert 429 in statuses, (
            f"no 429 after {len(statuses)} attempts (limit {settings.LOGIN_RATE_LIMIT}) — "
            f"login rate limiting is not enforced. Got: {statuses}"
        )
        assert statuses[-1] == 429
    finally:
        settings.LOGIN_RATE_LIMIT = original_limit
        await db.rate_limits.delete_many({"_id": {"$regex": "^login:"}})


async def test_verify_otp_rate_limit_returns_429(client, setup_test_db):
    db = setup_test_db
    email = f"otp-{uuid.uuid4().hex[:8]}@example.com"

    original_limit = settings.OTP_VERIFY_RATE_LIMIT
    settings.OTP_VERIFY_RATE_LIMIT = 3
    try:
        await db.rate_limits.delete_many({"_id": {"$regex": "^otp"}})

        statuses = []
        for _ in range(settings.OTP_VERIFY_RATE_LIMIT + 3):
            r = await client.post("/api/v1/auth/verify-otp", json={"email": email, "otp_code": "000000"})
            statuses.append(r.status_code)

        assert 429 in statuses, f"OTP verification is brute-forceable. Got: {statuses}"
    finally:
        settings.OTP_VERIFY_RATE_LIMIT = original_limit
        await db.rate_limits.delete_many({"_id": {"$regex": "^otp"}})


async def _make_candidate(db, *, invite_sent_at: str, token: str) -> str:
    candidate_id = str(uuid.uuid4())
    await db.candidates.insert_one({
        "candidate_id": candidate_id,
        "job_id": str(uuid.uuid4()),
        "name": "Expiry Test",
        "email": "expiry@example.com",
        "secure_token": token,
        "token_status": "active",
        "status": "invited",
        "invite_sent_at": invite_sent_at,
        "_questions": ["Q1"],
    })
    return candidate_id


async def test_expired_invite_link_is_rejected(client, setup_test_db):
    """A token older than INVITE_LINK_EXPIRY_DAYS must 410 on every
    candidate-facing endpoint, not just the session start."""
    db = setup_test_db
    token = f"tok_expired_{uuid.uuid4().hex[:8]}"
    stale = (datetime.now(timezone.utc) - timedelta(days=settings.INVITE_LINK_EXPIRY_DAYS + 1)).isoformat()
    candidate_id = await _make_candidate(db, invite_sent_at=stale, token=token)

    try:
        assert (await client.get(f"/api/v1/interview/session/{token}")).status_code == 410
        assert (await client.post(
            f"/api/v1/interview/session/{token}/submit",
            json={"transcript": [], "flags": []},
        )).status_code == 410
        assert (await client.post(
            f"/api/v1/interview/session/{token}/flag", json={"event": "tab_switch"},
        )).status_code == 410
    finally:
        await db.candidates.delete_one({"candidate_id": candidate_id})


async def test_fresh_invite_link_still_works(client, setup_test_db):
    """Guards against an over-eager expiry check rejecting valid links."""
    db = setup_test_db
    token = f"tok_fresh_{uuid.uuid4().hex[:8]}"
    fresh = datetime.now(timezone.utc).isoformat()
    candidate_id = await _make_candidate(db, invite_sent_at=fresh, token=token)

    try:
        r = await client.post(f"/api/v1/interview/session/{token}/flag", json={"event": "tab_switch"})
        assert r.status_code == 200
        assert r.json()["recorded"] is True
    finally:
        await db.candidates.delete_one({"candidate_id": candidate_id})


async def test_consumed_token_is_rejected(client, setup_test_db):
    """A completed session's token must not accept further integrity events —
    otherwise a finished report can be polluted after the fact."""
    db = setup_test_db
    token = f"tok_used_{uuid.uuid4().hex[:8]}"
    candidate_id = await _make_candidate(db, invite_sent_at=datetime.now(timezone.utc).isoformat(), token=token)
    await db.candidates.update_one({"candidate_id": candidate_id}, {"$set": {"token_status": "consumed"}})

    try:
        assert (await client.post(
            f"/api/v1/interview/session/{token}/flag", json={"event": "tab_switch"},
        )).status_code == 410
    finally:
        await db.candidates.delete_one({"candidate_id": candidate_id})


def test_audit_flags_shipped_default_secrets_as_fatal():
    original_key, original_pw = settings.SECRET_KEY, settings.DEFAULT_SUPERADMIN_PASSWORD
    settings.SECRET_KEY = "change-me-in-production-32-chars-min"
    settings.DEFAULT_SUPERADMIN_PASSWORD = "qwerty@54321"
    try:
        fatal, _ = audit_security_config()
        assert any("SECRET_KEY" in f for f in fatal)
        assert any("DEFAULT_SUPERADMIN_PASSWORD" in f for f in fatal)
    finally:
        settings.SECRET_KEY, settings.DEFAULT_SUPERADMIN_PASSWORD = original_key, original_pw


def test_audit_catches_env_example_placeholders():
    """The exact gap §6.2 #2 named: copying .env.example verbatim used to sail
    straight past the guard because those strings aren't the shipped literals."""
    original_key, original_pw = settings.SECRET_KEY, settings.DEFAULT_SUPERADMIN_PASSWORD
    settings.SECRET_KEY = "change-me-generate-a-32-char-secret-key"
    settings.DEFAULT_SUPERADMIN_PASSWORD = "change-me-in-production"
    try:
        fatal, weak = audit_security_config()
        findings = fatal + weak
        assert any("SECRET_KEY" in f for f in findings), "placeholder SECRET_KEY not detected"
        assert any("DEFAULT_SUPERADMIN_PASSWORD" in f for f in findings), "placeholder password not detected"
    finally:
        settings.SECRET_KEY, settings.DEFAULT_SUPERADMIN_PASSWORD = original_key, original_pw


def test_audit_catches_short_and_common_values():
    original_key, original_pw = settings.SECRET_KEY, settings.DEFAULT_SUPERADMIN_PASSWORD
    settings.SECRET_KEY = "abc123"
    settings.DEFAULT_SUPERADMIN_PASSWORD = "password123"
    try:
        _, weak = audit_security_config()
        assert any("SECRET_KEY" in w for w in weak)
        assert any("DEFAULT_SUPERADMIN_PASSWORD" in w for w in weak)
    finally:
        settings.SECRET_KEY, settings.DEFAULT_SUPERADMIN_PASSWORD = original_key, original_pw


def test_audit_passes_on_strong_values():
    original = (settings.SECRET_KEY, settings.DEFAULT_SUPERADMIN_PASSWORD,
                settings.ALLOW_DEMO_AUTH, settings.DEBUG)
    settings.SECRET_KEY = "Zk4rP2wQx9LmT7vNbJ8sHc3dYf6gRa5eUiOp1XzW"
    settings.DEFAULT_SUPERADMIN_PASSWORD = "Tq7#vNb2Lm9Xz4Rs"
    settings.ALLOW_DEMO_AUTH = False
    settings.DEBUG = False
    try:
        fatal, weak = audit_security_config()
        assert fatal == [] and weak == [], f"false positive: fatal={fatal} weak={weak}"
        validate_security_config()
    finally:
        (settings.SECRET_KEY, settings.DEFAULT_SUPERADMIN_PASSWORD,
         settings.ALLOW_DEMO_AUTH, settings.DEBUG) = original


def test_demo_auth_outside_debug_is_reported():
    original = (settings.ALLOW_DEMO_AUTH, settings.DEBUG)
    settings.ALLOW_DEMO_AUTH = True
    settings.DEBUG = False
    try:
        fatal, weak = audit_security_config()
        assert any("ALLOW_DEMO_AUTH" in f for f in fatal + weak)
    finally:
        settings.ALLOW_DEMO_AUTH, settings.DEBUG = original


def test_strict_mode_promotes_weak_findings_to_a_boot_refusal():
    original = (settings.SECRET_KEY, settings.STRICT_SECURITY_VALIDATION, settings.DEBUG)
    settings.SECRET_KEY = "change-me-generate-a-32-char-secret-key"
    settings.STRICT_SECURITY_VALIDATION = True
    settings.DEBUG = False
    try:
        with pytest.raises(RuntimeError):
            validate_security_config()
    finally:
        (settings.SECRET_KEY, settings.STRICT_SECURITY_VALIDATION, settings.DEBUG) = original


def test_runtime_config_audit_names_missing_capabilities():
    """§6.2 #11 — a missing key must not be silent. Non-fatal by design."""
    original = (settings.OPENAI_API_KEY, settings.ANTHROPIC_API_KEY,
                settings.PINECONE_API_KEY, settings.EMAIL_HOST,
                settings.AWS_SES_ENABLED, settings.JUDGE0_API_URL)
    settings.OPENAI_API_KEY = ""
    settings.ANTHROPIC_API_KEY = ""
    settings.PINECONE_API_KEY = ""
    settings.EMAIL_HOST = ""
    settings.AWS_SES_ENABLED = False
    settings.JUDGE0_API_URL = ""
    try:
        warnings = validate_runtime_config()
        blob = " ".join(warnings)
        assert "LLM provider" in blob
        assert "PINECONE_API_KEY" in blob
        assert "EMAIL_HOST" in blob
        assert "JUDGE0_API_URL" in blob
    finally:
        (settings.OPENAI_API_KEY, settings.ANTHROPIC_API_KEY,
         settings.PINECONE_API_KEY, settings.EMAIL_HOST,
         settings.AWS_SES_ENABLED, settings.JUDGE0_API_URL) = original
