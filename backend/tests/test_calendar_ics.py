"""
Tests for MVP2 §2.8 (interview-scheduling admin UI backend) + §2.19
(Calendar half of Integrations): the pure ICS builder and the
GET /interview/{candidate_id}/schedule.ics endpoint.
"""
import uuid

import pytest

from services.hr_module.calendar_ics import build_ics_event

pytestmark = pytest.mark.anyio


def test_build_ics_event_basic_shape():
    ics = build_ics_event(
        uid="interview-abc123@hrbot",
        summary="Interview: Jane Doe — Senior Backend Engineer",
        description="Interview session for Jane Doe.",
        start_iso="2026-07-14T09:00:00",
        duration_minutes=30,
        organizer_email="hr@company.com",
    )
    assert ics.startswith("BEGIN:VCALENDAR\r\n")
    assert ics.rstrip("\r\n").endswith("END:VCALENDAR")
    assert "BEGIN:VEVENT\r\n" in ics
    assert "END:VEVENT\r\n" in ics
    assert "DTSTART:20260714T090000Z" in ics
    assert "DTEND:20260714T093000Z" in ics
    assert "UID:interview-abc123@hrbot" in ics
    assert "ORGANIZER:mailto:hr@company.com" in ics
    assert "\n" not in ics.replace("\r\n", "")


def test_build_ics_event_converts_non_utc_offset_to_utc():
    ics = build_ics_event(
        uid="u1",
        summary="s",
        description="d",
        start_iso="2026-07-14T09:00:00+05:00",
        duration_minutes=45,
        organizer_email="hr@company.com",
    )
    unfolded = ics.replace("\r\n ", "")
    assert "DTSTART:20260714T040000Z" in unfolded
    assert "DTEND:20260714T044500Z" in unfolded


def test_build_ics_event_escapes_special_characters():
    ics = build_ics_event(
        uid="u2",
        summary="Interview; Round 1, Final",
        description="Line one\nLine two",
        start_iso="2026-07-14T09:00:00",
        duration_minutes=30,
        organizer_email="hr@company.com",
    )
    assert "SUMMARY:Interview\\; Round 1\\, Final" in ics
    assert "DESCRIPTION:Line one\\nLine two" in ics


def test_build_ics_event_folds_long_lines():
    long_summary = "Interview: " + ("Very Long Candidate Name " * 6) + "— Role"
    ics = build_ics_event(
        uid="u3",
        summary=long_summary,
        description="short",
        start_iso="2026-07-14T09:00:00",
        duration_minutes=30,
        organizer_email="hr@company.com",
    )
    lines = ics.split("\r\n")
    assert any(l.startswith(" ") for l in lines), "expected a folded continuation line"
    for l in lines:
        assert len(l.encode("utf-8")) <= 75


def test_build_ics_event_invalid_start_raises_value_error():
    with pytest.raises(ValueError):
        build_ics_event("u", "s", "d", "not-a-date", 30, "hr@company.com")


async def test_schedule_ics_requires_admin(client, standard_headers):
    response = await client.get(
        "/api/v1/interview/some-candidate-id/schedule.ics",
        headers=standard_headers,
    )
    assert response.status_code == 403


async def test_schedule_ics_candidate_not_found(client, admin_headers):
    response = await client.get(
        "/api/v1/interview/nonexistent-candidate-id/schedule.ics",
        headers=admin_headers,
    )
    assert response.status_code == 404


async def test_schedule_ics_not_scheduled_yet(client, admin_headers):
    from config.database import get_db

    db = get_db()
    candidate_id = str(uuid.uuid4())
    await db.candidates.insert_one({
        "doc_type": "candidate",
        "candidate_id": candidate_id,
        "secure_token": f"tok_{uuid.uuid4().hex[:12]}",
        "name": "ICS Not Scheduled",
        "email": "ics.notscheduled@example.com",
        "status": "invited",
        "scheduled_start_at": None,
    })

    response = await client.get(
        f"/api/v1/interview/{candidate_id}/schedule.ics",
        headers=admin_headers,
    )
    assert response.status_code == 404
    assert "no interview schedule" in response.json()["detail"].lower()


async def test_schedule_ics_downloads_after_schedule_set(client, admin_headers):
    from config.database import get_db

    db = get_db()
    candidate_id = str(uuid.uuid4())
    await db.candidates.insert_one({
        "doc_type": "candidate",
        "candidate_id": candidate_id,
        "secure_token": f"tok_{uuid.uuid4().hex[:12]}",
        "name": "ICS Scheduled Candidate",
        "email": "ics.scheduled@example.com",
        "status": "invited",
    })

    schedule_resp = await client.patch(
        f"/api/v1/interview/{candidate_id}/schedule",
        headers=admin_headers,
        json={"scheduled_start_at": "2026-08-01T10:00:00"},
    )
    assert schedule_resp.status_code == 200

    response = await client.get(
        f"/api/v1/interview/{candidate_id}/schedule.ics",
        headers=admin_headers,
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/calendar")
    assert "attachment" in response.headers["content-disposition"]
    body = response.text
    assert "BEGIN:VCALENDAR" in body
    assert "DTSTART:20260801T100000Z" in body
    assert "ICS Scheduled Candidate" in body
