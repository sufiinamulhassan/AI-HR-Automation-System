import uuid
from datetime import datetime, timedelta, timezone

import pytest

from config.database import get_db
from services.hr_module.permissions import DEFAULT_ROLE_PERMISSIONS

pytestmark = pytest.mark.anyio

REPORT = {
    "overall_score": 82,
    "final_score": 79,
    "recommendation": "hire",
    "summary": "Strong technical answers, clear communicator.",
    "strengths": ["Clean problem decomposition"],
    "areas_for_improvement": ["Could go deeper on system design tradeoffs"],
    "integrity_score": 94,
    "integrity_assessment": "No integrity flags to report.",
    "evaluation_status": None,
    "score_breakdown": {
        "dimensions": [
            {"name": "technical", "score": 85, "weight": 0.30, "rationale": "Cited a specific caching bug fix."},
            {"name": "communication", "score": 80, "weight": 0.20, "rationale": "Answers were concise and structured."},
        ],
        "integrity_deductions": [],
        "integrity_multiplier": 0.976,
        "final_score": 79,
    },
}

RESUME_TEXT = "CONFIDENTIAL RESUME TEXT, SHOULD NEVER APPEAR IN A SHARED REPORT"
TRANSCRIPT = [{"question": "Tell me about yourself.", "answer": "SECRET_TRANSCRIPT_MARKER"}]


async def _insert_shareable_candidate(db, **overrides) -> dict:
    job_id = f"job-{uuid.uuid4().hex[:10]}"
    await db.jobs.insert_one({"job_id": job_id, "title": "Backend Engineer"})

    token = f"tok_{uuid.uuid4().hex[:12]}"
    candidate_id = str(uuid.uuid4())
    doc = {
        "doc_type": "candidate",
        "candidate_id": candidate_id,
        "job_id": job_id,
        "secure_token": token,
        "name": "Jordan Share Test",
        "email": "jordan.sharetest@example.com",
        "phone": "+1-555-0100",
        "resume_text": RESUME_TEXT,
        "status": "completed",
        "report_status": "ready",
        "report_error": None,
        "report": dict(REPORT),
        "final_score": REPORT["final_score"],
        "transcript": TRANSCRIPT,
        "integrity_flags": ["tab_switch@t1", "tab_switch@t2"],
        "interview_started_at": datetime.now(timezone.utc).isoformat(),
        "interview_ended_at": datetime.now(timezone.utc).isoformat(),
    }
    doc.update(overrides)
    await db.candidates.insert_one(doc)
    return {"candidate_id": candidate_id, "job_id": job_id, "secure_token": token}


async def test_create_share_requires_admin(client, standard_headers):
    db = get_db()
    cand = await _insert_shareable_candidate(db)

    resp = await client.post(
        f"/api/v1/interview/report/{cand['secure_token']}/share",
        json={}, headers=standard_headers,
    )
    assert resp.status_code == 403


async def test_create_share_checked_even_for_admin_role(client, admin_headers):
    db = get_db()
    cand = await _insert_shareable_candidate(db)

    await db.roles.insert_one({
        "role_name": "admin",
        "permissions": [p for p in DEFAULT_ROLE_PERMISSIONS["admin"] if p != "interview:share_report"],
    })
    try:
        resp = await client.post(
            f"/api/v1/interview/report/{cand['secure_token']}/share",
            json={}, headers=admin_headers,
        )
        assert resp.status_code == 403
    finally:
        await db.roles.delete_one({"role_name": "admin"})


async def test_create_share_requires_report_to_be_ready(client, admin_headers):
    db = get_db()
    cand = await _insert_shareable_candidate(db, report_status="failed", report=None)

    resp = await client.post(
        f"/api/v1/interview/report/{cand['secure_token']}/share",
        json={}, headers=admin_headers,
    )
    assert resp.status_code == 400


async def test_create_share_unknown_token_404(client, admin_headers):
    resp = await client.post(
        "/api/v1/interview/report/tok_nonexistent/share",
        json={}, headers=admin_headers,
    )
    assert resp.status_code == 404


async def test_create_share_succeeds_for_admin_and_returns_raw_token_once(client, admin_headers):
    db = get_db()
    cand = await _insert_shareable_candidate(db)

    resp = await client.post(
        f"/api/v1/interview/report/{cand['secure_token']}/share",
        json={"expires_in_days": 3}, headers=admin_headers,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["candidate_id"] == cand["candidate_id"]
    assert body["job_id"] == cand["job_id"]
    assert body["view_count"] == 0
    assert body["token"]
    assert body["token"] in body["share_url"]

    stored = await db.report_shares.find_one({"share_id": body["share_id"]})
    assert stored["token_hash"] != body["token"]
    assert "token" not in stored


async def test_list_shares_requires_admin_permission(client, standard_headers, admin_headers):
    db = get_db()
    cand = await _insert_shareable_candidate(db)
    create_resp = await client.post(
        f"/api/v1/interview/report/{cand['secure_token']}/share", json={}, headers=admin_headers,
    )
    assert create_resp.status_code == 200

    resp = await client.get(
        f"/api/v1/interview/report/{cand['secure_token']}/shares", headers=standard_headers,
    )
    assert resp.status_code == 403

    resp = await client.get(
        f"/api/v1/interview/report/{cand['secure_token']}/shares", headers=admin_headers,
    )
    assert resp.status_code == 200
    shares = resp.json()["shares"]
    assert len(shares) == 1
    assert shares[0]["share_id"] == create_resp.json()["share_id"]
    assert shares[0]["active"] is True
    assert "token_hash" not in shares[0]


async def test_shared_report_unknown_token_404(client):
    resp = await client.get("/api/v1/interview/shared-report/not-a-real-token")
    assert resp.status_code == 404


async def test_shared_report_view_increments_view_count(client, admin_headers):
    db = get_db()
    cand = await _insert_shareable_candidate(db)
    create_resp = await client.post(
        f"/api/v1/interview/report/{cand['secure_token']}/share", json={}, headers=admin_headers,
    )
    token = create_resp.json()["token"]
    share_id = create_resp.json()["share_id"]

    first = await client.get(f"/api/v1/interview/shared-report/{token}")
    assert first.status_code == 200
    assert first.json()["view_count"] == 1

    second = await client.get(f"/api/v1/interview/shared-report/{token}")
    assert second.status_code == 200
    assert second.json()["view_count"] == 2

    stored = await db.report_shares.find_one({"share_id": share_id})
    assert stored["view_count"] == 2
    assert stored["last_viewed_at"]


async def test_shared_report_rejects_revoked_link(client, admin_headers):
    db = get_db()
    cand = await _insert_shareable_candidate(db)
    create_resp = await client.post(
        f"/api/v1/interview/report/{cand['secure_token']}/share", json={}, headers=admin_headers,
    )
    token = create_resp.json()["token"]
    share_id = create_resp.json()["share_id"]

    revoke_resp = await client.post(
        f"/api/v1/interview/report/shares/{share_id}/revoke", headers=admin_headers,
    )
    assert revoke_resp.status_code == 200
    assert revoke_resp.json()["revoked"] is True

    resp = await client.get(f"/api/v1/interview/shared-report/{token}")
    assert resp.status_code == 404


async def test_revoke_requires_admin_permission(client, standard_headers, admin_headers):
    db = get_db()
    cand = await _insert_shareable_candidate(db)
    create_resp = await client.post(
        f"/api/v1/interview/report/{cand['secure_token']}/share", json={}, headers=admin_headers,
    )
    share_id = create_resp.json()["share_id"]

    resp = await client.post(
        f"/api/v1/interview/report/shares/{share_id}/revoke", headers=standard_headers,
    )
    assert resp.status_code == 403


async def test_revoke_unknown_share_404(client, admin_headers):
    resp = await client.post(
        "/api/v1/interview/report/shares/does-not-exist/revoke", headers=admin_headers,
    )
    assert resp.status_code == 404


async def test_shared_report_rejects_expired_link(client):
    from shared.utils import sha256_hex

    db = get_db()
    cand = await _insert_shareable_candidate(db)
    token = f"expired-{uuid.uuid4().hex}"
    expired_at = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    await db.report_shares.insert_one({
        "share_id": uuid.uuid4().hex,
        "token_hash": sha256_hex(token.encode("utf-8")),
        "candidate_id": cand["candidate_id"],
        "job_id": cand["job_id"],
        "created_by": "admin@hirely.ai",
        "created_at": (datetime.now(timezone.utc) - timedelta(days=10)).isoformat(),
        "expires_at": expired_at,
        "revoked": False,
        "revoked_at": None,
        "revoked_by": None,
        "view_count": 0,
        "last_viewed_at": None,
        "feedback": [],
    })

    resp = await client.get(f"/api/v1/interview/shared-report/{token}")
    assert resp.status_code == 410


async def test_shared_report_excludes_resume_transcript_and_contact_info(client, admin_headers):
    db = get_db()
    cand = await _insert_shareable_candidate(db)
    create_resp = await client.post(
        f"/api/v1/interview/report/{cand['secure_token']}/share", json={}, headers=admin_headers,
    )
    token = create_resp.json()["token"]

    resp = await client.get(f"/api/v1/interview/shared-report/{token}")
    assert resp.status_code == 200
    body = resp.json()
    raw = resp.text

    assert body["candidate_name"] == "Jordan Share Test"
    assert body["job_title"] == "Backend Engineer"
    assert body["overall_score"] == REPORT["overall_score"]
    assert body["final_score"] == REPORT["final_score"]
    assert body["recommendation"] == "hire"
    assert body["dimensions"][0]["label"] == "Technical"

    assert "resume_text" not in body
    assert "transcript" not in body
    assert "email" not in body
    assert "phone" not in body
    assert "candidate_id" not in body
    assert "secure_token" not in body
    assert RESUME_TEXT not in raw
    assert "SECRET_TRANSCRIPT_MARKER" not in raw
    assert cand["secure_token"] not in raw
    assert "jordan.sharetest@example.com" not in raw
    assert "+1-555-0100" not in raw

    assert body["integrity"]["events"] == [{"event": "tab_switch", "count": 2}]


async def test_feedback_submission_is_visible_to_admin(client, admin_headers):
    db = get_db()
    cand = await _insert_shareable_candidate(db)
    create_resp = await client.post(
        f"/api/v1/interview/report/{cand['secure_token']}/share", json={}, headers=admin_headers,
    )
    token = create_resp.json()["token"]
    share_id = create_resp.json()["share_id"]

    resp = await client.post(
        f"/api/v1/interview/shared-report/{token}/feedback",
        json={"reviewer_name": "Pat the Hiring Manager", "rating": 4, "comment": "Would move forward."},
    )
    assert resp.status_code == 200
    assert resp.json()["recorded"] is True

    list_resp = await client.get(
        f"/api/v1/interview/report/{cand['secure_token']}/shares", headers=admin_headers,
    )
    shares = list_resp.json()["shares"]
    matching = next(s for s in shares if s["share_id"] == share_id)
    assert len(matching["feedback"]) == 1
    assert matching["feedback"][0]["reviewer_name"] == "Pat the Hiring Manager"
    assert matching["feedback"][0]["rating"] == 4
    assert matching["feedback"][0]["comment"] == "Would move forward."

    view_resp = await client.get(f"/api/v1/interview/shared-report/{token}")
    assert len(view_resp.json()["feedback"]) == 1


async def test_feedback_does_not_increment_view_count(client, admin_headers):
    db = get_db()
    cand = await _insert_shareable_candidate(db)
    create_resp = await client.post(
        f"/api/v1/interview/report/{cand['secure_token']}/share", json={}, headers=admin_headers,
    )
    token = create_resp.json()["token"]
    share_id = create_resp.json()["share_id"]

    feedback_resp = await client.post(
        f"/api/v1/interview/shared-report/{token}/feedback",
        json={"comment": "Solid candidate."},
    )
    assert feedback_resp.status_code == 200

    stored = await db.report_shares.find_one({"share_id": share_id})
    assert stored["view_count"] == 0


async def test_feedback_rejects_empty_comment(client, admin_headers):
    db = get_db()
    cand = await _insert_shareable_candidate(db)
    create_resp = await client.post(
        f"/api/v1/interview/report/{cand['secure_token']}/share", json={}, headers=admin_headers,
    )
    token = create_resp.json()["token"]

    resp = await client.post(
        f"/api/v1/interview/shared-report/{token}/feedback",
        json={"comment": "   "},
    )
    assert resp.status_code == 400


async def test_feedback_rejects_out_of_range_rating(client, admin_headers):
    db = get_db()
    cand = await _insert_shareable_candidate(db)
    create_resp = await client.post(
        f"/api/v1/interview/report/{cand['secure_token']}/share", json={}, headers=admin_headers,
    )
    token = create_resp.json()["token"]

    resp = await client.post(
        f"/api/v1/interview/shared-report/{token}/feedback",
        json={"comment": "ok", "rating": 9},
    )
    assert resp.status_code == 422


async def test_feedback_rejects_revoked_link(client, admin_headers):
    db = get_db()
    cand = await _insert_shareable_candidate(db)
    create_resp = await client.post(
        f"/api/v1/interview/report/{cand['secure_token']}/share", json={}, headers=admin_headers,
    )
    token = create_resp.json()["token"]
    share_id = create_resp.json()["share_id"]

    await client.post(f"/api/v1/interview/report/shares/{share_id}/revoke", headers=admin_headers)

    resp = await client.post(
        f"/api/v1/interview/shared-report/{token}/feedback",
        json={"comment": "too late"},
    )
    assert resp.status_code == 404


async def test_share_create_and_revoke_are_audit_logged(client, admin_headers):
    import asyncio

    db = get_db()
    cand = await _insert_shareable_candidate(db)
    create_resp = await client.post(
        f"/api/v1/interview/report/{cand['secure_token']}/share", json={}, headers=admin_headers,
    )
    share_id = create_resp.json()["share_id"]

    create_entry = None
    for _ in range(10):
        create_entry = await db.audit_log.find_one(
            {"action": "report_share_create", "details.share_id": share_id},
        )
        if create_entry:
            break
        await asyncio.sleep(0.2)
    assert create_entry is not None
    assert create_entry["resource_id"] == cand["candidate_id"]

    await client.post(f"/api/v1/interview/report/shares/{share_id}/revoke", headers=admin_headers)

    revoke_entry = None
    for _ in range(10):
        revoke_entry = await db.audit_log.find_one(
            {"action": "report_share_revoke", "details.share_id": share_id},
        )
        if revoke_entry:
            break
        await asyncio.sleep(0.2)
    assert revoke_entry is not None
