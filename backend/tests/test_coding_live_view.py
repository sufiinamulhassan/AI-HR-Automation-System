import uuid

import pytest

from config.database import get_db
from services.hr_module.permissions import DEFAULT_ROLE_PERMISSIONS

pytestmark = pytest.mark.anyio


async def _create_candidate_doc(coding_question_id: str | None = None) -> dict:
    db = get_db()
    token = f"tok_{uuid.uuid4().hex[:12]}"
    doc = {
        "doc_type": "candidate",
        "candidate_id": str(uuid.uuid4()),
        "job_id": None,
        "secure_token": token,
        "name": "Live View Test Candidate",
        "email": f"live-view-test.{uuid.uuid4().hex[:6]}@example.com",
        "status": "invited",
    }
    if coding_question_id:
        doc["coding_question_id"] = coding_question_id
    await db.candidates.insert_one(doc)
    doc.pop("_id", None)
    return doc


async def _create_question_doc() -> str:
    db = get_db()
    question_id = str(uuid.uuid4())
    await db.coding_questions.insert_one({
        "question_id": question_id,
        "title": "Live View Fixture Question",
        "description": "Read two integers from stdin, print their sum.",
        "language_templates": {"python": "a, b = map(int, input().split())\nprint(a + b)\n"},
        "test_cases": [{"input": "2 3", "expected_output": "5", "is_hidden": False}],
        "job_domain": "software_engineering",
        "difficulty": "easy",
        "created_by": "tester@hirely.ai",
        "created_at": "2026-01-01T00:00:00+00:00",
    })
    return question_id


async def _cleanup(question_id: str | None = None, candidate_id: str | None = None):
    db = get_db()
    if question_id:
        await db.coding_questions.delete_one({"question_id": question_id})
        await db.coding_session_state.delete_many({"question_id": question_id})
        await db.coding_submissions.delete_many({"question_id": question_id})
    if candidate_id:
        await db.candidates.delete_one({"candidate_id": candidate_id})


async def test_autosave_invalid_token_404(client):
    response = await client.post(
        "/api/v1/coding/session/tok_nonexistent/autosave",
        json={"language": "python", "code": "print(1)"},
    )
    assert response.status_code == 404


async def test_autosave_without_assigned_question_400(client):
    cand = await _create_candidate_doc()
    try:
        response = await client.post(
            f"/api/v1/coding/session/{cand['secure_token']}/autosave",
            json={"language": "python", "code": "print(1)"},
        )
        assert response.status_code == 400
    finally:
        await _cleanup(candidate_id=cand["candidate_id"])


async def test_autosave_upserts_not_accumulates(client):
    question_id = await _create_question_doc()
    cand = await _create_candidate_doc(coding_question_id=question_id)
    db = get_db()
    try:
        r1 = await client.post(
            f"/api/v1/coding/session/{cand['secure_token']}/autosave",
            json={"language": "python", "code": "print('first draft')"},
        )
        assert r1.status_code == 200
        assert r1.json()["saved"] is True

        r2 = await client.post(
            f"/api/v1/coding/session/{cand['secure_token']}/autosave",
            json={"language": "python", "code": "print('second draft')"},
        )
        assert r2.status_code == 200

        docs = await db.coding_session_state.find(
            {"candidate_id": cand["candidate_id"], "question_id": question_id},
        ).to_list(length=None)
        assert len(docs) == 1
        assert docs[0]["code"] == "print('second draft')"
        assert docs[0]["updated_at"] == r2.json()["updated_at"]
    finally:
        await _cleanup(question_id=question_id, candidate_id=cand["candidate_id"])


async def test_live_view_requires_admin(client, standard_headers):
    response = await client.get(
        "/api/v1/coding/live/some-candidate-id", headers=standard_headers,
    )
    assert response.status_code == 403


async def test_live_view_requires_coding_read_submissions_permission(client, admin_headers):
    db = get_db()
    narrowed = [p for p in DEFAULT_ROLE_PERMISSIONS["admin"] if p != "coding:read_submissions"]
    assert len(narrowed) == len(DEFAULT_ROLE_PERMISSIONS["admin"]) - 1
    await db.roles.insert_one({"role_name": "admin", "permissions": narrowed})
    try:
        response = await client.get(
            "/api/v1/coding/live/some-candidate-id", headers=admin_headers,
        )
        assert response.status_code == 403
        assert "coding:read_submissions" in response.json()["detail"]
    finally:
        await db.roles.delete_one({"role_name": "admin"})


async def test_live_view_unknown_candidate_404(client, admin_headers):
    response = await client.get(
        f"/api/v1/coding/live/does-not-exist-{uuid.uuid4().hex[:8]}", headers=admin_headers,
    )
    assert response.status_code == 404


async def test_live_view_not_assigned_when_no_coding_question(client, admin_headers):
    cand = await _create_candidate_doc()
    try:
        response = await client.get(f"/api/v1/coding/live/{cand['candidate_id']}", headers=admin_headers)
        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "not_assigned"
        assert body["question_id"] is None
        assert body["code"] is None
        assert body["last_saved_at"] is None
    finally:
        await _cleanup(candidate_id=cand["candidate_id"])


async def test_live_view_not_started_when_assigned_but_never_autosaved(client, admin_headers):
    question_id = await _create_question_doc()
    cand = await _create_candidate_doc(coding_question_id=question_id)
    try:
        response = await client.get(f"/api/v1/coding/live/{cand['candidate_id']}", headers=admin_headers)
        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "not_started"
        assert body["question_id"] == question_id
        assert body["question_title"] == "Live View Fixture Question"
        assert body["code"] is None
        assert body["language"] is None
        assert body["last_saved_at"] is None
    finally:
        await _cleanup(question_id=question_id, candidate_id=cand["candidate_id"])


async def test_live_view_in_progress_reflects_latest_autosave(client, admin_headers):
    question_id = await _create_question_doc()
    cand = await _create_candidate_doc(coding_question_id=question_id)
    try:
        await client.post(
            f"/api/v1/coding/session/{cand['secure_token']}/autosave",
            json={"language": "python", "code": "x = 1"},
        )
        save2 = await client.post(
            f"/api/v1/coding/session/{cand['secure_token']}/autosave",
            json={"language": "python", "code": "x = 1\ny = 2\nprint(x + y)"},
        )
        assert save2.status_code == 200

        response = await client.get(f"/api/v1/coding/live/{cand['candidate_id']}", headers=admin_headers)
        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "in_progress"
        assert body["question_id"] == question_id
        assert body["language"] == "python"
        assert body["code"] == "x = 1\ny = 2\nprint(x + y)"
        assert body["last_saved_at"] == save2.json()["updated_at"]
    finally:
        await _cleanup(question_id=question_id, candidate_id=cand["candidate_id"])


async def test_live_view_submitted_when_a_submission_already_exists(client, admin_headers):
    question_id = await _create_question_doc()
    cand = await _create_candidate_doc(coding_question_id=question_id)
    db = get_db()
    submission_id = str(uuid.uuid4())
    try:
        await client.post(
            f"/api/v1/coding/session/{cand['secure_token']}/autosave",
            json={"language": "python", "code": "a, b = map(int, input().split())"},
        )
        await db.coding_submissions.insert_one({
            "submission_id": submission_id,
            "candidate_id": cand["candidate_id"],
            "question_id": question_id,
            "language": "python",
            "code": "a, b = map(int, input().split())\nprint(a + b)",
            "status": "completed",
            "results": [],
            "score": 100.0,
            "submitted_at": "2026-01-01T00:00:00+00:00",
            "evaluated_at": "2026-01-01T00:00:00+00:00",
        })

        response = await client.get(f"/api/v1/coding/live/{cand['candidate_id']}", headers=admin_headers)
        assert response.status_code == 200
        assert response.json()["status"] == "submitted"
    finally:
        await db.coding_submissions.delete_one({"submission_id": submission_id})
        await _cleanup(question_id=question_id, candidate_id=cand["candidate_id"])
