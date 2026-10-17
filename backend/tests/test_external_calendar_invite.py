import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from email import message_from_bytes
from types import SimpleNamespace

import pytest

from config.database import get_db
from config.settings import settings
from services.hr_module import email_service
from services.hr_module import external_interview_service as ext
from shared.utils import EM_DASH

pytestmark = pytest.mark.anyio

MEET_URL = "https://meet.google.com/abc-defg-hij"
ZOOM_URL = "https://us06web.zoom.us/j/123456789"
ADMIN_EMAIL = "demo-admin@hirely.ai"


def _future(days: int = 2, hours: int = 0) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=days, hours=hours)).isoformat()


@pytest.fixture
def smtp(monkeypatch):
    import aiosmtplib

    sent: list = []

    async def fake_send(msg, **kwargs):
        sent.append(msg)

    monkeypatch.setattr(settings, "AWS_SES_ENABLED", False)
    monkeypatch.setattr(settings, "EMAIL_HOST", "smtp.test.invalid")
    monkeypatch.setattr(aiosmtplib, "send", fake_send)
    return sent


@pytest.fixture
async def seed():
    db = get_db()
    created = {"jobs": [], "candidates": []}

    async def job(**fields) -> str:
        job_id = f"cal-job-{uuid.uuid4().hex[:10]}"
        await db.jobs.insert_one({
            "doc_type": "job", "job_id": job_id, "title": "Marketing Lead",
            "company_name": "Calendar Corp", "candidate_pipeline": [], **fields,
        })
        created["jobs"].append(job_id)
        return job_id

    yield SimpleNamespace(db=db, job=job, created=created)

    for cid in created["candidates"]:
        doc = await db.candidates.find_one({"candidate_id": cid}, {"email": 1})
        await db.email_log.delete_many({"candidate_id": cid})
        await db.audit_log.delete_many({"resource_id": cid})
        await db.candidates.delete_one({"candidate_id": cid})
        if doc and doc.get("email"):
            await db.candidate_profiles.delete_many({"email": doc["email"]})
    for job_id in created["jobs"]:
        await db.jobs.delete_one({"job_id": job_id})
        await db.audit_log.delete_many({"resource_id": job_id})
    await asyncio.sleep(0)


async def schedule(client, headers, seed, *, job_id=None, **overrides):
    job_id = job_id or await seed.job()
    body = {
        "job_id": job_id, "name": "Sam Rivera", "email": f"sam-{uuid.uuid4().hex[:8]}@example.com",
        "platform": "meet", "join_url": MEET_URL, "scheduled_start_at": _future(),
        "duration_minutes": 45,
    }
    body.update(overrides)
    resp = await client.post("/api/v1/candidates/external-interview", json=body, headers=headers)
    if resp.status_code == 200:
        seed.created["candidates"].append(resp.json()["candidate_id"])
    return resp, body


def calendar_part(msg):
    return next((p for p in msg.walk() if p.get_content_type() == "text/calendar"), None)


def ics_lines(msg) -> list[str]:
    part = calendar_part(msg)
    assert part is not None, "no calendar part in the message"
    text = part.get_payload(decode=True).decode("utf-8")
    return text.replace("\r\n ", "").split("\r\n")


def ics_value(lines: list[str], name: str) -> str:
    return next(line.split(":", 1)[1] for line in lines if line.startswith(f"{name}:") or line.startswith(f"{name};"))


async def test_an_attachment_defaults_to_pdf_and_may_name_another_type():
    pdf = email_service._build_mime(
        to="a@example.com", subject="s", html_body="<p>x</p>", text_body="x",
        attachment_bytes=b"%PDF-1.4 body", attachment_filename="offer.pdf",
    )
    part = pdf.get_payload()[1]
    assert part.get_content_type() == "application/pdf"
    assert part.get_filename() == "offer.pdf" and part.get_payload(decode=True) == b"%PDF-1.4 body"

    nameless = email_service._build_mime(
        to="a@example.com", subject="s", html_body="<p>x</p>", text_body="x", attachment_bytes=b"%PDF-1.4",
    )
    assert nameless.get_payload()[1].get_filename() == "attachment.pdf"

    cal = email_service._build_mime(
        to="a@example.com", subject="s", html_body="<p>x</p>", text_body="x",
        attachment_bytes=b"BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n", attachment_filename="interview.ics",
        attachment_content_type="text/calendar; method=REQUEST; charset=UTF-8",
    )
    assert cal.get_content_type() == "multipart/mixed"
    part = cal.get_payload()[1]
    assert part.get_content_type() == "text/calendar"
    assert part.get_param("method") == "REQUEST" and part.get_content_charset() == "utf-8"
    assert part.get_filename() == "interview.ics"
    assert part.get_payload(decode=True).startswith(b"BEGIN:VCALENDAR")
    assert "attachment" in part.get("Content-Disposition", "")


async def test_send_email_passes_the_content_type_through_and_pdf_callers_are_unchanged(smtp, monkeypatch):
    ok = await email_service.send_email(
        to="a@example.com", subject="Offer", html_body="<p>x</p>", text_body="x",
        attachment_bytes=b"%PDF-1.4 letter", attachment_filename="offer.pdf",
    )
    assert ok is True
    assert smtp[0].get_payload()[1].get_content_type() == "application/pdf"

    await email_service.send_email(
        to="a@example.com", subject="Invite", html_body="<p>x</p>", text_body="x",
        attachment_bytes=b"BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n", attachment_filename="interview.ics",
        attachment_content_type="text/calendar; method=REQUEST",
    )
    assert smtp[1].get_payload()[1].get_content_type() == "text/calendar"
    assert smtp[1].get_payload()[1].get_param("method") == "REQUEST"

    await email_service.send_email(to="a@example.com", subject="Plain", html_body="<p>x</p>", text_body="x")
    assert smtp[2].get_content_type() == "multipart/alternative"


async def test_build_ics_event_takes_a_method_a_sequence_and_an_attendee():
    from services.hr_module.calendar_ics import build_ics_event

    args = ("uid-1@hrbot", "Interview", "Body", "2026-07-14T09:00:00+05:00", 30, "hr@company.com")
    default = build_ics_event(*args)
    assert "METHOD:PUBLISH\r\n" in default and "SEQUENCE:0\r\n" in default and "ATTENDEE" not in default

    request = build_ics_event(*args, method="request", sequence=3, attendee_email="sam@example.com")
    assert "METHOD:REQUEST\r\n" in request and "SEQUENCE:3\r\n" in request
    assert "ATTENDEE;ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:sam@example.com\r\n" in request
    assert "DTSTART:20260714T040000Z\r\n" in request and "DTEND:20260714T043000Z\r\n" in request
    assert "\n" not in request.replace("\r\n", "")

    assert "SEQUENCE:0\r\n" in build_ics_event(*args, sequence=-4)
    with pytest.raises(ValueError):
        build_ics_event(*args, method="PUBLISH\r\nX-INJECTED:1")


async def test_the_first_email_carries_a_request_invitation_in_utc(client, admin_headers, seed, smtp):
    start = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(days=3)
    resp, body = await schedule(client, admin_headers, seed, scheduled_start_at=start.isoformat(), duration_minutes=45)
    assert resp.status_code == 200, resp.text
    assert len(smtp) == 1

    msg = smtp[0]
    part = calendar_part(msg)
    assert part is not None and part.get_param("method") == "REQUEST"
    assert part.get_filename() == "interview.ics"
    assert msg["To"] == body["email"] and msg["Subject"] == "Your interview for Marketing Lead"

    lines = ics_lines(msg)
    assert lines[0] == "BEGIN:VCALENDAR" and lines[-2] == "END:VCALENDAR"
    assert ics_value(lines, "METHOD") == "REQUEST"
    assert ics_value(lines, "SEQUENCE") == "0"
    assert ics_value(lines, "STATUS") == "CONFIRMED"
    assert ics_value(lines, "DTSTART") == start.strftime("%Y%m%dT%H%M%SZ")
    assert ics_value(lines, "DTEND") == (start + timedelta(minutes=45)).strftime("%Y%m%dT%H%M%SZ")
    assert ics_value(lines, "SUMMARY") == "Interview for Marketing Lead"
    assert ics_value(lines, "DESCRIPTION") == f"Platform: Google Meet\\nJoin: {MEET_URL}"
    assert body["email"] in next(line for line in lines if line.startswith("ATTENDEE"))
    assert ics_value(lines, "UID") == f"external-interview-{resp.json()['candidate_id']}@hrbot"


async def test_the_invitation_holds_the_title_the_platform_and_the_link_and_nothing_else(client, admin_headers, seed, smtp):
    job_id = await seed.job(title="Staff Engineer", description="Secret internal budget notes.")
    resp, body = await schedule(
        client, admin_headers, seed, job_id=job_id, name="Quentin Candidate",
        notes="Bring a laptop. Confidential recruiter note.",
    )
    assert resp.status_code == 200
    text = "\n".join(ics_lines(smtp[0])).lower()
    for forbidden in ("quentin", "candidate", "score", "recommend", "confidential", "laptop", "secret", "calendar corp"):
        assert forbidden not in text.replace("vcalendar", "").replace("calscale", ""), forbidden
    assert "staff engineer" in text and "google meet" in text and "meet.google.com/abc-defg-hij" in text
    assert EM_DASH not in text


async def test_an_update_raises_the_sequence_and_keeps_the_uid(client, admin_headers, seed, smtp):
    resp, _ = await schedule(client, admin_headers, seed)
    cid = resp.json()["candidate_id"]
    uid = ics_value(ics_lines(smtp[0]), "UID")
    seen = [ics_value(ics_lines(smtp[0]), "SEQUENCE")]

    new_start = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(days=6)
    first = await client.patch(
        f"/api/v1/candidates/{cid}/external-interview", headers=admin_headers,
        json={"scheduled_start_at": new_start.isoformat()},
    )
    assert first.status_code == 200, first.text
    second = await client.patch(
        f"/api/v1/candidates/{cid}/external-interview", headers=admin_headers, json={"duration_minutes": 60},
    )
    assert second.status_code == 200
    assert len(smtp) == 3

    for msg in smtp[1:]:
        assert msg["Subject"] == "Updated interview details for Marketing Lead"
        assert ics_value(ics_lines(msg), "METHOD") == "REQUEST"
        assert ics_value(ics_lines(msg), "UID") == uid
        seen.append(ics_value(ics_lines(msg), "SEQUENCE"))
    assert seen == ["0", "1", "2"]

    update = ics_lines(smtp[1])
    assert ics_value(update, "DTSTART") == new_start.strftime("%Y%m%dT%H%M%SZ")
    assert ics_value(ics_lines(smtp[2]), "DTEND") == (new_start + timedelta(minutes=60)).strftime("%Y%m%dT%H%M%SZ")
    cand = await seed.db.candidates.find_one({"candidate_id": cid})
    assert cand["external_interview"]["calendar_sequence"] == 2


async def test_a_resend_repeats_the_current_sequence(client, admin_headers, seed, smtp):
    resp, _ = await schedule(client, admin_headers, seed)
    cid = resp.json()["candidate_id"]
    await client.patch(f"/api/v1/candidates/{cid}/external-interview", headers=admin_headers, json={"duration_minutes": 50})
    smtp.clear()

    again = await client.post(f"/api/v1/candidates/{cid}/external-interview/resend", headers=admin_headers)
    assert again.status_code == 200 and again.json()["email_sent"] is True
    lines = ics_lines(smtp[0])
    assert ics_value(lines, "SEQUENCE") == "1" and ics_value(lines, "METHOD") == "REQUEST"
    assert smtp[0]["Subject"] == "Your interview for Marketing Lead"


async def test_no_email_means_no_invitation_and_the_sequence_still_moves(client, admin_headers, seed, smtp):
    resp, _ = await schedule(client, admin_headers, seed, send_email=False)
    cid = resp.json()["candidate_id"]
    assert smtp == []
    upd = await client.patch(
        f"/api/v1/candidates/{cid}/external-interview", headers=admin_headers,
        json={"duration_minutes": 30, "send_email": False},
    )
    assert upd.status_code == 200 and smtp == []
    assert upd.json()["external_interview"]["calendar_sequence"] == 1


async def test_an_unreadable_start_sends_the_email_without_an_invitation(smtp):
    ok = await email_service.send_external_interview_email(
        to_email="x@example.com", candidate_name="X", job_title="Role", company_name=None,
        platform_label="Zoom", join_url=ZOOM_URL, scheduled_start_at="not a time", duration_minutes=30,
    )
    assert ok is True and calendar_part(smtp[0]) is None
    assert smtp[0].get_content_type() == "multipart/alternative"


async def test_the_invitation_text_is_free_of_em_dashes_and_unsafe_attendees_are_left_out():
    ics = email_service.build_external_interview_ics(
        candidate_id="c-1", to_email="bad address@example.com", job_title=f"Lead {EM_DASH} Platform",
        platform_label="Zoom", join_url=ZOOM_URL, scheduled_start_at=_future(), duration_minutes=30, sequence=4,
    )
    assert EM_DASH not in ics
    assert "SUMMARY:Interview for Lead\\, Platform" in ics and "SEQUENCE:4" in ics
    assert "ATTENDEE" not in ics and "\r\n\r\n" not in ics


async def test_the_uid_is_stable_per_candidate_and_differs_between_candidates():
    kwargs = dict(
        to_email="x@example.com", job_title="Role", platform_label="Zoom", join_url=ZOOM_URL,
        scheduled_start_at=_future(), duration_minutes=30,
    )
    one = email_service.build_external_interview_ics(candidate_id="c-1", sequence=0, **kwargs)
    two = email_service.build_external_interview_ics(candidate_id="c-1", sequence=5, **kwargs)
    other = email_service.build_external_interview_ics(candidate_id="c-2", sequence=0, **kwargs)
    uid = lambda ics: next(l for l in ics.split("\r\n") if l.startswith("UID:"))
    assert uid(one) == uid(two) != uid(other)


def download_lines(resp) -> list[str]:
    return resp.text.replace("\r\n ", "").split("\r\n")


async def test_the_download_for_an_external_interview_is_built_from_external_interview(client, admin_headers, seed, smtp):
    start = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(days=3)
    resp, body = await schedule(
        client, admin_headers, seed, scheduled_start_at=start.isoformat(), duration_minutes=50, name="Quentin Candidate",
    )
    cid = resp.json()["candidate_id"]

    dl = await client.get(f"/api/v1/interview/{cid}/schedule.ics", headers=admin_headers)
    assert dl.status_code == 200 and dl.headers["content-type"].startswith("text/calendar")
    assert f"interview_{cid[:8]}.ics" in dl.headers["content-disposition"]
    lines = download_lines(dl)
    assert ics_value(lines, "METHOD") == "PUBLISH" and not any(line.startswith("ATTENDEE") for line in lines)
    assert ics_value(lines, "DTSTART") == start.strftime("%Y%m%dT%H%M%SZ")
    assert ics_value(lines, "DTEND") == (start + timedelta(minutes=50)).strftime("%Y%m%dT%H%M%SZ")
    assert ics_value(lines, "SUMMARY") == "Interview for Marketing Lead"
    assert ics_value(lines, "DESCRIPTION") == f"Platform: Google Meet\\nJoin: {MEET_URL}"
    text = dl.text.lower()
    for private in ("quentin", body["email"], "score", "recommend"):
        assert private not in text

    email_lines = ics_lines(smtp[0])
    assert ics_value(lines, "UID") == ics_value(email_lines, "UID") == f"external-interview-{cid}@hrbot"
    assert ics_value(lines, "SEQUENCE") == ics_value(email_lines, "SEQUENCE") == "0"
    assert ics_value(lines, "DTSTART") == ics_value(email_lines, "DTSTART")


async def test_the_download_follows_a_reschedule_and_keeps_agreeing_with_the_email(client, admin_headers, seed, smtp):
    resp, _ = await schedule(client, admin_headers, seed)
    cid = resp.json()["candidate_id"]
    new_start = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(days=8)
    await client.patch(
        f"/api/v1/candidates/{cid}/external-interview", headers=admin_headers,
        json={"scheduled_start_at": new_start.isoformat(), "duration_minutes": 20, "join_url": "https://meet.google.com/new-room-xyz"},
    )

    lines = download_lines(await client.get(f"/api/v1/interview/{cid}/schedule.ics", headers=admin_headers))
    update = ics_lines(smtp[-1])
    assert ics_value(lines, "SEQUENCE") == ics_value(update, "SEQUENCE") == "1"
    assert ics_value(lines, "UID") == ics_value(update, "UID")
    assert ics_value(lines, "DTSTART") == new_start.strftime("%Y%m%dT%H%M%SZ")
    assert ics_value(lines, "DTEND") == (new_start + timedelta(minutes=20)).strftime("%Y%m%dT%H%M%SZ")
    assert ics_value(lines, "DESCRIPTION") == "Platform: Google Meet\\nJoin: https://meet.google.com/new-room-xyz"


async def test_the_download_works_when_only_external_interview_holds_the_time(client, admin_headers, seed, smtp):
    resp, _ = await schedule(client, admin_headers, seed, duration_minutes=35)
    cid = resp.json()["candidate_id"]
    await seed.db.candidates.update_one({"candidate_id": cid}, {"$unset": {"scheduled_start_at": "", "meeting_join_url": ""}})

    dl = await client.get(f"/api/v1/interview/{cid}/schedule.ics", headers=admin_headers)
    assert dl.status_code == 200
    lines = download_lines(dl)
    start = datetime.fromisoformat((await seed.db.candidates.find_one({"candidate_id": cid}))["external_interview"]["scheduled_start_at"])
    assert ics_value(lines, "DTEND") == (start + timedelta(minutes=35)).strftime("%Y%m%dT%H%M%SZ")
    assert MEET_URL in dl.text.replace("\r\n ", "")


async def test_an_external_interview_with_no_readable_time_is_a_404_or_a_400(client, admin_headers, seed, smtp):
    resp, _ = await schedule(client, admin_headers, seed)
    cid = resp.json()["candidate_id"]
    await seed.db.candidates.update_one(
        {"candidate_id": cid},
        {"$set": {"external_interview.scheduled_start_at": "garbage"}, "$unset": {"scheduled_start_at": ""}},
    )
    bad = await client.get(f"/api/v1/interview/{cid}/schedule.ics", headers=admin_headers)
    assert bad.status_code == 400 and "Cannot generate calendar invite" in bad.json()["detail"]

    await seed.db.candidates.update_one({"candidate_id": cid}, {"$unset": {"external_interview.scheduled_start_at": ""}})
    missing = await client.get(f"/api/v1/interview/{cid}/schedule.ics", headers=admin_headers)
    assert missing.status_code == 404 and "No interview schedule" in missing.json()["detail"]


async def test_the_download_is_admin_only_and_a_platform_candidate_is_unchanged(client, admin_headers, standard_headers, seed, smtp):
    resp, _ = await schedule(client, admin_headers, seed)
    cid = resp.json()["candidate_id"]
    assert (await client.get(f"/api/v1/interview/{cid}/schedule.ics", headers=standard_headers)).status_code == 403
    assert (await client.get(f"/api/v1/interview/{cid}/schedule.ics")).status_code == 401

    job_id = await seed.job()
    plain = str(uuid.uuid4())
    seed.created["candidates"].append(plain)
    start = (datetime.now(timezone.utc) + timedelta(days=2)).replace(microsecond=0)
    await seed.db.candidates.insert_one({
        "doc_type": "candidate", "candidate_id": plain, "job_id": job_id, "name": "Pat Lee",
        "email": f"pat-{uuid.uuid4().hex[:6]}@example.com", "secure_token": f"tok_{uuid.uuid4().hex[:12]}",
        "pipeline_stage": "invited", "status": "invited", "scheduled_start_at": start.isoformat(),
    })
    lines = download_lines(await client.get(f"/api/v1/interview/{plain}/schedule.ics", headers=admin_headers))
    assert ics_value(lines, "UID") == f"interview-{plain}@hrbot"
    assert ics_value(lines, "SUMMARY") == "Interview: Pat Lee for Marketing Lead"
    assert ics_value(lines, "METHOD") == "PUBLISH" and ics_value(lines, "SEQUENCE") == "0"
    assert ics_value(lines, "DTEND") == (start + timedelta(minutes=settings.INTERVIEW_DURATION_MINUTES)).strftime("%Y%m%dT%H%M%SZ")


async def history_of(client, headers, cid) -> list:
    got = await client.get(f"/api/v1/candidates/{cid}/external-review", headers=headers)
    assert got.status_code == 200
    return got.json()["external_interview"]["history"]


async def test_a_new_interview_has_an_empty_history(client, admin_headers, seed, smtp):
    resp, _ = await schedule(client, admin_headers, seed)
    assert resp.json()["external_interview"]["history"] == []
    assert await history_of(client, admin_headers, resp.json()["candidate_id"]) == []


async def test_each_change_appends_who_when_and_old_and_new(client, admin_headers, seed, smtp):
    start = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(days=2)
    resp, _ = await schedule(client, admin_headers, seed, scheduled_start_at=start.isoformat(), duration_minutes=45)
    cid = resp.json()["candidate_id"]

    new_start = start + timedelta(days=1)
    r1 = await client.patch(
        f"/api/v1/candidates/{cid}/external-interview", headers=admin_headers,
        json={"scheduled_start_at": new_start.isoformat()},
    )
    assert r1.status_code == 200
    r2 = await client.patch(
        f"/api/v1/candidates/{cid}/external-interview", headers=admin_headers,
        json={"duration_minutes": 60, "join_url": "https://meet.google.com/new-room-xyz"},
    )
    assert r2.status_code == 200

    history = await history_of(client, admin_headers, cid)
    assert len(history) == 2
    first, second = history
    assert first["by"] == ADMIN_EMAIL and datetime.fromisoformat(first["at"]) <= datetime.fromisoformat(second["at"])
    assert first["changes"] == {"scheduled_start_at": [start.isoformat(), new_start.isoformat()]}
    assert second["changes"] == {
        "join_url": [MEET_URL, "https://meet.google.com/new-room-xyz"],
        "duration_minutes": [45, 60],
    }
    assert r2.json()["external_interview"]["history"] == history


async def test_a_platform_switch_is_recorded_by_name_and_the_passcode_is_never_stored(client, admin_headers, seed, smtp):
    resp, _ = await schedule(client, admin_headers, seed)
    cid = resp.json()["candidate_id"]

    switched = await client.patch(
        f"/api/v1/candidates/{cid}/external-interview", headers=admin_headers,
        json={"platform": "zoom", "join_url": f"{ZOOM_URL}?pwd=TOPSECRETPASS"},
    )
    assert switched.status_code == 200, switched.text
    history = await history_of(client, admin_headers, cid)
    assert history[0]["changes"]["platform"] == ["Google Meet", "Zoom"]
    assert history[0]["changes"]["join_url"] == [MEET_URL, ZOOM_URL]

    again = await client.patch(
        f"/api/v1/candidates/{cid}/external-interview", headers=admin_headers,
        json={"join_url": f"{ZOOM_URL}?pwd=ANOTHERPASS"},
    )
    assert again.status_code == 200
    history = await history_of(client, admin_headers, cid)
    assert history[1]["changes"] == {"join_url": [ZOOM_URL, f"{ZOOM_URL} (passcode changed)"]}

    for text in (str(history), str(await seed.db.candidates.find_one({"candidate_id": cid}, {"external_interview.history": 1}))):
        assert "TOPSECRETPASS" not in text and "ANOTHERPASS" not in text and "pwd" not in text


async def test_notes_only_and_no_op_updates_add_no_entry(client, admin_headers, seed, smtp):
    resp, payload = await schedule(client, admin_headers, seed)
    cid = resp.json()["candidate_id"]

    notes = await client.patch(
        f"/api/v1/candidates/{cid}/external-interview", headers=admin_headers, json={"notes": "Use the side door."},
    )
    same = await client.patch(
        f"/api/v1/candidates/{cid}/external-interview", headers=admin_headers,
        json={"join_url": MEET_URL, "duration_minutes": 45, "platform": "meet", "scheduled_start_at": payload["scheduled_start_at"]},
    )
    assert notes.status_code == 200 and same.status_code == 200
    assert await history_of(client, admin_headers, cid) == []


async def test_rescheduling_after_a_no_show_is_recorded(client, admin_headers, seed, smtp):
    resp, payload = await schedule(client, admin_headers, seed)
    cid = resp.json()["candidate_id"]
    await client.post(f"/api/v1/candidates/{cid}/external-review", headers=admin_headers, json={"attended": False})

    new_start = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(days=9)
    r = await client.patch(
        f"/api/v1/candidates/{cid}/external-interview", headers=admin_headers,
        json={"scheduled_start_at": new_start.isoformat()},
    )
    assert r.status_code == 200
    history = await history_of(client, admin_headers, cid)
    assert [list(e["changes"]) for e in history] == [["scheduled_start_at"]]
    assert history[0]["changes"]["scheduled_start_at"][1] == new_start.isoformat()


async def test_history_is_admin_only_and_old_interviews_read_as_empty(client, admin_headers, standard_headers, seed, smtp):
    resp, _ = await schedule(client, admin_headers, seed)
    cid = resp.json()["candidate_id"]
    assert (await client.get(f"/api/v1/candidates/{cid}/external-review", headers=standard_headers)).status_code == 403

    await seed.db.candidates.update_one({"candidate_id": cid}, {"$unset": {"external_interview.history": ""}})
    assert await history_of(client, admin_headers, cid) == []
    r = await client.patch(f"/api/v1/candidates/{cid}/external-interview", headers=admin_headers, json={"duration_minutes": 20})
    assert r.status_code == 200
    assert len(await history_of(client, admin_headers, cid)) == 1


async def test_history_keeps_only_the_newest_fifty_entries():
    history: list = []
    for n in range(60):
        history = ext.history_with(history, at=str(n), by="a@b.c", changes={"duration_minutes": [n, n + 1]})
    assert len(history) == ext.MAX_HISTORY_ENTRIES == 50
    assert history[0]["at"] == "10" and history[-1]["at"] == "59"
    assert ext.history_with(history, at="x", by="a@b.c", changes={}) == history
    assert ext.reschedule_changes({"duration_minutes": 30}, {"duration_minutes": 30}) == {}
