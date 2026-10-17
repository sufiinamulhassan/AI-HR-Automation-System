import uuid
from datetime import datetime, timedelta, timezone

import pytest
from jose import jwt

from config.database import get_db
from config.settings import settings
from services.hr_module.permissions import DEFAULT_ROLE_PERMISSIONS

pytestmark = pytest.mark.anyio

API = "/api/v1"


def _bearer(email: str) -> dict:
    token = jwt.encode(
        {"sub": email, "exp": datetime.now(timezone.utc) + timedelta(hours=1)},
        settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM,
    )
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
async def world():
    db = get_db()
    tag = uuid.uuid4().hex[:8]
    dept_a, dept_b = f"dept-a-{tag}", f"dept-b-{tag}"
    w: dict = {"tag": tag, "dept_a": dept_a, "dept_b": dept_b}
    now = "2026-01-01T00:00:00+00:00"

    for label, dept in (("a", dept_a), ("b", dept_b), ("n", None)):
        job_id, resume_id, cand_id, token = f"job-{label}-{tag}", f"res-{label}-{tag}", f"cand-{label}-{tag}", f"tok_scope{label}{tag}"
        email = f"{label}.{tag}@example.com"
        await db.jobs.insert_one({
            "doc_type": "job", "job_id": job_id, "title": f"Scope {label} {tag}", "description": "d",
            "department_id": dept, "created_at": now,
            "candidate_pipeline": [{"resume_id": resume_id, "similarity_score": 0.8, "pipeline_stage": "matched", "added_at": now}],
        })
        await db.resumes.insert_one({
            "resume_id": resume_id, "doc_type": "resume", "filename": "cv.pdf", "candidate_name": f"Person {label}",
            "candidate_email": email, "processing_status": "processed", "created_at": now,
            "matched_jds": [{"job_id": f"job-a-{tag}", "score": 0.7}, {"job_id": f"job-b-{tag}", "score": 0.6}],
        })
        await db.candidates.insert_one({
            "doc_type": "candidate", "candidate_id": cand_id, "job_id": job_id, "resume_id": resume_id,
            "name": f"Person {label}", "email": email, "secure_token": token, "status": "completed",
            "pipeline_stage": "completed", "invite_type": "manual", "created_at": now,
            "report": {"summary": "s", "final_score": 70}, "report_status": "ready", "final_score": 70,
        })
        await db.offers.insert_one({
            "doc_type": "offer", "offer_id": f"off-{label}-{tag}", "candidate_id": cand_id, "job_id": job_id,
            "salary": "1", "status": "draft", "secure_token": f"tok_offer{label}{tag}", "created_at": now, "updated_at": now,
        })
        w.update({f"job_{label}": job_id, f"res_{label}": resume_id, f"cand_{label}": cand_id,
                  f"token_{label}": token, f"offer_{label}": f"off-{label}-{tag}", f"email_{label}": email})
        from services.hr_module.candidate_profile_service import upsert_candidate_profile
        w[f"profile_{label}"] = await upsert_candidate_profile(
            {"candidate_id": cand_id, "job_id": job_id, "resume_id": resume_id, "email": email, "name": f"Person {label}"},
        )

    users = {
        "std_a": ("standard", dept_a), "std_b": ("standard", dept_b),
        "adm_a": ("admin", dept_a),
    }
    for key, (role, dept) in users.items():
        email = f"{key}.{tag}@example.com"
        await db.users.insert_one({
            "name": key, "email": email, "role": role, "department_id": dept, "is_active": True, "otp_required": False,
        })
        w[key] = _bearer(email)
        w[f"{key}_email"] = email
    await db.roles.insert_one({
        "role_name": "admin",
        "permissions": [p for p in DEFAULT_ROLE_PERMISSIONS["admin"] if p != "departments:cross_scope"],
    })
    try:
        yield w
    finally:
        await db.roles.delete_one({"role_name": "admin"})
        await db.jobs.delete_many({"job_id": {"$in": [w["job_a"], w["job_b"], w["job_n"]]}})
        await db.resumes.delete_many({"resume_id": {"$in": [w["res_a"], w["res_b"], w["res_n"]]}})
        cand_ids = [w["cand_a"], w["cand_b"], w["cand_n"]]
        await db.candidates.delete_many({"candidate_id": {"$in": cand_ids}})
        await db.offers.delete_many({"candidate_id": {"$in": cand_ids}})
        await db.candidate_profiles.delete_many({"profile_id": {"$in": [w["profile_a"], w["profile_b"], w["profile_n"]]}})
        await db.users.delete_many({"email": {"$regex": f"\\.{tag}@example.com$"}})
        await db.audit_log.delete_many({"resource_id": {"$in": cand_ids + [w["job_a"], w["job_b"], w["job_n"]]}})
        await db.report_shares.delete_many({"candidate_id": {"$in": cand_ids}})


async def test_a_scoped_user_cannot_open_a_candidate_of_another_department(client, world):
    h = world["std_a"]
    assert (await client.get(f"{API}/candidates/{world['cand_a']}", headers=h)).status_code == 200
    assert (await client.get(f"{API}/candidates/{world['cand_n']}", headers=h)).status_code == 200
    for url in (
        f"{API}/candidates/{world['cand_b']}",
        f"{API}/candidates/{world['cand_b']}/timeline",
        f"{API}/candidates/{world['cand_b']}/emails",
    ):
        resp = await client.get(url, headers=h)
        assert resp.status_code == 404, url
        assert resp.json()["detail"] == "Candidate not found"


async def test_the_404_is_the_same_as_for_an_id_that_does_not_exist(client, world):
    h = world["std_a"]
    missing = await client.get(f"{API}/candidates/no-such-{world['tag']}", headers=h)
    hidden = await client.get(f"{API}/candidates/{world['cand_b']}", headers=h)
    assert (missing.status_code, missing.json()) == (hidden.status_code, hidden.json())


async def test_a_scoped_user_cannot_open_a_job_or_its_pipeline_in_another_department(client, world):
    h = world["std_a"]
    for job in ("job_a", "job_n"):
        assert (await client.get(f"{API}/jobs/{world[job]}", headers=h)).status_code == 200
        assert (await client.get(f"{API}/jobs/{world[job]}/pipeline", headers=h)).status_code == 200
    for url in (
        f"{API}/jobs/{world['job_b']}",
        f"{API}/jobs/{world['job_b']}/pipeline",
        f"{API}/jobs/{world['job_b']}/sourcing",
        f"{API}/jobs/{world['job_b']}/pipeline/{world['res_b']}/fit",
    ):
        resp = await client.get(url, headers=h)
        assert resp.status_code == 404, url
        assert resp.json()["detail"] == "Job not found"


async def test_a_scoped_user_cannot_open_an_offer_of_another_department(client, world):
    h = world["std_a"]
    assert (await client.get(f"{API}/offers/{world['offer_a']}", headers=h)).status_code == 200
    resp = await client.get(f"{API}/offers/{world['offer_b']}", headers=h)
    assert resp.status_code == 404 and resp.json()["detail"] == "Offer not found"
    listed = {o["offer_id"] for o in (await client.get(f"{API}/offers", headers=h)).json()["offers"]}
    assert world["offer_a"] in listed and world["offer_b"] not in listed
    only_b = (await client.get(f"{API}/offers", params={"candidate_id": world["cand_b"]}, headers=h)).json()["offers"]
    assert only_b == []


async def test_lists_follow_the_same_rule_as_the_by_id_routes(client, world):
    h = world["std_a"]
    ids = {c["candidate_id"] for c in (await client.get(f"{API}/candidates", params={"limit": 200}, headers=h)).json()["candidates"]}
    assert world["cand_a"] in ids and world["cand_b"] not in ids
    assert world["cand_n"] in ids
    jobs = {j["job_id"] for j in (await client.get(f"{API}/jobs", params={"limit": 500}, headers=h)).json()["jobs"]}
    assert world["job_a"] in jobs and world["job_n"] in jobs and world["job_b"] not in jobs
    probe = await client.get(f"{API}/candidates", params={"job_id": world["job_b"]}, headers=h)
    assert probe.json() == {"candidates": [], "total": 0}


async def test_profiles_and_resumes_do_not_reveal_another_departments_candidates_or_jobs(client, world):
    h = world["std_a"]
    assert (await client.get(f"{API}/candidates/profile/{world['profile_a']}", headers=h)).status_code == 200
    assert (await client.get(f"{API}/candidates/profile/{world['profile_b']}", headers=h)).status_code == 404
    assert (await client.get(f"{API}/candidates/profile/by-email/{world['email_b']}", headers=h)).status_code == 404
    assert (await client.get(f"{API}/resumes", params={"job_id": world["job_b"]}, headers=h)).status_code == 404
    doc = (await client.get(f"{API}/resumes/{world['res_a']}", headers=h)).json()
    assert {m["job_id"] for m in doc["matched_jds"]} == {world["job_a"]}, "a resume must not list another department's job"
    listed = (await client.get(f"{API}/resumes", params={"search": world["tag"], "limit": 50}, headers=h)).json()["resumes"]
    for row in listed:
        assert all(m["job_id"] != world["job_b"] for m in row.get("matched_jds", []))


async def test_the_timeline_only_lists_the_visible_records_of_a_person(client, world):
    db = get_db()
    extra = f"cand-extra-{world['tag']}"
    await db.candidates.insert_one({
        "doc_type": "candidate", "candidate_id": extra, "job_id": world["job_b"], "email": world["email_a"],
        "name": "Person a", "status": "invited", "created_at": "2026-02-01T00:00:00+00:00",
    })
    try:
        scoped = (await client.get(f"{API}/candidates/{world['cand_a']}/timeline", headers=world["std_a"])).json()["timeline"]
        assert [t["candidate_id"] for t in scoped] == []
        wide = (await client.get(f"{API}/candidates/{world['cand_a']}/timeline", headers={"Authorization": "Bearer demo-standard-token"})).json()["timeline"]
        assert [t["candidate_id"] for t in wide] == [extra]
    finally:
        await db.candidates.delete_one({"candidate_id": extra})


def _blocked_requests(w: dict) -> list[tuple[str, str, dict | None]]:
    b = {"cand": w["cand_b"], "job": w["job_b"], "res": w["res_b"], "offer": w["offer_b"], "token": w["token_b"]}
    return [
        ("PATCH", f"/jobs/{b['job']}", {"location": "Nowhere"}),
        ("DELETE", f"/jobs/{b['job']}", None),
        ("PATCH", f"/jobs/{b['job']}/pipeline/{b['res']}?stage=shortlisted", None),
        ("POST", f"/jobs/{b['job']}/pipeline/bulk-stage", {"resume_ids": [b["res"]], "stage": "shortlisted"}),
        ("POST", f"/jobs/{b['job']}/pipeline/{b['res']}/fit/ai-opinion", None),
        ("GET", f"/jobs/{b['job']}/comparison", None),
        ("POST", "/candidates", {"job_id": b["job"], "name": "N", "email": f"new.{w['tag']}@example.com"}),
        ("POST", f"/candidates/{b['cand']}/decision", {"decision": "reject"}),
        ("POST", f"/candidates/{b['cand']}/resend-invite", None),
        ("POST", f"/candidates/{b['cand']}/regenerate-token", {"resend": False}),
        ("POST", f"/candidates/{b['cand']}/send-email", {"template": "reminder"}),
        ("PATCH", f"/candidates/{b['cand']}/notes", {"notes": "x"}),
        ("GET", f"/candidates/{b['cand']}/external-review", None),
        ("GET", f"/candidates/{b['cand']}/interview-guide", None),
        ("POST", f"/candidates/{b['cand']}/interview-guide", {}),
        ("GET", f"/candidates/{b['cand']}/interviewer-links", None),
        ("POST", f"/candidates/{b['cand']}/interviewer-links", {}),
        ("PATCH", f"/candidates/profile/{w['profile_b']}/notes", {"notes": "x"}),
        ("POST", "/offers", {"candidate_id": b["cand"], "salary": "5"}),
        ("POST", f"/offers/{b['offer']}/approve", None),
        ("POST", f"/offers/{b['offer']}/send", None),
        ("POST", f"/offers/{b['offer']}/withdraw", None),
        ("POST", f"/offers/{b['offer']}/draft-letter", {}),
        ("GET", f"/offers/{b['offer']}/pdf", None),
        ("GET", f"/interview/report/{b['token']}", None),
        ("GET", f"/interview/report/{b['token']}/pdf", None),
        ("POST", f"/interview/report/{b['token']}/share", {}),
        ("GET", f"/interview/report/{b['token']}/shares", None),
        ("PATCH", f"/interview/{b['cand']}/schedule", {"scheduled_start_at": "2030-01-01T10:00:00+00:00"}),
        ("GET", f"/interview/{b['cand']}/schedule.ics", None),
        ("PATCH", f"/coding/assign/{b['cand']}", {"question_id": "whatever"}),
        ("GET", f"/coding/live/{b['cand']}", None),
        ("GET", f"/coding/submissions/{b['cand']}", None),
        ("POST", f"/integrations/hrms/push/{b['cand']}", None),
    ]


async def test_a_scoped_admin_gets_404_for_every_route_of_an_object_in_another_department(client, world):
    h = world["adm_a"]
    for method, path, body in _blocked_requests(world):
        resp = await client.request(method, API + path, headers=h, json=body)
        assert resp.status_code == 404, f"{method} {path} -> {resp.status_code} {resp.text[:160]}"


async def test_nothing_in_the_other_department_changed(client, world):
    h = world["adm_a"]
    for method, path, body in _blocked_requests(world):
        await client.request(method, API + path, headers=h, json=body)
    db = get_db()
    assert await db.jobs.find_one({"job_id": world["job_b"]}) is not None
    assert (await db.jobs.find_one({"job_id": world["job_b"]})).get("location") is None
    cand = await db.candidates.find_one({"candidate_id": world["cand_b"]})
    assert cand["status"] == "completed" and cand["secure_token"] == world["token_b"] and not cand.get("recruiter_notes")
    offer = await db.offers.find_one({"offer_id": world["offer_b"]})
    assert offer["status"] == "draft"
    assert await db.offers.count_documents({"candidate_id": world["cand_b"]}) == 1
    assert await db.candidates.count_documents({"email": f"new.{world['tag']}@example.com"}) == 0


async def test_a_scoped_admin_still_works_inside_their_own_department(client, world):
    h = world["adm_a"]
    assert (await client.get(f"{API}/jobs/{world['job_a']}", headers=h)).status_code == 200
    patched = await client.patch(f"{API}/jobs/{world['job_a']}", json={"location": "Berlin"}, headers=h)
    assert patched.status_code == 200 and patched.json()["location"] == "Berlin"
    assert (await client.get(f"{API}/interview/report/{world['token_a']}", headers=h)).status_code == 200
    guide = await client.get(f"{API}/candidates/{world['cand_a']}/interview-guide", headers=h)
    assert guide.status_code == 200, guide.text
    stage = await client.patch(f"{API}/jobs/{world['job_a']}/pipeline/{world['res_a']}?stage=shortlisted", headers=h)
    assert stage.status_code == 200
    offer = await client.post(f"{API}/offers/{world['offer_a']}/approve", headers=h)
    assert offer.status_code == 200 and offer.json()["status"] == "approved"
    assert (await client.get(f"{API}/jobs/{world['job_n']}/pipeline", headers=h)).status_code == 200
    assert (await client.get(f"{API}/interview/report/{world['token_n']}", headers=h)).status_code == 200


async def test_a_scoped_admin_cannot_file_a_job_under_another_department(client, world):
    h = world["adm_a"]
    body = {"title": f"Cross {world['tag']}", "description": "d", "department_id": world["dept_b"]}
    resp = await client.post(f"{API}/jobs", json=body, headers=h)
    assert resp.status_code == 403
    assert await get_db().jobs.count_documents({"title": body["title"]}) == 0
    move = await client.patch(f"{API}/jobs/{world['job_a']}", json={"department_id": world["dept_b"]}, headers=h)
    assert move.status_code == 403
    assert (await get_db().jobs.find_one({"job_id": world["job_a"]}))["department_id"] == world["dept_a"]


async def test_coding_submissions_list_is_limited_to_the_scope(client, world):
    db = get_db()
    ids = {}
    for label in ("a", "b"):
        ids[label] = f"sub-{label}-{world['tag']}"
        await db.coding_submissions.insert_one({
            "submission_id": ids[label], "candidate_id": world[f"cand_{label}"], "question_id": "q", "status": "completed",
            "submitted_at": "2026-03-01T00:00:00+00:00",
        })
    try:
        scoped = (await client.get(f"{API}/coding/submissions", params={"limit": 100}, headers=world["adm_a"])).json()
        found = {s["submission_id"] for s in scoped["submissions"]}
        assert ids["a"] in found and ids["b"] not in found
        probe = (await client.get(f"{API}/coding/submissions", params={"candidate_id": world["cand_b"]}, headers=world["adm_a"])).json()
        assert probe == {"submissions": [], "total": 0}
    finally:
        await db.coding_submissions.delete_many({"submission_id": {"$in": list(ids.values())}})


async def test_an_unscoped_admin_reaches_every_department(client, world, admin_headers, superadmin_headers):
    for headers in (admin_headers, superadmin_headers):
        for label in ("a", "b", "n"):
            assert (await client.get(f"{API}/jobs/{world['job_' + label]}", headers=headers)).status_code == 200
            assert (await client.get(f"{API}/candidates/{world['cand_' + label]}", headers=headers)).status_code == 200
            assert (await client.get(f"{API}/offers/{world['offer_' + label]}", headers=headers)).status_code == 200
            assert (await client.get(f"{API}/interview/report/{world['token_' + label]}", headers=headers)).status_code == 200


async def test_a_standard_user_with_no_department_is_unrestricted(client, world, standard_headers):
    for label in ("a", "b", "n"):
        assert (await client.get(f"{API}/jobs/{world['job_' + label]}", headers=standard_headers)).status_code == 200
        assert (await client.get(f"{API}/candidates/{world['cand_' + label]}", headers=standard_headers)).status_code == 200
        assert (await client.get(f"{API}/offers/{world['offer_' + label]}", headers=standard_headers)).status_code == 200


async def test_department_b_user_sees_the_mirror_image(client, world):
    h = world["std_b"]
    assert (await client.get(f"{API}/candidates/{world['cand_b']}", headers=h)).status_code == 200
    assert (await client.get(f"{API}/candidates/{world['cand_a']}", headers=h)).status_code == 404
    assert (await client.get(f"{API}/jobs/{world['job_a']}", headers=h)).status_code == 404
