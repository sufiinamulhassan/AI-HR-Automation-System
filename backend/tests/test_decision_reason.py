import asyncio
import uuid
from types import SimpleNamespace

import pytest

from config.database import get_db
from services.hr_module import email_service

pytestmark = pytest.mark.anyio

REASONS = ("not_a_fit", "salary", "withdrew", "no_show", "position_filled", "other")


@pytest.fixture
def sent_mail(monkeypatch):
    calls: list[dict] = []

    async def fake_send_email(**kwargs):
        calls.append(kwargs)
        return True

    monkeypatch.setattr(email_service, "send_email", fake_send_email)
    return calls


@pytest.fixture
async def seed():
    db = get_db()
    created = {"candidates": [], "jobs": []}

    async def job() -> str:
        job_id = f"reason-job-{uuid.uuid4().hex[:10]}"
        await db.jobs.insert_one({
            "doc_type": "job", "job_id": job_id, "title": "Support Engineer",
            "company_name": "Reason Corp", "candidate_pipeline": [],
        })
        created["jobs"].append(job_id)
        return job_id

    async def candidate(*, job_id: str | None = None, email: str | None = None, **extra) -> str:
        cid = str(uuid.uuid4())
        await db.candidates.insert_one({
            "doc_type": "candidate", "candidate_id": cid, "job_id": job_id or await job(),
            "name": "Riley Park", "email": email or f"riley-{uuid.uuid4().hex[:8]}@example.com",
            "secure_token": f"tok_{uuid.uuid4().hex[:12]}", "pipeline_stage": "completed",
            "status": "completed", "created_at": "2026-01-01T00:00:00+00:00", **extra,
        })
        created["candidates"].append(cid)
        return cid

    yield SimpleNamespace(db=db, candidate=candidate, job=job)

    for cid in created["candidates"]:
        await db.candidates.delete_one({"candidate_id": cid})
        await db.email_log.delete_many({"candidate_id": cid})
        await db.audit_log.delete_many({"resource_id": cid})
    for job_id in created["jobs"]:
        await db.jobs.delete_one({"job_id": job_id})
    await asyncio.sleep(0)


async def decide(client, headers, cid, **body):
    return await client.post(f"/api/v1/candidates/{cid}/decision", json=body, headers=headers)


async def audit_details(db, cid: str) -> dict:
    for _ in range(25):
        entry = await db.audit_log.find_one({"action": "candidate_decision", "resource_id": cid})
        if entry:
            return entry["details"]
        await asyncio.sleep(0.2)
    raise AssertionError("no candidate_decision audit entry")


@pytest.mark.parametrize("reason", REASONS)
async def test_every_reason_is_stored_and_audited(client, admin_headers, seed, sent_mail, reason):
    cid = await seed.candidate()
    resp = await decide(client, admin_headers, cid, decision="reject", notes="Not a match", reason=reason)
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"message": "Decision recorded: reject", "stage": "rejected"}

    cand = await seed.db.candidates.find_one({"candidate_id": cid})
    assert cand["decision"] == "reject" and cand["pipeline_stage"] == "rejected"
    assert cand["decision_reason"] == reason and cand["decision_notes"] == "Not a match"
    details = await audit_details(seed.db, cid)
    assert details["reason"] == reason and details["decision"] == "reject" and details["notes"] == "Not a match"


@pytest.mark.parametrize("reason", ["", "because", "Salary", "NOT_A_FIT", 7, ["salary"]])
async def test_an_unknown_reason_is_a_validation_error_and_changes_nothing(client, admin_headers, seed, sent_mail, reason):
    cid = await seed.candidate()
    resp = await decide(client, admin_headers, cid, decision="reject", reason=reason)
    assert resp.status_code == 422
    cand = await seed.db.candidates.find_one({"candidate_id": cid})
    assert cand["pipeline_stage"] == "completed" and "decision_reason" not in cand
    assert sent_mail == []


async def test_a_rejection_without_a_reason_still_works(client, admin_headers, seed, sent_mail):
    cid = await seed.candidate()
    assert (await decide(client, admin_headers, cid, decision="reject")).status_code == 200
    assert (await seed.db.candidates.find_one({"candidate_id": cid}))["decision_reason"] is None
    assert (await audit_details(seed.db, cid))["reason"] is None

    null = await seed.candidate()
    assert (await decide(client, admin_headers, null, decision="reject", reason=None)).status_code == 200
    assert (await seed.db.candidates.find_one({"candidate_id": null}))["decision_reason"] is None


async def test_only_a_rejection_keeps_a_reason(client, admin_headers, seed, sent_mail):
    hired = await seed.candidate()
    held = await seed.candidate()
    assert (await decide(client, admin_headers, hired, decision="hire", reason="salary")).status_code == 200
    assert (await decide(client, admin_headers, held, decision="hold", reason="other")).status_code == 200
    for cid in (hired, held):
        assert (await seed.db.candidates.find_one({"candidate_id": cid}))["decision_reason"] is None

    cid = await seed.candidate()
    await decide(client, admin_headers, cid, decision="reject", reason="no_show")
    await decide(client, admin_headers, cid, decision="hire")
    assert (await seed.db.candidates.find_one({"candidate_id": cid}))["decision_reason"] is None


async def test_the_rejection_email_never_mentions_the_reason(client, admin_headers, seed, sent_mail):
    cid = await seed.candidate()
    resp = await decide(client, admin_headers, cid, decision="reject", notes="Internal note", reason="salary")
    assert resp.status_code == 200
    assert len(sent_mail) == 1
    mail = sent_mail[0]
    assert mail["template"] == "rejection"
    everything = " ".join(str(mail[k]) for k in ("subject", "text_body", "html_body")).lower()
    for leaked in ("salary", "reason", "not_a_fit", "not a fit", "withdrew", "no_show", "position_filled", "internal note"):
        assert leaked not in everything, leaked
    other = await seed.candidate()
    await decide(client, admin_headers, other, decision="reject")
    assert sent_mail[1]["text_body"] == mail["text_body"] and sent_mail[1]["subject"] == mail["subject"]


async def test_standard_users_cannot_decide(client, standard_headers, seed, sent_mail):
    cid = await seed.candidate()
    resp = await decide(client, standard_headers, cid, decision="reject", reason="salary")
    assert resp.status_code == 403
    assert sent_mail == []


async def test_the_timeline_shows_the_reason_to_admins_only(client, admin_headers, standard_headers, seed, sent_mail):
    email = f"shared-{uuid.uuid4().hex[:8]}@example.com"
    viewed = await seed.candidate(email=email)
    earlier = await seed.candidate(email=email)
    await decide(client, admin_headers, earlier, decision="reject", reason="position_filled")

    admin_view = await client.get(f"/api/v1/candidates/{viewed}/timeline", headers=admin_headers)
    assert admin_view.status_code == 200
    rows = admin_view.json()["timeline"]
    assert [r["candidate_id"] for r in rows] == [earlier]
    assert rows[0]["decision"] == "reject" and rows[0]["decision_reason"] == "position_filled"

    std = await client.get(f"/api/v1/candidates/{viewed}/timeline", headers=standard_headers)
    assert std.status_code == 200
    row = std.json()["timeline"][0]
    assert row["decision"] == "reject" and "decision_reason" not in row


async def test_the_timeline_reads_null_for_a_decision_with_no_reason(client, admin_headers, seed, sent_mail):
    email = f"shared-{uuid.uuid4().hex[:8]}@example.com"
    viewed = await seed.candidate(email=email)
    legacy = await seed.candidate(email=email, decision="reject", decided_at="2026-02-01T00:00:00+00:00")
    rows = (await client.get(f"/api/v1/candidates/{viewed}/timeline", headers=admin_headers)).json()["timeline"]
    assert rows[0]["candidate_id"] == legacy and rows[0]["decision_reason"] is None


async def test_a_standard_user_never_reads_the_reason_from_the_candidate(client, admin_headers, standard_headers, seed, sent_mail):
    cid = await seed.candidate()
    await decide(client, admin_headers, cid, decision="reject", reason="withdrew")
    as_admin = await client.get(f"/api/v1/candidates/{cid}", headers=admin_headers)
    assert as_admin.json()["decision_reason"] == "withdrew"
    as_standard = await client.get(f"/api/v1/candidates/{cid}", headers=standard_headers)
    assert as_standard.status_code == 200 and "decision_reason" not in as_standard.json()
