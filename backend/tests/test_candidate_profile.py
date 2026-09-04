"""Tests for the candidate master profile (MVP2 §2.5) + candidate department
scoping and audit logging (MVP2 §2.1) — routes/candidates.py +
services/hr_module/candidate_profile_service.py.

Cleanup convention: every test declares its job_id(s)/email(s) up front
(before any network/DB call) and cleans up keyed off those pre-declared
values in a `finally` block that wraps the entire body — never keyed off a
candidate_id/profile_id that only exists if creation actually succeeded, so
a failed assertion mid-test still leaves the shared test database clean.
"""
import asyncio
import uuid
from datetime import datetime, timezone

import pytest
from passlib.context import CryptContext

from config.database import get_db

pytestmark = pytest.mark.anyio

pwd_ctx = CryptContext(schemes=["bcrypt"])

JOB_PAYLOAD = {
    "title": "Backend Engineer",
    "description": "Build APIs and services.",
    "difficulty": "mid",
    "employment_type": "full-time",
    "location": "Remote",
    "salary_min": 90000,
    "salary_max": 130000,
    "is_remote": True,
    "company_name": "Test Corp",
}


async def _create_job(client, headers, **overrides):
    payload = {**JOB_PAYLOAD, **overrides}
    response = await client.post("/api/v1/jobs", json=payload, headers=headers)
    assert response.status_code == 200
    return response.json()["job_id"]


async def _create_candidate(client, headers, job_id, name, email):
    response = await client.post(
        "/api/v1/candidates",
        json={"job_id": job_id, "name": name, "email": email},
        headers=headers,
    )
    assert response.status_code == 200
    return response.json()


async def _cleanup(db, *, job_ids=(), emails=()):
    job_ids = [j for j in job_ids if j]
    emails = [e for e in emails if e]
    if job_ids:
        await db.candidates.delete_many({"job_id": {"$in": job_ids}})
        await db.jobs.delete_many({"job_id": {"$in": job_ids}})
    if emails:
        await db.candidate_profiles.delete_many({"email": {"$in": emails}})


async def test_two_invites_same_email_share_one_profile(client, admin_headers):
    db = get_db()
    assert db is not None

    job1 = f"job-{uuid.uuid4().hex[:8]}"
    job2 = f"job-{uuid.uuid4().hex[:8]}"
    email = f"shared-{uuid.uuid4().hex[:8]}@example.com"

    try:
        job1 = await _create_job(client, admin_headers, title="Job One")
        job2 = await _create_job(client, admin_headers, title="Job Two")

        created1 = await _create_candidate(client, admin_headers, job1, "Shared Person", email)
        created2 = await _create_candidate(client, admin_headers, job2, "Shared Person", email)
        cand1, cand2 = created1["candidate_id"], created2["candidate_id"]

        profiles = await db.candidate_profiles.find({"email": email}).to_list(length=10)
        assert len(profiles) == 1
        profile = profiles[0]
        assert set(profile["candidate_ids"]) == {cand1, cand2}
        assert set(profile["job_ids"]) == {job1, job2}
        assert profile["name"] == "Shared Person"

        by_email = await client.get(
            f"/api/v1/candidates/profile/by-email/{email}", headers=admin_headers
        )
        assert by_email.status_code == 200
        data = by_email.json()
        assert data["profile_id"] == profile["profile_id"]
        linked_ids = {c["candidate_id"] for c in data["linked_candidates"]}
        assert linked_ids == {cand1, cand2}
        job_titles = {c["job_title"] for c in data["linked_candidates"]}
        assert job_titles == {"Job One", "Job Two"}

        by_id = await client.get(
            f"/api/v1/candidates/profile/{profile['profile_id']}", headers=admin_headers
        )
        assert by_id.status_code == 200
        assert by_id.json()["profile_id"] == profile["profile_id"]
    finally:
        await _cleanup(db, job_ids=[job1, job2], emails=[email])


async def test_auto_invite_path_also_upserts_profile(client, admin_headers):
    """services/hr_module/invite_service.py's _create_and_invite (auto-match
    path) must also roll its candidate doc up into candidate_profiles."""
    from services.hr_module.invite_service import _create_and_invite

    db = get_db()
    assert db is not None
    job_id = f"job-{uuid.uuid4().hex[:8]}"
    email = f"auto-{uuid.uuid4().hex[:8]}@example.com"

    try:
        job_id = await _create_job(client, admin_headers, title="Auto Match Job")

        candidate_id = await _create_and_invite(
            db=db, job_id=job_id, resume_id=f"resume-{uuid.uuid4().hex[:8]}",
            score=0.91, candidate_email=email, candidate_name="Auto Person",
            invite_type="auto",
        )
        assert candidate_id is not None

        profile = await db.candidate_profiles.find_one({"email": email})
        assert profile is not None
        assert candidate_id in profile["candidate_ids"]
        assert job_id in profile["job_ids"]
    finally:
        await _cleanup(db, job_ids=[job_id], emails=[email])


async def test_profile_notes_round_trip(client, admin_headers, standard_headers):
    db = get_db()
    job_id = f"job-{uuid.uuid4().hex[:8]}"
    email = f"notes-{uuid.uuid4().hex[:8]}@example.com"

    try:
        job_id = await _create_job(client, admin_headers)
        created = await _create_candidate(client, admin_headers, job_id, "Notes Person", email)
        cand_id = created["candidate_id"]

        profile = await db.candidate_profiles.find_one({"email": email})
        assert profile is not None
        profile_id = profile["profile_id"]
        assert profile.get("profile_notes") is None

        forbidden = await client.patch(
            f"/api/v1/candidates/profile/{profile_id}/notes",
            json={"notes": "should not land"},
            headers=standard_headers,
        )
        assert forbidden.status_code == 403

        patch_resp = await client.patch(
            f"/api/v1/candidates/profile/{profile_id}/notes",
            json={"notes": "Strong communicator, worth revisiting for future roles."},
            headers=admin_headers,
        )
        assert patch_resp.status_code == 200
        assert patch_resp.json()["profile_notes"] == "Strong communicator, worth revisiting for future roles."

        get_resp = await client.get(
            f"/api/v1/candidates/profile/{profile_id}", headers=admin_headers
        )
        assert get_resp.status_code == 200
        assert get_resp.json()["profile_notes"] == "Strong communicator, worth revisiting for future roles."

        cand_doc = await db.candidates.find_one({"candidate_id": cand_id})
        assert cand_doc.get("recruiter_notes") is None
    finally:
        await _cleanup(db, job_ids=[job_id], emails=[email])


async def test_profile_by_email_404_for_unknown(client, admin_headers):
    unknown_email = f"nobody-{uuid.uuid4().hex[:8]}@example.com"
    resp = await client.get(
        f"/api/v1/candidates/profile/by-email/{unknown_email}", headers=admin_headers
    )
    assert resp.status_code == 404
    assert "profile" in resp.json()["detail"].lower()


async def test_profile_by_id_404_for_unknown(client, admin_headers):
    resp = await client.get(
        f"/api/v1/candidates/profile/{uuid.uuid4()}", headers=admin_headers
    )
    assert resp.status_code == 404
    assert "profile" in resp.json()["detail"].lower()


async def test_profile_route_not_shadowed_by_candidate_id_catch_all(client, admin_headers):
    """GET /candidates/profile/{x} and /candidates/profile/by-email/{x} must
    resolve to the profile handlers, not be swallowed by the
    '/{candidate_id}' catch-all (which would 404 with 'Candidate not found'
    instead of 'Candidate profile not found')."""
    resp = await client.get(
        f"/api/v1/candidates/profile/{uuid.uuid4()}", headers=admin_headers
    )
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Candidate profile not found"


async def test_create_candidate_is_audit_logged(client, admin_headers):
    db = get_db()
    job_id = f"job-{uuid.uuid4().hex[:8]}"
    email = f"audit-invite-{uuid.uuid4().hex[:8]}@example.com"
    cand_id = None

    try:
        job_id = await _create_job(client, admin_headers)
        created = await _create_candidate(client, admin_headers, job_id, "Audit Person", email)
        cand_id = created["candidate_id"]

        await asyncio.sleep(0.3)
        entry = await db.audit_log.find_one({"action": "candidate_invited", "resource_id": cand_id})
        assert entry is not None
        assert entry["actor_email"] == "demo-admin@hirely.ai"
        assert entry["details"]["email"] == email
    finally:
        if cand_id:
            await db.audit_log.delete_many({"resource_id": cand_id})
        await _cleanup(db, job_ids=[job_id], emails=[email])


async def test_decision_is_audit_logged(client, admin_headers):
    db = get_db()
    job_id = f"job-{uuid.uuid4().hex[:8]}"
    email = f"audit-decision-{uuid.uuid4().hex[:8]}@example.com"
    cand_id = None

    try:
        job_id = await _create_job(client, admin_headers)
        created = await _create_candidate(client, admin_headers, job_id, "Decision Person", email)
        cand_id = created["candidate_id"]

        resp = await client.post(
            f"/api/v1/candidates/{cand_id}/decision",
            json={"decision": "hold", "notes": "Keep warm"},
            headers=admin_headers,
        )
        assert resp.status_code == 200

        await asyncio.sleep(0.3)
        entry = await db.audit_log.find_one({"action": "candidate_decision", "resource_id": cand_id})
        assert entry is not None
        assert entry["details"]["decision"] == "hold"
    finally:
        if cand_id:
            await db.audit_log.delete_many({"resource_id": cand_id})
        await _cleanup(db, job_ids=[job_id], emails=[email])


async def test_notes_update_is_audit_logged(client, admin_headers):
    db = get_db()
    job_id = f"job-{uuid.uuid4().hex[:8]}"
    email = f"audit-notes-{uuid.uuid4().hex[:8]}@example.com"
    cand_id = None

    try:
        job_id = await _create_job(client, admin_headers)
        created = await _create_candidate(client, admin_headers, job_id, "Notes Audit Person", email)
        cand_id = created["candidate_id"]

        resp = await client.patch(
            f"/api/v1/candidates/{cand_id}/notes",
            json={"notes": "Follow up next week"},
            headers=admin_headers,
        )
        assert resp.status_code == 200

        await asyncio.sleep(0.3)
        entry = await db.audit_log.find_one({"action": "candidate_notes_updated", "resource_id": cand_id})
        assert entry is not None
        assert entry["details"]["notes"] == "Follow up next week"
    finally:
        if cand_id:
            await db.audit_log.delete_many({"resource_id": cand_id})
        await _cleanup(db, job_ids=[job_id], emails=[email])


async def test_department_scoped_user_only_sees_own_department_candidates(client, admin_headers):
    db = get_db()
    assert db is not None

    dept_a = f"dept-a-{uuid.uuid4().hex[:8]}"
    dept_b = f"dept-b-{uuid.uuid4().hex[:8]}"
    job_a_id = f"job-a-{uuid.uuid4().hex[:8]}"
    job_b_id = f"job-b-{uuid.uuid4().hex[:8]}"
    email_a = f"dept-a-cand-{uuid.uuid4().hex[:8]}@example.com"
    email_b = f"dept-b-cand-{uuid.uuid4().hex[:8]}@example.com"
    scoped_email = f"scoped-user-{uuid.uuid4().hex[:8]}@hirely.ai"
    scoped_password = "Scoped@12345"

    try:
        now = datetime.now(timezone.utc).isoformat()
        await db.jobs.insert_many([
            {"job_id": job_a_id, "title": "Dept A Job", "department_id": dept_a,
             "created_at": now, "candidate_pipeline": []},
            {"job_id": job_b_id, "title": "Dept B Job", "department_id": dept_b,
             "created_at": now, "candidate_pipeline": []},
        ])

        created_a = await _create_candidate(client, admin_headers, job_a_id, "Dept A Candidate", email_a)
        created_b = await _create_candidate(client, admin_headers, job_b_id, "Dept B Candidate", email_b)
        cand_a_id, cand_b_id = created_a["candidate_id"], created_b["candidate_id"]

        await db.users.insert_one({
            "name": "Scoped Standard User",
            "email": scoped_email,
            "password_hash": pwd_ctx.hash(scoped_password),
            "role": "standard",
            "department_id": dept_a,
            "otp_required": False,
            "is_active": True,
        })

        login_resp = await client.post(
            "/api/v1/auth/login", json={"email": scoped_email, "password": scoped_password}
        )
        assert login_resp.status_code == 200
        scoped_token = login_resp.json()["access_token"]
        scoped_headers = {"Authorization": f"Bearer {scoped_token}"}

        scoped_list = await client.get("/api/v1/candidates", headers=scoped_headers)
        assert scoped_list.status_code == 200
        scoped_ids = {c["candidate_id"] for c in scoped_list.json()["candidates"]}
        assert cand_a_id in scoped_ids
        assert cand_b_id not in scoped_ids

        scoped_filtered = await client.get(
            "/api/v1/candidates", params={"job_id": job_b_id}, headers=scoped_headers
        )
        assert scoped_filtered.status_code == 200
        assert scoped_filtered.json()["candidates"] == []

        admin_list = await client.get("/api/v1/candidates", headers=admin_headers)
        assert admin_list.status_code == 200
        admin_ids = {c["candidate_id"] for c in admin_list.json()["candidates"]}
        assert cand_a_id in admin_ids
        assert cand_b_id in admin_ids
    finally:
        await db.users.delete_one({"email": scoped_email})
        await _cleanup(db, job_ids=[job_a_id, job_b_id], emails=[email_a, email_b])
