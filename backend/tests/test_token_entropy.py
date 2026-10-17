import re
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from config.database import get_db
from shared.utils import new_secure_token

pytestmark = pytest.mark.anyio

API = "/api/v1"
TOKEN_RE = re.compile(r"^tok_[0-9a-f]{32}$")


async def test_a_new_token_is_tok_plus_128_bits_of_hex_and_never_repeats():
    tokens = {new_secure_token() for _ in range(2000)}
    assert len(tokens) == 2000
    assert all(TOKEN_RE.match(t) for t in tokens)


async def test_no_source_file_mints_a_short_token_any_more():
    root = Path(__file__).resolve().parent.parent
    pattern = re.compile(r"uuid\.uuid4\(\)\.hex\[:\d+\]")
    offenders = []
    for folder in ("routes", "services", "agents", "shared", "config"):
        for path in (root / folder).rglob("*.py"):
            for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
                if pattern.search(line) and ("tok_" in line or "token" in line.lower()):
                    offenders.append(f"{path.relative_to(root)}:{number}: {line.strip()}")
    assert not offenders, "\n".join(offenders)


async def _job(client, admin_headers) -> str:
    resp = await client.post(
        f"{API}/jobs", headers=admin_headers,
        json={"title": f"Entropy {uuid.uuid4().hex[:6]}", "description": "Build things for entropy tests."},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["job_id"]


async def test_manual_invite_and_regenerate_issue_full_length_tokens(client, admin_headers):
    db = get_db()
    job_id = await _job(client, admin_headers)
    email = f"entropy.{uuid.uuid4().hex[:8]}@example.com"
    try:
        created = await client.post(f"{API}/candidates", headers=admin_headers, json={"job_id": job_id, "name": "E", "email": email})
        assert created.status_code == 200, created.text
        body = created.json()
        assert TOKEN_RE.match(body["secure_token"]) and body["interview_url"].endswith(body["secure_token"])
        regen = await client.post(
            f"{API}/candidates/{body['candidate_id']}/regenerate-token", headers=admin_headers, json={"resend": False},
        )
        assert regen.status_code == 200
        new = regen.json()["secure_token"]
        assert TOKEN_RE.match(new) and new != body["secure_token"]
        stored = await db.candidates.find_one({"candidate_id": body["candidate_id"]})
        assert stored["secure_token"] == new
        assert (await client.get(f"{API}/interview/session/{body['secure_token']}")).status_code == 404
    finally:
        await db.candidates.delete_many({"email": email})
        await db.jobs.delete_one({"job_id": job_id})
        await db.audit_log.delete_many({"resource_id": job_id})


async def test_an_external_interview_candidate_gets_a_full_length_token(client, admin_headers):
    db = get_db()
    job_id = await _job(client, admin_headers)
    email = f"ext.{uuid.uuid4().hex[:8]}@example.com"
    try:
        start = (datetime.now(timezone.utc) + timedelta(days=3)).isoformat()
        resp = await client.post(
            f"{API}/candidates/external-interview", headers=admin_headers,
            json={"job_id": job_id, "name": "X", "email": email, "platform": "other", "platform_label": "Phone",
                  "join_url": "https://meet.example.com/room", "scheduled_start_at": start, "send_email": False},
        )
        assert resp.status_code == 200, resp.text
        stored = await db.candidates.find_one({"candidate_id": resp.json()["candidate_id"]})
        assert TOKEN_RE.match(stored["secure_token"])
    finally:
        await db.candidates.delete_many({"email": email})
        await db.jobs.delete_one({"job_id": job_id})
        await db.audit_log.delete_many({"resource_id": job_id})


async def test_an_offer_gets_a_full_length_token(client, admin_headers):
    db = get_db()
    job_id = await _job(client, admin_headers)
    email = f"offer.{uuid.uuid4().hex[:8]}@example.com"
    try:
        cand = (await client.post(f"{API}/candidates", headers=admin_headers, json={"job_id": job_id, "name": "O", "email": email})).json()
        offer = await client.post(f"{API}/offers", headers=admin_headers, json={"candidate_id": cand["candidate_id"], "salary": "1"})
        assert offer.status_code == 200, offer.text
        assert TOKEN_RE.match(offer.json()["secure_token"])
    finally:
        await db.offers.delete_many({"job_id": job_id})
        await db.candidates.delete_many({"email": email})
        await db.jobs.delete_one({"job_id": job_id})
        await db.audit_log.delete_many({"resource_id": job_id})


async def test_an_auto_invite_gets_a_full_length_token(monkeypatch):
    from services.hr_module import email_service, invite_service

    db = get_db()
    job_id = f"job-entropy-{uuid.uuid4().hex[:8]}"
    email = f"auto.{uuid.uuid4().hex[:8]}@example.com"
    await db.jobs.insert_one({"doc_type": "job", "job_id": job_id, "title": "T", "description": "d", "candidate_pipeline": []})

    async def _no_mail(**kwargs):
        return True

    async def _no_questions(token):
        return None

    monkeypatch.setattr(email_service, "send_invite_email", _no_mail)
    monkeypatch.setattr(invite_service, "_prepare_interview_questions", _no_questions)
    try:
        candidate_id = await invite_service._create_and_invite(
            db=db, job_id=job_id, resume_id=f"res-{uuid.uuid4().hex[:6]}", score=0.9,
            candidate_email=email, candidate_name="A", invite_type="auto",
        )
        assert candidate_id
        stored = await db.candidates.find_one({"candidate_id": candidate_id})
        assert TOKEN_RE.match(stored["secure_token"])
    finally:
        await db.candidates.delete_many({"email": email})
        await db.candidate_profiles.delete_many({"email": email})
        await db.jobs.delete_one({"job_id": job_id})


async def test_a_performance_review_link_gets_a_full_length_token():
    from services.hr_module import performance_service

    db = get_db()
    tag = uuid.uuid4().hex[:8]
    cycle_id, employee_id = f"cyc-{tag}", f"emp-{tag}"
    await db.performance_cycles.insert_one({"cycle_id": cycle_id, "name": "C", "status": "active", "review_types": ["self"]})
    await db.employees.insert_one({"employee_id": employee_id, "candidate_id": f"cand-{tag}", "status": "active"})
    try:
        review = await performance_service.create_token_review(
            db, cycle_id=cycle_id, employee_id=employee_id, reviewer_type="self", reviewer_employee_id=None,
        )
        assert TOKEN_RE.match(review["secure_token"])
    finally:
        await db.performance_reviews.delete_many({"cycle_id": cycle_id})
        await db.performance_cycles.delete_one({"cycle_id": cycle_id})
        await db.employees.delete_one({"employee_id": employee_id})


async def test_a_link_issued_before_the_change_still_opens(client, admin_headers):
    db = get_db()
    tag = uuid.uuid4().hex[:8]
    job_id, cand_id = f"job-old-{tag}", f"cand-old-{tag}"
    old_token = f"tok_{uuid.uuid4().hex[:12]}"
    offer_token = f"tok_{uuid.uuid4().hex[:12]}"
    assert len(old_token) == 16
    now = datetime.now(timezone.utc).isoformat()
    await db.jobs.insert_one({"doc_type": "job", "job_id": job_id, "title": "Old Link Job", "description": "d"})
    await db.candidates.insert_one({
        "doc_type": "candidate", "candidate_id": cand_id, "job_id": job_id, "name": "Old", "email": f"old.{tag}@example.com",
        "secure_token": old_token, "token_status": "active", "status": "invited", "invite_sent_at": now,
        "invite_expires_at": (datetime.now(timezone.utc) + timedelta(days=3)).isoformat(),
        "_questions": ["One question?"], "report": {"summary": "s"}, "report_status": "ready", "created_at": now,
    })
    await db.offers.insert_one({
        "doc_type": "offer", "offer_id": f"off-old-{tag}", "candidate_id": cand_id, "job_id": job_id,
        "salary": "1", "status": "sent", "secure_token": offer_token, "created_at": now,
    })
    try:
        session = await client.get(f"{API}/interview/session/{old_token}")
        assert session.status_code == 200 and session.json()["questions"] == ["One question?"]
        report = await client.get(f"{API}/interview/report/{old_token}", headers=admin_headers)
        assert report.status_code == 200
        offer = await client.get(f"{API}/offers/public/{offer_token}")
        assert offer.status_code == 200 and offer.json()["salary"] == "1"
    finally:
        await db.candidates.delete_one({"candidate_id": cand_id})
        await db.offers.delete_many({"candidate_id": cand_id})
        await db.jobs.delete_one({"job_id": job_id})
