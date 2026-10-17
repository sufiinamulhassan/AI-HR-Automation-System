import asyncio
import json
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from config.database import get_db, get_platform_db
from services.hr_module import attention_service as attention
from services.hr_module.permissions import DEFAULT_ROLE_PERMISSIONS, PERMISSION_CATALOG
from shared.utils import EM_DASH

pytestmark = pytest.mark.anyio

NOW = datetime.now(timezone.utc)
ITEM_KEYS = {"key", "label", "count", "severity", "path", "query"}


def iso(**delta) -> str:
    return (NOW + timedelta(**delta)).isoformat()


@pytest.fixture
async def world():
    global NOW
    NOW = datetime.now(timezone.utc)
    db = get_db()
    ids = {"jobs": [], "candidates": [], "offers": [], "emails": []}

    async def job() -> str:
        job_id = f"att-job-{uuid.uuid4().hex[:10]}"
        await db.jobs.insert_one({"doc_type": "job", "job_id": job_id, "title": "Ops Lead", "candidate_pipeline": []})
        ids["jobs"].append(job_id)
        return job_id

    async def candidate(job_id: str, **fields) -> str:
        cid = str(uuid.uuid4())
        doc = {
            "doc_type": "candidate", "candidate_id": cid, "job_id": job_id, "name": "Zed Attention",
            "email": f"{uuid.uuid4().hex[:8]}@attention.example.com", "secure_token": f"tok_{uuid.uuid4().hex[:12]}",
            "phone": "+1-555-0142", "status": "interviewing", "pipeline_stage": "interviewing", "created_at": iso(hours=-1),
        }
        doc.update(fields)
        await db.candidates.insert_one(doc)
        ids["candidates"].append(cid)
        return cid

    async def external(job_id: str, *, start: timedelta, duration: int = 45, ext_status: str = "scheduled", **fields) -> str:
        return await candidate(
            job_id, interview_mode="external", token_status="unused",
            external_interview={
                "platform": "meet", "platform_label": "Google Meet", "join_url": "https://meet.google.com/abc-defg-hij",
                "scheduled_start_at": (NOW + start).isoformat(), "duration_minutes": duration, "status": ext_status,
            },
            **fields,
        )

    async def invite(job_id: str, *, sent: timedelta, expires: timedelta, **fields) -> str:
        base = {
            "status": "invited", "pipeline_stage": "invited", "token_status": "active", "session_active": False,
            "invite_type": "manual", "invite_sent_at": (NOW + sent).isoformat(), "created_at": (NOW + sent).isoformat(),
            "invite_expires_at": (NOW + expires).isoformat(),
        }
        base.update(fields)
        return await candidate(job_id, **base)

    async def offer(
        job_id: str, status: str, *, sent: timedelta | None = None, created: timedelta = timedelta(days=-12),
        candidate_id: str | None = None,
    ) -> str:
        offer_id = uuid.uuid4().hex
        await db.offers.insert_one({
            "doc_type": "offer", "offer_id": offer_id, "candidate_id": candidate_id or str(uuid.uuid4()),
            "job_id": job_id, "status": status, "salary": "99999 USD/year",
            "sent_at": (NOW + sent).isoformat() if sent is not None else None,
            "created_at": (NOW + created).isoformat(),
        })
        ids["offers"].append(offer_id)
        return offer_id

    async def failed_email(job_id: str | None, *, ago: timedelta, status: str = "failed") -> None:
        row = await db.email_log.insert_one({
            "to": "nobody@attention.example.com", "subject": "x", "template": "external_interview",
            "candidate_id": None, "job_id": job_id, "status": status, "created_at": (NOW - ago).isoformat(),
        })
        ids["emails"].append(row.inserted_id)

    async def bulk(docs: list[dict]) -> None:
        await db.candidates.insert_many(docs)
        ids["candidates"].extend(d["candidate_id"] for d in docs)

    yield SimpleNamespace(
        db=db, job=job, candidate=candidate, external=external, invite=invite, offer=offer,
        failed_email=failed_email, ids=ids, bulk=bulk,
    )

    for cid in ids["candidates"]:
        await db.candidates.delete_one({"candidate_id": cid})
    for offer_id in ids["offers"]:
        await db.offers.delete_one({"offer_id": offer_id})
    for row_id in ids["emails"]:
        await db.email_log.delete_one({"_id": row_id})
    for job_id in ids["jobs"]:
        await db.jobs.delete_one({"job_id": job_id})
    await asyncio.sleep(0)


async def seeded(world) -> tuple[str, str]:
    j, other = await world.job(), await world.job()

    await world.external(j, start=timedelta(hours=-3))
    await world.external(j, start=timedelta(minutes=-10))
    await world.external(j, start=timedelta(hours=-3), external_review={"overall": 4.0, "recommendation": "hire"},
                         pipeline_stage="completed", status="completed")
    await world.external(j, start=timedelta(hours=-3), pipeline_stage="rejected", status="rejected")
    await world.external(j, start=timedelta(hours=-4), ext_status="no_show")
    await world.external(j, start=timedelta(hours=-4), ext_status="no_show", pipeline_stage="rejected", status="rejected")
    await world.external(j, start=timedelta(hours=2))
    await world.external(j, start=timedelta(hours=5))
    await world.external(j, start=timedelta(hours=30))

    link_card = {"scorecard_id": "s1", "source": "link", "questions": [], "ratings": {}}
    hr_card = {"scorecard_id": "s2", "source": "hr", "questions": [], "ratings": {}}
    await world.external(j, start=timedelta(hours=60), interview_scorecards=[link_card])
    await world.external(j, start=timedelta(hours=60), interview_scorecards=[link_card, {**link_card, "scorecard_id": "s3"}])
    await world.external(j, start=timedelta(hours=60), interview_scorecards=[link_card, hr_card],
                         external_review={"overall": 3.0}, pipeline_stage="completed", status="completed")
    await world.external(j, start=timedelta(hours=60), interview_scorecards=[link_card], pipeline_stage="hired", status="hired")

    await world.offer(j, "pending_approval")
    await world.offer(j, "pending_approval")
    await world.offer(j, "approved")
    await world.offer(j, "sent", sent=timedelta(days=-8))
    await world.offer(j, "sent", sent=timedelta(days=-2))
    await world.offer(j, "accepted", sent=timedelta(days=-10))

    await world.invite(j, sent=timedelta(days=-4), expires=timedelta(days=3))
    await world.invite(j, sent=timedelta(days=-6), expires=timedelta(days=1))
    await world.invite(j, sent=timedelta(days=-1), expires=timedelta(days=6))
    await world.invite(j, sent=timedelta(days=-5), expires=timedelta(days=-1))
    await world.invite(j, sent=timedelta(days=-5), expires=timedelta(days=2), status="interviewing",
                       interview_started_at=iso(days=-4))
    await world.invite(j, sent=timedelta(days=-5), expires=timedelta(days=6), token_regenerated_at=iso(days=-1))
    await world.invite(j, sent=timedelta(days=-5), expires=timedelta(days=1), interview_mode="external")
    await world.invite(j, sent=timedelta(days=-5), expires=timedelta(days=1), token_status="consumed")

    old = iso(days=-20)
    await world.candidate(j, created_at=old)
    await world.candidate(j, created_at=old, status="completed", pipeline_stage="invited", interview_ended_at=iso(days=-9))
    await world.candidate(j, created_at=old, status="completed", interview_ended_at=iso(days=-2))
    await world.candidate(j, created_at=iso(days=-3))
    await world.candidate(j, created_at=old, status="hired", pipeline_stage="hired")
    await world.candidate(j, created_at=old, status="invited", pipeline_stage="completed")
    await world.candidate(j, created_at=old, scheduled_start_at=iso(days=3))
    await world.candidate(j, created_at=old, recruiter_notes_updated_at=iso(days=-1))

    await world.failed_email(j, ago=timedelta(hours=1))
    await world.failed_email(j, ago=timedelta(hours=2))
    await world.failed_email(j, ago=timedelta(hours=30))
    await world.failed_email(j, ago=timedelta(hours=1), status="sent")
    await world.failed_email(j, ago=timedelta(hours=1), status="not_sent")

    await world.external(other, start=timedelta(hours=-3))
    await world.external(other, start=timedelta(hours=3))
    await world.external(other, start=timedelta(hours=60), interview_scorecards=[link_card])
    await world.offer(other, "pending_approval")
    await world.offer(other, "sent", sent=timedelta(days=-9))
    await world.invite(other, sent=timedelta(days=-6), expires=timedelta(days=1))
    await world.candidate(other, created_at=old)
    await world.failed_email(other, ago=timedelta(hours=1))
    return j, other


def counts(payload: dict) -> dict[str, int]:
    return {item["key"]: item["count"] for item in payload["items"]}


J_COUNTS = {
    "external_awaiting_scorecard": 1,
    "external_no_show_open": 1,
    "external_starting_soon": 2,
    "link_scorecards_waiting_for_hr": 2,
    "offers_pending_approval": 2,
    "offers_no_response_7d": 1,
    "invites_unopened_3d": 2,
    "invites_expiring_48h": 1,
    "candidates_stuck_7d": 3,
    "email_failures_24h": 2,
}


async def test_every_count_is_seeded_and_counts_only_what_it_should(world):
    j, other = await seeded(world)
    payload = await attention.build_attention(world.db, job_ids=[j], now=NOW)
    assert counts(payload) == J_COUNTS


async def test_each_count_covers_both_jobs_when_both_are_visible(world):
    j, other = await seeded(world)
    payload = await attention.build_attention(world.db, job_ids=[j, other], now=NOW)
    assert counts(payload) == {
        "external_awaiting_scorecard": 2, "external_no_show_open": 1, "external_starting_soon": 3,
        "link_scorecards_waiting_for_hr": 3, "offers_pending_approval": 3, "offers_no_response_7d": 2,
        "invites_unopened_3d": 3, "invites_expiring_48h": 2, "candidates_stuck_7d": 4, "email_failures_24h": 3,
    }
    only_other = await attention.build_attention(world.db, job_ids=[other], now=NOW)
    assert counts(only_other) == {
        "external_awaiting_scorecard": 1, "external_starting_soon": 1, "link_scorecards_waiting_for_hr": 1,
        "offers_pending_approval": 1, "offers_no_response_7d": 1, "invites_unopened_3d": 1,
        "invites_expiring_48h": 1, "candidates_stuck_7d": 1, "email_failures_24h": 1,
    }


async def test_a_count_of_zero_is_left_out_and_no_visible_job_means_no_items(world):
    j = await world.job()
    empty = await attention.build_attention(world.db, job_ids=[j], now=NOW)
    assert empty["items"] == [] and empty["generated_at"] == NOW.isoformat()
    assert (await attention.build_attention(world.db, job_ids=[], now=NOW))["items"] == []

    await world.offer(j, "pending_approval")
    one = await attention.build_attention(world.db, job_ids=[j], now=NOW)
    assert counts(one) == {"offers_pending_approval": 1}


async def test_items_are_ordered_by_severity_then_count(world):
    j, _ = await seeded(world)
    items = (await attention.build_attention(world.db, job_ids=[j], now=NOW))["items"]
    assert [i["key"] for i in items] == [
        "email_failures_24h", "invites_expiring_48h",
        "candidates_stuck_7d", "link_scorecards_waiting_for_hr", "offers_pending_approval",
        "external_awaiting_scorecard", "external_no_show_open", "offers_no_response_7d",
        "external_starting_soon", "invites_unopened_3d",
    ]
    assert [i["severity"] for i in items] == ["urgent"] * 2 + ["warn"] * 6 + ["info"] * 2


async def test_an_external_interview_counts_as_awaiting_only_once_start_plus_duration_has_passed(world):
    j = await world.job()
    await world.external(j, start=timedelta(minutes=-50), duration=45)
    await world.external(j, start=timedelta(minutes=-50), duration=60)
    payload = await attention.build_attention(world.db, job_ids=[j], now=NOW)
    assert counts(payload) == {"external_awaiting_scorecard": 1}


async def test_time_windows_are_measured_from_one_now(world):
    j = await world.job()
    await world.offer(j, "sent", sent=timedelta(days=-7, minutes=-1))
    await world.offer(j, "sent", sent=timedelta(days=-7, minutes=1))
    await world.failed_email(j, ago=timedelta(hours=24, minutes=-1))
    await world.failed_email(j, ago=timedelta(hours=24, minutes=1))
    assert counts(await attention.build_attention(world.db, job_ids=[j], now=NOW)) == {
        "offers_no_response_7d": 1, "email_failures_24h": 1,
    }
    later = NOW + timedelta(minutes=5)
    assert counts(await attention.build_attention(world.db, job_ids=[j], now=later)) == {"offers_no_response_7d": 2}


async def test_items_have_one_shape_and_a_place_in_the_app(world):
    j, _ = await seeded(world)
    items = (await attention.build_attention(world.db, job_ids=[j], now=NOW))["items"]
    for item in items:
        assert set(item) == ITEM_KEYS
        assert isinstance(item["count"], int) and item["count"] > 0
        assert item["severity"] in ("info", "warn", "urgent")
        assert item["path"].startswith("/dashboard/")
        assert item["query"] and all(isinstance(k, str) and isinstance(v, str) for k, v in item["query"].items())
        assert item["label"] and EM_DASH not in item["label"]
    by_key = {i["key"]: i for i in items}
    assert by_key["email_failures_24h"]["path"] == "/dashboard/settings" and by_key["email_failures_24h"]["query"] == {"tab": "delivery"}
    assert by_key["offers_pending_approval"]["path"] == "/dashboard/hrbot"
    assert by_key["offers_pending_approval"]["query"] == {"attention": "offers_pending_approval"}


async def test_the_payload_has_no_names_emails_tokens_or_scores(world):
    j, other = await seeded(world)
    text = json.dumps(await attention.build_attention(world.db, job_ids=[j, other], now=NOW))
    for private in ("Zed", "Attention", "attention.example.com", "@", "tok_", "meet.google.com", "final_score", "recommendation"):
        assert private not in text
    assert j not in text and other not in text


async def test_every_definition_has_a_counter_and_no_label_has_an_em_dash():
    keys = [d[0] for d in attention.ITEM_DEFINITIONS]
    assert set(keys) == set(attention._COUNTERS) == set(attention._LISTERS) and len(keys) == len(set(keys)) == 10
    assert all(EM_DASH not in d[1] for d in attention.ITEM_DEFINITIONS)


async def test_a_counter_that_fails_is_left_out_not_fatal(world, monkeypatch):
    j = await world.job()
    await world.offer(j, "pending_approval")
    await world.failed_email(j, ago=timedelta(hours=1))

    async def broken(db, scope, now):
        raise RuntimeError("index missing")

    monkeypatch.setitem(attention._COUNTERS, "email_failures_24h", broken)
    payload = await attention.build_attention(world.db, job_ids=[j], now=NOW)
    assert counts(payload) == {"offers_pending_approval": 1}


async def test_the_route_is_admin_only(client, admin_headers, standard_headers, superadmin_headers):
    assert (await client.get("/api/v1/attention", headers=standard_headers)).status_code == 403
    assert (await client.get("/api/v1/attention")).status_code == 401
    assert (await client.get("/api/v1/attention", headers=admin_headers)).status_code == 200
    assert (await client.get("/api/v1/attention", headers=superadmin_headers)).status_code == 200


async def test_the_route_returns_the_shape_and_counts_what_is_there(client, admin_headers, world):
    j, other = await seeded(world)
    resp = await client.get("/api/v1/attention", headers=admin_headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert set(body) == {"generated_at", "items"}
    datetime.fromisoformat(body["generated_at"])
    assert all(set(i) == ITEM_KEYS and i["count"] > 0 for i in body["items"])
    order = {"urgent": 0, "warn": 1, "info": 2}
    assert [order[i["severity"]] for i in body["items"]] == sorted(order[i["severity"]] for i in body["items"])
    got = counts(body)
    assert all(got.get(key, 0) >= n for key, n in J_COUNTS.items())


async def test_a_department_scoped_caller_sees_only_its_jobs(client, admin_headers, world, monkeypatch):
    import routes.attention as route

    j, other = await seeded(world)
    seen: dict = {}

    async def scope(user):
        seen["user"] = user["email"]
        return "dept-a"

    async def visible_jobs(db, department_id):
        seen["department"] = department_id
        return [j]

    monkeypatch.setattr(route, "get_department_scope", scope)
    monkeypatch.setattr(route, "scoped_job_ids", visible_jobs)
    resp = await client.get("/api/v1/attention", headers=admin_headers)
    assert resp.status_code == 200, resp.text
    assert seen == {"user": "demo-admin@hirely.ai", "department": "dept-a"}
    assert counts(resp.json()) == J_COUNTS

    async def nothing(db, department_id):
        return []

    monkeypatch.setattr(route, "scoped_job_ids", nothing)
    assert (await client.get("/api/v1/attention", headers=admin_headers)).json()["items"] == []


async def test_the_permission_is_registered_for_admins_only():
    assert "attention:read" in PERMISSION_CATALOG
    assert "attention:read" in DEFAULT_ROLE_PERMISSIONS["admin"]
    assert "attention:read" in DEFAULT_ROLE_PERMISSIONS["superadmin"]
    assert "attention:read" not in DEFAULT_ROLE_PERMISSIONS["standard"]


async def test_the_new_query_fields_are_indexed(world):
    names = {
        "candidates": {"status_1_invite_expires_at_1", "interview_mode_1_external_interview.scheduled_start_at_1"},
        "offers": {"status_1_sent_at_1"},
        "email_log": {"status_1_created_at_-1"},
    }
    for collection, expected in names.items():
        existing = set((await get_platform_db()[collection].index_information()).keys())
        assert expected <= existing, (collection, expected - existing)


ITEM_FIELDS = {"candidate_id", "job_id", "job_title", "name", "stage", "detail", "due_at"}
LIST_KEYS = {"key", "label", "total", "items"}
CANDIDATE_KEYS = [k for k in J_COUNTS if k != "email_failures_24h"]


async def drill(world, key: str, job_ids):
    return await attention.list_attention(world.db, key, job_ids=job_ids, now=NOW)


def rows(result: dict) -> list[tuple]:
    return [(i["name"], i["detail"]) for i in result["items"]]


def candidate_doc(job_id: str, name: str, **fields) -> dict:
    cid = str(uuid.uuid4())
    doc = {
        "doc_type": "candidate", "candidate_id": cid, "job_id": job_id, "name": name,
        "email": f"{cid[:8]}@attention.example.com", "secure_token": f"tok_{cid[:12]}", "phone": "+1-555-0142",
        "status": "interviewing", "pipeline_stage": "interviewing", "created_at": iso(hours=-1),
    }
    doc.update(fields)
    return doc


async def test_every_list_agrees_with_its_count_and_has_one_shape(world):
    j, other = await seeded(world)
    queue = counts(await attention.build_attention(world.db, job_ids=[j], now=NOW))
    seen_totals = {}
    for key in attention.KEYS:
        result = await drill(world, key, [j])
        assert set(result) == LIST_KEYS and result["key"] == key and result["label"] == attention.LABELS[key]
        assert isinstance(result["total"], int)
        seen_totals[key] = result["total"]
        assert len(result["items"]) == (0 if key == "email_failures_24h" else result["total"])
        for item in result["items"]:
            assert set(item) == ITEM_FIELDS
            assert item["candidate_id"] and item["job_id"] == j and item["job_title"] == "Ops Lead"
            assert item["detail"] and isinstance(item["detail"], str) and EM_DASH not in item["detail"]
            assert item["due_at"] is None or datetime.fromisoformat(item["due_at"]).tzinfo is not None
            if key in CANDIDATE_KEYS and not key.startswith("offers_"):
                assert item["name"] == "Zed Attention" and item["stage"]
    assert {k: v for k, v in seen_totals.items() if v} == queue == J_COUNTS
    assert set(attention.KEYS) == set(J_COUNTS) == {d[0] for d in attention.ITEM_DEFINITIONS}


async def test_external_awaiting_scorecard_lists_the_longest_waiting_first(world):
    j = await world.job()
    await world.external(j, start=timedelta(minutes=-75), duration=45, name="Recent")
    await world.external(j, start=timedelta(hours=-6), duration=60, name="Mid")
    await world.external(j, start=timedelta(hours=-25), duration=60, name="Old")
    await world.external(j, start=timedelta(minutes=-10), name="Still running")
    await world.external(j, start=timedelta(hours=-6), name="Reviewed", external_review={"overall": 4.0})
    result = await drill(world, "external_awaiting_scorecard", [j])
    assert result["total"] == 3
    assert rows(result) == [
        ("Old", "Interview ended 1 day ago"), ("Mid", "Interview ended 5 hours ago"),
        ("Recent", "Interview ended 30 minutes ago"),
    ]
    assert [i["due_at"] for i in result["items"]] == [
        (NOW + timedelta(hours=-24)).isoformat(), (NOW + timedelta(hours=-5)).isoformat(),
        (NOW + timedelta(minutes=-30)).isoformat(),
    ]
    assert {i["stage"] for i in result["items"]} == {"interviewing"}


async def test_external_no_show_open_lists_the_oldest_no_show_first(world):
    j = await world.job()
    await world.external(j, start=timedelta(days=-1), ext_status="no_show", name="B")
    await world.external(j, start=timedelta(hours=-2), ext_status="no_show", name="C")
    await world.external(j, start=timedelta(days=-3), ext_status="no_show", name="A")
    await world.external(j, start=timedelta(days=-5), ext_status="no_show", name="Closed", pipeline_stage="rejected", status="rejected")
    result = await drill(world, "external_no_show_open", [j])
    assert result["total"] == 3
    assert rows(result) == [("A", "No-show 3 days ago"), ("B", "No-show 1 day ago"), ("C", "No-show 2 hours ago")]
    assert result["items"][0]["due_at"] == (NOW + timedelta(days=-3)).isoformat()


async def test_external_starting_soon_lists_the_soonest_first(world):
    j = await world.job()
    await world.external(j, start=timedelta(hours=10), name="C")
    await world.external(j, start=timedelta(minutes=30), name="A")
    await world.external(j, start=timedelta(hours=1), name="B")
    await world.external(j, start=timedelta(hours=30), name="Later")
    result = await drill(world, "external_starting_soon", [j])
    assert result["total"] == 3
    assert rows(result) == [
        ("A", "Interview starts in 30 minutes"), ("B", "Interview starts in 1 hour"), ("C", "Interview starts in 10 hours"),
    ]
    assert result["items"][0]["due_at"] == (NOW + timedelta(minutes=30)).isoformat()


async def test_link_scorecards_waiting_lists_the_longest_waiting_first_and_holds_no_scorecard_text(world):
    j = await world.job()

    def link(days: int) -> dict:
        return {
            "scorecard_id": uuid.uuid4().hex, "source": "link", "submitted_at": iso(days=days),
            "interviewer_name": "Hidden Interviewer", "summary": "SECRETSUMMARY", "ratings": {"technical": 1},
            "questions": [{"question_id": "q1", "rating": 2, "notes": "SECRETNOTE"}],
        }

    await world.external(j, start=timedelta(hours=60), name="B", interview_scorecards=[link(-1)])
    await world.external(j, start=timedelta(hours=60), name="A", interview_scorecards=[link(-5)])
    await world.external(j, start=timedelta(hours=60), name="C", interview_scorecards=[link(-2), link(-4)])
    await world.external(j, start=timedelta(hours=60), name="Has HR", interview_scorecards=[link(-9), {**link(-9), "source": "hr"}])
    result = await drill(world, "link_scorecards_waiting_for_hr", [j])
    assert result["total"] == 3
    assert rows(result) == [
        ("A", "Interviewer scorecard waiting 5 days"), ("C", "Interviewer scorecard waiting 4 days"),
        ("B", "Interviewer scorecard waiting 1 day"),
    ]
    text = json.dumps(result)
    for hidden in ("SECRET", "Hidden Interviewer", "interview_scorecards", "ratings"):
        assert hidden not in text


async def test_offers_pending_approval_names_the_candidate_and_leaves_out_the_terms(world):
    j = await world.job()
    p1 = await world.candidate(j, name="P1", status="completed", pipeline_stage="completed")
    p2 = await world.candidate(j, name="P2", status="completed", pipeline_stage="completed")
    p3 = await world.candidate(j, name="P3", status="hired", pipeline_stage="hired")
    await world.offer(j, "pending_approval", created=timedelta(days=-4), candidate_id=p1)
    await world.offer(j, "pending_approval", created=timedelta(days=-1), candidate_id=p2)
    await world.offer(j, "pending_approval", created=timedelta(days=-10), candidate_id=p3)
    await world.offer(j, "approved", created=timedelta(days=-30), candidate_id=p1)
    result = await drill(world, "offers_pending_approval", [j])
    assert result["total"] == 3
    assert rows(result) == [
        ("P3", "Offer waiting for approval for 10 days"), ("P1", "Offer waiting for approval for 4 days"),
        ("P2", "Offer waiting for approval for 1 day"),
    ]
    assert [i["candidate_id"] for i in result["items"]] == [p3, p1, p2]
    assert [i["stage"] for i in result["items"]] == ["hired", "completed", "completed"]
    assert result["items"][0]["due_at"] == (NOW + timedelta(days=-10)).isoformat()
    assert "99999" not in json.dumps(result) and "salary" not in json.dumps(result)


async def test_offers_with_no_reply_list_the_longest_silent_first(world):
    j = await world.job()
    n1 = await world.candidate(j, name="N1")
    n2 = await world.candidate(j, name="N2")
    n3 = await world.candidate(j, name="N3")
    await world.offer(j, "sent", sent=timedelta(days=-8), candidate_id=n2)
    await world.offer(j, "sent", sent=timedelta(days=-20), candidate_id=n1)
    await world.offer(j, "sent", sent=timedelta(days=-9), candidate_id=n3)
    await world.offer(j, "sent", sent=timedelta(days=-2), candidate_id=n3)
    result = await drill(world, "offers_no_response_7d", [j])
    assert result["total"] == 3
    assert rows(result) == [("N1", "Offer sent 20 days ago"), ("N3", "Offer sent 9 days ago"), ("N2", "Offer sent 8 days ago")]
    assert result["items"][0]["due_at"] == (NOW + timedelta(days=-13)).isoformat()


async def test_unopened_invites_list_the_soonest_to_expire_first(world):
    j = await world.job()
    await world.invite(j, sent=timedelta(days=-4), expires=timedelta(days=5), name="Z")
    await world.invite(j, sent=timedelta(days=-6), expires=timedelta(days=1), name="X")
    await world.invite(j, sent=timedelta(days=-4), expires=timedelta(days=3), name="Y")
    await world.invite(j, sent=timedelta(days=-1), expires=timedelta(days=6), name="Too new")
    result = await drill(world, "invites_unopened_3d", [j])
    assert result["total"] == 3
    assert rows(result) == [("X", "Invite sent 6 days ago"), ("Y", "Invite sent 4 days ago"), ("Z", "Invite sent 4 days ago")]
    assert result["items"][0]["due_at"] == (NOW + timedelta(days=1)).isoformat()
    assert {i["stage"] for i in result["items"]} == {"invited"}


async def test_expiring_invites_list_the_soonest_first(world):
    j = await world.job()
    await world.invite(j, sent=timedelta(days=-1), expires=timedelta(hours=40), name="E3")
    await world.invite(j, sent=timedelta(days=-1), expires=timedelta(hours=2), name="E1")
    await world.invite(j, sent=timedelta(days=-1), expires=timedelta(hours=20), name="E2")
    await world.invite(j, sent=timedelta(days=-1), expires=timedelta(hours=60), name="Not yet")
    await world.invite(j, sent=timedelta(days=-3), expires=timedelta(hours=-1), name="Already gone")
    result = await drill(world, "invites_expiring_48h", [j])
    assert result["total"] == 3
    assert rows(result) == [
        ("E1", "Invite expires in 2 hours"), ("E2", "Invite expires in 20 hours"), ("E3", "Invite expires in 1 day"),
    ]
    assert result["items"][0]["due_at"] == (NOW + timedelta(hours=2)).isoformat()


async def test_stuck_candidates_list_the_longest_idle_first(world):
    j = await world.job()
    await world.candidate(j, name="S3", created_at=iso(days=-20), recruiter_notes_updated_at=iso(days=-8))
    await world.candidate(j, name="S1", created_at=iso(days=-30))
    await world.candidate(j, name="S2", created_at=iso(days=-20), status="completed", interview_ended_at=iso(days=-10))
    await world.candidate(j, name="Active", created_at=iso(days=-20), recruiter_notes_updated_at=iso(days=-1))
    result = await drill(world, "candidates_stuck_7d", [j])
    assert result["total"] == 3
    assert rows(result) == [("S1", "No movement for 30 days"), ("S2", "No movement for 10 days"), ("S3", "No movement for 8 days")]
    assert [i["stage"] for i in result["items"]] == ["interviewing", "completed", "interviewing"]
    assert result["items"][0]["due_at"] == iso(days=-30)


async def test_email_failures_have_a_total_and_no_rows(world):
    j = await world.job()
    for hours in (1, 3, 5):
        await world.failed_email(j, ago=timedelta(hours=hours))
    await world.failed_email(j, ago=timedelta(hours=40))
    result = await drill(world, "email_failures_24h", [j])
    assert result == {"key": "email_failures_24h", "label": attention.LABELS["email_failures_24h"], "total": 3, "items": []}
    item = next(i for i in (await attention.build_attention(world.db, job_ids=[j], now=NOW))["items"] if i["key"] == "email_failures_24h")
    assert (item["path"], item["query"]) == ("/dashboard/settings", {"tab": "delivery"})


async def test_a_list_is_capped_at_50_rows_but_total_counts_them_all(world):
    j = await world.job()
    await world.bulk([
        candidate_doc(
            j, f"N{i:02d}", status="invited", pipeline_stage="invited", token_status="active", session_active=False,
            invite_sent_at=iso(days=-1), invite_expires_at=iso(hours=1, minutes=i * 10),
        )
        for i in range(55)
    ])
    expiring = await drill(world, "invites_expiring_48h", [j])
    assert expiring["total"] == 55 and len(expiring["items"]) == 50 == attention.MAX_LIST_ITEMS
    assert [i["name"] for i in expiring["items"]] == [f"N{i:02d}" for i in range(50)]
    dues = [i["due_at"] for i in expiring["items"]]
    assert dues == sorted(dues)

    k = await world.job()
    await world.bulk([
        candidate_doc(
            k, f"A{i:02d}", interview_mode="external", token_status="unused",
            external_interview={
                "platform": "meet", "platform_label": "Google Meet", "join_url": "https://meet.google.com/abc-defg-hij",
                "scheduled_start_at": iso(hours=-3, minutes=-i), "duration_minutes": 30, "status": "scheduled",
            },
        )
        for i in range(52)
    ])
    awaiting = await drill(world, "external_awaiting_scorecard", [k])
    assert awaiting["total"] == 52 and len(awaiting["items"]) == 50
    assert awaiting["items"][0]["name"] == "A51" and awaiting["items"][-1]["name"] == "A02"


async def test_a_list_respects_the_visible_jobs(world):
    j, other = await seeded(world)
    assert (await drill(world, "external_awaiting_scorecard", [j]))["total"] == 1
    both = await drill(world, "external_awaiting_scorecard", [j, other])
    assert both["total"] == 2 and {i["job_id"] for i in both["items"]} == {j, other}
    assert {i["job_title"] for i in both["items"]} == {"Ops Lead"}
    for key in attention.KEYS:
        nothing = await drill(world, key, [])
        assert nothing["total"] == 0 and nothing["items"] == [], key


async def test_a_row_without_a_candidate_record_still_lists(world):
    j = await world.job()
    await world.offer(j, "pending_approval", created=timedelta(days=-2))
    result = await drill(world, "offers_pending_approval", [j])
    assert result["total"] == 1
    item = result["items"][0]
    assert item["name"] is None and item["stage"] is None and item["job_title"] == "Ops Lead"
    assert item["detail"] == "Offer waiting for approval for 2 days"


async def test_no_list_holds_contact_details_tokens_or_terms(world):
    j, other = await seeded(world)
    text = json.dumps({key: await drill(world, key, [j, other]) for key in attention.KEYS})
    for private in ("@", "attention.example.com", "555-0142", "tok_", "99999", "meet.google.com", "final_score", "recommendation"):
        assert private not in text, private


async def test_the_list_route_is_admin_only(client, admin_headers, standard_headers, superadmin_headers):
    for key in attention.KEYS:
        assert (await client.get(f"/api/v1/attention/{key}", headers=standard_headers)).status_code == 403, key
        assert (await client.get(f"/api/v1/attention/{key}")).status_code == 401, key
        assert (await client.get(f"/api/v1/attention/{key}", headers=admin_headers)).status_code == 200, key
    assert (await client.get("/api/v1/attention/offers_pending_approval", headers=superadmin_headers)).status_code == 200


async def test_an_unknown_key_is_a_404_with_a_plain_message(client, admin_headers, standard_headers):
    for key in ("nope", "email_failures_24", "EMAIL_FAILURES_24H", "external", "0"):
        resp = await client.get(f"/api/v1/attention/{key}", headers=admin_headers)
        assert resp.status_code == 404, key
        assert resp.json()["detail"] == "Unknown attention item"
    assert (await client.get("/api/v1/attention/nope", headers=standard_headers)).status_code == 403


async def test_the_list_route_returns_the_documented_shape_for_a_scoped_caller(client, admin_headers, world, monkeypatch):
    import routes.attention as route

    j, other = await seeded(world)
    seen: dict = {}

    async def scope(user):
        seen["scope_user"] = user["email"]
        return "dept-a"

    async def visible_jobs(db, department_id):
        seen["department"] = department_id
        return [j]

    monkeypatch.setattr(route, "get_department_scope", scope)
    monkeypatch.setattr(route, "scoped_job_ids", visible_jobs)

    queue = await client.get("/api/v1/attention", headers=admin_headers)
    assert counts(queue.json()) == J_COUNTS
    for key, expected in J_COUNTS.items():
        resp = await client.get(f"/api/v1/attention/{key}", headers=admin_headers)
        assert resp.status_code == 200, (key, resp.text)
        body = resp.json()
        assert set(body) == LIST_KEYS and body["key"] == key and body["total"] == expected
        assert len(body["items"]) == (0 if key == "email_failures_24h" else expected)
        assert all(set(i) == ITEM_FIELDS for i in body["items"])
        assert all(i["job_id"] == j for i in body["items"])
    assert seen == {"scope_user": "demo-admin@hirely.ai", "department": "dept-a"}

    async def nothing(db, department_id):
        return []

    monkeypatch.setattr(route, "scoped_job_ids", nothing)
    for key in attention.KEYS:
        body = (await client.get(f"/api/v1/attention/{key}", headers=admin_headers)).json()
        assert body["total"] == 0 and body["items"] == [], key


async def test_unrestricted_callers_see_every_job(client, admin_headers, world):
    j, other = await seeded(world)
    body = (await client.get("/api/v1/attention/external_awaiting_scorecard", headers=admin_headers)).json()
    assert body["total"] >= 2
    assert len(body["items"]) == min(body["total"], 50)
    listed = {i["job_id"] for i in body["items"]}
    assert listed >= ({j, other} if body["total"] <= 50 else set())
