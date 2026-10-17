import asyncio
import json
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from config.database import get_db
from services.hr_module import interview_guide_service as guide_service
from shared.utils import EM_DASH

pytestmark = pytest.mark.anyio

AREAS = ("technical", "communication", "problem_solving", "cultural_fit", "confidence")
MEET_URL = "https://meet.google.com/abc-defg-hij"
ADMIN_EMAIL = "demo-admin@hirely.ai"
GOOD_RATINGS = {"technical": 5, "communication": 4, "problem_solving": 4, "cultural_fit": 3, "confidence": 4}


class FakeLLM:
    def __init__(self):
        self.calls: list[dict] = []
        self.reply = json.dumps({"questions": []})

    async def __call__(self, prompt, system="", **kwargs):
        self.calls.append({"prompt": prompt, **kwargs})
        return self.reply


@pytest.fixture(autouse=True)
def llm(monkeypatch):
    fake = FakeLLM()
    monkeypatch.setattr(guide_service, "ask_llm", fake)
    return fake


@pytest.fixture(autouse=True)
def _own_ip_bucket(monkeypatch):
    import routes.interviewer_scorecard as page

    ip = f"test-{uuid.uuid4().hex[:10]}"
    monkeypatch.setattr(page, "_client_ip", lambda request: ip)


def stored_guide(n: int = 4, *, with_source: bool = False) -> dict:
    questions = []
    for i in range(1, n + 1):
        q = {
            "id": f"q{i}", "text": f"Guide question {i} about the platform migration?",
            "dimension": AREAS[(i - 1) % len(AREAS)], "listen_for": f"Listen for point {i}.",
        }
        if with_source:
            q["source"] = "ai"
        questions.append(q)
    return {
        "questions": questions, "generated_at": datetime.now(timezone.utc).isoformat(),
        "generated_by": "seed@example.com", "model": "test-model", "fallback": False,
    }


@pytest.fixture
async def seed():
    db = get_db()
    created = {"candidates": [], "jobs": []}

    async def candidate(*, mode="external", guide=4, with_source=False, stage="interviewing", **extra):
        job_id = f"guide-job-{uuid.uuid4().hex[:10]}"
        await db.jobs.insert_one({
            "doc_type": "job", "job_id": job_id, "title": "Platform Engineer",
            "company_name": "Guide Corp", "candidate_pipeline": [],
        })
        created["jobs"].append(job_id)
        cid = str(uuid.uuid4())
        doc = {
            "doc_type": "candidate", "candidate_id": cid, "job_id": job_id, "resume_id": None,
            "name": "Sam Rivera", "email": f"sam-{uuid.uuid4().hex[:8]}@example.com",
            "secure_token": f"tok_{uuid.uuid4().hex[:12]}", "token_status": "unused",
            "pipeline_stage": stage, "status": stage, "transcript": [],
        }
        if mode == "external":
            doc.update({
                "interview_mode": "external",
                "external_interview": {
                    "platform": "meet", "platform_label": "Google Meet", "join_url": MEET_URL,
                    "scheduled_start_at": (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat(),
                    "duration_minutes": 45, "status": "scheduled",
                },
            })
        if guide:
            doc["interview_guide"] = stored_guide(guide, with_source=with_source)
        doc.update(extra)
        await db.candidates.insert_one(doc)
        created["candidates"].append(cid)
        return SimpleNamespace(id=cid, job_id=job_id)

    yield SimpleNamespace(db=db, candidate=candidate)

    for cid in created["candidates"]:
        await db.candidates.delete_one({"candidate_id": cid})
        await db.interviewer_links.delete_many({"candidate_id": cid})
        await db.audit_log.delete_many({"resource_id": cid})
        await db.cost_ledger.delete_many({"ref_id": cid})
    for job_id in created["jobs"]:
        await db.jobs.delete_one({"job_id": job_id})
    await asyncio.sleep(0)


def url(cid: str, tail: str = "") -> str:
    return f"/api/v1/candidates/{cid}/interview-guide{tail}"


async def add(client, headers, cid, text="How do you decide what to automate first?", dimension="problem_solving", **extra):
    return await client.post(url(cid, "/questions"), json={"text": text, "dimension": dimension, **extra}, headers=headers)


async def stored(seed, cid) -> dict:
    return await seed.db.candidates.find_one({"candidate_id": cid})


def ids(guide: dict) -> list[str]:
    return [q["id"] for q in guide["questions"]]


async def test_adding_appends_a_custom_question_and_returns_the_whole_guide(client, admin_headers, seed):
    cand = await seed.candidate(guide=4)
    resp = await add(client, admin_headers, cand.id, listen_for="A repeatable, measured method.")
    assert resp.status_code == 200, resp.text
    guide = resp.json()

    assert ids(guide) == ["q1", "q2", "q3", "q4", "c1"]
    added = guide["questions"][-1]
    assert added == {
        "id": "c1", "text": "How do you decide what to automate first?", "dimension": "problem_solving",
        "listen_for": "A repeatable, measured method.", "source": "custom",
    }
    assert [q["source"] for q in guide["questions"][:4]] == ["ai"] * 4
    assert set(guide) == {"questions", "generated_at", "generated_by", "model", "fallback"}
    assert guide["generated_by"] == "seed@example.com" and guide["model"] == "test-model"

    got = await client.get(url(cand.id), headers=admin_headers)
    assert got.json() == guide
    assert (await stored(seed, cand.id))["interview_guide"]["questions"][-1] == added


async def test_ids_count_up_and_are_never_reused_while_a_later_one_exists(client, admin_headers, seed):
    cand = await seed.candidate(guide=4)
    for expected in ("c1", "c2", "c3"):
        assert ids((await add(client, admin_headers, cand.id)).json())[-1] == expected
    assert (await client.delete(url(cand.id, "/questions/c1"), headers=admin_headers)).status_code == 200
    assert ids((await add(client, admin_headers, cand.id)).json())[-1] == "c4"
    await client.delete(url(cand.id, "/questions/c4"), headers=admin_headers)
    assert ids((await add(client, admin_headers, cand.id)).json())[-1] == "c4"


async def test_adding_to_a_candidate_with_no_guide_creates_one(client, admin_headers, seed):
    cand = await seed.candidate(guide=0)
    assert (await client.get(url(cand.id), headers=admin_headers)).json() is None

    resp = await add(client, admin_headers, cand.id, text="Walk me through your last incident.", dimension="technical")
    assert resp.status_code == 200, resp.text
    guide = resp.json()
    assert ids(guide) == ["c1"] and guide["questions"][0]["source"] == "custom"
    assert guide["generated_by"] == ADMIN_EMAIL and guide["model"] is None and guide["fallback"] is False
    assert guide["generated_at"]
    assert guide["questions"][0]["listen_for"]
    assert (await client.get(url(cand.id), headers=admin_headers)).json() == guide
    assert (await stored(seed, cand.id))["interview_guide"]["questions"][0]["id"] == "c1"


async def test_a_guide_made_only_of_custom_questions_is_not_replaced_by_a_plain_post(client, admin_headers, seed, llm):
    cand = await seed.candidate(guide=0)
    await add(client, admin_headers, cand.id)
    again = await client.post(url(cand.id), json={}, headers=admin_headers)
    assert again.status_code == 200 and ids(again.json()) == ["c1"]
    assert llm.calls == []


@pytest.mark.parametrize("text", ["ab", "   ", "  a  ", "", "x" * 501])
async def test_the_text_must_be_3_to_500_characters(client, admin_headers, seed, text):
    cand = await seed.candidate(guide=4)
    resp = await add(client, admin_headers, cand.id, text=text)
    assert resp.status_code == 422, resp.text
    assert ids((await stored(seed, cand.id))["interview_guide"]) == ["q1", "q2", "q3", "q4"]


@pytest.mark.parametrize("text", ["abc", "x" * 500])
async def test_the_limits_themselves_are_accepted(client, admin_headers, seed, text):
    cand = await seed.candidate(guide=4)
    resp = await add(client, admin_headers, cand.id, text=text)
    assert resp.status_code == 200 and resp.json()["questions"][-1]["text"] == text


@pytest.mark.parametrize("dimension", ["culture", "Technical", "", "astrology"])
async def test_the_area_must_be_one_of_the_five(client, admin_headers, seed, dimension):
    cand = await seed.candidate(guide=4)
    resp = await add(client, admin_headers, cand.id, dimension=dimension)
    assert resp.status_code == 422
    assert "area" in resp.json()["detail"].lower()


async def test_every_area_is_accepted(client, admin_headers, seed):
    cand = await seed.candidate(guide=0)
    for area in AREAS:
        resp = await add(client, admin_headers, cand.id, text=f"A question about {area}?", dimension=area)
        assert resp.status_code == 200, area
    assert [q["dimension"] for q in resp.json()["questions"]] == list(AREAS)


async def test_the_hint_is_tidied_and_capped_and_the_text_loses_its_em_dashes(client, admin_headers, seed):
    cand = await seed.candidate(guide=4)
    resp = await add(
        client, admin_headers, cand.id, text=f"First   line\nsecond {EM_DASH} line?", listen_for="  Look for\nevidence.  ",
    )
    assert resp.status_code == 200
    added = resp.json()["questions"][-1]
    assert added["text"] == "First line second, line?" and added["listen_for"] == "Look for evidence."
    assert EM_DASH not in json.dumps(resp.json(), ensure_ascii=False)

    too_long = await add(client, admin_headers, cand.id, listen_for="h" * 301)
    assert too_long.status_code == 422
    blank = await add(client, admin_headers, cand.id, listen_for="   ")
    assert blank.status_code == 200 and blank.json()["questions"][-1]["listen_for"]


async def test_a_missing_field_is_a_validation_error(client, admin_headers, seed):
    cand = await seed.candidate(guide=4)
    for body in ({"dimension": "technical"}, {"text": "A real question?"}, {}):
        assert (await client.post(url(cand.id, "/questions"), json=body, headers=admin_headers)).status_code == 422


async def test_a_guide_holds_at_most_25_questions(client, admin_headers, seed):
    cand = await seed.candidate(guide=24)
    last = await add(client, admin_headers, cand.id)
    assert last.status_code == 200 and len(last.json()["questions"]) == 25

    over = await add(client, admin_headers, cand.id)
    assert over.status_code == 409 and isinstance(over.json()["detail"], str) and "25" in over.json()["detail"]
    assert len((await stored(seed, cand.id))["interview_guide"]["questions"]) == 25


def card(source: str, *marks: dict, submitted_by: str | None = None) -> dict:
    return {
        "scorecard_id": uuid.uuid4().hex, "source": source, "submitted_by": submitted_by,
        "interviewer_name": "Dev Patel", "interviewer_role": "engineer",
        "submitted_at": "2026-10-01T10:00:00+00:00", "updated_at": "2026-10-01T10:00:00+00:00",
        "questions": [
            {"question_id": qid, "text": f"Guide question {qid}", "dimension": "technical", "rating": rating, "notes": notes}
            for qid, rating, notes in marks
        ],
        "ratings": dict(GOOD_RATINGS), "recommendation": "hire", "summary": "Solid answers across the board here.",
        "strengths": None, "concerns": None,
    }


async def test_deleting_removes_the_question_and_returns_the_guide(client, admin_headers, seed):
    cand = await seed.candidate(guide=4)
    added = (await add(client, admin_headers, cand.id)).json()
    assert ids(added)[-1] == "c1"

    for qid, expected in (("c1", ["q1", "q2", "q3", "q4"]), ("q2", ["q1", "q3", "q4"])):
        resp = await client.delete(url(cand.id, f"/questions/{qid}"), headers=admin_headers)
        assert resp.status_code == 200, resp.text
        assert ids(resp.json()) == expected
        assert all(q["source"] == "ai" for q in resp.json()["questions"])
    assert ids((await stored(seed, cand.id))["interview_guide"]) == ["q1", "q3", "q4"]


async def test_an_unknown_question_is_a_404(client, admin_headers, seed):
    cand = await seed.candidate(guide=4)
    resp = await client.delete(url(cand.id, "/questions/zzz"), headers=admin_headers)
    assert resp.status_code == 404
    assert (await client.delete(url(cand.id, "/questions/q1"), headers=admin_headers)).status_code == 200
    assert (await client.delete(url(cand.id, "/questions/q1"), headers=admin_headers)).status_code == 404


async def test_a_question_with_a_rating_cannot_be_deleted(client, admin_headers, seed):
    cand = await seed.candidate(guide=4, interview_scorecards=[card("link", ("q2", 4, ""))])
    resp = await client.delete(url(cand.id, "/questions/q2"), headers=admin_headers)
    assert resp.status_code == 409
    assert isinstance(resp.json()["detail"], str) and "scorecard" in resp.json()["detail"]
    assert ids((await stored(seed, cand.id))["interview_guide"]) == ["q1", "q2", "q3", "q4"]


async def test_a_question_with_only_a_note_cannot_be_deleted(client, admin_headers, seed):
    cand = await seed.candidate(guide=4, interview_scorecards=[card("hr", ("q3", None, "Needed a hint"), submitted_by=ADMIN_EMAIL)])
    resp = await client.delete(url(cand.id, "/questions/q3"), headers=admin_headers)
    assert resp.status_code == 409 and isinstance(resp.json()["detail"], str)


async def test_any_scorecard_counts_not_only_the_first(client, admin_headers, seed):
    cand = await seed.candidate(
        guide=4, interview_scorecards=[card("link", ("q1", 3, "")), card("link", ("q4", None, "A note"))],
    )
    assert (await client.delete(url(cand.id, "/questions/q4"), headers=admin_headers)).status_code == 409
    assert (await client.delete(url(cand.id, "/questions/q2"), headers=admin_headers)).status_code == 200


async def test_a_blank_mark_does_not_block_and_is_removed_with_the_question(client, admin_headers, seed):
    cand = await seed.candidate(
        guide=4, interview_scorecards=[card("link", ("q1", None, ""), ("q2", 4, "Strong"))],
    )
    resp = await client.delete(url(cand.id, "/questions/q1"), headers=admin_headers)
    assert resp.status_code == 200 and ids(resp.json()) == ["q2", "q3", "q4"]
    marks = (await stored(seed, cand.id))["interview_scorecards"][0]["questions"]
    assert [m["question_id"] for m in marks] == ["q2"]


async def test_deleting_the_last_question_leaves_no_guide_stored(client, admin_headers, seed):
    cand = await seed.candidate(guide=0)
    await add(client, admin_headers, cand.id)
    resp = await client.delete(url(cand.id, "/questions/c1"), headers=admin_headers)
    assert resp.status_code == 200 and resp.json()["questions"] == []
    assert (await stored(seed, cand.id))["interview_guide"] is None
    assert (await client.get(url(cand.id), headers=admin_headers)).json() is None
    assert ids((await add(client, admin_headers, cand.id)).json()) == ["c1"]


async def test_reordering_applies_the_new_order(client, admin_headers, seed):
    cand = await seed.candidate(guide=4)
    await add(client, admin_headers, cand.id)
    resp = await client.put(url(cand.id, "/order"), json={"ids": ["c1", "q3", "q1", "q4", "q2"]}, headers=admin_headers)
    assert resp.status_code == 200, resp.text
    guide = resp.json()
    assert ids(guide) == ["c1", "q3", "q1", "q4", "q2"]
    assert guide["questions"][0]["source"] == "custom" and guide["questions"][1]["source"] == "ai"
    assert guide["questions"][1]["text"] == "Guide question 3 about the platform migration?"
    assert (await client.get(url(cand.id), headers=admin_headers)).json() == guide
    assert ids((await stored(seed, cand.id))["interview_guide"]) == ["c1", "q3", "q1", "q4", "q2"]


@pytest.mark.parametrize("order", [
    ["q1", "q2", "q3"],
    ["q1", "q2", "q3", "q4", "q5"],
    ["q1", "q1", "q3", "q4"],
    ["q1", "q2", "q3", "nope"],
    [],
])
async def test_an_order_that_is_not_a_permutation_is_refused(client, admin_headers, seed, order):
    cand = await seed.candidate(guide=4)
    resp = await client.put(url(cand.id, "/order"), json={"ids": order}, headers=admin_headers)
    assert resp.status_code == 422, resp.text
    assert isinstance(resp.json()["detail"], str)
    assert ids((await stored(seed, cand.id))["interview_guide"]) == ["q1", "q2", "q3", "q4"]


async def test_the_order_body_must_be_a_list_of_ids(client, admin_headers, seed):
    cand = await seed.candidate(guide=4)
    for body in ({}, {"ids": "q1"}, {"ids": [1, 2, 3, 4]}):
        assert (await client.put(url(cand.id, "/order"), json=body, headers=admin_headers)).status_code == 422


async def test_reordering_with_no_guide_is_a_404(client, admin_headers, seed):
    cand = await seed.candidate(guide=0)
    resp = await client.put(url(cand.id, "/order"), json={"ids": ["q1"]}, headers=admin_headers)
    assert resp.status_code == 404


async def test_reordering_is_allowed_after_marks_exist_and_the_report_follows_the_new_order(client, admin_headers, seed):
    cand = await seed.candidate(guide=4)
    review = await client.post(
        f"/api/v1/candidates/{cand.id}/external-review", headers=admin_headers,
        json={
            "attended": True, "ratings": GOOD_RATINGS, "recommendation": "hire",
            "summary": "Strong on the platform migration and clear about trade-offs.",
            "questions": [
                {"question_id": "q1", "rating": 5, "notes": "Clear"},
                {"question_id": "q2", "rating": 3, "notes": "Hesitant"},
            ],
        },
    )
    assert review.status_code == 200, review.text
    before = (await stored(seed, cand.id))["report"]["questions"]
    assert [q["question_id"] for q in before] == ["q1", "q2"]

    resp = await client.put(url(cand.id, "/order"), json={"ids": ["q4", "q2", "q3", "q1"]}, headers=admin_headers)
    assert resp.status_code == 200 and ids(resp.json()) == ["q4", "q2", "q3", "q1"]
    after = await stored(seed, cand.id)
    assert [q["question_id"] for q in after["report"]["questions"]] == ["q2", "q1"]
    assert after["interview_scorecards"][0]["questions"][0]["notes"] == "Clear"
    assert after["pipeline_stage"] == "completed" and after["report_status"] == "ready"


async def test_regenerating_keeps_custom_questions(client, admin_headers, seed, llm):
    cand = await seed.candidate(guide=4)
    await add(client, admin_headers, cand.id, text="Tell me about the migration you led?", dimension="technical")
    llm.reply = json.dumps({"questions": [
        {"text": f"Question {i}: what drove the migration decision, part {i}?", "dimension": AREAS[i % 4], "listen_for": "Specifics."}
        for i in range(10)
    ]})
    resp = await client.post(url(cand.id), json={"regenerate": True}, headers=admin_headers)
    assert resp.status_code == 200, resp.text
    guide = resp.json()
    assert len(llm.calls) == 1
    assert ids(guide) == [f"q{i}" for i in range(1, 11)] + ["c1"]
    assert [q["source"] for q in guide["questions"]] == ["ai"] * 10 + ["custom"]
    assert guide["questions"][-1]["text"] == "Tell me about the migration you led?"


async def test_regenerating_is_still_refused_once_a_scorecard_exists(client, admin_headers, seed):
    cand = await seed.candidate(guide=4, interview_scorecards=[card("link", ("q1", 4, ""))])
    resp = await client.post(url(cand.id), json={"regenerate": True}, headers=admin_headers)
    assert resp.status_code == 409


async def test_standard_users_cannot_edit_the_guide(client, standard_headers, seed):
    cand = await seed.candidate(guide=4)
    assert (await add(client, standard_headers, cand.id)).status_code == 403
    assert (await client.delete(url(cand.id, "/questions/q1"), headers=standard_headers)).status_code == 403
    assert (await client.put(url(cand.id, "/order"), json={"ids": ["q1", "q2", "q3", "q4"]}, headers=standard_headers)).status_code == 403
    assert ids((await stored(seed, cand.id))["interview_guide"]) == ["q1", "q2", "q3", "q4"]


async def test_editing_needs_a_sign_in(client, seed):
    cand = await seed.candidate(guide=4)
    assert (await client.post(url(cand.id, "/questions"), json={"text": "A question?", "dimension": "technical"})).status_code == 401
    assert (await client.delete(url(cand.id, "/questions/q1"))).status_code == 401
    assert (await client.put(url(cand.id, "/order"), json={"ids": []})).status_code == 401


async def test_editing_needs_an_interview_on_another_platform(client, admin_headers, seed):
    cand = await seed.candidate(mode="platform", guide=0)
    assert (await add(client, admin_headers, cand.id)).status_code == 409
    assert (await client.delete(url(cand.id, "/questions/q1"), headers=admin_headers)).status_code == 409
    assert (await client.put(url(cand.id, "/order"), json={"ids": ["q1"]}, headers=admin_headers)).status_code == 409
    assert "interview_guide" not in await stored(seed, cand.id)


async def test_an_unknown_candidate_is_a_404(client, admin_headers):
    assert (await add(client, admin_headers, "no-such-candidate")).status_code == 404
    assert (await client.delete(url("no-such-candidate", "/questions/q1"), headers=admin_headers)).status_code == 404
    assert (await client.put(url("no-such-candidate", "/order"), json={"ids": []}, headers=admin_headers)).status_code == 404


async def test_each_edit_is_audited(client, admin_headers, seed):
    cand = await seed.candidate(guide=4)
    await add(client, admin_headers, cand.id)
    await client.put(url(cand.id, "/order"), json={"ids": ["c1", "q1", "q2", "q3", "q4"]}, headers=admin_headers)
    await client.delete(url(cand.id, "/questions/c1"), headers=admin_headers)

    entries = {
        e["action"]: e async for e in seed.db.audit_log.find({"resource_id": cand.id})
    }
    assert set(entries) == {"interview_guide_question_added", "interview_guide_reordered", "interview_guide_question_deleted"}
    assert entries["interview_guide_question_added"]["details"]["question_id"] == "c1"
    assert entries["interview_guide_question_added"]["actor_email"] == ADMIN_EMAIL
    assert entries["interview_guide_question_deleted"]["details"] == {"question_id": "c1", "questions": 4}
    assert "automate" not in json.dumps([e["details"] for e in entries.values()])


async def test_the_public_interviewer_page_shows_custom_questions_their_source_and_the_new_order(client, admin_headers, seed):
    cand = await seed.candidate(guide=4)
    minted = await client.post(f"/api/v1/candidates/{cand.id}/interviewer-links", json={}, headers=admin_headers)
    assert minted.status_code == 200, minted.text
    token = minted.json()["token"]

    page = await client.get(f"/api/v1/interviewer-scorecard/{token}")
    assert page.status_code == 200
    assert [q["id"] for q in page.json()["guide"]["questions"]] == ["q1", "q2", "q3", "q4"]
    assert {q["source"] for q in page.json()["guide"]["questions"]} == {"ai"}

    await add(client, admin_headers, cand.id, text="How do you decide what to automate first?")
    await client.put(url(cand.id, "/order"), json={"ids": ["c1", "q4", "q3", "q2", "q1"]}, headers=admin_headers)
    page = await client.get(f"/api/v1/interviewer-scorecard/{token}")
    questions = page.json()["guide"]["questions"]
    assert [q["id"] for q in questions] == ["c1", "q4", "q3", "q2", "q1"]
    assert questions[0] == {
        "id": "c1", "text": "How do you decide what to automate first?", "dimension": "problem_solving",
        "listen_for": questions[0]["listen_for"], "source": "custom",
    }
    assert questions[0]["listen_for"]

    await client.delete(url(cand.id, "/questions/c1"), headers=admin_headers)
    page = await client.get(f"/api/v1/interviewer-scorecard/{token}")
    assert [q["id"] for q in page.json()["guide"]["questions"]] == ["q4", "q3", "q2", "q1"]


async def test_a_scorecard_can_mark_a_custom_question(client, admin_headers, seed):
    cand = await seed.candidate(guide=4)
    minted = await client.post(f"/api/v1/candidates/{cand.id}/interviewer-links", json={}, headers=admin_headers)
    token = minted.json()["token"]
    await add(client, admin_headers, cand.id, text="How do you decide what to automate first?")

    saved = await client.put(f"/api/v1/interviewer-scorecard/{token}", json={
        "interviewer_name": "Dev Patel", "interviewer_role": "engineer", "ratings": GOOD_RATINGS,
        "recommendation": "hire", "summary": "Thoughtful about priorities and honest about limits.",
        "questions": [{"question_id": "c1", "rating": 4, "notes": "Good method"}],
    })
    assert saved.status_code == 200, saved.text
    assert saved.json()["scorecard"]["questions"][0]["text"] == "How do you decide what to automate first?"
    assert (await client.delete(url(cand.id, "/questions/c1"), headers=admin_headers)).status_code == 409
