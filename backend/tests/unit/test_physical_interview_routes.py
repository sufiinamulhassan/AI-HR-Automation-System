import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from httpx import ASGITransport, AsyncClient

import config.database as database
from config import tenancy
from config.tenancy import DEFAULT_COMPANY_ID
from fake_mongo import FakeRaw
from main import app
from services.hr_module import email_service

pytestmark = pytest.mark.anyio

COMPANY = "cmp_a"
ADMIN = {"Authorization": f"Bearer demo-admin-token@@{COMPANY}"}
STANDARD = {"Authorization": f"Bearer demo-standard-token@@{COMPANY}"}
EXTERNAL = "/api/v1/candidates/external-interview"
ADDRESS = "Hirely.ai Head Office, 228 Rose Commercial, Park View, Lahore"


def when(days=3, hours=0) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=days, hours=hours)).replace(microsecond=0).isoformat()


@pytest.fixture
async def world(monkeypatch):
    raw = FakeRaw()
    raw.add("jobs", {"job_id": "job_1", "title": "Project Manager", "company_name": "Prenosis", "candidate_pipeline": []}, COMPANY)
    raw.add("candidates", {
        "candidate_id": "cand_1", "job_id": "job_1", "name": "Zeeshan Idrees", "email": "zeeshan@example.com",
        "secure_token": "tok_1", "pipeline_stage": "invited", "status": "invited", "transcript": [],
    }, COMPANY)
    monkeypatch.setattr(database, "_db", raw)
    sent: list[dict] = []

    async def record(**kwargs):
        sent.append(kwargs)
        return True

    async def no_override(key):
        return None

    monkeypatch.setattr(email_service, "send_email", record)
    monkeypatch.setattr(email_service, "get_template_override", no_override)
    tenancy.use_fallback_company(None)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as client:
        yield SimpleNamespace(client=client, raw=raw, sent=sent)
    tenancy.use_fallback_company(DEFAULT_COMPANY_ID)


def physical(**over) -> dict:
    body = {
        "job_id": "job_1", "name": "Sana Khan", "email": "sana@example.com", "platform": "physical",
        "location": ADDRESS, "scheduled_start_at": when(), "duration_minutes": 45, "notes": "Ask for Bilal at reception.",
        "display_timezone": "Asia/Karachi",
    }
    body.update(over)
    return body


def stored(world, candidate_id):
    (doc,) = [d for d in world.raw["candidates"].docs if d["candidate_id"] == candidate_id]
    return doc


async def test_an_admin_sets_up_an_interview_in_person_with_an_address_instead_of_a_link(world):
    response = await world.client.post(EXTERNAL, headers=ADMIN, json=physical())
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["interview_mode"] == "external" and body["email_sent"] is True
    details = body["external_interview"]
    assert (details["platform"], details["platform_label"], details["location"], details["join_url"]) == (
        "physical", "In person", ADDRESS, None)
    assert details["meeting_created"] is False and details["status"] == "scheduled"

    doc = stored(world, body["candidate_id"])
    assert doc["interview_mode"] == "external" and doc["pipeline_stage"] == "interviewing"
    assert doc["external_interview"]["location"] == ADDRESS and doc["meeting_join_url"] is None
    assert doc["scheduled_start_at"] == details["scheduled_start_at"]


async def test_the_candidate_is_told_by_a_message_with_the_place_and_a_calendar_invitation(world):
    await world.client.post(EXTERNAL, headers=ADMIN, json=physical())
    (mail,) = world.sent
    assert mail["to"] == "sana@example.com" and mail["template"] == "physical_interview_call"
    assert mail["subject"] == "Your in-person interview for Project Manager"
    assert ADDRESS in mail["text_body"] and ADDRESS in mail["html_body"] and "Ask for Bilal at reception." in mail["html_body"]
    assert "Join the interview" not in mail["html_body"]
    ics = mail["attachment_bytes"].decode("utf-8").replace("\r\n ", "")
    assert "LOCATION:Hirely.ai Head Office\\, 228 Rose Commercial\\, Park View\\, Lahore" in ics and "METHOD:REQUEST" in ics


async def test_setting_up_with_send_email_off_stores_it_and_sends_nothing(world):
    response = await world.client.post(EXTERNAL, headers=ADMIN, json=physical(send_email=False))
    assert response.status_code == 200 and response.json()["email_sent"] is False and world.sent == []


async def test_an_existing_candidate_can_be_called_in_person_too(world):
    response = await world.client.post(EXTERNAL, headers=ADMIN, json={
        "candidate_id": "cand_1", "platform": "physical", "location": ADDRESS, "scheduled_start_at": when(),
    })
    assert response.status_code == 200, response.text
    assert world.sent[0]["to"] == "zeeshan@example.com"
    assert stored(world, "cand_1")["interview_mode"] == "external"


@pytest.mark.parametrize("over, message", [
    ({"location": None}, "Add the address"),
    ({"location": "   "}, "Add the address"),
    ({"location": "Room\x00 4"}, "not valid"),
    ({"scheduled_start_at": when(days=-1)}, "future"),
    ({"scheduled_start_at": "soon"}, "valid date"),
    ({"create_meeting": True}, "no meeting to create"),
])
async def test_an_interview_in_person_needs_a_place_and_a_future_time(world, over, message):
    response = await world.client.post(EXTERNAL, headers=ADMIN, json=physical(**over))
    assert response.status_code == 422, response.text
    assert message in str(response.json()["detail"])
    assert world.sent == [] and not [d for d in world.raw["candidates"].docs if d["candidate_id"] != "cand_1"]


async def test_an_address_over_the_limit_is_refused(world):
    response = await world.client.post(EXTERNAL, headers=ADMIN, json=physical(location="x" * 301))
    assert response.status_code == 422


async def test_a_link_sent_with_a_place_is_ignored_and_never_stored(world):
    response = await world.client.post(EXTERNAL, headers=ADMIN, json=physical(join_url="https://zoom.us/j/1"))
    assert response.status_code == 200
    assert response.json()["external_interview"]["join_url"] is None
    assert "zoom.us" not in world.sent[0]["html_body"] and "zoom.us" not in world.sent[0]["text_body"]


async def test_a_meeting_on_a_platform_still_needs_its_link_and_has_no_place(world):
    no_link = await world.client.post(EXTERNAL, headers=ADMIN, json=physical(platform="zoom", location=None))
    assert no_link.status_code == 422 and "meeting link" in str(no_link.json()["detail"])
    ok = await world.client.post(EXTERNAL, headers=ADMIN, json=physical(
        platform="zoom", location="ignored", join_url="https://zoom.us/j/1", email="eve@example.com", name="Eve"))
    assert ok.status_code == 200 and ok.json()["external_interview"]["location"] is None
    assert world.sent[-1]["template"] == "external_interview"


async def test_a_recruiter_cannot_set_one_up(world):
    assert (await world.client.post(EXTERNAL, headers=STANDARD, json=physical())).status_code == 403
    assert (await world.client.post(EXTERNAL, json=physical())).status_code in (401, 403)
    assert world.sent == []


async def scheduled(world) -> str:
    return (await world.client.post(EXTERNAL, headers=ADMIN, json=physical())).json()["candidate_id"]


async def test_moving_the_place_is_stored_with_its_history_and_told_as_an_update(world):
    cid = await scheduled(world)
    world.sent.clear()
    response = await world.client.patch(
        f"/api/v1/candidates/{cid}/external-interview", headers=ADMIN, json={"location": "Branch Office, Gulberg III, Lahore"})
    assert response.status_code == 200, response.text
    details = response.json()["external_interview"]
    assert details["location"] == "Branch Office, Gulberg III, Lahore" and details["calendar_sequence"] == 1
    (entry,) = details["history"]
    assert entry["changes"] == {"location": [ADDRESS, "Branch Office, Gulberg III, Lahore"]}
    (mail,) = world.sent
    assert mail["subject"] == "Updated interview details for Project Manager" and "Branch Office, Gulberg III, Lahore" in mail["html_body"]
    assert "SEQUENCE:1" in mail["attachment_bytes"].decode()


async def test_moving_only_the_time_keeps_the_place(world):
    cid = await scheduled(world)
    response = await world.client.patch(
        f"/api/v1/candidates/{cid}/external-interview", headers=ADMIN, json={"scheduled_start_at": when(days=5)})
    assert response.status_code == 200 and response.json()["external_interview"]["location"] == ADDRESS


async def test_moving_an_interview_in_person_to_a_platform_needs_a_link_and_drops_the_place(world):
    cid = await scheduled(world)
    refused = await world.client.patch(f"/api/v1/candidates/{cid}/external-interview", headers=ADMIN, json={"platform": "zoom"})
    assert refused.status_code == 422 and "meeting link" in str(refused.json()["detail"])
    ok = await world.client.patch(
        f"/api/v1/candidates/{cid}/external-interview", headers=ADMIN, json={"platform": "zoom", "join_url": "https://zoom.us/j/9"})
    assert ok.status_code == 200
    details = ok.json()["external_interview"]
    assert details["platform"] == "zoom" and details["location"] is None and details["join_url"] == "https://zoom.us/j/9"
    assert world.sent[-1]["template"] == "external_interview"


async def test_moving_a_meeting_to_a_place_needs_an_address_and_drops_the_link(world):
    created = await world.client.post(EXTERNAL, headers=ADMIN, json=physical(
        platform="zoom", location=None, join_url="https://zoom.us/j/1", email="eve@example.com", name="Eve"))
    cid = created.json()["candidate_id"]
    refused = await world.client.patch(f"/api/v1/candidates/{cid}/external-interview", headers=ADMIN, json={"platform": "physical"})
    assert refused.status_code == 422 and "address" in str(refused.json()["detail"])
    ok = await world.client.patch(
        f"/api/v1/candidates/{cid}/external-interview", headers=ADMIN, json={"platform": "physical", "location": ADDRESS})
    details = ok.json()["external_interview"]
    assert details["platform"] == "physical" and details["join_url"] is None and details["location"] == ADDRESS
    assert stored(world, cid)["meeting_join_url"] is None


async def test_resending_sends_the_same_call_again(world):
    cid = await scheduled(world)
    world.sent.clear()
    response = await world.client.post(f"/api/v1/candidates/{cid}/external-interview/resend", headers=ADMIN)
    assert response.status_code == 200, response.text
    assert world.sent[0]["template"] == "physical_interview_call" and ADDRESS in world.sent[0]["html_body"]


async def test_the_pipeline_row_shows_the_place_to_everyone_who_may_see_the_row(world):
    cid = await scheduled(world)
    doc = stored(world, cid)
    doc["resume_id"] = "r_1"
    world.raw.add("resumes", {"resume_id": "r_1", "candidate_name": "Sana Khan"}, COMPANY)
    world.raw["jobs"].docs[0]["candidate_pipeline"] = [{"resume_id": "r_1", "pipeline_stage": "interviewing", "similarity_score": 0.7}]
    for headers in (ADMIN, STANDARD):
        rows = (await world.client.get("/api/v1/jobs/job_1/pipeline", headers=headers)).json()["pipeline"]
        (row,) = rows
        assert (row["external_platform"], row["external_platform_label"], row["external_location"], row["external_join_url"]) == (
            "physical", "In person", ADDRESS, None)


async def test_the_hr_calendar_download_carries_the_place(world):
    cid = await scheduled(world)
    response = await world.client.get(f"/api/v1/interview/{cid}/schedule.ics", headers=ADMIN)
    assert response.status_code == 200, response.text
    ics = response.text.replace("\r\n ", "")
    assert "METHOD:PUBLISH" in ics and "LOCATION:Hirely.ai Head Office" in ics and "ATTENDEE" not in ics


def comm(world, **over):
    body = {"template": "physical_interview_call", "scheduled_start_at": when(), "location": ADDRESS, "duration_minutes": 30,
            "notes": "Bring a photo ID.", "display_timezone": "Asia/Karachi"}
    body.update(over)
    return world.client.post("/api/v1/candidates/cand_1/send-email", headers=ADMIN, json=body)


async def test_the_communication_center_sends_the_call_without_changing_the_candidate(world):
    before = dict(stored(world, "cand_1"))
    response = await comm(world)
    assert response.status_code == 200, response.text
    assert response.json() == {"sent": True, "template": "physical_interview_call", "sent_to": "zeeshan@example.com"}
    (mail,) = world.sent
    assert mail["template"] == "physical_interview_call" and mail["candidate_id"] == "cand_1" and mail["job_id"] == "job_1"
    assert ADDRESS in mail["html_body"] and "Bring a photo ID." in mail["html_body"] and "about 30 minutes" in mail["text_body"]
    after = stored(world, "cand_1")
    assert after["pipeline_stage"] == before["pipeline_stage"] and "interview_mode" not in after and "external_interview" not in after


@pytest.mark.parametrize("over, message", [
    ({"location": None}, "address"), ({"location": ""}, "address"),
    ({"scheduled_start_at": None}, "valid date"), ({"scheduled_start_at": when(days=-2)}, "future"),
])
async def test_the_call_needs_a_place_and_a_future_time(world, over, message):
    response = await comm(world, **over)
    assert response.status_code == 422 and message in str(response.json()["detail"]) and world.sent == []


async def test_an_unknown_template_lists_the_valid_ones_including_this_one(world):
    response = await comm(world, template="nope")
    assert response.status_code == 400 and "physical_interview_call" in response.json()["detail"]


async def test_a_recruiter_cannot_send_the_call(world):
    response = await world.client.post(
        "/api/v1/candidates/cand_1/send-email", headers=STANDARD, json={"template": "physical_interview_call", "location": ADDRESS})
    assert response.status_code == 403 and world.sent == []


async def test_a_candidate_with_no_email_cannot_be_sent_the_call(world):
    stored(world, "cand_1")["email"] = ""
    assert (await comm(world)).status_code == 400
