import asyncio
import contextlib
import hashlib
import io
import json
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from config.database import get_db
from config.settings import settings
from services.hr_module import external_interview_service as ext
from services.hr_module import interview_guide_service as guide_service
from services.hr_module import interviewer_link_service as link_service
from services.hr_module import scorecard_service as sc
from services.hr_module.permissions import DEFAULT_ROLE_PERMISSIONS
from shared.utils import EM_DASH

pytestmark = pytest.mark.anyio

MEET_URL = "https://meet.google.com/abc-defg-hij"
RESUME_MARKER = "ORIONMIGRATION"
RESUME_TAIL = "TAILBEYONDFOURTHOUSAND"
JD_MARKER = "KUBERNETESJDMARKER"
TOPIC_MARKER = "INCIDENTRESPONSETOPIC"
SKILL_MARKER = "TERRAFORMSKILL"
CANDIDATE_NAME = "Sam Rivera"
PHONE = "+1-555-0177"
HR_EMAIL = "demo-admin@hirely.ai"

AREAS = ("technical", "communication", "problem_solving", "cultural_fit", "confidence")
GOOD_RATINGS = {"technical": 5, "communication": 4, "problem_solving": 4, "cultural_fit": 3, "confidence": 4}
GOOD_FINAL = 83


def guide_reply(n: int = 10, marker: str = "Orion") -> str:
    dims = ["technical", "communication", "problem_solving", "cultural_fit", "technical",
            "problem_solving", "confidence", "communication", "cultural_fit", "technical"]
    return json.dumps({"questions": [
        {
            "text": f"Question {i + 1}: what drove the {marker} migration decision, part {i + 1}?",
            "dimension": dims[i % len(dims)],
            "listen_for": f"A concrete answer for point {i + 1}.",
        }
        for i in range(n)
    ]})


class FakeLLM:

    def __init__(self):
        self.calls: list[dict] = []
        self.guide = guide_reply()
        self.summary = "The candidate showed solid technical depth. Notes recorded by the interviewer are positive."
        self.error: Exception | None = None

    async def __call__(self, prompt, system="", **kwargs):
        self.calls.append({"prompt": prompt, "system": system, **kwargs})
        if self.error:
            raise self.error
        return self.guide if kwargs.get("json_mode") else self.summary


@pytest.fixture(autouse=True)
def llm(monkeypatch):
    fake = FakeLLM()
    monkeypatch.setattr(guide_service, "ask_llm", fake)
    return fake


@pytest.fixture
def cost_calls(monkeypatch):
    calls: list[tuple] = []

    @contextlib.asynccontextmanager
    async def fake_track(source, ref_id=None, items=None):
        calls.append((source, ref_id))
        yield

    monkeypatch.setattr(guide_service, "track_llm_cost", fake_track)
    return calls


@pytest.fixture(autouse=True)
def _own_ip_bucket(monkeypatch):
    import routes.interviewer_scorecard as page

    ip = f"test-{uuid.uuid4().hex[:10]}"
    monkeypatch.setattr(page, "_client_ip", lambda request: ip)


def stored_guide(n: int = 10) -> dict:
    return {
        "questions": [
            {
                "id": f"q{i}",
                "text": f"Guide question {i} about the Orion migration?",
                "dimension": AREAS[(i - 1) % len(AREAS)],
                "listen_for": f"Listen for point {i}.",
            }
            for i in range(1, n + 1)
        ],
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "generated_by": "seed@example.com",
        "model": "test-model",
        "fallback": False,
    }


@pytest.fixture
async def seed():
    db = get_db()
    created = {"candidates": [], "jobs": [], "resumes": []}

    async def candidate(*, mode="external", stage="interviewing", guide=0, resume=True, **extra):
        job_id = f"sc-job-{uuid.uuid4().hex[:10]}"
        resume_id = f"sc-resume-{uuid.uuid4().hex[:10]}" if resume else None
        cid = str(uuid.uuid4())
        email = f"sam-{uuid.uuid4().hex[:8]}@example.com"
        await db.jobs.insert_one({
            "doc_type": "job", "job_id": job_id, "title": "Platform Engineer", "company_name": "Scorecard Corp",
            "description": f"We need a platform engineer. {JD_MARKER} experience is essential.",
            "parsed_criteria": {"skills": [SKILL_MARKER, "Python"], "interview_topics": [TOPIC_MARKER]},
            "candidate_pipeline": [{"resume_id": resume_id, "similarity_score": 0.8, "pipeline_stage": stage}] if resume else [],
        })
        created["jobs"].append(job_id)
        if resume:
            await db.resumes.insert_one({
                "doc_type": "resume", "resume_id": resume_id, "candidate_name": CANDIDATE_NAME,
                "candidate_email": email,
                "text": f"{RESUME_MARKER} led the data platform. " + ("filler " * 700) + RESUME_TAIL,
                "classification": {
                    "seniority_level": "senior", "job_domain": "software_engineering",
                    "skills": [f"skill-{i}" for i in range(20)],
                },
            })
            created["resumes"].append(resume_id)
        token = f"tok_{uuid.uuid4().hex[:12]}"
        doc = {
            "doc_type": "candidate", "candidate_id": cid, "job_id": job_id, "resume_id": resume_id,
            "name": CANDIDATE_NAME, "email": email, "phone": PHONE, "secure_token": token,
            "token_status": "unused", "pipeline_stage": stage, "status": stage, "transcript": [],
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
            doc["interview_guide"] = stored_guide(guide)
        doc.update(extra)
        await db.candidates.insert_one(doc)
        created["candidates"].append(cid)
        return SimpleNamespace(id=cid, token=token, job_id=job_id, resume_id=resume_id, email=email)

    yield SimpleNamespace(db=db, candidate=candidate, created=created)

    for cid in created["candidates"]:
        await db.candidates.delete_one({"candidate_id": cid})
        await db.interviewer_links.delete_many({"candidate_id": cid})
        await db.audit_log.delete_many({"resource_id": cid})
        await db.report_shares.delete_many({"candidate_id": cid})
        await db.cost_ledger.delete_many({"ref_id": cid})
    for job_id in created["jobs"]:
        await db.jobs.delete_one({"job_id": job_id})
    for resume_id in created["resumes"]:
        await db.resumes.delete_one({"resume_id": resume_id})
    await asyncio.sleep(0)


def hr_body(**overrides) -> dict:
    body = {
        "attended": True,
        "ratings": dict(GOOD_RATINGS),
        "recommendation": "hire",
        "summary": "Strong on system design and clear when explaining trade-offs.",
    }
    body.update(overrides)
    return body


def link_body(**overrides) -> dict:
    body = {
        "interviewer_name": "Dev Patel",
        "interviewer_role": "engineer",
        "ratings": {"technical": 3, "communication": 4, "problem_solving": 2, "cultural_fit": 5, "confidence": 4},
        "recommendation": "hold",
        "summary": "Decent depth on the core stack but shaky on failure handling.",
        "questions": [],
    }
    body.update(overrides)
    return body


async def post_review(client, headers, cid, **overrides):
    return await client.post(f"/api/v1/candidates/{cid}/external-review", json=hr_body(**overrides), headers=headers)


async def mint(client, headers, cid, **body):
    return await client.post(f"/api/v1/candidates/{cid}/interviewer-links", json=body, headers=headers)


async def put_link(client, token, **overrides):
    return await client.put(f"/api/v1/interviewer-scorecard/{token}", json=link_body(**overrides))


async def fetch(seed, cid) -> dict:
    return await seed.db.candidates.find_one({"candidate_id": cid})


def expected_final(ratings_list: list[dict]) -> int:
    total = 0.0
    for area, weight in settings.SCORE_DIMENSION_WEIGHTS.items():
        mean = sum(r[area] for r in ratings_list) / len(ratings_list)
        total += round(mean * 20) * weight
    return round(total)


def pdf_text(data: bytes) -> str:
    import pdfplumber

    with pdfplumber.open(io.BytesIO(data)) as pdf:
        return "\n".join((page.extract_text() or "") for page in pdf.pages)


async def test_guide_is_generated_stored_and_shaped(client, admin_headers, seed, llm, cost_calls):
    cand = await seed.candidate()
    resp = await client.post(f"/api/v1/candidates/{cand.id}/interview-guide", json={}, headers=admin_headers)
    assert resp.status_code == 200, resp.text
    guide = resp.json()

    assert set(guide) == {"questions", "generated_at", "generated_by", "model", "fallback"}
    assert guide["fallback"] is False
    assert guide["model"] == settings.DEFAULT_LLM_MODEL
    assert guide["generated_by"] == HR_EMAIL
    assert [q["id"] for q in guide["questions"]] == [f"q{i}" for i in range(1, 11)]
    for q in guide["questions"]:
        assert set(q) == {"id", "text", "dimension", "listen_for", "source"}
        assert q["source"] == "ai"
        assert q["dimension"] in AREAS and q["text"] and q["listen_for"]
    assert {q["dimension"] for q in guide["questions"]} >= set(AREAS[:4])

    assert (await fetch(seed, cand.id))["interview_guide"] == guide
    assert cost_calls == [("interview_guide", cand.id)]
    call = llm.calls[0]
    assert call["json_mode"] is True and call["model"] == settings.DEFAULT_LLM_MODEL


async def test_guide_prompt_carries_the_cv_and_the_job(client, admin_headers, seed, llm):
    cand = await seed.candidate()
    resp = await client.post(f"/api/v1/candidates/{cand.id}/interview-guide", json={}, headers=admin_headers)
    assert resp.status_code == 200
    prompt = llm.calls[0]["prompt"]

    assert RESUME_MARKER in prompt
    assert JD_MARKER in prompt
    assert SKILL_MARKER in prompt and TOPIC_MARKER in prompt
    assert "Platform Engineer" in prompt
    assert "senior" in prompt
    assert RESUME_TAIL not in prompt
    assert "exactly 10" in prompt
    assert PHONE not in prompt
    assert EM_DASH not in prompt and EM_DASH not in llm.calls[0]["system"]


@pytest.mark.parametrize("reply", [
    "this is not json",
    "{}",
    "[]",
    "",
    '{"questions": "oops"}',
    '{"questions": [{"text": "hi"}, 7, null, {"text": "A real looking question here?", "dimension": "astrology"}]}',
])
async def test_guide_falls_back_when_the_reply_is_unusable(client, admin_headers, seed, llm, reply):
    llm.guide = reply
    cand = await seed.candidate()
    resp = await client.post(f"/api/v1/candidates/{cand.id}/interview-guide", json={}, headers=admin_headers)
    assert resp.status_code == 200, resp.text
    guide = resp.json()
    assert guide["fallback"] is True and guide["model"] is None
    assert len(guide["questions"]) == 10
    assert {q["dimension"] for q in guide["questions"]} >= set(AREAS[:4])
    assert all(q["text"] and q["listen_for"] for q in guide["questions"])
    assert EM_DASH not in json.dumps(guide)


async def test_guide_falls_back_when_the_model_call_raises(client, admin_headers, seed, llm):
    llm.error = RuntimeError("provider down")
    cand = await seed.candidate()
    resp = await client.post(f"/api/v1/candidates/{cand.id}/interview-guide", json={}, headers=admin_headers)
    assert resp.status_code == 200 and resp.json()["fallback"] is True


async def test_guide_drops_bad_items_normalises_the_rest_and_covers_every_required_area(client, admin_headers, seed, llm):
    good = [
        {"text": f"Technical question number {i} about the Orion pipeline?", "dimension": "Technical", "listen_for": "Specifics."}
        for i in range(12)
    ]
    llm.guide = json.dumps({"questions": good + [
        {"text": "Technical question number 0 about the Orion pipeline?", "dimension": "technical"},
        {"text": "How do you handle a clash with a colleague?", "dimension": "problem solving"},
        {"text": "x", "dimension": "technical"},
        "just a string",
        {"text": "A question with an unknown area, long enough", "dimension": "astrology"},
    ]})
    cand = await seed.candidate()
    guide = (await client.post(f"/api/v1/candidates/{cand.id}/interview-guide", json={}, headers=admin_headers)).json()

    questions = guide["questions"]
    assert guide["fallback"] is False
    assert len(questions) == 10
    texts = [q["text"] for q in questions]
    assert len(set(t.lower() for t in texts)) == 10
    assert all(q["dimension"] in AREAS for q in questions)
    dims = {q["dimension"] for q in questions}
    assert dims >= set(AREAS[:4])
    ps = next(q for q in questions if q["text"].startswith("How do you handle a clash"))
    assert ps["dimension"] == "problem_solving" and ps["listen_for"]


async def test_guide_count_follows_the_setting_and_is_clamped(client, admin_headers, seed, llm, monkeypatch):
    cand = await seed.candidate()
    llm.guide = guide_reply(20)
    monkeypatch.setattr(settings, "INTERVIEW_GUIDE_QUESTION_COUNT", 6)
    guide = (await client.post(f"/api/v1/candidates/{cand.id}/interview-guide", json={}, headers=admin_headers)).json()
    assert len(guide["questions"]) == 6 and "exactly 6" in llm.calls[-1]["prompt"]

    assert guide_service.question_count() == 6
    monkeypatch.setattr(settings, "INTERVIEW_GUIDE_QUESTION_COUNT", 1)
    assert guide_service.question_count() == 4
    monkeypatch.setattr(settings, "INTERVIEW_GUIDE_QUESTION_COUNT", 500)
    assert guide_service.question_count() == 25
    assert type(settings).model_fields["INTERVIEW_GUIDE_QUESTION_COUNT"].default == 10


async def test_guide_reads_null_until_generated_then_returns_it(client, admin_headers, seed, llm):
    cand = await seed.candidate()
    first = await client.get(f"/api/v1/candidates/{cand.id}/interview-guide", headers=admin_headers)
    assert first.status_code == 200 and first.json() is None
    made = await client.post(f"/api/v1/candidates/{cand.id}/interview-guide", json={}, headers=admin_headers)
    again = await client.get(f"/api/v1/candidates/{cand.id}/interview-guide", headers=admin_headers)
    assert again.status_code == 200 and again.json() == made.json()


async def test_an_existing_guide_is_returned_unchanged_without_regenerate(client, admin_headers, seed, llm):
    cand = await seed.candidate()
    first = (await client.post(f"/api/v1/candidates/{cand.id}/interview-guide", json={}, headers=admin_headers)).json()
    second = await client.post(f"/api/v1/candidates/{cand.id}/interview-guide", json={"regenerate": False}, headers=admin_headers)
    assert second.status_code == 200 and second.json() == first
    third = await client.post(f"/api/v1/candidates/{cand.id}/interview-guide", headers=admin_headers)
    assert third.status_code == 200 and third.json() == first
    assert len(llm.calls) == 1


async def test_regenerate_replaces_the_guide_until_a_scorecard_exists(client, admin_headers, seed, llm):
    cand = await seed.candidate()
    first = (await client.post(f"/api/v1/candidates/{cand.id}/interview-guide", json={}, headers=admin_headers)).json()
    llm.guide = guide_reply(8, marker="Zephyr")
    again = await client.post(f"/api/v1/candidates/{cand.id}/interview-guide", json={"regenerate": True}, headers=admin_headers)
    assert again.status_code == 200
    assert len(again.json()["questions"]) == 8 and "Zephyr" in again.json()["questions"][0]["text"]
    assert again.json()["generated_at"] != first["generated_at"]

    filed = await post_review(client, admin_headers, cand.id)
    assert filed.status_code == 200, filed.text
    blocked = await client.post(f"/api/v1/candidates/{cand.id}/interview-guide", json={"regenerate": True}, headers=admin_headers)
    assert blocked.status_code == 409 and "cannot be regenerated" in blocked.json()["detail"]
    assert len(llm.calls) == 2
    same = await client.post(f"/api/v1/candidates/{cand.id}/interview-guide", json={}, headers=admin_headers)
    assert same.status_code == 200 and same.json()["generated_at"] == again.json()["generated_at"]


async def test_guide_is_for_external_interviews_and_admins_only(client, admin_headers, standard_headers, seed, llm):
    platform = await seed.candidate(mode="platform")
    r = await client.post(f"/api/v1/candidates/{platform.id}/interview-guide", json={}, headers=admin_headers)
    assert r.status_code == 409 and "another platform" in r.json()["detail"]
    assert llm.calls == []

    cand = await seed.candidate()
    for call in (
        client.post(f"/api/v1/candidates/{cand.id}/interview-guide", json={}, headers=standard_headers),
        client.get(f"/api/v1/candidates/{cand.id}/interview-guide", headers=standard_headers),
    ):
        assert (await call).status_code == 403
    missing = await client.post("/api/v1/candidates/nope/interview-guide", json={}, headers=admin_headers)
    assert missing.status_code == 404
    assert (await client.get("/api/v1/candidates/nope/interview-guide", headers=admin_headers)).status_code == 404


async def test_guide_text_never_carries_an_em_dash(client, admin_headers, seed, llm):
    llm.guide = guide_reply(10).replace("what drove", f"what {EM_DASH} exactly {EM_DASH} drove")
    cand = await seed.candidate()
    guide = (await client.post(f"/api/v1/candidates/{cand.id}/interview-guide", json={}, headers=admin_headers)).json()
    assert EM_DASH not in json.dumps(guide)


async def test_hr_scorecard_copies_question_text_and_area_from_the_guide(client, admin_headers, seed):
    cand = await seed.candidate(guide=6)
    resp = await post_review(
        client, admin_headers, cand.id,
        questions=[
            {"question_id": "q1", "rating": 5, "notes": "Named the exact failure mode.", "text": "FORGED", "dimension": "confidence"},
            {"question_id": "q2", "rating": None, "notes": ""},
        ],
    )
    assert resp.status_code == 200, resp.text
    card = (await fetch(seed, cand.id))["interview_scorecards"][0]
    q1, q2 = card["questions"]
    assert q1 == {
        "question_id": "q1", "text": "Guide question 1 about the Orion migration?",
        "dimension": "technical", "rating": 5, "notes": "Named the exact failure mode.",
    }
    assert q2["rating"] is None and q2["notes"] == "" and q2["dimension"] == "communication"


async def test_hr_scorecard_document_has_the_documented_shape(client, admin_headers, seed):
    cand = await seed.candidate(guide=3)
    resp = await post_review(client, admin_headers, cand.id, strengths="Clear thinker", concerns=None, interviewer_role="hiring_manager")
    assert resp.status_code == 200
    card = (await fetch(seed, cand.id))["interview_scorecards"][0]
    assert set(card) == {
        "scorecard_id", "source", "submitted_by", "interviewer_name", "interviewer_role", "submitted_at",
        "updated_at", "questions", "ratings", "recommendation", "summary", "strengths", "concerns",
    }
    assert card["source"] == "hr" and card["submitted_by"] == HR_EMAIL
    assert card["interviewer_name"] == "Demo Admin"
    assert card["interviewer_role"] == "hiring_manager"
    assert card["ratings"] == GOOD_RATINGS and card["recommendation"] == "hire"
    assert card["strengths"] == "Clear thinker" and card["concerns"] is None
    assert card["submitted_at"] == card["updated_at"]


async def test_hr_scorecard_defaults_role_to_hr_and_accepts_a_typed_name(client, admin_headers, seed):
    cand = await seed.candidate()
    resp = await post_review(client, admin_headers, cand.id, interviewer_name="  Priya Nair  ")
    assert resp.status_code == 200
    card = (await fetch(seed, cand.id))["interview_scorecards"][0]
    assert card["interviewer_name"] == "Priya Nair" and card["interviewer_role"] == "hr"


@pytest.mark.parametrize("overrides", [
    {"ratings": None},
    {"ratings": {}},
    {"ratings": {k: v for k, v in GOOD_RATINGS.items() if k != "confidence"}},
    {"ratings": {k: v for k, v in GOOD_RATINGS.items() if k != "technical"}},
    {"ratings": {**GOOD_RATINGS, "technical": 0}},
    {"ratings": {**GOOD_RATINGS, "technical": 6}},
    {"ratings": {**GOOD_RATINGS, "confidence": 3.5}},
    {"ratings": {**GOOD_RATINGS, "confidence": "4"}},
    {"ratings": {**GOOD_RATINGS, "cultural_fit": True}},
    {"recommendation": None},
    {"recommendation": "maybe"},
    {"summary": None},
    {"summary": "too short"},
    {"summary": "x" * 4001},
    {"strengths": "s" * 2001},
    {"concerns": "c" * 2001},
    {"interviewer_role": "wizard"},
])
async def test_attended_scorecard_needs_everything_and_says_why_in_plain_text(client, admin_headers, seed, overrides):
    cand = await seed.candidate()
    resp = await post_review(client, admin_headers, cand.id, **overrides)
    assert resp.status_code == 422, overrides
    detail = resp.json()["detail"]
    assert isinstance(detail, str) and detail and EM_DASH not in detail
    after = await fetch(seed, cand.id)
    assert not after.get("interview_scorecards") and not after.get("external_review") and not after.get("report")
    assert after["pipeline_stage"] == "interviewing"


@pytest.mark.parametrize("questions,fragment", [
    ([{"question_id": "q99", "rating": 3}], "Unknown question"),
    ([{"question_id": "q1", "rating": 3}, {"question_id": "q1", "rating": 4}], "twice"),
    ([{"question_id": "q1", "rating": 0}], "1 to 5"),
    ([{"question_id": "q1", "rating": 6}], "1 to 5"),
    ([{"question_id": "q1", "rating": "high"}], "1 to 5"),
    ([{"question_id": "q1", "rating": True}], "1 to 5"),
    ([{"question_id": "q1", "rating": 3, "notes": "n" * 2001}], "at most 2000"),
])
async def test_bad_question_marks_are_422_with_a_plain_message(client, admin_headers, seed, questions, fragment):
    cand = await seed.candidate(guide=3)
    resp = await post_review(client, admin_headers, cand.id, questions=questions)
    assert resp.status_code == 422, resp.text
    assert fragment in resp.json()["detail"]
    assert not (await fetch(seed, cand.id)).get("interview_scorecards")


async def test_question_marks_without_a_guide_are_rejected(client, admin_headers, seed):
    cand = await seed.candidate()
    resp = await post_review(client, admin_headers, cand.id, questions=[{"question_id": "q1", "rating": 3}])
    assert resp.status_code == 422 and "Unknown question" in resp.json()["detail"]
    assert (await post_review(client, admin_headers, cand.id)).status_code == 200


async def test_the_old_culture_fit_key_is_an_alias_for_cultural_fit(client, admin_headers, seed):
    cand = await seed.candidate()
    legacy = {k: v for k, v in GOOD_RATINGS.items() if k != "cultural_fit"} | {"culture_fit": 2}
    resp = await post_review(client, admin_headers, cand.id, ratings=legacy)
    assert resp.status_code == 200, resp.text
    stored = await fetch(seed, cand.id)
    assert stored["interview_scorecards"][0]["ratings"]["cultural_fit"] == 2
    assert "culture_fit" not in stored["interview_scorecards"][0]["ratings"]
    assert stored["report"]["cultural_fit_score"] == 40
    both = await post_review(client, admin_headers, cand.id, ratings={**GOOD_RATINGS, "culture_fit": 1})
    assert both.status_code == 200
    assert (await fetch(seed, cand.id))["interview_scorecards"][0]["ratings"]["cultural_fit"] == 3


async def test_a_resubmission_by_the_same_hr_user_replaces_the_scorecard(client, admin_headers, seed):
    cand = await seed.candidate(guide=2)
    first = await post_review(client, admin_headers, cand.id, recommendation="hold")
    assert first.status_code == 200
    before = (await fetch(seed, cand.id))["interview_scorecards"][0]
    second = await post_review(
        client, admin_headers, cand.id, recommendation="strong_hire",
        ratings={k: 5 for k in AREAS}, questions=[{"question_id": "q2", "rating": 5, "notes": "Excellent."}],
    )
    assert second.status_code == 200 and second.json()["overall"] == 5.0
    stored = await fetch(seed, cand.id)
    cards = stored["interview_scorecards"]
    assert len(cards) == 1
    assert cards[0]["scorecard_id"] == before["scorecard_id"] and cards[0]["submitted_at"] == before["submitted_at"]
    assert cards[0]["updated_at"] > before["updated_at"] and cards[0]["recommendation"] == "strong_hire"
    assert stored["external_review"]["edited"] is True and stored["external_review"]["first_reviewed_at"] == before["submitted_at"]
    assert stored["report"]["recommendation"] == "hire" and stored["report"]["final_score"] == 100


async def test_a_second_hr_user_adds_a_scorecard_and_the_first_keeps_the_verdict(client, admin_headers, superadmin_headers, seed):
    cand = await seed.candidate()
    assert (await post_review(client, admin_headers, cand.id, recommendation="hire")).status_code == 200
    second = await post_review(
        client, superadmin_headers, cand.id, recommendation="no_hire",
        ratings={k: 1 for k in AREAS}, summary="Disagree with the first interviewer on depth.",
    )
    assert second.status_code == 200, second.text
    stored = await fetch(seed, cand.id)
    assert len(stored["interview_scorecards"]) == 2
    assert {c["submitted_by"] for c in stored["interview_scorecards"]} == {HR_EMAIL, "demo-superadmin@hirely.ai"}
    review = stored["external_review"]
    assert review["panel_size"] == 2 and review["reviewed_by"] == HR_EMAIL
    assert review["recommendation"] == "hire"
    assert stored["report"]["interviewers"][0]["recommendation"] == "hire"
    assert stored["report"]["technical_score"] == round((5 + 1) / 2 * 20)


async def test_the_scorecard_stays_closed_once_the_candidate_is_hired_or_rejected(client, admin_headers, seed):
    cand = await seed.candidate()
    assert (await post_review(client, admin_headers, cand.id)).status_code == 200
    assert (await client.post(f"/api/v1/candidates/{cand.id}/decision", json={"decision": "hire"}, headers=admin_headers)).status_code == 200
    closed = await post_review(client, admin_headers, cand.id, recommendation="no_hire")
    assert closed.status_code == 409
    assert (await fetch(seed, cand.id))["interview_scorecards"][0]["recommendation"] == "hire"


async def test_the_no_show_path_ignores_scorecard_fields_and_unlocks_nothing(client, admin_headers, seed):
    cand = await seed.candidate()
    resp = await client.post(
        f"/api/v1/candidates/{cand.id}/external-review", headers=admin_headers,
        json={"attended": False, "note": "Did not join"},
    )
    assert resp.status_code == 200 and resp.json() == {"stage": "interviewing", "external_status": "no_show"}
    stored = await fetch(seed, cand.id)
    assert not stored.get("interview_scorecards") and not stored.get("report") and not stored.get("external_review")
    assert ext.needs_review(stored) is True


async def test_interviewer_notes_are_never_written_to_the_transcript(client, admin_headers, seed):
    cand = await seed.candidate(guide=2)
    await post_review(client, admin_headers, cand.id, questions=[{"question_id": "q1", "rating": 4, "notes": "NOTE-MARKER"}])
    stored = await fetch(seed, cand.id)
    assert stored["transcript"] == []
    assert "NOTE-MARKER" not in json.dumps(stored["transcript"])


async def _ai_report(monkeypatch) -> dict:
    import services.hr_module.interview_engine as engine

    async def fake_ask(**kwargs):
        return json.dumps({
            "overall_score": 80, "technical_score": 80, "technical_rationale": "t",
            "communication_score": 70, "communication_rationale": "c",
            "problem_solving_score": 75, "problem_solving_rationale": "p",
            "cultural_fit_score": 85, "cultural_fit_rationale": "f",
            "confidence_score": 65, "confidence_rationale": "k",
            "strengths": ["a"], "areas_for_improvement": ["b"], "recommendation": "hire",
            "summary": "Good.", "integrity_assessment": "No flags.",
        })

    monkeypatch.setattr(engine, "ask_llm", fake_ask)
    _, report = await engine.evaluate_interview(
        [{"question": "Why this role?", "answer": "Because I enjoy platform work and have done it for years."}],
        {"title": "Platform Engineer"}, {"candidate_id": "x"}, [],
    )
    return report


async def test_the_report_has_every_key_of_an_ai_report_with_matching_types(client, admin_headers, seed, monkeypatch):
    cand = await seed.candidate(guide=4)
    resp = await post_review(
        client, admin_headers, cand.id, strengths="Clear thinker\nOwns outcomes", concerns="Light on analytics",
        questions=[{"question_id": "q1", "rating": 4, "notes": "Good."}],
    )
    assert resp.status_code == 200, resp.text
    stored = await fetch(seed, cand.id)
    report = stored["report"]

    ai = await _ai_report(monkeypatch)
    missing = set(ai) - set(report) - {"integrity_score"}
    assert not missing, f"keys an AI report has and this one lacks: {missing}"
    for key, value in ai.items():
        if key in report and key != "evaluation_status":
            if isinstance(value, (int, float)):
                assert isinstance(report[key], (int, float)), key
            else:
                assert isinstance(report[key], type(value)), key
    assert set(ai["score_breakdown"]) == set(report["score_breakdown"])

    assert "integrity_score" not in report
    assert report["source"] == "interviewer_scorecard" and report["evaluation_status"] == "interviewer_scorecard"
    assert report["interview_platform"] == "Google Meet"
    assert "another platform" in report["integrity_assessment"] and "Google Meet" in report["integrity_assessment"]
    assert EM_DASH not in json.dumps(report)

    breakdown = report["score_breakdown"]
    assert [d["name"] for d in breakdown["dimensions"]] == list(settings.SCORE_DIMENSION_WEIGHTS)
    assert all(set(d) == {"name", "score", "weight", "rationale"} for d in breakdown["dimensions"])
    assert breakdown["integrity_deductions"] == [] and breakdown["integrity_multiplier"] == 1.0
    assert breakdown["final_score"] == report["final_score"] == report["overall_score"]

    assert report["interviewers"] == [
        {"name": "Demo Admin", "role": "hr", "source": "hr", "recommendation": "hire", "overall": 4.0},
    ]
    assert report["questions"] == [{
        "question_id": "q1", "text": "Guide question 1 about the Orion migration?", "dimension": "technical",
        "entries": [{"by": "Demo Admin", "role": "hr", "rating": 4, "notes": "Good."}],
    }]

    assert stored["report_status"] == "ready" and stored["report_error"] is None
    assert stored["eval_score"] == report["overall_score"] and stored["final_score"] == report["final_score"]
    assert stored["score_breakdown"] == report["score_breakdown"]
    assert stored["interview_ended_at"] == stored["external_review"]["interviewed_at"]
    assert stored["interview_ended_at"] == stored["external_interview"]["scheduled_start_at"]


async def test_final_score_follows_the_spec_arithmetic(client, admin_headers, seed):
    cand = await seed.candidate()
    resp = await post_review(client, admin_headers, cand.id)
    assert resp.json() == {
        "stage": "completed", "external_status": "reviewed", "overall": 4.0,
        "final_score": GOOD_FINAL, "report_ready": True,
    }
    report = (await fetch(seed, cand.id))["report"]
    assert expected_final([GOOD_RATINGS]) == GOOD_FINAL == report["final_score"] == report["overall_score"]
    assert [report[f"{a}_score"] for a in AREAS] == [100, 80, 80, 60, 80]
    for dim in report["score_breakdown"]["dimensions"]:
        assert dim["score"] == report[f"{dim['name']}_score"] and dim["weight"] == settings.SCORE_DIMENSION_WEIGHTS[dim["name"]]

    odd = {"technical": 3, "communication": 2, "problem_solving": 5, "cultural_fit": 1, "confidence": 4}
    await post_review(client, admin_headers, cand.id, ratings=odd)
    after = (await fetch(seed, cand.id))
    assert after["report"]["final_score"] == expected_final([odd]) == after["final_score"] == after["eval_score"]


@pytest.mark.parametrize("given,mapped", [
    ("strong_hire", "hire"), ("hire", "hire"), ("hold", "maybe"), ("no_hire", "reject"),
])
async def test_recommendation_is_mapped_to_the_ai_vocabulary(client, admin_headers, seed, given, mapped):
    cand = await seed.candidate()
    assert (await post_review(client, admin_headers, cand.id, recommendation=given)).status_code == 200
    report = (await fetch(seed, cand.id))["report"]
    assert report["recommendation"] == mapped and report["interviewer_recommendation"] == given
    assert (await fetch(seed, cand.id))["external_review"]["recommendation"] == given


async def test_rationale_is_composed_only_from_the_interviewers_own_notes(client, admin_headers, seed):
    cand = await seed.candidate(guide=5)
    await post_review(
        client, admin_headers, cand.id, interviewer_name="Priya Nair",
        questions=[
            {"question_id": "q1", "rating": 4, "notes": "Explained the index choice well.\nSecond line."},
            {"question_id": "q3", "rating": None, "notes": ""},
        ],
    )
    report = (await fetch(seed, cand.id))["report"]
    technical = report["technical_rationale"]
    assert "Technical was rated 5 out of 5 by Priya Nair (HR)." in technical
    assert 'Priya Nair (HR) on "Guide question 1 about the Orion migration?": 4 out of 5.' in technical
    assert "Explained the index choice well. Second line." in technical
    assert report["problem_solving_rationale"] == "Problem solving was rated 4 out of 5 by Priya Nair (HR)."
    assert report["confidence_rationale"].startswith("Confidence was rated 4 out of 5")
    assert "Guide question 3" not in report["problem_solving_rationale"]


async def test_strengths_and_concerns_become_lists_split_on_newlines(client, admin_headers, seed):
    cand = await seed.candidate()
    await post_review(
        client, admin_headers, cand.id,
        strengths="- Clear thinker\n\n* Owns outcomes\nClear thinker\n  Mentors others  ",
        concerns="Light on analytics",
    )
    report = (await fetch(seed, cand.id))["report"]
    assert report["strengths"] == ["Clear thinker", "Owns outcomes", "Mentors others"]
    assert report["areas_for_improvement"] == ["Light on analytics"]
    await post_review(client, admin_headers, cand.id, strengths=None, concerns="")
    report = (await fetch(seed, cand.id))["report"]
    assert report["strengths"] == [] and report["areas_for_improvement"] == []


async def test_view_report_endpoint_returns_the_scorecard_report(client, admin_headers, standard_headers, seed):
    cand = await seed.candidate()
    await post_review(client, admin_headers, cand.id)
    resp = await client.get(f"/api/v1/interview/report/{cand.token}", headers=admin_headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    stored = (await fetch(seed, cand.id))["report"]
    assert body["report"] == stored
    assert body["report_status"] == "ready" and body["final_score"] == GOOD_FINAL and body["eval_score"] == GOOD_FINAL
    assert body["report"]["source"] == "interviewer_scorecard"
    assert body["transcript"] == []
    assert (await client.get(f"/api/v1/interview/report/{cand.token}", headers=standard_headers)).status_code == 403


async def test_pdf_for_a_scorecard_report_has_no_integrity_row_and_lists_interviewers_and_questions(client, admin_headers, seed):
    cand = await seed.candidate(guide=4)
    await post_review(
        client, admin_headers, cand.id, interviewer_name="Priya Nair & Co <HR>",
        questions=[{"question_id": "q1", "rating": 4, "notes": "Fine <b>bold</b> & careful."}],
    )
    await mint_and_file(client, admin_headers, cand.id, questions=[
        {"question_id": "q1", "rating": 2, "notes": "Struggled with the failure case."},
    ])
    resp = await client.get(f"/api/v1/interview/report/{cand.token}/pdf", headers=admin_headers)
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"] == "application/pdf" and resp.content.startswith(b"%PDF")

    text = " ".join(pdf_text(resp.content).split())
    assert "Interview Report: Sam Rivera" in text
    assert "Integrity " not in text.replace("Integrity Assessment", "")
    assert "/100" in text and "N/A" not in text and "Not applicable" not in text
    assert "Interviewers" in text and "Priya Nair & Co <HR> (HR)" in text and "Dev Patel (Engineer)" in text
    assert "Questions" in text and "Guide question 1" in text
    assert "Fine <b>bold</b> & careful." in text
    assert "Struggled with the failure case." in text
    assert "Interviewer recommendation: Hire" in text
    assert "held on another platform" in text


async def mint_and_file(client, headers, cid, **overrides):
    resp = await mint(client, headers, cid, interviewer_name="Dev Patel")
    assert resp.status_code == 200, resp.text
    saved = await put_link(client, resp.json()["token"], **overrides)
    assert saved.status_code == 200, saved.text
    return resp.json()


async def test_pdf_prints_not_applicable_for_a_score_a_report_does_not_have(client, admin_headers, seed):
    cand = await seed.candidate(mode="platform", stage="completed", report={
        "overall_score": 70, "technical_score": 71, "recommendation": "maybe", "summary": "Thin evidence.",
        "integrity_assessment": "No integrity flags to report.", "strengths": [], "areas_for_improvement": [],
    })
    resp = await client.get(f"/api/v1/interview/report/{cand.token}/pdf", headers=admin_headers)
    assert resp.status_code == 200
    text = pdf_text(resp.content)
    assert "N/A/100" not in text and "N/A" not in text
    assert text.count("Not applicable") >= 5
    assert "71/100" in text and "70/100" in text


async def test_pdf_is_admin_only(client, standard_headers, admin_headers, seed):
    cand = await seed.candidate()
    await post_review(client, admin_headers, cand.id)
    assert (await client.get(f"/api/v1/interview/report/{cand.token}/pdf", headers=standard_headers)).status_code == 403
    assert (await client.get(f"/api/v1/interview/report/{cand.token}/pdf")).status_code in (401, 403)


async def test_share_link_view_is_built_from_the_scorecard_report(client, admin_headers, seed):
    from services.hr_module.report_share_service import build_shared_report_view

    cand = await seed.candidate(guide=3)
    await post_review(client, admin_headers, cand.id, questions=[{"question_id": "q1", "rating": 5, "notes": "Great."}])
    stored = await fetch(seed, cand.id)

    view = await build_shared_report_view(seed.db, stored)
    assert view["candidate_name"] == CANDIDATE_NAME and view["job_title"] == "Platform Engineer"
    assert view["overall_score"] == view["final_score"] == GOOD_FINAL
    assert view["recommendation"] == "hire" and view["evaluation_status"] == "interviewer_scorecard"
    assert view["interview_date"] == stored["interview_ended_at"]
    assert [d["key"] for d in view["dimensions"]] == list(settings.SCORE_DIMENSION_WEIGHTS)
    assert all(d["rationale"] for d in view["dimensions"])
    assert view["integrity"] == {"score": None, "assessment": "", "multiplier": None, "events": []}

    minted = await client.post(f"/api/v1/interview/report/{cand.token}/share", json={}, headers=admin_headers)
    assert minted.status_code == 200, minted.text
    shared = await client.get(f"/api/v1/interview/shared-report/{minted.json()['token']}")
    assert shared.status_code == 200
    dumped = json.dumps(shared.json())
    assert shared.json()["overall_score"] == GOOD_FINAL
    for secret in (stored["email"], PHONE, RESUME_MARKER):
        assert secret not in dumped


async def test_a_link_scorecard_alone_unlocks_nothing(client, admin_headers, seed):
    cand = await seed.candidate(guide=3)
    minted = (await mint(client, admin_headers, cand.id)).json()
    saved = await put_link(client, minted["token"], questions=[{"question_id": "q1", "rating": 3, "notes": "ok"}])
    assert saved.status_code == 200, saved.text

    stored = await fetch(seed, cand.id)
    assert len(stored["interview_scorecards"]) == 1 and stored["interview_scorecards"][0]["source"] == "link"
    assert not stored.get("external_review") and not stored.get("report") and stored.get("report_status") is None
    assert ext.needs_review(stored) is True and ext.external_status(stored) != "reviewed"
    assert stored["pipeline_stage"] == "interviewing"

    for decision in ("hire", "hold"):
        r = await client.post(f"/api/v1/candidates/{cand.id}/decision", json={"decision": decision}, headers=admin_headers)
        assert r.status_code == 409 and r.json()["detail"] == ext.REVIEW_REQUIRED_MESSAGE
    offer = await client.post(
        "/api/v1/offers", headers=admin_headers,
        json={"candidate_id": cand.id, "salary": "90000", "benefits": None, "joining_date": None},
    )
    assert offer.status_code == 409
    view = (await client.get(f"/api/v1/candidates/{cand.id}/external-review", headers=admin_headers)).json()
    assert view["external_review"] is None and view["scorecards"][0]["questions"][0]["notes"] == "ok"
    assert (await client.get(f"/api/v1/interview/report/{cand.token}/pdf", headers=admin_headers)).status_code == 404


async def test_the_hr_scorecard_unlocks_hire_and_offer_even_after_a_link_one(client, admin_headers, seed):
    cand = await seed.candidate()
    minted = (await mint(client, admin_headers, cand.id)).json()
    assert (await put_link(client, minted["token"])).status_code == 200
    assert (await post_review(client, admin_headers, cand.id)).status_code == 200
    stored = await fetch(seed, cand.id)
    assert ext.needs_review(stored) is False and stored["pipeline_stage"] == "completed"
    hired = await client.post(f"/api/v1/candidates/{cand.id}/decision", json={"decision": "hire"}, headers=admin_headers)
    assert hired.status_code == 200 and hired.json()["stage"] == "hired"


async def test_a_four_rating_review_filed_before_this_change_still_unlocks_the_gate(client, admin_headers, seed):
    legacy = {
        "ratings": {"communication": 4, "technical": 5, "problem_solving": 4, "culture_fit": 3}, "overall": 4.0,
        "recommendation": "hire", "summary": "A review filed before scorecards existed.",
        "strengths": None, "concerns": None, "reviewed_by": "old@example.com",
        "reviewed_at": datetime.now(timezone.utc).isoformat(),
    }
    cand = await seed.candidate(stage="completed", external_review=legacy)
    stored = await fetch(seed, cand.id)
    assert ext.needs_review(stored) is False
    view = await client.get(f"/api/v1/candidates/{cand.id}/external-review", headers=admin_headers)
    assert view.status_code == 200
    assert view.json()["external_review"] == {**legacy} and view.json()["scorecards"] == []
    hired = await client.post(f"/api/v1/candidates/{cand.id}/decision", json={"decision": "hire"}, headers=admin_headers)
    assert hired.status_code == 200
    assert (await fetch(seed, cand.id))["external_review"]["ratings"].get("culture_fit") == 3


async def test_the_review_and_report_aggregate_every_scorecard(client, admin_headers, seed):
    cand = await seed.candidate(guide=4)
    link_ratings = {"technical": 3, "communication": 4, "problem_solving": 2, "cultural_fit": 5, "confidence": 4}
    minted = (await mint(client, admin_headers, cand.id, interviewer_name="Dev Patel")).json()
    assert (await put_link(
        client, minted["token"], ratings=link_ratings, recommendation="hold", strengths="Calm under pressure",
        concerns="Weak on failure handling",
        questions=[{"question_id": "q1", "rating": 3, "notes": "Okay on indexes."}],
    )).status_code == 200
    resp = await post_review(
        client, admin_headers, cand.id, strengths="Clear thinker", concerns="Light on analytics",
        questions=[{"question_id": "q1", "rating": 5, "notes": "Named the failure mode."}],
    )
    assert resp.status_code == 200, resp.text

    stored = await fetch(seed, cand.id)
    review, report = stored["external_review"], stored["report"]
    means = {a: round((GOOD_RATINGS[a] + link_ratings[a]) / 2, 1) for a in AREAS}
    assert review["ratings"] == means
    assert review["overall"] == round(sum(means.values()) / 5, 1)
    assert review["panel_size"] == 2 and review["reviewed_by"] == HR_EMAIL
    assert review["recommendation"] == "hire" and review["summary"] == hr_body()["summary"]
    assert review["strengths"] == "Clear thinker" and review["concerns"] == "Light on analytics"
    assert resp.json()["overall"] == review["overall"] == 3.8

    both = [GOOD_RATINGS, link_ratings]
    assert report["final_score"] == resp.json()["final_score"] == expected_final(both)
    for area in AREAS:
        assert report[f"{area}_score"] == round((GOOD_RATINGS[area] + link_ratings[area]) / 2 * 20)
    assert "averaged" in report["technical_rationale"] and "2 interviewers" in report["technical_rationale"]
    assert "Demo Admin (HR)" in report["technical_rationale"] and "Dev Patel (Engineer)" in report["technical_rationale"]
    assert "Named the failure mode." in report["technical_rationale"] and "Okay on indexes." in report["technical_rationale"]
    assert report["strengths"] == ["Clear thinker", "Calm under pressure"]
    assert report["areas_for_improvement"] == ["Light on analytics", "Weak on failure handling"]
    assert report["recommendation"] == "hire" and report["summary"] == hr_body()["summary"]
    assert [i["name"] for i in report["interviewers"]] == ["Demo Admin", "Dev Patel"]
    assert [i["source"] for i in report["interviewers"]] == ["hr", "link"]
    assert report["interviewers"][1] == {
        "name": "Dev Patel", "role": "engineer", "source": "link", "recommendation": "hold", "overall": 3.6,
    }
    q1 = report["questions"][0]
    assert q1["question_id"] == "q1"
    assert [(e["by"], e["rating"]) for e in q1["entries"]] == [("Demo Admin", 5), ("Dev Patel", 3)]


async def test_a_late_link_scorecard_rebuilds_the_report_and_an_edit_does_not_duplicate_it(client, admin_headers, seed):
    cand = await seed.candidate()
    assert (await post_review(client, admin_headers, cand.id)).status_code == 200
    before = (await fetch(seed, cand.id))
    assert before["report"]["final_score"] == GOOD_FINAL and before["external_review"]["panel_size"] == 1
    reviewed_at = before["external_review"]["reviewed_at"]

    minted = (await mint(client, admin_headers, cand.id)).json()
    low = {k: 1 for k in AREAS}
    late = await put_link(client, minted["token"], ratings=low, recommendation="no_hire")
    assert late.status_code == 200 and late.json()["saved"] is True
    after = await fetch(seed, cand.id)
    assert after["external_review"]["panel_size"] == 2 and len(after["interview_scorecards"]) == 2
    assert after["report"]["final_score"] == expected_final([GOOD_RATINGS, low]) == after["final_score"] == after["eval_score"]
    assert len(after["report"]["interviewers"]) == 2
    assert after["report"]["recommendation"] == "hire"
    assert after["external_review"]["reviewed_at"] == reviewed_at
    assert after["pipeline_stage"] == "completed"

    edit = await put_link(client, minted["token"], ratings={k: 5 for k in AREAS}, recommendation="strong_hire")
    assert edit.status_code == 200
    final = await fetch(seed, cand.id)
    assert len(final["interview_scorecards"]) == 2
    assert final["report"]["final_score"] == expected_final([GOOD_RATINGS, {k: 5 for k in AREAS}])
    assert final["report"]["interviewers"][1]["recommendation"] == "strong_hire"


async def test_a_link_scorecard_cannot_be_changed_once_the_candidate_is_hired_or_rejected(client, admin_headers, seed):
    cand = await seed.candidate()
    await post_review(client, admin_headers, cand.id)
    minted = (await mint(client, admin_headers, cand.id)).json()
    assert (await put_link(client, minted["token"])).status_code == 200
    await client.post(f"/api/v1/candidates/{cand.id}/decision", json={"decision": "reject"}, headers=admin_headers)
    frozen = (await fetch(seed, cand.id))["report"]
    locked = await put_link(client, minted["token"], ratings={k: 1 for k in AREAS})
    assert locked.status_code == 423 and "rejected" in locked.json()["detail"]
    assert (await fetch(seed, cand.id))["report"] == frozen


async def test_the_token_is_shown_once_and_only_its_hash_is_stored(client, admin_headers, seed, llm):
    cand = await seed.candidate()
    resp = await mint(client, admin_headers, cand.id, interviewer_name="Dev Patel", interviewer_role="engineer", expires_in_days=3)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert set(body) == {"link_id", "token", "url", "expires_at"}
    assert len(body["token"]) >= 40
    assert body["url"] == f"{settings.FRONTEND_URL.rstrip('/')}/interviewer/{body['token']}"
    expires = datetime.fromisoformat(body["expires_at"])
    assert timedelta(days=2, hours=23) < expires - datetime.now(timezone.utc) <= timedelta(days=3, minutes=1)

    stored = await seed.db.interviewer_links.find_one({"link_id": body["link_id"]})
    assert stored["token_hash"] == hashlib.sha256(body["token"].encode()).hexdigest()
    assert body["token"] not in json.dumps(stored, default=str) and "token" not in stored
    assert {k: stored[k] for k in ("candidate_id", "job_id", "interviewer_name", "interviewer_role", "revoked", "scorecard_id")} == {
        "candidate_id": cand.id, "job_id": cand.job_id, "interviewer_name": "Dev Patel",
        "interviewer_role": "engineer", "revoked": False, "scorecard_id": None,
    }
    assert stored["created_by"] == HR_EMAIL and stored["created_at"] and stored["expires_at"] == body["expires_at"]


async def test_listing_links_never_returns_the_token_or_its_hash(client, admin_headers, seed, llm):
    cand = await seed.candidate()
    minted = (await mint(client, admin_headers, cand.id, interviewer_name="Dev Patel")).json()
    await mint(client, admin_headers, cand.id)
    resp = await client.get(f"/api/v1/candidates/{cand.id}/interviewer-links", headers=admin_headers)
    assert resp.status_code == 200
    rows = resp.json()
    assert isinstance(rows, list) and len(rows) == 2
    for row in rows:
        assert set(row) == {"link_id", "interviewer_name", "interviewer_role", "created_at", "expires_at", "revoked", "submitted"}
        assert row["revoked"] is False and row["submitted"] is False
    assert minted["token"] not in resp.text
    assert hashlib.sha256(minted["token"].encode()).hexdigest() not in resp.text
    assert {r["interviewer_name"] for r in rows} == {"Dev Patel", None}
    assert {r["interviewer_role"] for r in rows} == {"engineer"}

    assert (await put_link(client, minted["token"])).status_code == 200
    rows = (await client.get(f"/api/v1/candidates/{cand.id}/interviewer-links", headers=admin_headers)).json()
    assert next(r for r in rows if r["link_id"] == minted["link_id"])["submitted"] is True


async def test_minting_a_link_generates_the_guide_only_when_there_is_none(client, admin_headers, seed, llm):
    bare = await seed.candidate()
    assert (await mint(client, admin_headers, bare.id)).status_code == 200
    guide = (await fetch(seed, bare.id))["interview_guide"]
    assert guide and len(guide["questions"]) == 10 and len(llm.calls) == 1

    guided = await seed.candidate(guide=5)
    before = (await fetch(seed, guided.id))["interview_guide"]
    assert (await mint(client, admin_headers, guided.id)).status_code == 200
    assert (await fetch(seed, guided.id))["interview_guide"] == before and len(llm.calls) == 1


async def test_at_most_five_links_per_candidate_and_revoking_frees_a_slot(client, admin_headers, seed):
    cand = await seed.candidate(guide=3)
    minted = [(await mint(client, admin_headers, cand.id, interviewer_name=f"Person {i}")) for i in range(5)]
    assert all(r.status_code == 200 for r in minted)
    sixth = await mint(client, admin_headers, cand.id)
    assert sixth.status_code == 409 and isinstance(sixth.json()["detail"], str)
    assert await seed.db.interviewer_links.count_documents({"candidate_id": cand.id}) == 5

    revoked = await client.post(
        f"/api/v1/candidates/{cand.id}/interviewer-links/{minted[0].json()['link_id']}/revoke", headers=admin_headers,
    )
    assert revoked.status_code == 200 and revoked.json()["revoked"] is True
    assert (await mint(client, admin_headers, cand.id)).status_code == 200
    other = await seed.candidate(guide=3)
    assert (await mint(client, admin_headers, other.id)).status_code == 200


async def test_a_revoked_link_stops_working_and_revoking_twice_is_harmless(client, admin_headers, seed):
    cand = await seed.candidate(guide=3)
    minted = (await mint(client, admin_headers, cand.id)).json()
    assert (await client.get(f"/api/v1/interviewer-scorecard/{minted['token']}")).status_code == 200

    path = f"/api/v1/candidates/{cand.id}/interviewer-links/{minted['link_id']}/revoke"
    first = await client.post(path, headers=admin_headers)
    again = await client.post(path, headers=admin_headers)
    assert first.status_code == again.status_code == 200 and again.json()["revoked"] is True

    assert (await client.get(f"/api/v1/interviewer-scorecard/{minted['token']}")).status_code == 404
    put = await put_link(client, minted["token"])
    assert put.status_code == 423
    assert not (await fetch(seed, cand.id)).get("interview_scorecards")
    listed = (await client.get(f"/api/v1/candidates/{cand.id}/interviewer-links", headers=admin_headers)).json()
    assert listed[0]["revoked"] is True


async def test_revoking_keeps_the_scorecard_the_link_already_filed(client, admin_headers, seed):
    cand = await seed.candidate()
    await post_review(client, admin_headers, cand.id)
    minted = (await mint(client, admin_headers, cand.id)).json()
    await put_link(client, minted["token"])
    await client.post(f"/api/v1/candidates/{cand.id}/interviewer-links/{minted['link_id']}/revoke", headers=admin_headers)
    stored = await fetch(seed, cand.id)
    assert len(stored["interview_scorecards"]) == 2 and stored["external_review"]["panel_size"] == 2


async def test_an_expired_link_is_a_404_on_read_and_locked_on_write(client, admin_headers, seed):
    cand = await seed.candidate(guide=3)
    minted = (await mint(client, admin_headers, cand.id)).json()
    await seed.db.interviewer_links.update_one(
        {"link_id": minted["link_id"]},
        {"$set": {"expires_at": (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()}},
    )
    got = await client.get(f"/api/v1/interviewer-scorecard/{minted['token']}")
    assert got.status_code == 404
    put = await put_link(client, minted["token"])
    assert put.status_code == 423 and isinstance(put.json()["detail"], str)


async def test_unknown_revoked_and_expired_tokens_read_the_same(client, admin_headers, seed):
    cand = await seed.candidate(guide=3)
    revoked = (await mint(client, admin_headers, cand.id)).json()
    expired = (await mint(client, admin_headers, cand.id)).json()
    await client.post(f"/api/v1/candidates/{cand.id}/interviewer-links/{revoked['link_id']}/revoke", headers=admin_headers)
    await seed.db.interviewer_links.update_one(
        {"link_id": expired["link_id"]}, {"$set": {"expires_at": "2000-01-01T00:00:00+00:00"}},
    )
    answers = []
    for token in ("not-a-real-token", revoked["token"], expired["token"], "x" * 400):
        resp = await client.get(f"/api/v1/interviewer-scorecard/{token}")
        answers.append((resp.status_code, resp.json()))
    assert len({json.dumps(a) for a in answers}) == 1
    assert answers[0][0] == 404 and isinstance(answers[0][1]["detail"], str)
    assert (await client.put("/api/v1/interviewer-scorecard/not-a-real-token", json=link_body())).status_code == 404


@pytest.mark.parametrize("body", [
    {"interviewer_role": "wizard"},
    {"interviewer_name": "n" * 121},
    {"interviewer_name": "n" * 1001},
])
async def test_bad_link_input_is_422_and_creates_nothing(client, admin_headers, seed, llm, body):
    cand = await seed.candidate()
    resp = await mint(client, admin_headers, cand.id, **body)
    assert resp.status_code == 422, resp.text
    assert await seed.db.interviewer_links.count_documents({"candidate_id": cand.id}) == 0
    assert llm.calls == []


@pytest.mark.parametrize("days", [0, 31, -1])
async def test_link_lifetime_must_be_one_to_thirty_days(client, admin_headers, seed, days):
    cand = await seed.candidate(guide=3)
    assert (await mint(client, admin_headers, cand.id, expires_in_days=days)).status_code == 422
    for ok in (1, 30):
        assert (await mint(client, admin_headers, cand.id, expires_in_days=ok)).status_code == 200


async def test_links_need_an_open_external_interview(client, admin_headers, seed, llm):
    platform = await seed.candidate(mode="platform")
    assert (await mint(client, admin_headers, platform.id)).status_code == 409
    hired = await seed.candidate(stage="hired", guide=3)
    resp = await mint(client, admin_headers, hired.id)
    assert resp.status_code == 409 and "hired" in resp.json()["detail"]
    assert (await mint(client, admin_headers, "nope")).status_code == 404
    assert llm.calls == []


async def test_link_endpoints_are_admin_only_and_use_the_review_permission(client, admin_headers, standard_headers, seed, llm):
    cand = await seed.candidate(guide=3)
    minted = (await mint(client, admin_headers, cand.id)).json()
    base = f"/api/v1/candidates/{cand.id}"
    assert (await client.post(f"{base}/interviewer-links", json={}, headers=standard_headers)).status_code == 403
    assert (await client.get(f"{base}/interviewer-links", headers=standard_headers)).status_code == 403
    assert (await client.post(f"{base}/interviewer-links/{minted['link_id']}/revoke", headers=standard_headers)).status_code == 403
    assert (await client.post(f"{base}/external-review/draft-summary", json={}, headers=standard_headers)).status_code == 403

    from config.database import get_db
    db = get_db()
    await db.roles.insert_one({
        "role_name": "admin",
        "permissions": [p for p in DEFAULT_ROLE_PERMISSIONS["admin"] if p != "interview:external_review"],
    })
    try:
        for call in (
            client.get(f"{base}/interview-guide", headers=admin_headers),
            client.post(f"{base}/interview-guide", json={}, headers=admin_headers),
            client.get(f"{base}/interviewer-links", headers=admin_headers),
            client.post(f"{base}/interviewer-links", json={}, headers=admin_headers),
            client.post(f"{base}/external-review/draft-summary", json={}, headers=admin_headers),
            client.get(f"{base}/external-review", headers=admin_headers),
        ):
            assert (await call).status_code == 403
    finally:
        await db.roles.delete_one({"role_name": "admin"})


async def test_revoking_a_link_of_another_candidate_or_an_unknown_link_is_404(client, admin_headers, seed):
    mine = await seed.candidate(guide=3)
    theirs = await seed.candidate(guide=3)
    link = (await mint(client, admin_headers, theirs.id)).json()
    wrong = await client.post(f"/api/v1/candidates/{mine.id}/interviewer-links/{link['link_id']}/revoke", headers=admin_headers)
    assert wrong.status_code == 404
    assert (await client.get(f"/api/v1/interviewer-scorecard/{link['token']}")).status_code == 200
    unknown = await client.post(f"/api/v1/candidates/{mine.id}/interviewer-links/nope/revoke", headers=admin_headers)
    assert unknown.status_code == 404


PAGE_KEYS = {
    "candidate_name", "job_title", "platform_label", "scheduled_start_at", "interviewer_name", "interviewer_role",
    "guide", "candidate_highlights", "scorecard", "locked", "locked_reason", "expires_at",
}


async def test_the_public_page_shape(client, admin_headers, seed):
    cand = await seed.candidate(guide=6)
    minted = (await mint(client, admin_headers, cand.id, interviewer_name="Dev Patel", interviewer_role="engineer")).json()
    resp = await client.get(f"/api/v1/interviewer-scorecard/{minted['token']}")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert set(body) == PAGE_KEYS
    stored = await fetch(seed, cand.id)
    assert body["candidate_name"] == CANDIDATE_NAME and body["job_title"] == "Platform Engineer"
    assert body["platform_label"] == "Google Meet"
    assert body["scheduled_start_at"] == stored["external_interview"]["scheduled_start_at"]
    assert body["interviewer_name"] == "Dev Patel" and body["interviewer_role"] == "engineer"
    assert body["scorecard"] is None and body["locked"] is False and body["locked_reason"] is None
    assert body["expires_at"] == minted["expires_at"]
    assert set(body["guide"]) == {"questions", "fallback"} and len(body["guide"]["questions"]) == 6
    assert body["guide"]["fallback"] is False
    assert all(set(q) == {"id", "text", "dimension", "listen_for", "source"} for q in body["guide"]["questions"])
    assert {q["source"] for q in body["guide"]["questions"]} == {"ai"}
    highlights = body["candidate_highlights"]
    assert set(highlights) == {"seniority", "domain", "skills"}
    assert highlights["seniority"] == "senior" and highlights["domain"] == "software_engineering"
    assert highlights["skills"] == [f"skill-{i}" for i in range(15)]


async def test_the_public_page_says_when_the_guide_is_generic(client, admin_headers, seed):
    cand = await seed.candidate(guide=4)
    await seed.db.candidates.update_one({"candidate_id": cand.id}, {"$set": {"interview_guide.fallback": True}})
    minted = (await mint(client, admin_headers, cand.id)).json()
    body = (await client.get(f"/api/v1/interviewer-scorecard/{minted['token']}")).json()
    assert body["guide"]["fallback"] is True


async def test_the_public_page_leaks_nothing_sensitive(client, admin_headers, seed):
    cand = await seed.candidate(guide=4)
    await post_review(
        client, admin_headers, cand.id, strengths="HR-ONLY-STRENGTH", concerns="HR-ONLY-CONCERN",
        summary="HR-ONLY-SUMMARY written by the recruiter.",
        questions=[{"question_id": "q1", "rating": 5, "notes": "HR-ONLY-NOTE"}],
    )
    other = (await mint(client, admin_headers, cand.id, interviewer_name="Other Person")).json()
    await put_link(client, other["token"], summary="OTHER-INTERVIEWER-SUMMARY here.",
                   questions=[{"question_id": "q2", "rating": 2, "notes": "OTHER-INTERVIEWER-NOTE"}])
    mine = (await mint(client, admin_headers, cand.id, interviewer_name="Dev Patel")).json()

    stored = await fetch(seed, cand.id)
    resp = await client.get(f"/api/v1/interviewer-scorecard/{mine['token']}")
    assert resp.status_code == 200
    text = resp.text
    assert set(resp.json()) == PAGE_KEYS
    for secret in (
        stored["email"], PHONE, RESUME_MARKER, RESUME_TAIL, JD_MARKER,
        "HR-ONLY", "OTHER-INTERVIEWER", "Other Person", "Demo Admin", HR_EMAIL, stored["secure_token"],
        "overall_score", "final_score", "score_breakdown", "external_review", "interview_scorecards", "recommendation",
        "report", mine["token"], other["token"],
    ):
        assert secret not in text, secret
    assert resp.json()["scorecard"] is None


async def test_the_public_page_returns_this_links_own_scorecard_and_nobody_elses(client, admin_headers, seed):
    cand = await seed.candidate(guide=3)
    a = (await mint(client, admin_headers, cand.id)).json()
    b = (await mint(client, admin_headers, cand.id)).json()
    await put_link(client, a["token"], interviewer_name="Ann A", summary="ANN-SUMMARY for the record, thank you.")
    await put_link(client, b["token"], interviewer_name="Bob B", summary="BOB-SUMMARY for the record, thank you.")
    a_page = (await client.get(f"/api/v1/interviewer-scorecard/{a['token']}")).json()
    assert a_page["scorecard"]["summary"].startswith("ANN-SUMMARY") and "BOB" not in json.dumps(a_page)
    assert a_page["interviewer_name"] == "Ann A"
    assert a_page["scorecard"]["source"] == "link" and a_page["scorecard"]["submitted_by"] is None


async def test_the_public_page_locks_after_hire_or_reject_and_for_other_interviews(client, admin_headers, seed):
    cand = await seed.candidate(guide=3)
    minted = (await mint(client, admin_headers, cand.id)).json()
    await post_review(client, admin_headers, cand.id)
    await client.post(f"/api/v1/candidates/{cand.id}/decision", json={"decision": "hire"}, headers=admin_headers)
    page = (await client.get(f"/api/v1/interviewer-scorecard/{minted['token']}")).json()
    assert page["locked"] is True and "hired" in page["locked_reason"]
    assert set(page) == PAGE_KEYS

    rejected = await seed.candidate(guide=3)
    token = (await mint(client, admin_headers, rejected.id)).json()["token"]
    await client.post(f"/api/v1/candidates/{rejected.id}/decision", json={"decision": "reject"}, headers=admin_headers)
    page = (await client.get(f"/api/v1/interviewer-scorecard/{token}")).json()
    assert page["locked"] is True and "rejected" in page["locked_reason"]

    switched = await seed.candidate(guide=3)
    token = (await mint(client, admin_headers, switched.id)).json()["token"]
    await seed.db.candidates.update_one({"candidate_id": switched.id}, {"$set": {"interview_mode": "platform"}})
    page = (await client.get(f"/api/v1/interviewer-scorecard/{token}")).json()
    assert page["locked"] is True and page["locked_reason"]
    assert (await put_link(client, token)).status_code == 423


async def test_the_public_put_creates_then_updates_this_links_single_scorecard(client, admin_headers, seed):
    cand = await seed.candidate(guide=3)
    minted = (await mint(client, admin_headers, cand.id)).json()
    first = await put_link(client, minted["token"], questions=[{"question_id": "q1", "rating": 4, "notes": "Solid."}])
    assert first.status_code == 200, first.text
    card = first.json()["scorecard"]
    assert first.json()["saved"] is True
    assert card["source"] == "link" and card["submitted_by"] is None
    assert card["interviewer_name"] == "Dev Patel" and card["interviewer_role"] == "engineer"
    assert card["questions"][0] == {
        "question_id": "q1", "text": "Guide question 1 about the Orion migration?",
        "dimension": "technical", "rating": 4, "notes": "Solid.",
    }
    link = await seed.db.interviewer_links.find_one({"link_id": minted["link_id"]})
    assert link["scorecard_id"] == card["scorecard_id"]

    second = await put_link(client, minted["token"], interviewer_name="Dev P.", recommendation="no_hire")
    assert second.status_code == 200
    stored = (await fetch(seed, cand.id))["interview_scorecards"]
    assert len(stored) == 1 and stored[0]["scorecard_id"] == card["scorecard_id"]
    assert stored[0]["interviewer_name"] == "Dev P." and stored[0]["recommendation"] == "no_hire"
    assert stored[0]["submitted_at"] == card["submitted_at"] and stored[0]["updated_at"] >= card["updated_at"]
    page = (await client.get(f"/api/v1/interviewer-scorecard/{minted['token']}")).json()
    assert page["scorecard"]["scorecard_id"] == card["scorecard_id"] and page["scorecard"]["questions"] == []


@pytest.mark.parametrize("overrides,fragment", [
    ({"interviewer_name": ""}, "name"),
    ({"interviewer_name": None}, "name"),
    ({"interviewer_role": None}, "role"),
    ({"interviewer_role": "wizard"}, "role"),
    ({"ratings": {"technical": 3}}, "Rate every area"),
    ({"ratings": {"technical": 9, "communication": 4, "problem_solving": 2, "cultural_fit": 5, "confidence": 4}}, "Rate every area"),
    ({"recommendation": "maybe"}, "recommendation"),
    ({"summary": "short"}, "at least 20"),
    ({"questions": [{"question_id": "q99", "rating": 3}]}, "Unknown question"),
    ({"questions": [{"question_id": "q1", "rating": 7}]}, "1 to 5"),
    ({"strengths": "s" * 2001}, "at most 2000"),
])
async def test_the_public_put_validates_exactly_like_the_admin_path(client, admin_headers, seed, overrides, fragment):
    cand = await seed.candidate(guide=3)
    minted = (await mint(client, admin_headers, cand.id)).json()
    resp = await put_link(client, minted["token"], **overrides)
    assert resp.status_code == 422, resp.text
    assert fragment in resp.json()["detail"]
    assert not (await fetch(seed, cand.id)).get("interview_scorecards")


async def test_the_public_put_accepts_the_legacy_culture_fit_key(client, admin_headers, seed):
    cand = await seed.candidate(guide=3)
    minted = (await mint(client, admin_headers, cand.id)).json()
    ratings = {"technical": 3, "communication": 4, "problem_solving": 2, "culture_fit": 5, "confidence": 4}
    resp = await put_link(client, minted["token"], ratings=ratings)
    assert resp.status_code == 200 and resp.json()["scorecard"]["ratings"]["cultural_fit"] == 5


async def test_the_public_put_leaves_the_stage_and_gate_alone_and_audits_without_the_notes(client, admin_headers, seed):
    cand = await seed.candidate(guide=3)
    minted = (await mint(client, admin_headers, cand.id)).json()
    resp = await put_link(client, minted["token"], questions=[{"question_id": "q1", "rating": 3, "notes": "SECRET-NOTE"}])
    assert resp.status_code == 200
    stored = await fetch(seed, cand.id)
    assert stored["pipeline_stage"] == "interviewing" and ext.needs_review(stored) is True

    entry = await seed.db.audit_log.find_one({"resource_id": cand.id, "action": "interviewer_scorecard_submitted"})
    assert entry is not None and entry["actor_role"] == "interviewer_link"
    assert entry["details"]["link_id"] == minted["link_id"] and entry["details"]["report_rebuilt"] is False
    assert "SECRET-NOTE" not in json.dumps(entry, default=str) and minted["token"] not in json.dumps(entry, default=str)
    created = await seed.db.audit_log.find_one({"resource_id": cand.id, "action": "interviewer_link_created"})
    assert created is not None and minted["token"] not in json.dumps(created, default=str)


async def test_the_public_endpoints_are_rate_limited_per_ip_and_per_token(client, admin_headers, seed, monkeypatch):
    import routes.interviewer_scorecard as page

    cand = await seed.candidate(guide=3)
    one = (await mint(client, admin_headers, cand.id)).json()
    two = (await mint(client, admin_headers, cand.id)).json()

    monkeypatch.setattr(page, "TOKEN_LIMIT", 2)
    for _ in range(2):
        assert (await client.get(f"/api/v1/interviewer-scorecard/{one['token']}")).status_code == 200
    limited = await client.get(f"/api/v1/interviewer-scorecard/{one['token']}")
    assert limited.status_code == 429 and isinstance(limited.json()["detail"], str)
    assert (await put_link(client, one["token"])).status_code == 429
    assert (await client.get(f"/api/v1/interviewer-scorecard/{two['token']}")).status_code == 200

    monkeypatch.setattr(page, "TOKEN_LIMIT", 1000)
    monkeypatch.setattr(page, "IP_LIMIT", 3)
    ip = f"scan-{uuid.uuid4().hex[:8]}"
    monkeypatch.setattr(page, "_client_ip", lambda request: ip)
    codes = [(await client.get(f"/api/v1/interviewer-scorecard/guess-{i}")).status_code for i in range(5)]
    assert codes == [404, 404, 404, 429, 429]
    keys = [d["_id"] async for d in seed.db.rate_limits.find({"_id": {"$regex": "^interviewer:token:"}}, {"_id": 1}).limit(200)]
    assert keys and not any(one["token"] in key for key in keys)


async def test_the_draft_summary_prompt_holds_only_what_was_supplied(client, admin_headers, seed, llm, cost_calls):
    cand = await seed.candidate(guide=3)
    body = {
        "ratings": {"technical": 4, "communication": 3},
        "questions": [
            {"question_id": "q1", "rating": 5, "notes": "NOTE-ONE explained the index choice"},
            {"question_id": "q2", "rating": None, "notes": ""},
        ],
        "strengths": "STRENGTH-TEXT clear thinker",
        "concerns": "CONCERN-TEXT light on analytics",
        "recommendation": "hire",
    }
    resp = await client.post(f"/api/v1/candidates/{cand.id}/external-review/draft-summary", json=body, headers=admin_headers)
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"summary": llm.summary}

    prompt = llm.calls[0]["prompt"]
    for supplied in ("NOTE-ONE explained the index choice", "STRENGTH-TEXT", "CONCERN-TEXT", "Technical: 4", "Communication: 3",
                     "5/5", "Guide question 1 about the Orion migration?", "hire"):
        assert supplied in prompt, supplied
    stored = await fetch(seed, cand.id)
    for absent in (CANDIDATE_NAME, "Sam", stored["email"], PHONE, RESUME_MARKER, JD_MARKER, SKILL_MARKER, "Platform Engineer",
                   "Guide question 2", "Cultural fit:", "Confidence:"):
        assert absent not in prompt, absent
    system = llm.calls[0]["system"].lower()
    assert "only" in system and "never add" in system
    assert "do not add any fact, name, employer, skill, project or score" in prompt.lower()
    assert "60 to 120 words" in prompt
    assert EM_DASH not in prompt and EM_DASH not in llm.calls[0]["system"]
    assert cost_calls == [("interview_summary_draft", cand.id)]

    assert not stored.get("interview_scorecards") and not stored.get("report") and not stored.get("external_review")


async def test_the_draft_summary_is_trimmed_and_stripped_of_em_dashes(client, admin_headers, seed, llm):
    cand = await seed.candidate()
    llm.summary = ("Word. " * 40 + f"Another sentence {EM_DASH} here. ") * 4
    resp = await client.post(
        f"/api/v1/candidates/{cand.id}/external-review/draft-summary", json={"strengths": "Clear"}, headers=admin_headers,
    )
    assert resp.status_code == 200
    summary = resp.json()["summary"]
    assert len(summary.split()) <= 120 and EM_DASH not in summary and summary.endswith(".")


async def test_the_draft_summary_validates_and_fails_cleanly(client, admin_headers, standard_headers, seed, llm):
    cand = await seed.candidate(guide=2)
    url = f"/api/v1/candidates/{cand.id}/external-review/draft-summary"
    assert (await client.post(url, json={}, headers=admin_headers)).status_code == 422
    empty = await client.post(url, json={"strengths": "  "}, headers=admin_headers)
    assert empty.status_code == 422 and "Add some ratings or notes" in empty.json()["detail"]
    bad_id = await client.post(url, json={"questions": [{"question_id": "q99", "rating": 3}]}, headers=admin_headers)
    assert bad_id.status_code == 422 and "Unknown question" in bad_id.json()["detail"]
    bad_rating = await client.post(url, json={"ratings": {"technical": 7}}, headers=admin_headers)
    assert bad_rating.status_code == 422
    bad_rec = await client.post(url, json={"strengths": "ok", "recommendation": "maybe"}, headers=admin_headers)
    assert bad_rec.status_code == 422
    assert (await client.post(url, json={"strengths": "ok"}, headers=standard_headers)).status_code == 403
    assert (await client.post("/api/v1/candidates/nope/external-review/draft-summary", json={"strengths": "ok"}, headers=admin_headers)).status_code == 404
    platform = await seed.candidate(mode="platform")
    assert (await client.post(f"/api/v1/candidates/{platform.id}/external-review/draft-summary", json={"strengths": "ok"}, headers=admin_headers)).status_code == 409
    assert llm.calls == []

    llm.summary = ""
    down = await client.post(url, json={"strengths": "ok"}, headers=admin_headers)
    assert down.status_code == 502 and isinstance(down.json()["detail"], str)
    llm.error = RuntimeError("provider down")
    assert (await client.post(url, json={"strengths": "ok"}, headers=admin_headers)).status_code == 502


async def test_the_admin_view_returns_the_meeting_review_guide_and_every_scorecard(client, admin_headers, standard_headers, seed):
    cand = await seed.candidate(guide=3)
    minted = (await mint(client, admin_headers, cand.id)).json()
    await put_link(client, minted["token"], questions=[{"question_id": "q1", "rating": 3, "notes": "LINK-NOTE"}])
    await post_review(client, admin_headers, cand.id, questions=[{"question_id": "q1", "rating": 5, "notes": "HR-NOTE"}])

    resp = await client.get(f"/api/v1/candidates/{cand.id}/external-review", headers=admin_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert set(body) == {"external_interview", "external_review", "interview_guide", "scorecards"}
    assert body["external_interview"]["platform"] == "meet" and len(body["interview_guide"]["questions"]) == 3
    assert body["external_review"]["panel_size"] == 2
    assert [c["source"] for c in body["scorecards"]] == ["hr", "link"]
    assert [c["questions"][0]["notes"] for c in body["scorecards"]] == ["HR-NOTE", "LINK-NOTE"]

    assert (await client.get(f"/api/v1/candidates/{cand.id}/external-review", headers=standard_headers)).status_code == 403
    std = await client.get(f"/api/v1/candidates/{cand.id}", headers=standard_headers)
    assert std.status_code == 200
    assert "interview_scorecards" not in std.json() and "external_review" not in std.json()
    assert "report" not in std.json() and "score_breakdown" not in std.json()
    assert "HR-NOTE" not in std.text and "LINK-NOTE" not in std.text
    listed = await client.get(f"/api/v1/candidates?job_id={cand.job_id}", headers=standard_headers)
    assert listed.status_code == 200 and "HR-NOTE" not in listed.text and "LINK-NOTE" not in listed.text
    adm = await client.get(f"/api/v1/candidates/{cand.id}", headers=admin_headers)
    assert len(adm.json()["interview_scorecards"]) == 2
    assert (await client.get("/api/v1/candidates/nope/external-review", headers=admin_headers)).status_code == 404


async def test_the_scorecard_report_reaches_the_pipeline_and_workflow_surfaces(client, admin_headers, standard_headers, seed):
    cand = await seed.candidate()
    await post_review(client, admin_headers, cand.id)
    rows = (await client.get(f"/api/v1/jobs/{cand.job_id}/pipeline", headers=standard_headers)).json()["pipeline"]
    row = next(r for r in rows if r["resume_id"] == cand.resume_id)
    assert row["external_status"] == "reviewed" and row["review_submitted"] is True and row["pipeline_stage"] == "completed"
    job = await seed.db.jobs.find_one({"job_id": cand.job_id})
    assert job["candidate_pipeline"][0]["pipeline_stage"] == "completed"
    stored = await fetch(seed, cand.id)
    assert stored["status"] == "completed" and stored["external_interview"]["status"] == "reviewed"
    audit = await seed.db.audit_log.find_one({"resource_id": cand.id, "action": "external_review_submitted"})
    for _ in range(20):
        if audit:
            break
        await asyncio.sleep(0.15)
        audit = await seed.db.audit_log.find_one({"resource_id": cand.id, "action": "external_review_submitted"})
    assert audit and audit["details"]["panel_size"] == 1 and audit["details"]["recommendation"] == "hire"


def _card(**over) -> dict:
    base = dict(
        source="hr", submitted_by="a@b.c", interviewer_name="Sam", interviewer_role="hr", questions=None,
        ratings=GOOD_RATINGS, recommendation="hire", summary="y" * 25, strengths=None, concerns=None, guide=None,
    )
    base.update(over)
    return sc.build_scorecard(**base)


async def test_dimension_scores_round_half_up_on_the_mean_times_twenty():
    cards = [_card(ratings={**GOOD_RATINGS, "technical": t}, submitted_by=f"{i}@x.y") for i, t in enumerate([4, 3, 4])]
    assert sc.dimension_score(cards, "technical") == 73
    eight = [_card(ratings={**GOOD_RATINGS, "technical": t}, submitted_by=f"{i}@x.y") for i, t in enumerate([4, 3, 3, 3, 3, 3, 3, 3])]
    assert sc.dimension_score(eight, "technical") == 63
    assert sc.dimension_score([], "technical") == 0


async def test_build_report_is_pure_and_needs_an_hr_scorecard():
    link_only = [_card(source="link", submitted_by=None)]
    with pytest.raises(ValueError):
        sc.build_report(link_only, platform_label="Zoom")
    assert sc.build_combined_review(link_only, interviewed_at=None) is None

    report = sc.build_report([_card()], platform_label=None)
    assert report["interview_platform"] is None and "another platform" in report["integrity_assessment"]
    assert "(" not in report["integrity_assessment"]
    assert sc.build_report([_card()], platform_label=None) == report


async def test_lock_reason_covers_every_closed_state():
    assert sc.lock_reason({"interview_mode": "external", "pipeline_stage": "interviewing"}) is None
    assert "hired" in sc.lock_reason({"interview_mode": "external", "pipeline_stage": "hired"})
    assert "rejected" in sc.lock_reason({"interview_mode": "external", "pipeline_stage": "rejected"})
    assert sc.lock_reason({"interview_mode": "platform", "pipeline_stage": "interviewing"})
    assert sc.lock_reason(None)


async def test_no_new_permission_was_added_and_the_existing_one_is_admin_only():
    assert "interview:external_review" in DEFAULT_ROLE_PERMISSIONS["admin"]
    assert "interview:external_review" in DEFAULT_ROLE_PERMISSIONS["superadmin"]
    assert "interview:external_review" not in DEFAULT_ROLE_PERMISSIONS["standard"]
