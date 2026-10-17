import time as real_time
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from config import tenancy
from config.tenancy import DEFAULT_COMPANY_ID, TenantDB
from fake_mongo import FakeRaw
from services.hr_module import company_settings_service, erasure_service, retention_service as ret

pytestmark = pytest.mark.anyio

A, B = "cmp_a", "cmp_b"
NOW = datetime(2026, 10, 12, 12, 0, tzinfo=timezone.utc)
DAYS = 90


def ago(days: float) -> str:
    return (NOW - timedelta(days=days)).isoformat()


def ahead(days: float) -> str:
    return (NOW + timedelta(days=days)).isoformat()


def cand(**fields) -> dict:
    doc = {
        "doc_type": "candidate", "candidate_id": "c1", "job_id": "j1", "status": "rejected", "pipeline_stage": "rejected",
        "decision": "reject", "created_at": ago(400), "invite_sent_at": ago(400), "decided_at": ago(200),
        "invite_expires_at": ago(393),
    }
    doc.update(fields)
    return doc


def verdict(doc, **kw):
    return ret.candidate_eligibility(doc, now=NOW, days=DAYS, **kw)


@pytest.mark.parametrize("value,ok", [
    (None, True), (30, True), (31, True), (90, True), (3650, True), (36500, True),
    (29, False), (0, False), (-5, False), (36501, False), (True, False), (False, False), (30.5, False), ("90", False),
])
def test_a_period_is_null_or_a_whole_number_of_days_from_thirty(value, ok):
    if ok:
        assert ret.validate_days(value, "Candidate retention") == value
    else:
        with pytest.raises(ret.RetentionError) as err:
            ret.validate_days(value, "Candidate retention")
        assert err.value.args[0].startswith("Candidate retention") and "-" not in err.value.args[0]


def test_an_unreadable_stored_period_means_keep_for_ever_never_a_short_one():
    assert ret.policy_from(None) == {"candidate_days": None, "resume_days": None}
    assert ret.policy_from({"retention": {"candidate_days": 90, "resume_days": 400}}) == {"candidate_days": 90, "resume_days": 400}
    assert ret.policy_from({"retention": {"candidate_days": 5, "resume_days": "soon"}}) == {"candidate_days": None, "resume_days": None}
    assert ret.policy_from({"retention": {"candidate_days": True}}) == {"candidate_days": None, "resume_days": None}


def test_a_rejected_candidate_idle_past_the_period_is_eligible():
    assert verdict(cand()) == (True, "rejected")


@pytest.mark.parametrize("fields", [
    {"status": "withdrawn", "pipeline_stage": "withdrawn", "decision": None},
    {"status": "not_selected", "pipeline_stage": "not_selected", "decision": None},
    {"status": "completed", "pipeline_stage": "rejected", "decision": None},
    {"status": "completed", "pipeline_stage": "completed", "decision": "reject"},
])
def test_every_final_non_hire_state_counts(fields):
    assert verdict(cand(**fields))[0] is True


def test_the_clock_runs_from_the_latest_activity_not_from_creation():
    assert verdict(cand(decided_at=ago(10)))  == (False, "recent")
    assert verdict(cand(decided_at=ago(89)))[0] is False
    assert verdict(cand(decided_at=ago(91)))[0] is True
    assert verdict(cand(decided_at=ago(200), recruiter_notes_updated_at=ago(5)))[0] is False
    assert verdict(cand(decided_at=ago(200), external_review={"reviewed_at": ago(3)}))[0] is False
    assert verdict(cand(decided_at=ago(200), external_interview={"updated_at": ago(2)}))[0] is False
    assert verdict(cand(decided_at=ago(200), scheduled_start_at=ahead(3)))[0] is False


def test_a_candidate_whose_activity_cannot_be_dated_is_never_erased():
    assert verdict(cand(created_at=None, invite_sent_at=None, decided_at=None)) == (False, "no_activity_date")
    assert verdict(cand(created_at="garbage", invite_sent_at="", decided_at="soon")) == (False, "no_activity_date")


@pytest.mark.parametrize("fields,why", [
    ({"status": "hired", "pipeline_stage": "hired", "decision": "hire"}, "hired"),
    ({"status": "completed", "pipeline_stage": "completed", "decision": "hire"}, "hired"),
    ({"status": "rejected", "pipeline_stage": "hired"}, "hired"),
])
def test_a_hired_candidate_is_never_eligible_however_old(fields, why):
    assert verdict(cand(**fields)) == (False, why)


def test_an_offer_of_any_kind_or_an_employee_record_blocks_it():
    assert verdict(cand(), has_offer=True) == (False, "offered")
    assert verdict(cand(), has_employee=True) == (False, "employed")
    assert verdict(cand(status="hired", pipeline_stage="hired"), has_employee=True)[1] == "hired"


@pytest.mark.parametrize("fields", [
    {"status": "interviewing", "pipeline_stage": "interviewing", "decision": None},
    {"status": "completed", "pipeline_stage": "completed", "decision": None},
    {"status": "completed", "pipeline_stage": "completed", "decision": "hold"},
    {"status": "invited", "pipeline_stage": "shortlisted", "decision": None},
    {"status": "interviewing", "pipeline_stage": "interviewing", "decision": None, "interview_mode": "external"},
])
def test_a_candidate_in_progress_is_never_eligible(fields):
    assert verdict(cand(**fields)) == (False, "in_progress")


def test_a_live_session_blocks_even_a_rejected_candidate():
    assert verdict(cand(session_active=True)) == (False, "in_progress")


def test_a_tombstone_is_never_picked_again():
    assert verdict(cand(erased=True)) == (False, "already_erased")


def test_an_invite_that_expired_without_ever_starting_is_eligible_after_the_period():
    invited = cand(status="invited", pipeline_stage="invited", decision=None, token_status="active", decided_at=None,
                   invite_sent_at=ago(300), invite_expires_at=ago(293), created_at=ago(300))
    assert verdict(invited) == (True, "expired_invite")
    assert verdict({**invited, "invite_expires_at": ago(20)})[0] is False


@pytest.mark.parametrize("change", [
    {"token_status": "consumed"},
    {"interview_started_at": ago(250)},
    {"transcript": [{"question": "q", "answer": "a"}]},
    {"session_active": True},
    {"interview_mode": "external"},
    {"invite_expires_at": ahead(2)},
])
def test_an_invite_that_was_used_or_still_works_is_not_eligible(change):
    invited = cand(status="invited", pipeline_stage="invited", decision=None, token_status="active", decided_at=None,
                   invite_sent_at=ago(300), invite_expires_at=ago(293), created_at=ago(300))
    assert verdict({**invited, **change})[0] is False


def test_an_expired_invite_with_a_live_coding_link_waits_for_that_link_too():
    invited = cand(status="invited", pipeline_stage="invited", decision=None, token_status="active", decided_at=None,
                   invite_sent_at=ago(300), invite_expires_at=ago(293), created_at=ago(300), coding_question_id="q1")
    live_coding = {**invited, "coding_invite_expires_at": ahead(3)}
    assert verdict(live_coding) == (False, "in_progress")
    assert verdict({**invited, "coding_invite_expires_at": ago(250)})[0] is True


def resume_verdict(doc, referenced=frozenset(), live=frozenset(), days=DAYS):
    return ret.resume_eligibility(doc, now=NOW, days=days, referenced_ids=set(referenced), live_emails=set(live))


def test_an_old_resume_nobody_uses_is_eligible():
    old = {"resume_id": "r1", "created_at": ago(120), "candidate_email": "a@x.co"}
    assert resume_verdict(old) == (True, "old_resume")
    assert resume_verdict({**old, "created_at": ago(10)}) == (False, "recent")
    assert resume_verdict({**old, "created_at": None}) == (False, "no_date")


def test_a_resume_a_candidate_uses_or_whose_applicant_is_still_live_is_kept():
    old = {"resume_id": "r1", "created_at": ago(120), "candidate_email": "A@X.co"}
    assert resume_verdict(old, referenced={"r1"}) == (False, "attached")
    assert resume_verdict(old, live={"a@x.co"}) == (False, "applicant_still_live")
    assert resume_verdict({**old, "candidate_email": None}, live={"a@x.co"})[0] is True


class FakeIndex:
    def __init__(self):
        self.vectors = {}
        self.deleted = []
        self.fail = False

    def fetch(self, ids):
        return SimpleNamespace(vectors={i: SimpleNamespace(metadata={"company_id": self.vectors[i]}) for i in ids if i in self.vectors})

    def delete(self, ids=None, **kw):
        if self.fail:
            raise RuntimeError("down")
        self.deleted.append(list(ids))
        for i in ids:
            self.vectors.pop(i, None)


@pytest.fixture
def world(monkeypatch):
    raw = FakeRaw()
    db = TenantDB(raw, A)
    index = FakeIndex()
    monkeypatch.setattr(ret, "get_db", lambda: db)
    monkeypatch.setattr(company_settings_service, "get_db", lambda: db)
    monkeypatch.setattr(erasure_service, "get_pinecone", lambda: index)
    tenancy.use_fallback_company(A)
    yield SimpleNamespace(raw=raw, db=db, index=index)
    tenancy.use_fallback_company(DEFAULT_COMPANY_ID)


def set_policy(w, candidate_days=DAYS, resume_days=None, company=A):
    w.raw.add("company_settings", {"_id": f"{company}:singleton", "retention": {
        "candidate_days": candidate_days, "resume_days": resume_days,
    }}, company)


def seed(w, tag, company=A, **fields):
    doc = cand(candidate_id=f"c-{tag}", name=f"Person {tag}", email=f"p{tag}@x.co", secure_token=f"t-{tag}", **fields)
    w.raw.add("candidates", doc, company)
    return doc["candidate_id"]


def state(w, cid, company=A):
    (row,) = w.raw.rows("candidates", company, candidate_id=cid)
    return row


async def test_a_company_with_retention_off_reads_once_and_writes_nothing(world):
    seed(world, "old")
    result = await ret.purge_company(30)
    assert result["enabled"] is False and result["candidates_erased"] == 0
    assert world.raw.writes == 0
    set_policy(world, None, None)
    assert (await ret.purge_company(30))["enabled"] is False and world.raw.writes == 0
    assert state(world, "c-old")["name"] == "Person old"


async def test_only_eligible_candidates_are_erased_and_everyone_else_is_untouched(world):
    set_policy(world)
    eligible = seed(world, "old")
    keep = {
        "recent": seed(world, "recent", decided_at=ago(5)),
        "hired": seed(world, "hired", status="hired", pipeline_stage="hired", decision="hire"),
        "offered": seed(world, "offered"),
        "employed": seed(world, "employed"),
        "interviewing": seed(world, "interviewing", status="interviewing", pipeline_stage="interviewing", decision=None),
        "hold": seed(world, "hold", status="completed", pipeline_stage="completed", decision="hold"),
        "awaiting": seed(world, "awaiting", status="completed", pipeline_stage="completed", decision=None),
        "live_invite": seed(world, "live", status="invited", pipeline_stage="invited", decision=None, token_status="active",
                            decided_at=None, invite_expires_at=ahead(2)),
        "used_invite": seed(world, "used", status="invited", pipeline_stage="invited", decision=None, token_status="consumed",
                            decided_at=None),
    }
    expired_invite = seed(world, "expired", status="invited", pipeline_stage="invited", decision=None, token_status="active",
                          decided_at=None, invite_sent_at=ago(300), invite_expires_at=ago(293), created_at=ago(300))
    world.raw.add("offers", {"doc_type": "offer", "offer_id": "o1", "candidate_id": keep["offered"], "status": "declined"})
    world.raw.add("employees", {"employee_id": "e1", "candidate_id": keep["employed"]})
    already = world.raw.add("candidates", {"doc_type": "candidate", "candidate_id": "c-gone", "erased": True, "created_at": ago(500)})
    other_company = seed(world, "other", company=B)
    set_policy(world, company=B)

    result = await ret.purge_company(30)

    assert result["enabled"] is True and result["complete"] is True and result["candidates_erased"] == 2
    assert state(world, eligible)["erased"] is True and state(world, expired_invite)["erased"] is True
    for name, cid in keep.items():
        row = state(world, cid)
        assert not row.get("erased") and row["name"] == f"Person {cid[2:]}", name
    assert state(world, other_company, B)["name"] == "Person other" and not state(world, other_company, B).get("erased")
    assert already["erased"] is True
    assert "secure_token" not in state(world, eligible)
    assert state(world, eligible)["erasure"] == {"by": "retention", "reason": f"Retention policy: no activity for {DAYS} days."}
    (audit,) = world.raw.rows("audit_log", action="retention_purge")
    assert audit["actor_email"] is None and audit["actor_role"] == "cron"
    assert audit["details"]["candidates_erased"] == 2 and audit["details"]["resumes_erased"] == 0
    assert audit["details"]["counts"]["candidates"] == 2 and audit["details"]["complete"] is True
    assert world.raw.rows("audit_log", action="candidate_erase") == []
    assert "Person old" not in str(audit)


async def test_a_run_that_finds_nothing_to_do_writes_no_audit_row(world):
    set_policy(world)
    seed(world, "recent", decided_at=ago(5))
    result = await ret.purge_company(30)
    assert result["enabled"] is True and result["candidates_erased"] == 0
    assert world.raw.rows("audit_log") == []


async def test_it_erases_the_oldest_first_and_stops_inside_the_budget_then_carries_on(world, monkeypatch):
    set_policy(world)
    monkeypatch.setattr(ret, "BATCH_SIZE", 1)
    ids = [seed(world, f"n{n}", created_at=ago(400 - n), decided_at=ago(300 - n)) for n in range(5)]

    ticks = iter(range(1000))
    monkeypatch.setattr(ret, "time", SimpleNamespace(monotonic=lambda: float(next(ticks))))
    first = await ret.purge_company(budget_seconds=5)

    assert first["complete"] is False and first["candidates_erased"] == 2
    assert [bool(state(world, c).get("erased")) for c in ids] == [True, True, False, False, False]

    monkeypatch.setattr(ret, "time", real_time)
    second = await ret.purge_company(30)
    assert second["complete"] is True and second["candidates_erased"] == 3
    assert all(state(world, c).get("erased") for c in ids)
    assert len(world.raw.rows("audit_log", action="retention_purge")) == 2


async def test_with_no_time_left_nothing_is_started(world, monkeypatch):
    set_policy(world)
    cid = seed(world, "old")
    result = await ret.purge_company(budget_seconds=0)
    assert result["complete"] is False and result["candidates_erased"] == 0
    assert not state(world, cid).get("erased") and world.raw.rows("audit_log") == []


async def test_a_rejected_candidate_with_an_accepted_offer_is_left_alone(world):
    set_policy(world)
    cid = seed(world, "old")
    world.raw.add("offers", {"doc_type": "offer", "offer_id": "o1", "candidate_id": cid, "status": "accepted"})
    result = await ret.purge_company(30)
    assert result["candidates_erased"] == 0 and not state(world, cid).get("erased")


async def test_old_resumes_with_no_candidate_are_erased_and_the_rest_stay(world):
    set_policy(world, candidate_days=None, resume_days=DAYS)
    world.raw.add("resumes", {"resume_id": "r-old", "created_at": ago(300), "candidate_email": "nobody@x.co", "filename": "n.pdf"})
    world.raw.add("resumes", {"resume_id": "r-recent", "created_at": ago(10)})
    world.raw.add("resumes", {"resume_id": "r-used", "created_at": ago(300)})
    world.raw.add("resumes", {"resume_id": "r-applicant", "created_at": ago(300), "candidate_email": "LIVE@x.co"})
    world.raw.add("resume_files", {"resume_id": "r-old", "data": b"x"})
    world.raw.add("candidates", {"doc_type": "candidate", "candidate_id": "c-used", "resume_id": "r-used", "status": "invited", "created_at": ago(5)})
    world.raw.add("candidates", {"doc_type": "candidate", "candidate_id": "c-live", "email": "live@x.co", "status": "invited", "created_at": ago(5)})
    world.raw.add("resumes", {"resume_id": "r-other-company", "created_at": ago(300)}, B)
    set_policy(world, candidate_days=None, resume_days=DAYS, company=B)
    world.index.vectors.update({"r-old": A, "r-used": A})

    result = await ret.purge_company(30)

    assert result["resumes_erased"] == 1 and result["candidates_erased"] == 0
    assert sorted(r["resume_id"] for r in world.raw.rows("resumes")) == ["r-applicant", "r-recent", "r-used"]
    assert world.raw.rows("resume_files") == []
    assert world.index.vectors == {"r-used": A}
    assert [r["resume_id"] for r in world.raw.rows("resumes", B)] == ["r-other-company"]
    (audit,) = world.raw.rows("audit_log", action="retention_purge")
    assert audit["details"]["resumes_erased"] == 1 and audit["details"]["candidate_days"] is None


async def test_a_search_index_that_will_not_delete_is_an_error_and_is_remembered(world):
    set_policy(world)
    cid = seed(world, "old", resume_id="r-1")
    world.raw.add("resumes", {"resume_id": "r-1", "created_at": ago(300), "candidate_email": "pold@x.co"})
    world.index.vectors["r-1"] = A
    world.index.fail = True

    result = await ret.purge_company(30)

    assert result["candidates_erased"] == 1 and result["vectors_failed"] == 1
    assert ret.summarise(result)[0] == "error"
    assert state(world, cid)["erasure"]["vectors_pending"] == ["r-1"]
    assert world.raw.rows("resumes") == []

    world.index.fail = False
    again = await ret.purge_company(30)
    assert again["vectors_failed"] == 0 and world.index.vectors == {}
    assert "vectors_pending" not in state(world, cid)["erasure"]


async def test_the_policy_is_stored_on_the_company_settings_document_and_read_back(world):
    assert await ret.get_policy(world.db) == {"candidate_days": None, "resume_days": None, "updated_at": None, "updated_by": None}
    before, after = await ret.set_policy(world.db, {"candidate_days": 120}, updated_by="boss@acme.test")
    assert before["candidate_days"] is None and after["candidate_days"] == 120 and after["resume_days"] is None
    assert after["updated_by"] == "boss@acme.test" and after["updated_at"]
    _, after = await ret.set_policy(world.db, {"resume_days": 365}, updated_by="boss@acme.test")
    assert (after["candidate_days"], after["resume_days"]) == (120, 365)
    _, after = await ret.set_policy(world.db, {"candidate_days": None}, updated_by="boss@acme.test")
    assert (after["candidate_days"], after["resume_days"]) == (None, 365)
    (doc,) = world.raw.rows("company_settings")
    assert doc["_id"] == f"{A}:singleton" and doc["retention"]["resume_days"] == 365


async def test_a_value_under_thirty_days_is_refused_and_changes_nothing(world):
    await ret.set_policy(world.db, {"candidate_days": 60}, updated_by="x")
    with pytest.raises(ret.RetentionError):
        await ret.set_policy(world.db, {"candidate_days": 60, "resume_days": 7}, updated_by="x")
    assert (await ret.get_policy(world.db))["candidate_days"] == 60 and (await ret.get_policy(world.db))["resume_days"] is None


async def test_the_last_purge_is_read_from_the_audit_row(world):
    assert await ret.last_purge(world.db) is None
    world.raw.add("audit_log", {"action": "retention_purge", "created_at": ago(3), "details": {"candidates_erased": 1, "resumes_erased": 2}})
    world.raw.add("audit_log", {"action": "retention_purge", "created_at": ago(1), "details": {"candidates_erased": 4, "resumes_erased": 0}})
    assert await ret.last_purge(world.db) == {"at": ago(1), "candidates_erased": 4, "resumes_erased": 0}


def test_the_cron_detail_says_what_happened():
    assert ret.summarise({"enabled": False}) == ("ok", "Retention is off for this company.")
    done = {"enabled": True, "complete": True, "candidates_erased": 3, "resumes_erased": 5, "vectors_failed": 0}
    assert ret.summarise(done) == ("ok", "Erased 3 candidate(s) and 5 resume(s).")
    more = {**done, "complete": False}
    assert ret.summarise(more) == ("ok", "Erased 3 candidate(s) and 5 resume(s). More are due; the next run continues.")
    status, detail = ret.summarise({**done, "vectors_failed": 2})
    assert status == "error" and "2 search index record(s) could not be removed" in detail
    for text in (detail, ret.summarise(more)[1]):
        assert "-" not in text
