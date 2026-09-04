"""
Integrations — MVP2 §2.19 (Zoom/Teams meetings + HRMS/Payroll connector).

Neither connector can be exercised against a live third party here, and
pretending otherwise would be worse than not testing it. What IS tested is
everything that does not need the vendor:

  * the configured/not-configured gate, which is what decides whether the
    feature appears in the UI at all;
  * that an unconfigured connector reports that plainly instead of erroring,
    half-succeeding, or claiming success — the failure mode this codebase has
    been bitten by before (email "delivered=True" with no EMAIL_HOST);
  * the normalised employee record's shape and stability, which is the actual
    contract an HRMS consumes;
  * that a meeting failure never breaks interview scheduling.
"""
import uuid

import pytest

from config.settings import settings
from services.hr_module import hrms_service, meeting_service

pytestmark = pytest.mark.anyio


async def test_no_provider_configured_by_default():
    assert meeting_service.configured_providers() == []
    assert meeting_service.is_configured() is False


async def test_zoom_counts_as_configured_only_with_a_complete_credential_set():
    original = (settings.ZOOM_ACCOUNT_ID, settings.ZOOM_CLIENT_ID, settings.ZOOM_CLIENT_SECRET)
    try:
        settings.ZOOM_ACCOUNT_ID = "acct"
        settings.ZOOM_CLIENT_ID = "cid"
        settings.ZOOM_CLIENT_SECRET = ""
        assert "zoom" not in meeting_service.configured_providers(), "partial credentials read as configured"

        settings.ZOOM_CLIENT_SECRET = "secret"
        assert meeting_service.configured_providers() == ["zoom"]
        assert meeting_service.is_configured("zoom") is True
        assert meeting_service.is_configured("teams") is False
    finally:
        (settings.ZOOM_ACCOUNT_ID, settings.ZOOM_CLIENT_ID, settings.ZOOM_CLIENT_SECRET) = original


async def test_teams_requires_an_organizer_user_id():
    """Graph's /users/{id}/onlineMeetings has no "me" under client credentials,
    so an organiser is genuinely mandatory — not an optional extra."""
    original = (settings.MS_TEAMS_TENANT_ID, settings.MS_TEAMS_CLIENT_ID,
                settings.MS_TEAMS_CLIENT_SECRET, settings.MS_TEAMS_ORGANIZER_USER_ID)
    try:
        settings.MS_TEAMS_TENANT_ID = "tid"
        settings.MS_TEAMS_CLIENT_ID = "cid"
        settings.MS_TEAMS_CLIENT_SECRET = "secret"
        settings.MS_TEAMS_ORGANIZER_USER_ID = ""
        assert "teams" not in meeting_service.configured_providers()

        settings.MS_TEAMS_ORGANIZER_USER_ID = "organiser@example.com"
        assert "teams" in meeting_service.configured_providers()
    finally:
        (settings.MS_TEAMS_TENANT_ID, settings.MS_TEAMS_CLIENT_ID,
         settings.MS_TEAMS_CLIENT_SECRET, settings.MS_TEAMS_ORGANIZER_USER_ID) = original


async def test_create_meeting_reports_not_configured_rather_than_crashing():
    with pytest.raises(meeting_service.MeetingServiceError) as exc:
        await meeting_service.create_meeting(topic="Interview", start_iso="2026-09-01T10:00:00Z")
    assert "no video-meeting provider is configured" in str(exc.value).lower()


async def test_create_meeting_rejects_an_unconfigured_named_provider():
    original = (settings.ZOOM_ACCOUNT_ID, settings.ZOOM_CLIENT_ID, settings.ZOOM_CLIENT_SECRET)
    try:
        settings.ZOOM_ACCOUNT_ID = settings.ZOOM_CLIENT_ID = settings.ZOOM_CLIENT_SECRET = "x"
        with pytest.raises(meeting_service.MeetingServiceError) as exc:
            await meeting_service.create_meeting(
                topic="Interview", start_iso="2026-09-01T10:00:00Z", provider="teams",
            )
        assert "teams" in str(exc.value)
    finally:
        (settings.ZOOM_ACCOUNT_ID, settings.ZOOM_CLIENT_ID, settings.ZOOM_CLIENT_SECRET) = original


async def test_ambiguous_provider_choice_is_an_explicit_error(monkeypatch):
    """Two configured providers and no default must fail loudly rather than
    silently picking one — a meeting on the wrong platform is a no-show."""
    monkeypatch.setattr(meeting_service, "configured_providers", lambda: ["zoom", "teams"])
    monkeypatch.setattr(settings, "MEETING_PROVIDER", "")
    with pytest.raises(meeting_service.MeetingServiceError) as exc:
        await meeting_service.create_meeting(topic="Interview", start_iso="2026-09-01T10:00:00Z")
    assert "MEETING_PROVIDER" in str(exc.value)


async def test_unparsable_start_time_is_rejected(monkeypatch):
    monkeypatch.setattr(meeting_service, "configured_providers", lambda: ["zoom"])
    with pytest.raises(meeting_service.MeetingServiceError) as exc:
        await meeting_service.create_meeting(
            topic="Interview", start_iso="not-a-timestamp", provider="zoom",
        )
    assert "start time" in str(exc.value).lower()


async def test_scheduling_still_succeeds_when_meeting_creation_fails(client, admin_headers, setup_test_db):
    """The important guarantee: an unavailable meeting provider must not stop a
    recruiter scheduling an interview."""
    db = setup_test_db
    candidate_id = str(uuid.uuid4())
    await db.candidates.insert_one({
        "candidate_id": candidate_id, "job_id": str(uuid.uuid4()),
        "name": "Meeting Test", "email": "meeting@example.com", "status": "invited",
    })
    try:
        r = await client.patch(
            f"/api/v1/interview/{candidate_id}/schedule",
            json={"scheduled_start_at": "2026-09-01T10:00:00", "create_meeting": True},
            headers=admin_headers,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["scheduled_start_at"] == "2026-09-01T10:00:00"
        assert body["meeting"] is None
        assert body["meeting_error"], "a failed meeting attempt was not reported"

        cand = await db.candidates.find_one({"candidate_id": candidate_id})
        assert cand["scheduled_start_at"] == "2026-09-01T10:00:00"
    finally:
        await db.candidates.delete_one({"candidate_id": candidate_id})


async def test_clearing_a_schedule_clears_the_meeting(client, admin_headers, setup_test_db):
    """A stale join URL for a slot that no longer exists is worse than none."""
    db = setup_test_db
    candidate_id = str(uuid.uuid4())
    await db.candidates.insert_one({
        "candidate_id": candidate_id, "job_id": str(uuid.uuid4()),
        "name": "Clear Test", "email": "clear@example.com", "status": "invited",
        "meeting_join_url": "https://zoom.us/j/stale", "meeting": {"provider": "zoom"},
    })
    try:
        r = await client.patch(
            f"/api/v1/interview/{candidate_id}/schedule",
            json={"scheduled_start_at": None}, headers=admin_headers,
        )
        assert r.status_code == 200
        cand = await db.candidates.find_one({"candidate_id": candidate_id})
        assert cand["meeting_join_url"] is None
        assert cand["meeting"] is None
    finally:
        await db.candidates.delete_one({"candidate_id": candidate_id})


async def test_hrms_not_configured_by_default():
    assert hrms_service.is_configured() is False


async def test_push_reports_not_configured_instead_of_claiming_success():
    result = await hrms_service.push_to_hrms(str(uuid.uuid4()))
    assert result["status"] == "not_configured"


async def test_push_endpoint_returns_503_when_unconfigured(client, admin_headers):
    r = await client.post(f"/api/v1/integrations/hrms/push/{uuid.uuid4()}", headers=admin_headers)
    assert r.status_code == 503


async def test_push_blocks_an_ssrf_unsafe_endpoint():
    """Settings are still operator input, and this path runs in the background."""
    original = settings.HRMS_WEBHOOK_URL
    settings.HRMS_WEBHOOK_URL = "http://169.254.169.254/latest/meta-data/"
    try:
        result = await hrms_service.push_to_hrms(str(uuid.uuid4()))
        assert result["status"] == "blocked"
    finally:
        settings.HRMS_WEBHOOK_URL = original


@pytest.fixture
async def hired_candidate(setup_test_db):
    db = setup_test_db
    candidate_id, job_id = str(uuid.uuid4()), str(uuid.uuid4())
    await db.jobs.insert_one({
        "job_id": job_id, "title": "Senior Backend Engineer",
        "employment_type": "full_time", "location": "Remote",
    })
    await db.candidates.insert_one({
        "candidate_id": candidate_id, "job_id": job_id,
        "name": "Hired Person", "email": "hired@example.com",
        "status": "hired", "match_score": 0.91, "eval_score": 87,
        "updated_at": "2026-08-01T00:00:00+00:00",
    })
    await db.offers.insert_one({
        "doc_type": "offer", "offer_id": str(uuid.uuid4()), "candidate_id": candidate_id,
        "job_id": job_id, "salary": "120000", "benefits": "Health, pension",
        "joining_date": "2026-09-01", "status": "accepted",
        "responded_at": "2026-08-02T00:00:00+00:00",
    })
    yield db, candidate_id, job_id
    await db.offers.delete_many({"candidate_id": candidate_id})
    await db.candidates.delete_one({"candidate_id": candidate_id})
    await db.jobs.delete_one({"job_id": job_id})


async def test_employee_record_has_a_complete_stable_shape(hired_candidate):
    """Every key present even when empty — an HRMS import that has to
    distinguish "absent" from "unknown" is a support ticket."""
    _, candidate_id, job_id = hired_candidate
    record = await hrms_service.build_employee_record(candidate_id)
    assert record is not None

    for key in (
        "record_version", "exported_at", "source", "candidate_id", "full_name",
        "email", "phone", "location", "linkedin_url", "job_id", "job_title",
        "department_id", "employment_type", "work_location", "offer_id", "salary",
        "benefits", "start_date", "offer_accepted_at", "hiring_status",
        "match_score", "interview_score", "seniority_level", "skills",
    ):
        assert key in record, f"employee record is missing {key}"

    assert record["full_name"] == "Hired Person"
    assert record["job_title"] == "Senior Backend Engineer"
    assert record["salary"] == "120000"
    assert record["start_date"] == "2026-09-01"
    assert record["job_id"] == job_id
    assert record["record_version"] == hrms_service.EMPLOYEE_RECORD_VERSION


async def test_unknown_candidate_yields_no_record():
    assert await hrms_service.build_employee_record(str(uuid.uuid4())) is None


async def test_export_returns_hired_candidates(client, admin_headers, hired_candidate):
    """Export needs no HRMS configuration at all — it's the path for systems
    that can only import a file."""
    _, candidate_id, job_id = hired_candidate
    r = await client.get("/api/v1/integrations/hrms/export",
                         params={"job_id": job_id}, headers=admin_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["record_version"] == hrms_service.EMPLOYEE_RECORD_VERSION
    assert any(rec["candidate_id"] == candidate_id for rec in body["records"])


async def test_export_since_filter_excludes_older_records(client, admin_headers, hired_candidate):
    _, candidate_id, job_id = hired_candidate
    r = await client.get("/api/v1/integrations/hrms/export",
                         params={"job_id": job_id, "since": "2027-01-01T00:00:00+00:00"},
                         headers=admin_headers)
    assert all(rec["candidate_id"] != candidate_id for rec in r.json()["records"])


async def test_status_endpoint_reports_every_connector(client, admin_headers):
    r = await client.get("/api/v1/integrations/status", headers=admin_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["meetings"]["configured_providers"] == []
    assert body["hrms"]["configured"] is False
    assert "sso" in body and "email" in body and "coding_sandbox" in body


async def test_status_endpoint_is_admin_only(client, standard_headers):
    r = await client.get("/api/v1/integrations/status", headers=standard_headers)
    assert r.status_code == 403
