import re
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from jose import jwt

import ops_store
from config.database import get_db, get_platform_db
from config.settings import settings
from config.tenancy import DEFAULT_COMPANY_ID, company_context
from config.tenancy_migration import client_doc, company_doc
from services.hr_module import (
    coding_service,
    cron_service,
    email_service,
    erasure_service,
    report_share_service,
    retention_service,
    workspace_service,
)
from services.hr_module import interviewer_link_service as links
from services.hr_module.coding_link_service import EXPIRED_MESSAGE
from services.hr_module.permissions import DEFAULT_ROLE_PERMISSIONS
from shared.utils import sha256_hex

pytestmark = pytest.mark.anyio

API = "/api/v1"
NOW = datetime.now(timezone.utc)
REASON = "Subject access request, ticket 4411"


def iso(days: float) -> str:
    return (NOW + timedelta(days=days)).isoformat()


def super_of(company: str) -> dict:
    return {"Authorization": f"Bearer demo-superadmin-token@@{company}"}


def _jwt(email: str) -> dict:
    token = jwt.encode(
        {"sub": email, "exp": datetime.now(timezone.utc) + timedelta(hours=1)},
        settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM,
    )
    return {"Authorization": f"Bearer {token}"}


class FakeIndex:

    def __init__(self):
        self.vectors: dict[str, str] = {}
        self.fail = False

    def fetch(self, ids):
        return SimpleNamespace(vectors={
            i: SimpleNamespace(metadata={"company_id": self.vectors[i]}) for i in ids if i in self.vectors
        })

    def delete(self, ids=None, **kwargs):
        if self.fail:
            raise RuntimeError("the vector store is down")
        for i in ids:
            self.vectors.pop(i, None)


@pytest.fixture(autouse=True)
def index(monkeypatch):
    fake = FakeIndex()
    monkeypatch.setattr(erasure_service, "get_pinecone", lambda: fake)
    return fake


@pytest.fixture(autouse=True)
def own_ip(monkeypatch):
    import shared.rate_limit as rate_limit

    ip = f"gov-{uuid.uuid4().hex[:10]}"
    monkeypatch.setattr(rate_limit, "client_ip", lambda request: ip)
    return ip


@pytest.fixture
async def b():
    tag = uuid.uuid4().hex[:8]
    client_id, company_id = f"cli_gov{tag}", f"cmp_gov{tag}"
    raw = get_platform_db()
    await raw.clients.insert_one(client_doc(client_id, f"Gov Client {tag}", f"gov-client-{tag}"))
    await raw.companies.insert_one(company_doc(company_id, client_id, f"Gov Company {tag}", f"gov-company-{tag}"))
    yield company_id
    for name in await raw.list_collection_names():
        if name not in ("clients", "companies", "settings") and not name.startswith("system."):
            await raw[name].delete_many({"company_id": company_id})
    await raw.users.delete_many({"company_id": company_id})
    await raw.companies.delete_many({"company_id": company_id})
    await raw.clients.delete_many({"client_id": client_id})


class Seeder:

    def __init__(self, index: FakeIndex):
        self.index = index
        self.cids: list[str] = []
        self.rids: list[str] = []
        self.jobs: list[str] = []
        self.emails: list[str] = []
        self.offers: list[str] = []
        self.employees: list[str] = []
        self.questions: list[str] = []
        self.batches: list[str] = []

    async def person(self, tag=None, *, email=None, job_id=None, company=None, status="completed", decision="hold", **extra):
        tag = tag or uuid.uuid4().hex[:8]
        email = email or f"Gov.Person.{tag}@Example.com"
        p = SimpleNamespace(
            tag=tag, email=email, cid=f"gov-c-{tag}", rid=f"gov-r-{tag}", old=f"gov-r-{tag}-old",
            job_id=job_id or f"gov-job-{tag}", token=f"gov-tok-{tag}", offer_id=f"gov-off-{tag}",
            offer_token=f"gov-offtok-{tag}", share_token=f"gov-share-{tag}", link_token=f"gov-link-{tag}",
            filename=f"Gov_{tag}_CV.pdf", question_id=f"gov-q-{tag}", batch_id=f"gov-batch-{tag}",
            name=f"Gov Person {tag}",
        )
        ctx = company_context(company) if company else None
        if ctx:
            ctx.__enter__()
        try:
            db = get_db()
            cand = {
                "doc_type": "candidate", "candidate_id": p.cid, "job_id": p.job_id, "resume_id": p.rid, "name": p.name,
                "email": email, "phone": "+1 555 0100", "phone_normalized": "15550100",
                "linkedin_url": f"https://linkedin.com/in/gov-{tag}", "linkedin_normalized": f"linkedin.com/in/gov-{tag}",
                "status": status, "pipeline_stage": status, "decision": decision, "secure_token": p.token,
                "token_status": "active", "invite_type": "manual", "invite_sent_at": iso(-10), "invite_expires_at": iso(5),
                "created_at": iso(-10), "_questions": ["Tell me about yourself"], "transcript": [{"answer": f"answer {tag}"}],
                "report": {"summary": f"strong fit {tag}"}, "eval_score": 80, "recruiter_notes": f"notes {tag}",
                "decision_notes": f"decision {tag}", "coding_question_id": p.question_id,
                "coding_invite_expires_at": iso(5), "invited_by": "hr@acme.test",
            }
            cand.update(extra)
            await db.candidates.insert_one(cand)
            await db.coding_questions.insert_one({
                "question_id": p.question_id, "title": f"Q {tag}", "description": "d", "language_templates": {},
                "test_cases": [{"input": "1", "expected_output": "1", "is_hidden": False}], "difficulty": "easy",
            })
            await db.resumes.insert_one({
                "resume_id": p.rid, "candidate_email": email.lower(), "candidate_name": p.name, "text": f"CV of {p.name}",
                "filename": p.filename, "previous_resume_id": p.old, "superseded_by": None, "created_at": iso(-10),
            })
            await db.resumes.insert_one({
                "resume_id": p.old, "candidate_email": email, "candidate_name": p.name, "text": f"older CV of {p.name}",
                "filename": f"Gov_{tag}_CV_v1.pdf", "superseded_by": p.rid, "created_at": iso(-20),
            })
            await db.resume_files.insert_one({"resume_id": p.rid, "filename": p.filename, "data": b"cv"})
            await db.resume_files.insert_one({"resume_id": p.old, "filename": "old.pdf", "data": b"cv"})
            if not await db.jobs.find_one({"job_id": p.job_id}):
                await db.jobs.insert_one({
                    "doc_type": "job", "job_id": p.job_id, "title": "Gov Engineer", "description": "d",
                    "created_at": iso(-30), "candidate_pipeline": [
                        {"resume_id": p.rid, "pipeline_stage": status}, {"resume_id": f"gov-other-{tag}", "pipeline_stage": "matched"},
                    ],
                })
            await db[settings.MARKETPLACE_COLLECTION].insert_one({
                "profile_id": f"gov-prof-{tag}", "resume_id": p.rid, "email": email, "name": p.name,
            })
            await db.upload_batches.insert_one({"batch_id": p.batch_id, "errors": [
                {"filename": p.filename, "error": "unreadable"}, {"filename": f"gov-other-{tag}.pdf", "error": "unreadable"},
            ]})
            profile = await db.candidate_profiles.find_one({"email": email.lower()})
            if profile:
                await db.candidate_profiles.update_one(
                    {"profile_id": profile["profile_id"]},
                    {"$addToSet": {"candidate_ids": p.cid, "job_ids": p.job_id, "resume_ids": p.rid}},
                )
            else:
                await db.candidate_profiles.insert_one({
                    "profile_id": f"gov-pp-{tag}", "email": email.lower(), "name": p.name, "phone_normalized": "15550100",
                    "linkedin_normalized": f"linkedin.com/in/gov-{tag}", "candidate_ids": [p.cid], "job_ids": [p.job_id],
                    "resume_ids": [p.rid], "profile_notes": f"profile notes {tag}",
                })
            await db.candidate_demographics.insert_one({"candidate_id": p.cid, "gender": "f", "location": "Lisbon"})
            await db.coding_submissions.insert_one({
                "submission_id": f"gov-sub-{tag}", "candidate_id": p.cid, "question_id": p.question_id,
                "status": "completed", "language": "python", "code": f"print('{tag}')", "submitted_at": iso(-1),
            })
            await db.coding_session_state.insert_one({"candidate_id": p.cid, "question_id": p.question_id, "code": "draft"})
            await db.interviewer_links.insert_one({
                "link_id": f"gov-l-{tag}", "candidate_id": p.cid, "job_id": p.job_id, "token_hash": links.hash_token(p.link_token),
                "interviewer_name": "Ann Engineer", "interviewer_role": "engineer", "created_by": "hr@acme.test",
                "created_at": iso(-1), "expires_at": iso(5), "revoked": False, "scorecard_id": None,
            })
            await db.report_shares.insert_one({
                "share_id": f"gov-sh-{tag}", "token_hash": sha256_hex(p.share_token.encode("utf-8")), "candidate_id": p.cid,
                "job_id": p.job_id, "created_by": "hr@acme.test", "created_at": iso(-1), "expires_at": iso(5),
                "revoked": False, "view_count": 0, "feedback": [{"comment": f"feedback {tag}"}],
            })
            await db.hrms_sync_log.insert_one({"candidate_id": p.cid, "status": "sent", "detail": f"pushed {p.name}"})
            await db.email_log.insert_one({
                "to": email, "subject": f"Interview for {p.name}", "template": "interview_invite", "candidate_id": p.cid,
                "job_id": p.job_id, "status": "failed", "error": f"550 {email} unknown", "created_at": iso(-9),
            })
            await db.email_log.insert_one({
                "to": email.upper(), "subject": "Hello", "template": "reminder", "status": "sent", "created_at": iso(-8),
            })
            await db.audit_log.insert_one({
                "actor_email": "hr@acme.test", "action": "candidate_invited", "resource_type": "candidate", "resource_id": p.cid,
                "details": {"job_id": p.job_id, "email": email, "invite_type": "manual"}, "created_at": iso(-10),
            })
            await db.audit_log.insert_one({
                "actor_email": "hr@acme.test", "action": "candidate_notes_updated", "resource_type": "candidate",
                "resource_id": p.cid, "details": {"notes": f"notes {tag}"}, "created_at": iso(-9),
            })
            await db.audit_log.insert_one({
                "actor_email": "hr@acme.test", "action": "resume_upload", "resource_type": "resume", "resource_id": p.rid,
                "details": {"filename": p.filename, "job_id": p.job_id}, "created_at": iso(-10),
            })
            await db.offers.insert_one({
                "doc_type": "offer", "offer_id": p.offer_id, "candidate_id": p.cid, "job_id": p.job_id, "status": "sent",
                "salary": f"salary {tag}", "benefits": "x", "secure_token": p.offer_token, "created_by": "hr@acme.test",
                "created_at": iso(-9), "updated_at": iso(-9), "sent_at": iso(-8),
            })
        finally:
            if ctx:
                ctx.__exit__(None, None, None)
        self.index.vectors[p.rid] = company or DEFAULT_COMPANY_ID
        self.index.vectors[p.old] = company or DEFAULT_COMPANY_ID
        if not company:
            self.cids.append(p.cid)
            self.rids += [p.rid, p.old]
            self.jobs.append(p.job_id)
            self.emails.append(email)
            self.offers.append(p.offer_id)
            self.questions.append(p.question_id)
            self.batches.append(p.batch_id)
        return p

    async def employment(self, p, *, accepted_only=False):
        db = get_db()
        accepted = f"gov-acc-{p.tag}"
        await db.offers.insert_one({
            "doc_type": "offer", "offer_id": accepted, "candidate_id": p.cid, "job_id": p.job_id, "status": "accepted",
            "salary": f"accepted salary {p.tag}", "secure_token": f"gov-acctok-{p.tag}",
            "signature": {"typed_name": p.name, "ip_address": "10.9.8.7", "signed_at": iso(-3)}, "created_at": iso(-4),
        })
        self.offers.append(accepted)
        if accepted_only:
            return
        employee = f"gov-emp-{p.tag}"
        await db.employees.insert_one({
            "employee_id": employee, "candidate_id": p.cid, "job_id": p.job_id, "offer_id": accepted, "department": "eng",
            "manager_id": "boss@acme.test", "status": "active", "hired_at": iso(-3), "created_at": iso(-3),
        })
        self.employees.append(employee)
        await db.performance_reviews.insert_one({
            "review_id": f"gov-rv-{p.tag}", "employee_id": employee, "reviewer_id": "boss@acme.test",
            "reviewer_type": "manager", "comments": f"review of {p.name}", "status": "submitted",
        })
        await db.performance_reviews.insert_one({
            "review_id": f"gov-rv2-{p.tag}", "employee_id": f"gov-emp-other-{p.tag}", "reviewer_id": employee,
            "reviewer_type": "peer", "secure_token": f"gov-peertok-{p.tag}", "comments": "fine", "status": "submitted",
        })
        await db.goals.insert_one({"goal_id": f"gov-g-{p.tag}", "owner_id": employee, "title": f"goal of {p.name}"})
        await db.goals.insert_one({
            "goal_id": f"gov-g2-{p.tag}", "owner_id": f"gov-emp-other-{p.tag}", "title": "child", "parent_goal_id": f"gov-g-{p.tag}",
        })

    async def cleanup(self):
        db = get_db()
        ids, rids = {"$in": self.cids}, {"$in": self.rids}
        emp = {"$in": self.employees + [f"gov-emp-other-{c[6:]}" for c in self.cids]}
        await db.candidates.delete_many({"candidate_id": ids})
        await db.resumes.delete_many({"resume_id": rids})
        await db.resume_files.delete_many({"resume_id": rids})
        await db.jobs.delete_many({"job_id": {"$in": self.jobs}})
        await db[settings.MARKETPLACE_COLLECTION].delete_many({"$or": [{"resume_id": rids}, {"profile_id": {"$regex": "^gov-prof-"}}]})
        await db.upload_batches.delete_many({"batch_id": {"$in": self.batches}})
        await db.candidate_profiles.delete_many({"profile_id": {"$regex": "^gov-pp-"}})
        for name in ("candidate_demographics", "coding_submissions", "coding_session_state", "interviewer_links",
                     "report_shares", "hrms_sync_log", "offers"):
            await db[name].delete_many({"candidate_id": ids})
        await db.offers.delete_many({"offer_id": {"$in": self.offers}})
        await db.employees.delete_many({"employee_id": {"$in": self.employees}})
        await db.performance_reviews.delete_many({"$or": [{"employee_id": emp}, {"reviewer_id": emp}]})
        await db.goals.delete_many({"$or": [{"owner_id": emp}, {"goal_id": {"$regex": "^gov-g"}}]})
        await db.coding_questions.delete_many({"question_id": {"$in": self.questions}})
        patterns = [{"to": {"$regex": "^" + re.escape(e) + "$", "$options": "i"}} for e in self.emails]
        await db.email_log.delete_many({"$or": [{"candidate_id": ids}, *patterns]})
        await db.audit_log.delete_many({"$or": [
            {"resource_id": {"$in": self.cids + self.rids}},
            {"action": {"$in": ["candidate_erase", "retention_purge", "retention_update"]}},
        ]})
        await db.company_settings.update_one({"_id": "singleton"}, {"$unset": {"retention": ""}})


@pytest.fixture
async def gov(index):
    seeder = Seeder(index)
    yield seeder
    await seeder.cleanup()


async def traces(p) -> dict[str, int]:
    db = get_db()
    ids = {"$in": [p.rid, p.old]}
    rx = {"$regex": "^" + re.escape(p.email) + "$", "$options": "i"}
    return {
        "resumes": await db.resumes.count_documents({"resume_id": ids}),
        "resume_files": await db.resume_files.count_documents({"resume_id": ids}),
        "pipeline_entries": await db.jobs.count_documents({"candidate_pipeline.resume_id": ids}),
        "enrichment": await db[settings.MARKETPLACE_COLLECTION].count_documents({"$or": [{"resume_id": ids}, {"email": rx}]}),
        "upload_batch_errors": await db.upload_batches.count_documents({"errors.filename": p.filename}),
        "profiles": await db.candidate_profiles.count_documents({"$or": [{"email": p.email.lower()}, {"candidate_ids": p.cid}]}),
        "demographics": await db.candidate_demographics.count_documents({"candidate_id": p.cid}),
        "coding_submissions": await db.coding_submissions.count_documents({"candidate_id": p.cid}),
        "coding_sessions": await db.coding_session_state.count_documents({"candidate_id": p.cid}),
        "interviewer_links": await db.interviewer_links.count_documents({"candidate_id": p.cid}),
        "report_shares": await db.report_shares.count_documents({"candidate_id": p.cid}),
        "hrms_log": await db.hrms_sync_log.count_documents({"candidate_id": p.cid}),
        "email_log_with_address": await db.email_log.count_documents({"$or": [
            {"to": rx}, {"candidate_id": p.cid, "subject": {"$exists": True}}, {"candidate_id": p.cid, "error": {"$exists": True}},
        ]}),
        "audit_with_personal_text": await db.audit_log.count_documents({"$or": [
            {"resource_id": p.cid, "details.email": {"$exists": True}}, {"resource_id": p.cid, "details.notes": {"$exists": True}},
            {"resource_id": p.rid, "details.filename": {"$exists": True}},
        ]}),
        "offer_terms": await db.offers.count_documents({"candidate_id": p.cid, "$or": [
            {"salary": {"$exists": True}}, {"secure_token": {"$exists": True}}, {"signature": {"$exists": True}},
        ]}),
        "candidate_personal": await db.candidates.count_documents({"candidate_id": p.cid, "$or": [
            {"name": {"$exists": True}}, {"email": {"$exists": True}}, {"phone": {"$exists": True}},
            {"transcript": {"$exists": True}}, {"report": {"$exists": True}}, {"recruiter_notes": {"$exists": True}},
            {"secure_token": {"$exists": True}}, {"resume_id": {"$exists": True}},
        ]}),
    }


async def erase(client, headers, cid, **body):
    return await client.post(f"{API}/candidates/{cid}/erase", json={"reason": REASON, **body}, headers=headers)


async def test_a_superadmin_erases_a_candidate_and_every_store_is_clean(client, superadmin_headers, gov, index):
    p = await gov.person()
    before = await traces(p)
    assert all(count >= 1 for count in before.values()), before

    response = await erase(client, superadmin_headers, p.cid)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["candidate_id"] == p.cid and body["erased"] is True and body["already_erased"] is False
    assert body["vectors_failed"] == 0 and body["other_applications"] == 0 and body["erased_at"]
    assert set(body["counts"]) == set(erasure_service.COUNT_KEYS)
    assert body["counts"]["candidates"] == 1 and body["counts"]["resumes"] == 2 and body["counts"]["offers"] == 1
    assert body["counts"]["vectors_deleted"] == 2
    assert await traces(p) == {name: 0 for name in before}
    assert p.rid not in index.vectors and p.old not in index.vectors


async def test_the_tombstone_keeps_the_contract_fields_and_the_audit_row_holds_no_personal_data(client, superadmin_headers, gov):
    p = await gov.person()
    assert (await erase(client, superadmin_headers, p.cid)).status_code == 200

    db = get_db()
    tomb = await db.candidates.find_one({"candidate_id": p.cid}, {"_id": 0})
    assert set(tomb) <= erasure_service.CANDIDATE_KEEP - {"_id"}
    assert {"candidate_id", "job_id", "company_id", "status", "decision", "created_at", "erased", "erased_at", "erasure"} <= set(tomb)
    assert tomb["company_id"] == DEFAULT_COMPANY_ID and tomb["status"] == "completed" and tomb["decision"] == "hold"
    assert tomb["erased"] is True and tomb["erasure"] == {"by": "demo-superadmin@hirely.ai", "reason": REASON}

    row = await db.audit_log.find_one({"action": "candidate_erase", "resource_id": p.cid}, {"_id": 0})
    assert row["resource_type"] == "candidate" and row["actor_email"] == "demo-superadmin@hirely.ai"
    assert set(row["details"]) == {"via", "include_employment", "job_id", "candidates_in_request", "counts"}
    text = str(row)
    for secret in (p.name, p.email, p.email.lower(), REASON, "Subject access"):
        assert secret not in text, secret


async def test_every_link_the_person_held_stops_working(client, superadmin_headers, gov):
    p = await gov.person(token_status="active", status="invited", decision=None)
    db = get_db()
    await db.offers.update_one({"offer_id": p.offer_id}, {"$set": {"status": "sent"}})
    live = {
        "interview": await client.get(f"{API}/interview/session/{p.token}"),
        "coding": await client.get(f"{API}/coding/session/{p.token}"),
        "offer": await client.get(f"{API}/offers/public/{p.offer_token}"),
    }
    assert {name: r.status_code for name, r in live.items()} == {"interview": 200, "coding": 200, "offer": 200}
    assert (await report_share_service.resolve_active_share(db, p.share_token, count_view=False))["candidate_id"] == p.cid
    assert (await links.resolve_link(db, p.link_token))["candidate_id"] == p.cid

    assert (await erase(client, superadmin_headers, p.cid)).status_code == 200

    for path in (f"/interview/session/{p.token}", f"/coding/session/{p.token}", f"/offers/public/{p.offer_token}"):
        assert (await client.get(API + path)).status_code == 404, path
    assert (await client.post(f"{API}/coding/session/{p.token}/flag", json={"event": "x"})).status_code == 404
    assert (await client.post(f"{API}/interview/session/{p.token}/flag", json={"event": "x"})).status_code == 404
    with pytest.raises(report_share_service.ShareNotFound):
        await report_share_service.resolve_active_share(db, p.share_token, count_view=False)
    with pytest.raises(links.LinkNotFound):
        await links.resolve_link(db, p.link_token)
    assert (await client.get(f"{API}/interview/shared-report/{p.share_token}")).status_code == 404
    assert (await client.get(f"{API}/interviewer-scorecard/{p.link_token}")).status_code == 404


async def test_erasing_twice_returns_the_tombstone_result_and_changes_nothing_more(client, superadmin_headers, gov):
    p = await gov.person()
    first = (await erase(client, superadmin_headers, p.cid)).json()
    db = get_db()
    snapshot = await db.candidates.find_one({"candidate_id": p.cid})

    again = await erase(client, superadmin_headers, p.cid)

    assert again.status_code == 200
    body = again.json()
    assert body["already_erased"] is True and body["erased"] is True and body["erased_at"] == first["erased_at"]
    assert all(count == 0 for count in body["counts"].values())
    assert await db.candidates.find_one({"candidate_id": p.cid}) == snapshot
    assert await db.audit_log.count_documents({"action": "candidate_erase", "resource_id": p.cid}) == 1


async def test_a_pinecone_failure_is_reported_and_a_second_erasure_retries_it(client, superadmin_headers, gov, index):
    p = await gov.person()
    index.fail = True
    body = (await erase(client, superadmin_headers, p.cid)).json()
    assert body["vectors_failed"] == 2 and body["counts"]["vectors_deleted"] == 0 and body["counts"]["candidates"] == 1
    assert all(count == 0 for count in (await traces(p)).values())
    assert sorted((await get_db().candidates.find_one({"candidate_id": p.cid}))["erasure"]["vectors_pending"]) == sorted([p.rid, p.old])

    index.fail = False
    again = (await erase(client, superadmin_headers, p.cid)).json()
    assert again["already_erased"] is True and again["vectors_failed"] == 0
    assert p.rid not in index.vectors and p.old not in index.vectors
    assert "vectors_pending" not in (await get_db().candidates.find_one({"candidate_id": p.cid}))["erasure"]


async def test_an_unknown_candidate_is_404_and_the_reason_is_required(client, superadmin_headers, gov):
    assert (await erase(client, superadmin_headers, "gov-no-such-candidate")).status_code == 404
    p = await gov.person()
    for body in ({}, {"reason": None}, {"reason": ""}, {"reason": "  "}, {"reason": "ab"}, {"reason": "x" * 501}):
        response = await client.post(f"{API}/candidates/{p.cid}/erase", json=body, headers=superadmin_headers)
        assert response.status_code == 422, body
        assert response.json()["detail"] == "Give a reason of 3 to 500 characters."
    assert (await client.post(f"{API}/candidates/{p.cid}/erase", json={"reason": "abc"}, headers=superadmin_headers)).status_code == 200


async def test_a_resume_another_live_application_uses_is_kept(client, superadmin_headers, gov, index):
    p = await gov.person()
    db = get_db()
    second = f"gov-c-second-{p.tag}"
    gov.cids.append(second)
    await db.candidates.insert_one({
        "doc_type": "candidate", "candidate_id": second, "job_id": f"gov-job2-{p.tag}", "resume_id": p.rid, "name": p.name,
        "email": p.email, "status": "invited", "pipeline_stage": "invited", "created_at": iso(-2),
    })
    gov.jobs.append(f"gov-job2-{p.tag}")

    body = (await erase(client, superadmin_headers, p.cid)).json()

    assert body["other_applications"] == 1 and body["counts"]["resumes_kept"] == 1
    assert await db.resumes.count_documents({"resume_id": p.rid}) == 1 and await db.resumes.count_documents({"resume_id": p.old}) == 0
    assert p.rid in index.vectors and p.old not in index.vectors
    live = await db.candidates.find_one({"candidate_id": second})
    assert live["name"] == p.name and not live.get("erased")


async def test_an_accepted_offer_or_an_employee_refuses_with_409_and_changes_nothing(client, superadmin_headers, gov):
    p = await gov.person()
    await gov.employment(p)
    response = await erase(client, superadmin_headers, p.cid)
    assert response.status_code == 409
    assert response.json()["detail"] == erasure_service.EMPLOYMENT_REFUSAL
    assert "-" not in response.json()["detail"]
    db = get_db()
    assert (await db.candidates.find_one({"candidate_id": p.cid}))["name"] == p.name
    assert await db.resumes.count_documents({"resume_id": p.rid}) == 1
    assert await db.audit_log.count_documents({"action": "candidate_erase", "resource_id": p.cid}) == 0

    q = await gov.person()
    await gov.employment(q, accepted_only=True)
    assert (await erase(client, superadmin_headers, q.cid)).status_code == 409


async def test_include_employment_anonymises_the_offers_and_employee_and_deletes_reviews_and_goals(client, superadmin_headers, gov):
    p = await gov.person()
    await gov.employment(p)
    response = await erase(client, superadmin_headers, p.cid, include_employment=True)
    assert response.status_code == 200, response.text
    counts = response.json()["counts"]
    assert counts["offers"] == 2 and counts["employees"] == 1 and counts["performance_reviews"] == 1 and counts["goals"] == 1

    db = get_db()
    accepted = await db.offers.find_one({"offer_id": f"gov-acc-{p.tag}"}, {"_id": 0})
    assert set(accepted) <= erasure_service.OFFER_KEEP - {"_id"} and accepted["status"] == "accepted" and accepted["erased"] is True
    employee = await db.employees.find_one({"employee_id": f"gov-emp-{p.tag}"}, {"_id": 0})
    assert set(employee) <= erasure_service.EMPLOYEE_KEEP - {"_id"} and "manager_id" not in employee
    assert await db.performance_reviews.count_documents({"employee_id": f"gov-emp-{p.tag}"}) == 0
    peer = await db.performance_reviews.find_one({"review_id": f"gov-rv2-{p.tag}"})
    assert peer["reviewer_id"] is None and "secure_token" not in peer
    assert await db.goals.count_documents({"owner_id": f"gov-emp-{p.tag}"}) == 0
    assert (await db.goals.find_one({"goal_id": f"gov-g2-{p.tag}"}))["parent_goal_id"] is None
    assert not await db.offers.find_one({"secure_token": f"gov-acctok-{p.tag}"})
    audit = await db.audit_log.find_one({"action": "candidate_erase", "resource_id": p.cid})
    assert audit["details"]["include_employment"] is True


async def test_erase_by_email_removes_every_application_and_leaves_another_company_alone(client, superadmin_headers, gov, b, index):
    email = f"Gov.Shared.{uuid.uuid4().hex[:6]}@Example.com"
    first = await gov.person(email=email)
    second = await gov.person(email=email.lower())
    bystander = await gov.person()
    foreign = await gov.person(email=email, company=b)
    db = get_db()
    orphan = f"gov-orphan-{first.tag}"
    gov.rids.append(orphan)
    await db.resumes.insert_one({"resume_id": orphan, "candidate_email": email.upper(), "text": "scan", "created_at": iso(-30), "filename": "scan.pdf"})
    index.vectors[orphan] = DEFAULT_COMPANY_ID

    response = await client.post(
        f"{API}/candidates/erase-by-email", json={"email": f"  {email.upper()} ", "reason": REASON}, headers=superadmin_headers,
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["matched"] == 2 and sorted(body["candidate_ids"]) == sorted([first.cid, second.cid]) and body["vectors_failed"] == 0
    assert body["counts"]["candidates"] == 2 and body["counts"]["resumes"] >= 5 and body["erased_at"]
    for p in (first, second):
        assert all(count == 0 for count in (await traces(p)).values()), p.tag
    assert await db.resumes.count_documents({"resume_id": orphan}) == 0 and orphan not in index.vectors
    assert (await db.candidates.find_one({"candidate_id": bystander.cid}))["name"] == bystander.name
    with company_context(b):
        survivor = await get_db().candidates.find_one({"candidate_id": foreign.cid})
        assert survivor["name"] == foreign.name and survivor["email"] == email and survivor["secure_token"] == foreign.token
        assert await get_db().resumes.count_documents({"resume_id": foreign.rid}) == 1
    assert foreign.rid in index.vectors
    audits = await db.audit_log.find({"action": "candidate_erase"}).to_list(10)
    assert {a["resource_id"] for a in audits} == {first.cid, second.cid} and all(a["details"]["via"] == "email" for a in audits)

    again = await client.post(f"{API}/candidates/erase-by-email", json={"email": email, "reason": REASON}, headers=superadmin_headers)
    assert again.status_code == 200 and again.json()["matched"] == 0 and all(v == 0 for v in again.json()["counts"].values())
    assert again.json()["erased_at"] is None


async def test_erase_by_email_validates_its_body_and_respects_the_employment_refusal(client, superadmin_headers, gov):
    for body in ({"reason": REASON}, {"email": "", "reason": REASON}, {"email": "no-at-sign", "reason": REASON}):
        response = await client.post(f"{API}/candidates/erase-by-email", json=body, headers=superadmin_headers)
        assert response.status_code == 422 and response.json()["detail"] == "Enter a valid email address.", body
    assert (await client.post(f"{API}/candidates/erase-by-email", json={"email": "a@b.co"}, headers=superadmin_headers)).status_code == 422

    p = await gov.person()
    await gov.employment(p)
    refused = await client.post(f"{API}/candidates/erase-by-email", json={"email": p.email, "reason": REASON}, headers=superadmin_headers)
    assert refused.status_code == 409
    assert (await get_db().candidates.find_one({"candidate_id": p.cid}))["name"] == p.name
    allowed = await client.post(
        f"{API}/candidates/erase-by-email", json={"email": p.email, "reason": REASON, "include_employment": True}, headers=superadmin_headers,
    )
    assert allowed.status_code == 200 and allowed.json()["matched"] == 1


async def test_a_company_cannot_erase_another_companys_candidate(client, gov, b):
    p = await gov.person()
    response = await erase(client, super_of(b), p.cid)
    assert response.status_code == 404
    assert (await get_db().candidates.find_one({"candidate_id": p.cid}))["name"] == p.name
    by_email = await client.post(f"{API}/candidates/erase-by-email", json={"email": p.email, "reason": REASON}, headers=super_of(b))
    assert by_email.status_code == 200 and by_email.json()["matched"] == 0
    assert (await get_db().candidates.find_one({"candidate_id": p.cid}))["email"] == p.email


async def test_only_a_superadmin_may_erase_or_set_retention(client, admin_headers, standard_headers, superadmin_headers, gov):
    assert "candidates:erase" in DEFAULT_ROLE_PERMISSIONS["superadmin"]
    assert "candidates:erase" not in DEFAULT_ROLE_PERMISSIONS["admin"] and "candidates:erase" not in DEFAULT_ROLE_PERMISSIONS["standard"]
    p = await gov.person()
    calls = [
        ("post", f"/candidates/{p.cid}/erase", {"reason": REASON}),
        ("post", "/candidates/erase-by-email", {"email": p.email, "reason": REASON}),
        ("get", "/company-settings/retention", None),
        ("patch", "/company-settings/retention", {"candidate_days": 90}),
    ]
    for method, path, body in calls:
        denied = await client.request(method, API + path, json=body, headers=admin_headers)
        assert denied.status_code == 403 and "candidates:erase" in denied.json()["detail"], (method, path, denied.text)
        assert (await client.request(method, API + path, json=body, headers=standard_headers)).status_code == 403, (method, path)
        assert (await client.request(method, API + path, json=body)).status_code == 401, (method, path)
    assert (await get_db().candidates.find_one({"candidate_id": p.cid}))["name"] == p.name
    assert (await client.get(f"{API}/company-settings/retention", headers=superadmin_headers)).status_code == 200


async def test_an_admin_role_granted_the_permission_may_erase(client, admin_headers, gov):
    p = await gov.person()
    db = get_db()
    await db.roles.insert_one({"role_name": "admin", "permissions": [*DEFAULT_ROLE_PERMISSIONS["admin"], "candidates:erase"]})
    try:
        assert (await erase(client, admin_headers, p.cid)).status_code == 200
    finally:
        await db.roles.delete_one({"role_name": "admin"})


async def test_a_tombstone_reads_cleanly_everywhere_and_cannot_be_brought_back(client, superadmin_headers, admin_headers, standard_headers, gov):
    p = await gov.person()
    live = await gov.person()
    assert (await erase(client, superadmin_headers, p.cid)).status_code == 200

    for headers in (admin_headers, standard_headers):
        detail = await client.get(f"{API}/candidates/{p.cid}", headers=headers)
        assert detail.status_code == 200
        body = detail.json()
        assert body["erased"] is True and body["candidate_id"] == p.cid and "name" not in body and "email" not in body
        assert "secure_token" not in body
    admin_view = (await client.get(f"{API}/candidates/{p.cid}", headers=admin_headers)).json()
    assert admin_view["erasure"]["reason"] == REASON
    assert "erasure" not in (await client.get(f"{API}/candidates/{p.cid}", headers=standard_headers)).json()

    listing = await client.get(f"{API}/candidates?limit=200", headers=admin_headers)
    assert listing.status_code == 200
    rows = {r["candidate_id"]: r for r in listing.json()["candidates"]}
    assert rows[p.cid]["erased"] is True and rows[live.cid]["name"] == live.name and not rows[live.cid].get("erased")
    assert (await client.get(f"{API}/candidates/{p.cid}/timeline", headers=standard_headers)).json() == {"timeline": []}
    assert (await client.get(f"{API}/candidates/{p.cid}/emails", headers=admin_headers)).status_code == 200
    assert (await client.get(f"{API}/analytics/dashboard", headers=admin_headers)).status_code == 200

    blocked = [
        await client.post(f"{API}/candidates/{p.cid}/regenerate-token", json={"resend": False}, headers=admin_headers),
        await client.post(f"{API}/candidates/{p.cid}/decision", json={"decision": "reject"}, headers=admin_headers),
        await client.patch(f"{API}/candidates/{p.cid}/notes", json={"notes": "new personal note"}, headers=admin_headers),
        await client.post(f"{API}/candidates/{p.cid}/resend-invite", headers=admin_headers),
        await client.post(f"{API}/candidates/{p.cid}/send-email", json={"template": "reminder"}, headers=admin_headers),
        await client.patch(f"{API}/interview/{p.cid}/schedule", json={"scheduled_start_at": iso(3)}, headers=admin_headers),
        await client.patch(f"{API}/coding/assign/{p.cid}", json={"question_id": live.question_id}, headers=admin_headers),
    ]
    assert [r.status_code for r in blocked] == [409] * len(blocked), [r.text for r in blocked]
    assert all(r.json()["detail"] == erasure_service.ERASED_MESSAGE for r in blocked)
    assert (await client.post(f"{API}/offers", json={"candidate_id": p.cid, "salary": "1"}, headers=admin_headers)).status_code == 404
    tomb = await get_db().candidates.find_one({"candidate_id": p.cid}, {"_id": 0})
    assert set(tomb) <= erasure_service.CANDIDATE_KEEP - {"_id"}, "nothing was written onto the tombstone"
    assert (await client.post(f"{API}/candidates/{live.cid}/regenerate-token", json={"resend": False}, headers=admin_headers)).status_code == 200


async def test_the_needs_attention_queue_does_not_count_tombstones():
    from services.hr_module.attention_service import _Scope

    assert _Scope(None).candidates()["erased"] == {"$ne": True}
    assert _Scope(["j1"]).candidates({"status": "x"})["erased"] == {"$ne": True}


async def test_retention_defaults_to_keep_for_ever_and_can_be_set_partially(client, superadmin_headers, gov):
    first = await client.get(f"{API}/company-settings/retention", headers=superadmin_headers)
    assert first.status_code == 200
    assert first.json()["candidate_days"] is None and first.json()["resume_days"] is None and first.json()["last_purge"] is None

    patched = await client.patch(f"{API}/company-settings/retention", json={"candidate_days": 365}, headers=superadmin_headers)
    assert patched.status_code == 200
    assert (patched.json()["candidate_days"], patched.json()["resume_days"]) == (365, None)
    assert patched.json()["updated_by"] == "demo-superadmin@hirely.ai" and patched.json()["updated_at"]

    both = await client.patch(f"{API}/company-settings/retention", json={"resume_days": 90}, headers=superadmin_headers)
    assert (both.json()["candidate_days"], both.json()["resume_days"]) == (365, 90)
    cleared = await client.patch(f"{API}/company-settings/retention", json={"candidate_days": None}, headers=superadmin_headers)
    assert (cleared.json()["candidate_days"], cleared.json()["resume_days"]) == (None, 90)
    assert (await client.get(f"{API}/company-settings/retention", headers=superadmin_headers)).json()["resume_days"] == 90

    stored = await get_db().company_settings.find_one({"_id": "singleton"})
    assert stored["retention"]["resume_days"] == 90 and stored["retention"]["candidate_days"] is None
    assert (await client.get(f"{API}/company-settings", headers=superadmin_headers)).status_code == 200
    audits = await get_db().audit_log.find({"action": "retention_update"}).sort("created_at", 1).to_list(10)
    assert len(audits) == 3 and audits[-1]["details"]["after"] == {"candidate_days": None, "resume_days": 90}


async def test_a_retention_period_under_thirty_days_is_refused(client, superadmin_headers, gov):
    for bad in (29, 0, -1, 36501):
        response = await client.patch(f"{API}/company-settings/retention", json={"candidate_days": bad}, headers=superadmin_headers)
        assert response.status_code == 422, bad
        assert "Candidate retention must be" in response.json()["detail"]
    low = await client.patch(f"{API}/company-settings/retention", json={"resume_days": 7}, headers=superadmin_headers)
    assert low.status_code == 422 and "at least 30 days" in low.json()["detail"]
    assert (await client.patch(f"{API}/company-settings/retention", json={"candidate_days": 30}, headers=superadmin_headers)).status_code == 200
    unchanged = (await client.get(f"{API}/company-settings/retention", headers=superadmin_headers)).json()
    assert (unchanged["candidate_days"], unchanged["resume_days"]) == (30, None)


async def test_retention_is_per_company(client, superadmin_headers, gov, b):
    assert (await client.patch(f"{API}/company-settings/retention", json={"candidate_days": 60}, headers=superadmin_headers)).status_code == 200
    other = (await client.get(f"{API}/company-settings/retention", headers=super_of(b))).json()
    assert other["candidate_days"] is None and other["resume_days"] is None


def old_candidate(tag, **fields):
    doc = {
        "doc_type": "candidate", "candidate_id": f"gov-ret-{tag}", "job_id": "gov-ret-job", "name": f"Retention {tag}",
        "email": f"ret-{tag}@example.com", "status": "rejected", "pipeline_stage": "rejected", "decision": "reject",
        "secure_token": f"gov-rettok-{tag}", "created_at": iso(-400), "invite_sent_at": iso(-400), "invite_expires_at": iso(-393),
        "decided_at": iso(-200),
    }
    doc.update(fields)
    return doc


async def test_the_retention_purge_erases_only_what_is_eligible(gov):
    db = get_db()
    tags = {name: uuid.uuid4().hex[:6] for name in (
        "old", "recent", "hired", "offered", "employed", "interviewing", "hold", "awaiting", "live_invite", "expired_invite",
    )}
    rows = [
        old_candidate(tags["old"]),
        old_candidate(tags["recent"], decided_at=iso(-5)),
        old_candidate(tags["hired"], status="hired", pipeline_stage="hired", decision="hire"),
        old_candidate(tags["offered"]),
        old_candidate(tags["employed"]),
        old_candidate(tags["interviewing"], status="interviewing", pipeline_stage="interviewing", decision=None),
        old_candidate(tags["hold"], status="completed", pipeline_stage="completed", decision="hold"),
        old_candidate(tags["awaiting"], status="completed", pipeline_stage="completed", decision=None),
        old_candidate(tags["live_invite"], status="invited", pipeline_stage="invited", decision=None, token_status="active",
                      decided_at=None, invite_expires_at=iso(2)),
        old_candidate(tags["expired_invite"], status="invited", pipeline_stage="invited", decision=None, token_status="active",
                      decided_at=None, invite_sent_at=iso(-300), created_at=iso(-300), invite_expires_at=iso(-293)),
    ]
    ids = {name: f"gov-ret-{tag}" for name, tag in tags.items()}
    gov.cids += list(ids.values())
    await db.candidates.insert_many(rows)
    gov.offers.append(f"gov-ret-offer-{tags['offered']}")
    gov.employees.append(f"gov-ret-emp-{tags['employed']}")
    await db.offers.insert_one({"doc_type": "offer", "offer_id": f"gov-ret-offer-{tags['offered']}", "candidate_id": ids["offered"], "status": "declined"})
    await db.employees.insert_one({"employee_id": f"gov-ret-emp-{tags['employed']}", "candidate_id": ids["employed"], "status": "active"})
    await retention_service.set_policy(db, {"candidate_days": 90}, updated_by="test")

    result = await retention_service.purge_company(60)

    assert result["enabled"] is True and result["complete"] is True and result["candidates_erased"] >= 2
    for name in ("old", "expired_invite"):
        row = await db.candidates.find_one({"candidate_id": ids[name]}, {"_id": 0})
        assert row["erased"] is True and "name" not in row and "secure_token" not in row, name
        assert row["erasure"]["by"] == "retention"
    for name in set(ids) - {"old", "expired_invite"}:
        row = await db.candidates.find_one({"candidate_id": ids[name]})
        assert not row.get("erased") and row["name"] == f"Retention {tags[name]}", name
    audit = await db.audit_log.find({"action": "retention_purge"}).to_list(5)
    assert len(audit) == 1 and audit[0]["details"]["candidates_erased"] >= 2 and audit[0]["actor_role"] == "cron"
    assert await db.audit_log.count_documents({"action": "candidate_erase"}) == 0
    last = (await retention_service.last_purge(db))
    assert last["candidates_erased"] == audit[0]["details"]["candidates_erased"]


async def test_old_resumes_with_no_candidate_are_purged_and_attached_ones_stay(gov):
    db = get_db()
    tag = uuid.uuid4().hex[:6]
    gov.rids += [f"gov-ret-r-old-{tag}", f"gov-ret-r-used-{tag}", f"gov-ret-r-new-{tag}", f"gov-ret-r-live-{tag}"]
    gov.cids.append(f"gov-ret-c-{tag}")
    await db.resumes.insert_many([
        {"resume_id": f"gov-ret-r-old-{tag}", "created_at": iso(-300), "candidate_email": f"nobody-{tag}@example.com", "filename": "a.pdf"},
        {"resume_id": f"gov-ret-r-used-{tag}", "created_at": iso(-300), "filename": "b.pdf"},
        {"resume_id": f"gov-ret-r-new-{tag}", "created_at": iso(-3), "filename": "c.pdf"},
        {"resume_id": f"gov-ret-r-live-{tag}", "created_at": iso(-300), "candidate_email": f"LIVE-{tag}@example.com", "filename": "d.pdf"},
    ])
    await db.candidates.insert_one({
        "doc_type": "candidate", "candidate_id": f"gov-ret-c-{tag}", "resume_id": f"gov-ret-r-used-{tag}", "email": f"live-{tag}@example.com",
        "status": "invited", "pipeline_stage": "invited", "created_at": iso(-3),
    })
    await retention_service.set_policy(db, {"resume_days": 90}, updated_by="test")

    result = await retention_service.purge_company(60)

    assert result["resumes_erased"] >= 1
    assert await db.resumes.count_documents({"resume_id": f"gov-ret-r-old-{tag}"}) == 0
    for name in ("used", "new", "live"):
        assert await db.resumes.count_documents({"resume_id": f"gov-ret-r-{name}-{tag}"}) == 1, name


async def test_a_company_with_retention_off_erases_nothing(gov):
    db = get_db()
    tag = uuid.uuid4().hex[:6]
    gov.cids.append(f"gov-ret-{tag}")
    await db.candidates.insert_one(old_candidate(tag))
    await db.company_settings.update_one({"_id": "singleton"}, {"$unset": {"retention": ""}})
    result = await retention_service.purge_company(30)
    assert result["enabled"] is False and result["candidates_erased"] == 0 and result["resumes_erased"] == 0
    assert (await db.candidates.find_one({"candidate_id": f"gov-ret-{tag}"}))["name"] == f"Retention {tag}"
    assert await db.audit_log.count_documents({"action": "retention_purge"}) == 0


async def test_another_companys_retention_never_reaches_this_one(gov, b):
    db = get_db()
    tag = uuid.uuid4().hex[:6]
    gov.cids.append(f"gov-ret-{tag}")
    await db.candidates.insert_one(old_candidate(tag))
    with company_context(b):
        await retention_service.set_policy(get_db(), {"candidate_days": 30}, updated_by="test")
        mine = await retention_service.purge_company(30)
        assert mine["candidates_erased"] == 0
    assert (await db.candidates.find_one({"candidate_id": f"gov-ret-{tag}"}))["name"] == f"Retention {tag}"


CRON_SECRET = "gov-cron-secret-0123456789abcdef"


@pytest.fixture
async def cron_world(monkeypatch):
    ops = ops_store.install(monkeypatch)

    async def default_only():
        return [{"company_id": DEFAULT_COMPANY_ID, "name": "Default", "settings": {}}]

    async def no_platform_checks(began):
        return None

    monkeypatch.setattr(workspace_service, "list_active_companies", default_only)
    monkeypatch.setattr(cron_service, "_run_platform_checks", no_platform_checks)
    monkeypatch.setattr(cron_service, "_alert_job_failure", lambda *a, **k: _done())
    monkeypatch.setattr(settings, "CRON_SECRET", CRON_SECRET)
    yield ops
    raw = get_platform_db()
    await raw.settings.delete_many({"key": {"$regex": "^cron_"}})
    await raw.companies.update_one({"company_id": DEFAULT_COMPANY_ID}, {"$unset": {"cron": ""}})


async def _done():
    return None


async def test_the_retention_job_erases_for_the_company_and_the_endpoint_runs_it(client, cron_world, gov):
    db = get_db()
    tag = uuid.uuid4().hex[:6]
    gov.cids.append(f"gov-ret-{tag}")
    await db.candidates.insert_one(old_candidate(tag))
    await retention_service.set_policy(db, {"candidate_days": 90}, updated_by="test")

    response = await client.get(f"{API}/cron/retention", headers={"Authorization": f"Bearer {CRON_SECRET}"})

    assert response.status_code == 200, response.text
    (result,) = response.json()["results"]
    assert result["key"] == "retention" and result["label"] == "Data retention" and result["status"] == "ok"
    assert result["detail"].startswith("Erased ") and "candidate(s)" in result["detail"]
    assert (await db.candidates.find_one({"candidate_id": f"gov-ret-{tag}"}))["erased"] is True
    assert cron_world.cron_runs.docs[-1]["key"] == "retention" and cron_world.cron_runs.docs[-1]["status"] == "ok"
    assert (await client.get(f"{API}/cron/retention")).status_code == 401


async def test_the_daily_run_ends_with_retention_and_a_company_with_it_off_reports_ok(cron_world, gov, monkeypatch):
    async def nothing():
        return "ok", "skipped in this test"

    monkeypatch.setattr(cron_service, "_RUNNERS", {
        **cron_service._RUNNERS, "reminders": nothing, "external_reminders": nothing, "job_sync": nothing,
    })
    await get_db().company_settings.update_one({"_id": "singleton"}, {"$unset": {"retention": ""}})
    results = await cron_service.run_daily()
    assert [r["key"] for r in results] == ["reminders", "external_reminders", "job_sync", "retention"]
    assert results[-1]["status"] == "ok" and results[-1]["detail"] == "Retention is off for this company."


def coding_candidate(tag, **fields):
    doc = {
        "doc_type": "candidate", "candidate_id": f"gov-cd-{tag}", "job_id": "gov-cd-job", "name": f"Coder {tag}",
        "email": f"coder-{tag}@example.com", "secure_token": f"gov-cdtok-{tag}", "token_status": "active", "status": "invited",
        "pipeline_stage": "invited", "created_at": iso(-3), "invite_sent_at": iso(-3), "invite_expires_at": iso(4),
        "coding_question_id": f"gov-cdq-{tag}",
    }
    doc.update(fields)
    return doc


@pytest.fixture
async def coder(monkeypatch):
    db = get_db()
    tag = uuid.uuid4().hex[:8]
    await db.coding_questions.insert_one({
        "question_id": f"gov-cdq-{tag}", "title": "Sum", "description": "add", "language_templates": {"python": "pass"},
        "test_cases": [{"input": "1 2", "expected_output": "3", "is_hidden": False}], "difficulty": "easy",
    })
    await db.coding_submissions.insert_one({
        "submission_id": f"gov-cds-{tag}", "candidate_id": f"gov-cd-{tag}", "question_id": f"gov-cdq-{tag}", "status": "completed",
        "language": "python", "code": "print(3)", "submitted_at": iso(-1),
    })

    async def evaluate_submission(**kwargs):
        return {"submission_id": "x", "status": "completed", "score": 100, "language": kwargs["language"]}

    async def run_in_sandbox(code, language, stdin):
        return {"stdout": "3", "stderr": "", "status": {"description": "Accepted"}}

    async def probe(**kwargs):
        return "Now handle negative numbers."

    monkeypatch.setattr(coding_service, "evaluate_submission", evaluate_submission)
    monkeypatch.setattr(coding_service, "run_in_sandbox", run_in_sandbox)
    monkeypatch.setattr(coding_service, "generate_live_modification_probe", probe)
    created = SimpleNamespace(tag=tag, ids=[f"gov-cd-{tag}"])

    async def add(**fields):
        await db.candidates.insert_one(coding_candidate(tag, **fields))

    created.add = add
    yield created
    await db.candidates.delete_many({"candidate_id": {"$in": created.ids}})
    await db.coding_questions.delete_many({"question_id": f"gov-cdq-{tag}"})
    await db.coding_submissions.delete_many({"candidate_id": f"gov-cd-{tag}"})
    await db.coding_session_state.delete_many({"candidate_id": f"gov-cd-{tag}"})
    await db.audit_log.delete_many({"resource_id": f"gov-cd-{tag}"})


PUBLIC_CODING_CALLS = [
    ("get", "", None),
    ("post", "/submit", {"language": "python", "code": "print(3)"}),
    ("post", "/run", {"language": "python", "code": "print(3)"}),
    ("post", "/modify-probe", None),
    ("post", "/flag", {"event": "paste_blocked"}),
    ("post", "/autosave", {"language": "python", "code": "x = 1"}),
]


@pytest.mark.parametrize("method,suffix,body", PUBLIC_CODING_CALLS, ids=[c[1] or "get-session" for c in PUBLIC_CODING_CALLS])
async def test_an_expired_coding_link_answers_410_on_every_public_route_and_a_live_one_works(client, coder, method, suffix, body):
    await coder.add(coding_invite_expires_at=iso(3))
    live = await client.request(method, f"{API}/coding/session/gov-cdtok-{coder.tag}{suffix}", json=body)
    assert live.status_code == 200, live.text

    await get_db().candidates.update_one({"candidate_id": f"gov-cd-{coder.tag}"}, {"$set": {"coding_invite_expires_at": iso(-0.01)}})
    gone = await client.request(method, f"{API}/coding/session/gov-cdtok-{coder.tag}{suffix}", json=body)
    assert gone.status_code == 410
    assert gone.json()["detail"] == EXPIRED_MESSAGE == "This assessment link has expired. Ask your recruiter for a new one."


async def test_without_a_stamp_the_link_lives_until_the_interview_link_expiry_plus_the_grace(client, coder, monkeypatch):
    monkeypatch.setattr(settings, "CODING_LINK_GRACE_DAYS", 30)
    inside = coder.tag
    await coder.add(invite_expires_at=iso(-10))
    assert (await client.get(f"{API}/coding/session/gov-cdtok-{inside}")).status_code == 200
    await get_db().candidates.update_one({"candidate_id": f"gov-cd-{inside}"}, {"$set": {"invite_expires_at": iso(-31)}})
    assert (await client.get(f"{API}/coding/session/gov-cdtok-{inside}")).status_code == 410
    monkeypatch.setattr(settings, "CODING_LINK_GRACE_DAYS", 60)
    assert (await client.get(f"{API}/coding/session/gov-cdtok-{inside}")).status_code == 200


async def test_an_unknown_coding_token_is_still_404_and_a_live_stamp_beats_an_old_interview_link(client, coder):
    assert (await client.get(f"{API}/coding/session/gov-cdtok-nobody")).status_code == 404
    await coder.add(coding_invite_expires_at=iso(2), invite_expires_at=iso(-200))
    assert (await client.get(f"{API}/coding/session/gov-cdtok-{coder.tag}")).status_code == 200


async def test_sending_the_coding_invite_again_stamps_a_fresh_expiry_and_revives_the_link(client, admin_headers, coder, monkeypatch):
    sent = []

    async def fake_send_email(**kwargs):
        sent.append(kwargs)
        return True

    monkeypatch.setattr(email_service, "send_email", fake_send_email)
    await coder.add(coding_invite_expires_at=iso(-3), invite_expires_at=iso(-100))
    token_url = f"{API}/coding/session/gov-cdtok-{coder.tag}"
    assert (await client.get(token_url)).status_code == 410

    response = await client.patch(
        f"{API}/coding/assign/gov-cd-{coder.tag}", json={"question_id": f"gov-cdq-{coder.tag}"}, headers=admin_headers,
    )

    assert response.status_code == 200 and response.json()["email_sent"] is True and len(sent) == 1
    stamp = datetime.fromisoformat((await get_db().candidates.find_one({"candidate_id": f"gov-cd-{coder.tag}"}))["coding_invite_expires_at"])
    lifetime = timedelta(days=settings.INVITE_LINK_EXPIRY_DAYS)
    assert abs((stamp - (datetime.now(timezone.utc) + lifetime)).total_seconds()) < 60
    assert (await client.get(token_url)).status_code == 200


async def test_regenerating_the_token_stamps_a_fresh_coding_expiry_on_the_new_token(client, admin_headers, coder):
    await coder.add(coding_invite_expires_at=iso(-3), invite_expires_at=iso(-100))
    response = await client.post(f"{API}/candidates/gov-cd-{coder.tag}/regenerate-token", json={"resend": False}, headers=admin_headers)
    assert response.status_code == 200
    new_token = response.json()["secure_token"]
    assert (await client.get(f"{API}/coding/session/gov-cdtok-{coder.tag}")).status_code == 404
    assert (await client.get(f"{API}/coding/session/{new_token}")).status_code == 200
    row = await get_db().candidates.find_one({"candidate_id": f"gov-cd-{coder.tag}"})
    assert datetime.fromisoformat(row["coding_invite_expires_at"]) > datetime.now(timezone.utc) + timedelta(days=settings.INVITE_LINK_EXPIRY_DAYS - 1)


async def test_a_candidate_without_coding_gets_no_stamp_when_the_token_is_regenerated(client, admin_headers, gov):
    p = await gov.person(coding_question_id=None, coding_invite_expires_at=None)
    await get_db().candidates.update_one({"candidate_id": p.cid}, {"$unset": {"coding_question_id": "", "coding_invite_expires_at": ""}})
    assert (await client.post(f"{API}/candidates/{p.cid}/regenerate-token", json={"resend": False}, headers=admin_headers)).status_code == 200
    assert "coding_invite_expires_at" not in await get_db().candidates.find_one({"candidate_id": p.cid})


@pytest.fixture
async def no_coding_company(b):
    raw = get_platform_db()
    company = await raw.companies.find_one({"company_id": b})
    await raw.clients.update_one({"client_id": company["client_id"]}, {"$set": {"plan.features": {"coding": False}}})
    emails = {}
    for role in ("superadmin", "standard"):
        email = f"gov-{role}-{uuid.uuid4().hex[:6]}@example.com"
        await raw.users.insert_one({
            "name": role, "email": email, "role": role, "is_active": True, "company_id": b,
            "password_hash": "x", "created_at": iso(-1),
        })
        emails[role] = _jwt(email)
    return SimpleNamespace(company_id=b, super=emails["superadmin"], standard=emails["standard"])


ADMIN_CODING_CALLS = [
    ("get", "/coding/questions", None),
    ("post", "/coding/questions", {"title": "t", "description": "d"}),
    ("post", "/coding/questions/generate", {"job_domain": "software_engineering"}),
    ("get", "/coding/questions/nope", None),
    ("patch", "/coding/questions/nope", {"title": "y"}),
    ("delete", "/coding/questions/nope", None),
    ("patch", "/coding/assign/nope", {"question_id": "q"}),
    ("get", "/coding/submissions", None),
    ("get", "/coding/submissions/nope", None),
    ("get", "/coding/live/sessions", None),
    ("get", "/coding/live/nope", None),
]


@pytest.mark.parametrize("method,path,body", ADMIN_CODING_CALLS, ids=[f"{m} {p}" for m, p, _ in ADMIN_CODING_CALLS])
async def test_a_plan_without_coding_gets_402_on_every_admin_coding_route(client, no_coding_company, method, path, body):
    response = await client.request(method, API + path, json=body, headers=no_coding_company.super)
    assert response.status_code == 402, response.text
    assert response.json()["detail"] == "Your plan does not include coding assessments."


async def test_the_role_check_comes_before_the_plan_check_and_other_companies_are_unaffected(client, no_coding_company, admin_headers):
    assert (await client.get(f"{API}/coding/questions", headers=no_coding_company.standard)).status_code == 403
    assert (await client.get(f"{API}/coding/questions", headers=admin_headers)).status_code == 200
    assert (await client.get(f"{API}/coding/submissions", headers=admin_headers)).status_code == 200


async def test_a_candidate_link_already_issued_still_works_when_the_plan_has_no_coding(client, no_coding_company, monkeypatch):
    b = no_coding_company.company_id
    tag = uuid.uuid4().hex[:8]
    with company_context(b):
        await get_db().coding_questions.insert_one({
            "question_id": f"gov-nc-q-{tag}", "title": "Sum", "description": "add", "language_templates": {}, "test_cases": [], "difficulty": "easy",
        })
        await get_db().candidates.insert_one(coding_candidate(tag, candidate_id=f"gov-nc-{tag}", secure_token=f"gov-nctok-{tag}",
                                                              coding_question_id=f"gov-nc-q-{tag}", coding_invite_expires_at=iso(3)))
    response = await client.get(f"{API}/coding/session/gov-nctok-{tag}")
    assert response.status_code == 200, response.text
    assert (await client.post(f"{API}/coding/session/gov-nctok-{tag}/flag", json={"event": "paste_blocked"})).status_code == 200


async def test_the_four_new_routes_exist_with_the_guard_and_the_literal_path_comes_before_the_catch_all():
    from main import app
    from support_routes import all_routes

    mine = {f"{sorted(r.methods)[0]} {r.path}": r for r in all_routes() if r.path in (
        "/api/v1/candidates/{candidate_id}/erase", "/api/v1/candidates/erase-by-email", "/api/v1/company-settings/retention",
    )}
    assert set(mine) == {
        "POST /api/v1/candidates/{candidate_id}/erase", "POST /api/v1/candidates/erase-by-email",
        "GET /api/v1/company-settings/retention", "PATCH /api/v1/company-settings/retention",
    }
    for route in mine.values():
        assert route.permissions == {"candidates:erase"} and "require_admin" in route.roles

    from routes import candidates, data_governance

    mounted = [getattr(route, "original_router", None) for route in app.routes]
    assert mounted.index(data_governance.router) < mounted.index(candidates.router), (
        "data governance is mounted ahead of the candidates router, so its literal paths are never read as a candidate id"
    )
