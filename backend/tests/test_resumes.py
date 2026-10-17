import uuid
import pytest
from datetime import datetime, timedelta, timezone
from io import BytesIO

from config.database import get_db
from routes.auth import _make_token

pytestmark = pytest.mark.anyio


def _rid() -> str:
    return f"t-{uuid.uuid4()}"


async def _seed_resume(resume_id: str, *, status: str = "processed", age: timedelta = timedelta(0), **extra):
    db = get_db()
    await db.resumes.insert_one({
        "resume_id": resume_id,
        "filename": f"{resume_id}.pdf",
        "candidate_name": "Test Person",
        "processing_status": status,
        "created_at": (datetime.now(timezone.utc) - age).isoformat(),
        **extra,
    })
    await db.resume_files.insert_one({"resume_id": resume_id, "filename": f"{resume_id}.pdf", "data": b"x"})


async def _bearer(email: str) -> str:
    return f"Bearer {await _make_token(email)}"


async def test_upload_resume_requires_admin(client):
    headers = {"Authorization": await _bearer("user@hirely.ai")}
    file_content = b"Mock resume content"
    files = {"file": ("resume.pdf", BytesIO(file_content), "application/pdf")}

    response = await client.post("/api/v1/resumes/upload", files=files, headers=headers)
    assert response.status_code == 403
    assert "Admin access required" in response.json()["detail"]


async def test_upload_resume_success_and_lifecycle(client):
    headers = {"Authorization": await _bearer("hradmin@hirely.ai")}
    file_content = b"Mock resume content for admin upload"
    files = {"file": ("test_resume.pdf", BytesIO(file_content), "application/pdf")}
    data = {"job_id": "optional-job-id-123"}

    response = await client.post("/api/v1/resumes/upload", files=files, data=data, headers=headers)
    assert response.status_code == 200
    res = response.json()
    assert "resume_id" in res
    assert res["status"] == "processing"

    resume_id = res["resume_id"]

    get_headers = {"Authorization": "Bearer demo-standard-token"}
    list_response = await client.get("/api/v1/resumes", headers=get_headers)
    assert list_response.status_code == 200
    list_data = list_response.json()
    assert "resumes" in list_data
    assert any(r["resume_id"] == resume_id for r in list_data["resumes"])

    get_res = await client.get(f"/api/v1/resumes/{resume_id}", headers=get_headers)
    assert get_res.status_code == 200
    assert get_res.json()["filename"] == "test_resume.pdf"

    search_res = await client.get("/api/v1/resumes?search=test_resume", headers=get_headers)
    assert search_res.status_code == 200
    search_data = search_res.json()
    assert any(r["resume_id"] == resume_id for r in search_data["resumes"])

    del_response = await client.delete(f"/api/v1/resumes/{resume_id}", headers=headers)
    assert del_response.status_code == 200

    get_res_after_del = await client.get(f"/api/v1/resumes/{resume_id}", headers=get_headers)
    assert get_res_after_del.status_code == 404

async def test_get_resume_not_found(client):
    headers = {"Authorization": await _bearer("user@hirely.ai")}
    response = await client.get("/api/v1/resumes/non-existent-uuid-12345", headers=headers)
    assert response.status_code == 404
    assert "Resume not found" in response.json()["detail"]


async def test_delete_resume_cascades_to_every_store(client, admin_headers):
    db = get_db()
    a, b = _rid(), _rid()
    await _seed_resume(a, superseded_by=b)
    await _seed_resume(b, previous_resume_id=a)
    job_id = _rid()
    await db.jobs.insert_one({
        "job_id": job_id, "title": "Cascade JD",
        "candidate_pipeline": [{"resume_id": a, "similarity_score": 0.9}, {"resume_id": b, "similarity_score": 0.8}],
    })
    cand_id = _rid()
    await db.candidates.insert_one({"candidate_id": cand_id, "resume_id": a, "job_id": job_id})

    try:
        res = await client.delete(f"/api/v1/resumes/{a}", headers=admin_headers)
        assert res.status_code == 200

        assert await db.resumes.find_one({"resume_id": a}) is None
        assert await db.resume_files.find_one({"resume_id": a}) is None

        job = await db.jobs.find_one({"job_id": job_id})
        assert [p["resume_id"] for p in job["candidate_pipeline"]] == [b]

        survivor = await db.resumes.find_one({"resume_id": b})
        assert survivor["previous_resume_id"] is None

        assert await db.candidates.find_one({"candidate_id": cand_id}) is not None
    finally:
        await db.resumes.delete_many({"resume_id": {"$in": [a, b]}})
        await db.resume_files.delete_many({"resume_id": {"$in": [a, b]}})
        await db.jobs.delete_many({"job_id": job_id})
        await db.candidates.delete_many({"candidate_id": cand_id})


async def test_delete_missing_resume_is_404(client, admin_headers):
    res = await client.delete(f"/api/v1/resumes/{_rid()}", headers=admin_headers)
    assert res.status_code == 404


async def test_delete_refuses_a_live_upload_but_clears_a_stale_one(client, admin_headers):
    db = get_db()
    live, stale = _rid(), _rid()
    await _seed_resume(live, status="pending")
    await _seed_resume(stale, status="pending", age=timedelta(hours=1))
    try:
        res = await client.delete(f"/api/v1/resumes/{live}", headers=admin_headers)
        assert res.status_code == 409
        assert await db.resumes.find_one({"resume_id": live}) is not None

        res = await client.delete(f"/api/v1/resumes/{stale}", headers=admin_headers)
        assert res.status_code == 200
        assert await db.resumes.find_one({"resume_id": stale}) is None
    finally:
        await db.resumes.delete_many({"resume_id": {"$in": [live, stale]}})
        await db.resume_files.delete_many({"resume_id": {"$in": [live, stale]}})


async def test_bulk_delete_splits_deleted_in_progress_and_not_found(client, admin_headers):
    db = get_db()
    ok, live, ghost = _rid(), _rid(), _rid()
    await _seed_resume(ok)
    await _seed_resume(live, status="pending")
    try:
        res = await client.post(
            "/api/v1/resumes/bulk-delete",
            json={"resume_ids": [ok, live, ghost, ok]},
            headers=admin_headers,
        )
        assert res.status_code == 200
        body = res.json()
        assert body["deleted"] == [ok]
        assert body["in_progress"] == [live]
        assert body["not_found"] == [ghost]
        assert await db.resumes.find_one({"resume_id": ok}) is None
        assert await db.resumes.find_one({"resume_id": live}) is not None
    finally:
        await db.resumes.delete_many({"resume_id": {"$in": [ok, live]}})
        await db.resume_files.delete_many({"resume_id": {"$in": [ok, live]}})


async def test_delete_endpoints_require_admin(client, standard_headers):
    rid = _rid()
    assert (await client.delete(f"/api/v1/resumes/{rid}", headers=standard_headers)).status_code == 403
    res = await client.post("/api/v1/resumes/bulk-delete", json={"resume_ids": [rid]}, headers=standard_headers)
    assert res.status_code == 403


async def test_bulk_delete_validates_the_id_list(client, admin_headers):
    res = await client.post("/api/v1/resumes/bulk-delete", json={"resume_ids": []}, headers=admin_headers)
    assert res.status_code == 400
    too_many = [_rid() for _ in range(201)]
    res = await client.post("/api/v1/resumes/bulk-delete", json={"resume_ids": too_many}, headers=admin_headers)
    assert res.status_code == 400


async def test_list_filters_by_status_and_treats_search_as_literal(client, standard_headers):
    db = get_db()
    done, bad = _rid(), _rid()
    await _seed_resume(done, status="processed", candidate_name="C++ Developer", classification={"skills": ["C++"]})
    await _seed_resume(bad, status="failed")
    try:
        res = await client.get("/api/v1/resumes?status=failed&limit=100", headers=standard_headers)
        assert res.status_code == 200
        ids = {r["resume_id"] for r in res.json()["resumes"]}
        assert bad in ids and done not in ids

        res = await client.get("/api/v1/resumes?search=C%2B%2B&limit=100", headers=standard_headers)
        assert res.status_code == 200
        assert done in {r["resume_id"] for r in res.json()["resumes"]}

        assert (await client.get("/api/v1/resumes?search=(", headers=standard_headers)).status_code == 200
    finally:
        await db.resumes.delete_many({"resume_id": {"$in": [done, bad]}})
        await db.resume_files.delete_many({"resume_id": {"$in": [done, bad]}})
