import json
from types import SimpleNamespace

import pytest
from fastapi import APIRouter, Depends, FastAPI
from httpx import ASGITransport, AsyncClient

from config import tenancy
from config.tenancy import DEFAULT_COMPANY_ID, TenantDB
from fake_mongo import FakeRaw
from services.hr_module import erasure_service as svc
from services.hr_module.candidate_redaction import ADMIN_ONLY_KEYS, CANDIDATE_FIELDS_FOR_NON_ADMIN

pytestmark = pytest.mark.anyio

A, B = "cmp_a", "cmp_b"
EMAIL = "Jane.Doe@Example.com"
NOW = "2026-01-01T00:00:00+00:00"
ACTOR = {"email": "boss@acme.test", "role": "superadmin"}
REASON = "Subject access request 2026-10"

MARKERS = (
    "Jane", "jane.doe", "Doe", "555 0100", "15550100", "linkedin.com/in/jane", "private answer",
    "call her back", "tok-1", "strong fit", "Jane_Doe_CV", "negotiate", "She is great",
)


@pytest.fixture
def world(monkeypatch):
    raw = FakeRaw()
    index = FakeIndex()
    monkeypatch.setattr(svc, "get_pinecone", lambda: index)
    tenancy.use_fallback_company(A)
    yield SimpleNamespace(raw=raw, db=TenantDB(raw, A), index=index)
    tenancy.use_fallback_company(DEFAULT_COMPANY_ID)


class FakeIndex:

    def __init__(self):
        self.vectors: dict[str, str | None] = {}
        self.deleted: list[list[str]] = []
        self.fail = False

    def put(self, vector_id, company=A):
        self.vectors[vector_id] = company

    def fetch(self, ids):
        return SimpleNamespace(vectors={
            i: SimpleNamespace(metadata={"company_id": self.vectors[i]}) for i in ids if i in self.vectors
        })

    def delete(self, ids=None, **kwargs):
        if self.fail:
            raise RuntimeError("the vector store is down")
        self.deleted.append(list(ids))
        for i in ids:
            self.vectors.pop(i, None)


def seed_person(w, *, company=A, tag="1", email=EMAIL, job="job-1", status="completed", decision="hold", **extra):
    raw = w.raw
    cid, rid, old = f"cand-{tag}", f"res-{tag}", f"res-{tag}-old"
    cand = {
        "doc_type": "candidate", "candidate_id": cid, "job_id": job, "resume_id": rid,
        "name": "Jane Doe", "email": email, "phone": "+1 555 0100", "phone_normalized": "15550100",
        "linkedin_url": "https://linkedin.com/in/jane", "linkedin_normalized": "linkedin.com/in/jane",
        "status": status, "pipeline_stage": status, "decision": decision, "secure_token": f"tok-{tag}",
        "token_status": "consumed", "invite_type": "manual", "application_source": "career_site",
        "transcript": [{"question": "Tell me", "answer": "private answer"}], "report": {"summary": "strong fit"},
        "eval_score": 82, "final_score": 82, "integrity_flags": ["tab@x"], "recruiter_notes": "call her back",
        "decision_notes": "She is great", "interview_scorecards": [{"scorecard_id": "s1", "notes": "Jane"}],
        "interview_guide": {"questions": []}, "external_review": {"overall": 4}, "meeting_join_url": "https://zoom.us/j/1",
        "invited_by": "hr@acme.test", "created_at": NOW, "invite_sent_at": NOW, "coding_question_id": "q1",
        "coding_invite_expires_at": NOW, "decided_at": NOW, "_questions": ["q"], "recruiter_notes_updated_at": NOW,
    }
    cand.update(extra)
    raw.add("candidates", cand, company)
    raw.add("resumes", {
        "resume_id": rid, "candidate_email": email.lower(), "candidate_name": "Jane Doe", "text": "Jane Doe CV ... 555 0100",
        "embedding": [0.1], "filename": "Jane_Doe_CV.pdf", "previous_resume_id": old, "superseded_by": None, "created_at": NOW,
    }, company)
    raw.add("resumes", {
        "resume_id": old, "candidate_email": email, "candidate_name": "Jane Doe", "text": "older Jane Doe CV",
        "filename": "Jane_Doe_CV_v1.pdf", "previous_resume_id": None, "superseded_by": rid, "created_at": NOW,
    }, company)
    raw.add("resume_files", {"resume_id": rid, "filename": "Jane_Doe_CV.pdf", "data": b"Jane"}, company)
    raw.add("resume_files", {"resume_id": old, "filename": "Jane_Doe_CV_v1.pdf", "data": b"Jane"}, company)
    raw.add("jobs", {"job_id": job, "title": "Engineer", "candidate_pipeline": [
        {"resume_id": rid, "pipeline_stage": status}, {"resume_id": "res-someone-else", "pipeline_stage": "matched"},
    ]}, company)
    raw.add("marketplace_module", {"profile_id": f"prof-{tag}", "resume_id": rid, "email": email, "name": "Jane Doe"}, company)
    raw.add("upload_batches", {"batch_id": f"b-{tag}", "errors": [
        {"filename": "Jane_Doe_CV.pdf", "error": "unreadable"}, {"filename": "other.pdf", "error": "unreadable"},
    ]}, company)
    raw.add("candidate_profiles", {
        "profile_id": f"pp-{tag}", "email": email.lower(), "name": "Jane Doe", "phone_normalized": "15550100",
        "candidate_ids": [cid], "job_ids": [job], "resume_ids": [rid], "profile_notes": "Jane likes remote",
    }, company)
    raw.add("candidate_demographics", {"candidate_id": cid, "gender": "f", "location": "Lisbon"}, company)
    raw.add("coding_submissions", {"submission_id": f"sub-{tag}", "candidate_id": cid, "code": "print('Jane')"}, company)
    raw.add("coding_session_state", {"candidate_id": cid, "question_id": "q1", "code": "draft"}, company)
    raw.add("interviewer_links", {"link_id": f"l-{tag}", "candidate_id": cid, "interviewer_name": "Ann"}, company)
    raw.add("report_shares", {"share_id": f"sh-{tag}", "candidate_id": cid, "feedback": [{"comment": "She is great"}]}, company)
    raw.add("hrms_sync_log", {"candidate_id": cid, "detail": "Jane Doe accepted"}, company)
    raw.add("email_log", {
        "to": email, "subject": "Interview invitation for Jane", "template": "interview_invite", "candidate_id": cid,
        "status": "failed", "error": "550 mailbox jane.doe@example.com unknown", "created_at": NOW,
    }, company)
    raw.add("email_log", {
        "to": email.upper(), "subject": "Hello", "template": "x", "status": "sent", "created_at": NOW,
    }, company)
    raw.add("audit_log", {
        "action": "candidate_invited", "resource_type": "candidate", "resource_id": cid,
        "details": {"job_id": job, "email": email, "invite_type": "manual"}, "created_at": NOW,
    }, company)
    raw.add("audit_log", {
        "action": "candidate_notes_updated", "resource_type": "candidate", "resource_id": cid,
        "details": {"notes": "call her back"}, "created_at": NOW,
    }, company)
    raw.add("audit_log", {
        "action": "resume_upload", "resource_type": "resume", "resource_id": rid,
        "details": {"filename": "Jane_Doe_CV.pdf", "job_id": job}, "created_at": NOW,
    }, company)
    raw.add("offers", {
        "doc_type": "offer", "offer_id": f"off-{tag}", "candidate_id": cid, "job_id": job, "status": "draft",
        "salary": "negotiate 90k", "benefits": "x", "secure_token": f"offtok-{tag}", "created_by": "hr@acme.test",
        "created_at": NOW, "updated_at": NOW,
    }, company)
    w.index.put(rid, company)
    w.index.put(old, company)
    return cid


def text_of_company(w, company=A) -> str:
    return w.raw.dump(company)


async def erase(w, cid="cand-1", **kw):
    return await svc.erase_candidate(w.db, cid, actor=ACTOR, reason=REASON, **kw)


def test_a_tombstone_keeps_only_the_contract_fields_and_drops_the_token():
    doc = {
        "_id": "x", "company_id": A, "doc_type": "candidate", "candidate_id": "c", "job_id": "j", "status": "rejected",
        "pipeline_stage": "rejected", "decision": "reject", "created_at": NOW, "name": "N", "email": "e@x.co",
        "secure_token": "t", "transcript": [], "report": {}, "recruiter_notes": "n", "phone": "p",
    }
    update = svc.tombstone_update([doc], now="2026-10-12T00:00:00+00:00", actor=ACTOR, reason=REASON)
    assert update["$set"] == {
        "erased": True, "erased_at": "2026-10-12T00:00:00+00:00", "erasure": {"by": "boss@acme.test", "reason": REASON},
    }
    assert set(update["$unset"]) == {"name", "email", "secure_token", "transcript", "report", "recruiter_notes", "phone"}
    kept = set(doc) - set(update["$unset"])
    assert kept == {"_id", "company_id", "doc_type", "candidate_id", "job_id", "status", "pipeline_stage", "decision", "created_at"}


def test_every_known_candidate_field_outside_the_keep_list_is_removed():
    known = set(CANDIDATE_FIELDS_FOR_NON_ADMIN) | set(ADMIN_ONLY_KEYS) | {
        "phone_normalized", "linkedin_normalized", "recruiter_notes_updated_by", "interview_guide", "coding_integrity_flags",
        "external_interview", "meeting", "last_resent_by", "token_regenerated_by", "invite_email_delivered", "brand_new_field",
    }
    doc = {key: "x" for key in known}
    unset = set(svc.tombstone_update([doc], now=NOW, actor=ACTOR, reason=REASON)["$unset"])
    assert unset == {k for k in known if k not in svc.CANDIDATE_KEEP}
    for personal in ("name", "email", "phone", "linkedin_url", "secure_token", "transcript", "report", "recruiter_notes",
                     "resume_id", "external_review", "interview_scorecards", "decision_notes", "brand_new_field"):
        assert personal in unset, personal


def test_the_keep_lists_never_hold_a_personal_field():
    personal = {"name", "email", "phone", "salary", "benefits", "joining_date", "signature", "secure_token", "decline_reason",
                "ai_letter_body", "manager_id", "linkedin_url", "resume_id", "transcript"}
    for keep in (svc.CANDIDATE_KEEP, svc.OFFER_KEEP, svc.EMPLOYEE_KEEP):
        assert not (personal & keep)


def test_an_anonymised_offer_and_employee_keep_ids_and_status_only():
    offer = {"_id": "o", "company_id": A, "offer_id": "1", "candidate_id": "c", "status": "accepted", "salary": "9", "secure_token": "t",
             "signature": {"typed_name": "Jane", "ip_address": "1.2.3.4"}, "ai_letter_body": "Dear Jane", "decline_reason": "x"}
    update = svc.anonymise_update([offer], svc.OFFER_KEEP, {"erased": True, "erased_at": NOW})
    assert set(update["$unset"]) == {"salary", "secure_token", "signature", "ai_letter_body", "decline_reason"}
    employee = {"_id": "e", "company_id": A, "employee_id": "1", "candidate_id": "c", "manager_id": "boss@acme.test", "status": "active"}
    assert set(svc.anonymise_update([employee], svc.EMPLOYEE_KEEP, {})["$unset"]) == {"manager_id"}
    assert "$unset" not in svc.anonymise_update([{"_id": "e", "status": "x"}], svc.EMPLOYEE_KEEP, {})


def test_email_matching_is_case_insensitive_and_literal():
    import re

    pattern = svc.email_pattern("Jane.Doe+a@Example.com")
    rx = re.compile(pattern["$regex"], re.IGNORECASE)
    assert pattern["$options"] == "i"
    assert rx.search("jane.doe+a@example.com") and rx.search("JANE.DOE+A@EXAMPLE.COM")
    assert not rx.search("janeXdoe+a@example.com") and not rx.search("prefix-jane.doe+a@example.com")
    assert not rx.search("jane.doe+a@example.com.evil")
    assert svc.normalise_email("  Jane@X.COM ") == "jane@x.com" and svc.normalise_email(None) == ""


def test_the_reason_must_be_three_to_five_hundred_characters():
    assert svc.clean_reason("  ok   then  ") == "ok then"
    assert svc.clean_reason("abc") == "abc" and len(svc.clean_reason("x" * 500)) == 500
    for bad in (None, "", "  ", "ab", "x" * 501):
        with pytest.raises(svc.ErasureError) as err:
            svc.clean_reason(bad)
        assert err.value.status == 422 and "3 to 500" in err.value.message


async def test_erasing_a_candidate_leaves_no_trace_of_the_person_anywhere_in_the_company(world):
    cid = seed_person(world)
    result = await erase(world)

    assert result["candidate_id"] == cid and result["erased"] is True and result["already_erased"] is False
    assert result["vectors_failed"] == 0 and result["other_applications"] == 0

    leftover = [m for m in MARKERS if m in text_of_company(world)]
    assert not leftover, f"still in the company's data: {leftover}"

    counts = result["counts"]
    assert set(counts) == set(svc.COUNT_KEYS)
    assert counts["candidates"] == 1 and counts["resumes"] == 2 and counts["resume_files"] == 2
    assert counts["demographics"] == counts["coding_submissions"] == counts["coding_sessions"] == 1
    assert counts["interviewer_links"] == counts["report_shares"] == counts["hrms_log_rows"] == 1
    assert counts["email_log_rows"] == 2 and counts["offers"] == 1 and counts["enrichment_profiles"] == 1
    assert counts["candidate_profiles_deleted"] == 1 and counts["upload_batch_errors"] == 1
    assert counts["job_pipelines"] == 1 and counts["vectors_deleted"] == 2 and counts["resumes_kept"] == 0
    assert counts["audit_rows"] == 3


async def test_the_tombstone_has_exactly_the_contract_shape(world):
    seed_person(world)
    await erase(world)
    (tomb,) = world.raw.rows("candidates")
    assert set(tomb) <= svc.CANDIDATE_KEEP
    assert tomb["candidate_id"] == "cand-1" and tomb["job_id"] == "job-1" and tomb["company_id"] == A
    assert tomb["status"] == "completed" and tomb["decision"] == "hold" and tomb["created_at"] == NOW
    assert tomb["erased"] is True and tomb["erased_at"]
    assert tomb["erasure"] == {"by": "boss@acme.test", "reason": REASON}
    for gone in ("secure_token", "name", "email", "resume_id", "transcript", "report"):
        assert gone not in tomb


async def test_every_link_is_dead_the_token_is_gone_from_the_candidate_and_the_offer(world):
    seed_person(world)
    await erase(world)
    assert not await world.db.candidates.find_one({"secure_token": "tok-1"})
    assert not await world.db.offers.find_one({"secure_token": "offtok-1"})
    assert not await world.db.interviewer_links.find_one({"candidate_id": "cand-1"})
    assert not await world.db.report_shares.find_one({"candidate_id": "cand-1"})


async def test_the_mail_log_keeps_its_rows_but_loses_the_address_subject_and_error(world):
    seed_person(world)
    await erase(world)
    rows = world.raw.rows("email_log")
    assert len(rows) == 2
    for row in rows:
        assert row["erased"] is True and not ({"to", "subject", "error"} & set(row))
    assert {r["status"] for r in rows} == {"failed", "sent"} and {r["template"] for r in rows} == {"interview_invite", "x"}


async def test_the_audit_log_keeps_the_events_and_loses_what_was_typed_about_the_person(world):
    seed_person(world)
    await erase(world)
    by_action = {r["action"]: r for r in world.raw.rows("audit_log")}
    assert by_action["candidate_invited"]["details"] == {"job_id": "job-1", "invite_type": "manual"}
    assert by_action["candidate_notes_updated"]["details"] == {}
    assert by_action["resume_upload"]["details"] == {"job_id": "job-1"}


async def test_the_audit_row_for_an_erasure_holds_counts_and_ids_and_nothing_personal(world):
    seed_person(world)
    await erase(world)
    (row,) = world.raw.rows("audit_log", action="candidate_erase")
    assert row["resource_type"] == "candidate" and row["resource_id"] == "cand-1"
    assert row["actor_email"] == "boss@acme.test" and row["actor_role"] == "superadmin"
    assert set(row["details"]) == {"via", "include_employment", "job_id", "candidates_in_request", "counts"}
    assert row["details"]["via"] == "id" and row["details"]["counts"]["candidates"] == 1
    text = json.dumps(row)
    for secret in ("Jane", "jane.doe", "Example.com", REASON, "Subject access"):
        assert secret not in text, secret


async def test_a_second_erasure_returns_the_tombstone_result_and_changes_nothing(world):
    seed_person(world)
    first = await erase(world)
    writes_before = world.raw.writes
    snapshot = world.raw.snapshot(A)

    again = await erase(world)

    assert again["already_erased"] is True and again["erased"] is True and again["candidate_id"] == "cand-1"
    assert again["erased_at"] == first["erased_at"]
    assert all(v == 0 for v in again["counts"].values())
    assert world.raw.writes == writes_before and world.raw.snapshot(A) == snapshot
    assert len(world.raw.rows("audit_log", action="candidate_erase")) == 1


async def test_an_unknown_candidate_is_not_found(world):
    with pytest.raises(svc.CandidateNotFound) as err:
        await erase(world, "cand-missing")
    assert err.value.status == 404


async def test_a_company_cannot_erase_another_companys_candidate(world):
    seed_person(world, company=B, tag="b")
    with pytest.raises(svc.CandidateNotFound):
        await erase(world, "cand-b")
    assert world.raw.rows("candidates", B, candidate_id="cand-b")[0]["name"] == "Jane Doe"


async def test_another_companys_identical_person_is_untouched(world):
    seed_person(world, tag="1")
    seed_person(world, company=B, tag="b")
    before = world.raw.snapshot(B)
    await erase(world)
    assert world.raw.snapshot(B) == before
    assert world.raw.rows("candidates", B, candidate_id="cand-b")[0]["email"] == EMAIL
    assert world.index.vectors == {"res-b": B, "res-b-old": B}


async def test_a_resume_another_live_application_uses_is_kept_and_the_profile_stays(world):
    seed_person(world, tag="1")
    world.raw.add("candidates", {
        "doc_type": "candidate", "candidate_id": "cand-2", "job_id": "job-2", "resume_id": "res-1", "name": "Jane Doe",
        "email": EMAIL, "status": "invited", "pipeline_stage": "invited", "secure_token": "tok-2", "created_at": NOW,
    })
    world.raw.rows("candidate_profiles")[0]["candidate_ids"].append("cand-2")
    world.raw.rows("candidate_profiles")[0]["job_ids"].append("job-2")

    result = await erase(world)

    assert result["other_applications"] == 1
    assert result["counts"]["resumes_kept"] == 1
    assert [r["resume_id"] for r in world.raw.rows("resumes")] == ["res-1"]
    assert world.raw.rows("resume_files")[0]["resume_id"] == "res-1"
    assert "res-1" in world.index.vectors and "res-1-old" not in world.index.vectors
    (profile,) = world.raw.rows("candidate_profiles")
    assert profile["candidate_ids"] == ["cand-2"] and profile["job_ids"] == ["job-2"] and profile["resume_ids"] == ["res-1"]
    assert result["counts"]["candidate_profiles_updated"] == 1 and result["counts"]["candidate_profiles_deleted"] == 0
    live = world.raw.rows("candidates", candidate_id="cand-2")[0]
    assert live["name"] == "Jane Doe" and live["secure_token"] == "tok-2"


async def test_the_erased_applications_own_pipeline_entry_goes_even_when_the_resume_is_kept(world):
    seed_person(world, tag="1")
    world.raw.add("candidates", {
        "doc_type": "candidate", "candidate_id": "cand-2", "job_id": "job-2", "resume_id": "res-1", "email": EMAIL,
        "status": "invited", "created_at": NOW,
    })
    world.raw.add("jobs", {"job_id": "job-2", "candidate_pipeline": [{"resume_id": "res-1", "pipeline_stage": "invited"}]})
    await erase(world)
    assert world.raw.rows("jobs", job_id="job-2")[0]["candidate_pipeline"] == [{"resume_id": "res-1", "pipeline_stage": "invited"}]
    assert all(e["resume_id"] != "res-1" for e in world.raw.rows("jobs", job_id="job-1")[0]["candidate_pipeline"])


async def test_the_resume_version_chain_goes_together_and_other_peoples_pipeline_entries_stay(world):
    seed_person(world)
    await erase(world)
    assert world.raw.rows("resumes") == []
    assert world.raw.rows("jobs", job_id="job-1")[0]["candidate_pipeline"] == [
        {"resume_id": "res-someone-else", "pipeline_stage": "matched"},
    ]
    assert world.raw.rows("upload_batches")[0]["errors"] == [{"filename": "other.pdf", "error": "unreadable"}]


async def test_erase_by_email_removes_every_application_and_what_carries_the_address(world):
    seed_person(world, tag="1", job="job-1")
    seed_person(world, tag="2", job="job-2", email=EMAIL.lower())
    world.raw.add("resumes", {"resume_id": "res-orphan", "candidate_email": EMAIL.upper(), "filename": "scan.pdf", "text": "Jane Doe", "created_at": NOW})
    world.index.put("res-orphan")
    world.raw.add("candidates", {
        "doc_type": "candidate", "candidate_id": "cand-x", "job_id": "job-1", "name": "Other Person",
        "email": "other@acme.test", "status": "invited", "secure_token": "tok-x", "created_at": NOW,
    })

    result = await svc.erase_by_email(world.db, f"  {EMAIL.upper()} ", actor=ACTOR, reason=REASON)

    assert result["matched"] == 2 and sorted(result["candidate_ids"]) == ["cand-1", "cand-2"]
    assert result["vectors_failed"] == 0 and result["counts"]["candidates"] == 2
    for marker in ("Jane", "jane.doe", "res-orphan", "tok-1", "tok-2"):
        assert marker not in text_of_company(world), marker
    assert all(world.raw.rows("candidates", candidate_id=c)[0]["erased"] for c in ("cand-1", "cand-2"))
    other = world.raw.rows("candidates", candidate_id="cand-x")[0]
    assert other["name"] == "Other Person" and other["secure_token"] == "tok-x"
    assert {r["resource_id"] for r in world.raw.rows("audit_log", action="candidate_erase")} == {"cand-1", "cand-2"}
    assert all(r["details"]["via"] == "email" for r in world.raw.rows("audit_log", action="candidate_erase"))


async def test_erase_by_email_twice_matches_nothing_the_second_time(world):
    seed_person(world)
    await svc.erase_by_email(world.db, EMAIL, actor=ACTOR, reason=REASON)
    writes = world.raw.writes
    again = await svc.erase_by_email(world.db, EMAIL, actor=ACTOR, reason=REASON)
    assert again["matched"] == 0 and again["candidate_ids"] == [] and all(v == 0 for v in again["counts"].values())
    assert again["erased_at"] is None
    assert world.raw.writes > writes
    assert len(world.raw.rows("audit_log", action="candidate_erase")) == 1


async def test_erase_by_email_never_reaches_another_company(world):
    seed_person(world, tag="1")
    seed_person(world, company=B, tag="1")
    before = world.raw.snapshot(B)
    await svc.erase_by_email(world.db, EMAIL, actor=ACTOR, reason=REASON)
    assert world.raw.snapshot(B) == before


async def test_erase_by_email_needs_a_plausible_address(world):
    for bad in ("", "   ", "not-an-address"):
        with pytest.raises(svc.ErasureError) as err:
            await svc.erase_by_email(world.db, bad, actor=ACTOR, reason=REASON)
        assert err.value.status == 422


def seed_employment(w, tag="1", cid="cand-1"):
    raw = w.raw
    raw.add("offers", {
        "doc_type": "offer", "offer_id": f"acc-{tag}", "candidate_id": cid, "job_id": "job-1", "status": "accepted",
        "salary": "negotiate 120k", "secure_token": f"acctok-{tag}",
        "signature": {"typed_name": "Jane Doe", "ip_address": "10.0.0.1"}, "created_at": NOW,
    })
    raw.add("employees", {
        "employee_id": f"emp-{tag}", "candidate_id": cid, "job_id": "job-1", "offer_id": f"acc-{tag}", "department": "eng",
        "manager_id": "boss@acme.test", "status": "active", "hired_at": NOW, "created_at": NOW,
    })
    raw.add("performance_reviews", {"review_id": "rv1", "employee_id": f"emp-{tag}", "comments": "Jane is great", "reviewer_id": "boss@acme.test"})
    raw.add("performance_reviews", {"review_id": "rv2", "employee_id": "emp-other", "reviewer_id": f"emp-{tag}", "secure_token": "peer-tok", "comments": "fine"})
    raw.add("goals", {"goal_id": "g1", "owner_id": f"emp-{tag}", "title": "Learn Jane's codebase"})
    raw.add("goals", {"goal_id": "g2", "owner_id": "emp-other", "title": "Child", "parent_goal_id": "g1"})
    raw.add("employees", {"employee_id": "emp-report", "candidate_id": "cand-report", "manager_id": EMAIL.lower(), "status": "active"})


async def test_an_accepted_offer_or_an_employee_refuses_the_erasure_and_changes_nothing(world):
    seed_person(world)
    seed_employment(world)
    writes, snapshot = world.raw.writes, world.raw.snapshot(A)
    with pytest.raises(svc.ErasureRefused) as err:
        await erase(world)
    assert err.value.status == 409 and "employment records" in err.value.message
    assert world.raw.writes == writes and world.raw.snapshot(A) == snapshot


async def test_an_employee_record_alone_also_refuses(world):
    seed_person(world)
    world.raw.add("employees", {"employee_id": "emp-1", "candidate_id": "cand-1", "status": "active"})
    with pytest.raises(svc.ErasureRefused):
        await erase(world)


async def test_include_employment_anonymises_the_offer_and_employee_and_deletes_reviews_and_goals(world):
    seed_person(world)
    seed_employment(world)
    result = await erase(world, include_employment=True)

    counts = result["counts"]
    assert counts["offers"] == 2 and counts["employees"] == 1 and counts["performance_reviews"] == 1 and counts["goals"] == 1
    assert "negotiate" not in text_of_company(world) and "10.0.0.1" not in text_of_company(world)
    assert "acctok-1" not in text_of_company(world) and "Learn Jane" not in text_of_company(world)
    accepted = world.raw.rows("offers", offer_id="acc-1")[0]
    assert set(accepted) <= svc.OFFER_KEEP and accepted["status"] == "accepted" and accepted["erased"] is True
    employee = world.raw.rows("employees", employee_id="emp-1")[0]
    assert set(employee) <= svc.EMPLOYEE_KEEP and employee["department"] == "eng" and "manager_id" not in employee
    peer = world.raw.rows("performance_reviews", review_id="rv2")[0]
    assert peer["reviewer_id"] is None and "secure_token" not in peer
    assert world.raw.rows("goals", goal_id="g2")[0]["parent_goal_id"] is None
    assert world.raw.rows("employees", employee_id="emp-report")[0]["manager_id"] is None
    (audit,) = world.raw.rows("audit_log", action="candidate_erase")
    assert audit["details"]["include_employment"] is True


async def test_a_manager_link_is_left_alone_without_the_employment_override(world):
    seed_person(world)
    world.raw.add("employees", {"employee_id": "emp-report", "candidate_id": "cand-report", "manager_id": EMAIL.lower(), "status": "active"})
    await erase(world)
    assert world.raw.rows("employees", employee_id="emp-report")[0]["manager_id"] == EMAIL.lower()


async def test_a_vector_with_no_resume_row_is_deleted_only_when_the_company_owns_it(world):
    seed_person(world, tag="1")
    seed_person(world, tag="2", job="job-2", email="second@acme.test")
    world.raw.rows("candidates", candidate_id="cand-1")[0]["resume_id"] = "res-ghost"
    world.raw.rows("candidates", candidate_id="cand-2")[0]["resume_id"] = "res-stale"
    world.index.put("res-ghost", B)
    world.index.put("res-stale", A)
    await svc.erase_candidates(world.db, ["cand-1", "cand-2"], actor=ACTOR, reason=REASON)
    deleted = [i for batch in world.index.deleted for i in batch]
    assert "res-ghost" not in deleted and world.index.vectors["res-ghost"] == B
    assert "res-stale" in deleted and "res-stale" not in world.index.vectors


async def test_vectors_are_deleted_in_batches_of_a_thousand(world):
    for n in range(2100):
        world.raw.add("resumes", {"resume_id": f"r{n}", "filename": f"f{n}.pdf", "created_at": NOW})
        world.index.put(f"r{n}")
    result = await svc.erase_resumes(world.db, [f"r{n}" for n in range(2100)])
    assert [len(batch) for batch in world.index.deleted] == [1000, 1000, 100]
    assert result["counts"]["resumes"] == 2100 and result["counts"]["vectors_deleted"] == 2100 and result["vectors_failed"] == 0
    assert world.index.vectors == {}


async def test_a_pinecone_failure_is_reported_without_undoing_mongo_and_a_second_erasure_retries_it(world):
    seed_person(world)
    world.index.fail = True
    result = await erase(world)

    assert result["vectors_failed"] == 2 and result["counts"]["vectors_deleted"] == 0
    assert result["counts"]["candidates"] == 1 and result["counts"]["resumes"] == 2
    for marker in MARKERS:
        assert marker not in text_of_company(world), marker
    (tomb,) = world.raw.rows("candidates")
    assert sorted(tomb["erasure"]["vectors_pending"]) == ["res-1", "res-1-old"]

    world.index.fail = False
    again = await erase(world)
    assert again["already_erased"] is True and again["vectors_failed"] == 0
    assert world.index.vectors == {}
    (tomb,) = world.raw.rows("candidates")
    assert "vectors_pending" not in tomb["erasure"]


async def test_an_install_with_no_pinecone_erases_the_rest(world, monkeypatch):
    seed_person(world)
    monkeypatch.setattr(svc, "get_pinecone", lambda: None)
    result = await erase(world)
    assert result["counts"]["resumes"] == 2 and result["counts"]["vectors_deleted"] == 0 and result["vectors_failed"] == 0


async def test_erase_resumes_removes_the_resume_its_file_pipeline_entry_and_vector(world):
    world.raw.add("resumes", {"resume_id": "r1", "filename": "a.pdf", "candidate_email": "x@y.co", "created_at": NOW})
    world.raw.add("resumes", {"resume_id": "r2", "filename": "b.pdf", "created_at": NOW, "previous_resume_id": "r1"})
    world.raw.add("resume_files", {"resume_id": "r1", "data": b"x"})
    world.raw.add("jobs", {"job_id": "j", "candidate_pipeline": [{"resume_id": "r1"}, {"resume_id": "r2"}]})
    world.raw.add("marketplace_module", {"profile_id": "p", "resume_id": "r1", "email": "x@y.co"})
    world.index.put("r1")
    result = await svc.erase_resumes(world.db, ["r1"])
    assert result["counts"]["resumes"] == 1 and result["counts"]["resume_files"] == 1 and result["counts"]["enrichment_profiles"] == 1
    assert world.raw.rows("jobs")[0]["candidate_pipeline"] == [{"resume_id": "r2"}]
    assert world.raw.rows("resumes")[0]["previous_resume_id"] is None
    assert world.index.vectors == {}
    assert (await svc.erase_resumes(world.db, []))["resume_ids"] == []


async def test_a_change_to_an_erased_candidate_is_a_409_and_a_read_is_not(world, monkeypatch):
    seed_person(world, tag="1")
    world.raw.add("candidates", {"doc_type": "candidate", "candidate_id": "cand-live", "job_id": "job-1", "name": "Live", "created_at": NOW})
    await erase(world)
    monkeypatch.setattr(svc, "get_db", lambda: world.db)

    router = APIRouter(dependencies=[Depends(svc.block_erased_candidate)])

    @router.post("/{candidate_id}/regenerate-token")
    async def regenerate(candidate_id: str):
        return {"ok": candidate_id}

    @router.get("/{candidate_id}")
    async def read(candidate_id: str):
        return {"ok": candidate_id}

    @router.post("/new")
    async def create():
        return {"ok": "created"}

    app = FastAPI()
    app.include_router(router)
    headers = {"Authorization": f"Bearer demo-admin-token@@{A}"}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as client:
        blocked = await client.post("/cand-1/regenerate-token", headers=headers)
        assert blocked.status_code == 409 and blocked.json()["detail"] == svc.ERASED_MESSAGE
        assert (await client.get("/cand-1", headers=headers)).status_code == 200
        assert (await client.post("/cand-live/regenerate-token", headers=headers)).status_code == 200
        assert (await client.post("/cand-unknown/regenerate-token", headers=headers)).status_code == 200
        assert (await client.post("/new", headers=headers)).status_code == 200
        assert (await client.post("/cand-1/regenerate-token")).status_code == 401


async def test_ensure_not_erased_raises_only_for_a_tombstone(world):
    seed_person(world)
    await svc.ensure_not_erased(world.db, "cand-1")
    await svc.ensure_not_erased(world.db, "cand-nobody")
    await erase(world)
    with pytest.raises(Exception) as err:
        await svc.ensure_not_erased(world.db, "cand-1")
    assert getattr(err.value, "status_code", None) == 409
