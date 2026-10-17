import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

pytestmark = pytest.mark.anyio


class _PoisonedCollection:

    def __init__(self, seeded: dict | None = None):
        self.seeded = seeded or {}

    def __getattr__(self, name):
        raise AssertionError(
            f"candidate_demographics.{name}(...) was called, structural "
            "isolation violated (MVP2 plan §4 point 4)"
        )


_EXTREME_DEMOGRAPHICS = {
    "candidate_id": "cand-with-extreme-demographics",
    "gender": "EXTREME_TEST_VALUE_should_never_affect_scoring_or_matching",
    "location": "EXTREME_TEST_VALUE_Timbuktu_Nowhereville_XYZ",
    "submitted_at": "2026-01-01T00:00:00+00:00",
}


def _fake_cursor(items):
    cursor = MagicMock()
    cursor.to_list = AsyncMock(return_value=items)
    return cursor


async def test_match_resume_to_jds_never_touches_candidate_demographics():
    from services.hr_module import matcher

    db = MagicMock()
    db.candidate_demographics = _PoisonedCollection(seeded=_EXTREME_DEMOGRAPHICS)
    db.jobs.find = MagicMock(return_value=_fake_cursor([{"job_id": "job-1", "deadline_at": None}]))
    db.jobs.update_one = AsyncMock()

    pc = MagicMock()
    pc.query.return_value = MagicMock(matches=[
        {"id": "job-1", "score": 0.9, "metadata": {"job_domain": "engineering", "skills": []}},
    ])

    with patch.object(matcher, "get_db", return_value=db), \
         patch.object(matcher, "get_pinecone", return_value=pc):
        result = await matcher.match_resume_to_jds(
            resume_id="resume-linked-to-extreme-candidate",
            embedding=[0.1] * 10,
            classification={"job_domain": "engineering", "seniority_level": "mid", "skills": []},
        )

    assert result == [{"job_id": "job-1", "score": 0.9}]
    db.jobs.update_one.assert_called_once()


async def test_match_jd_to_resume_pool_never_touches_candidate_demographics():
    from services.hr_module import matcher

    db = MagicMock()
    db.candidate_demographics = _PoisonedCollection(seeded=_EXTREME_DEMOGRAPHICS)
    db.resumes.find = MagicMock(return_value=_fake_cursor([{"resume_id": "resume-1"}]))
    db.jobs.find_one = AsyncMock(return_value={"deadline_at": None})
    db.jobs.update_one = AsyncMock()

    pc = MagicMock()
    pc.query.return_value = MagicMock(matches=[
        {"id": "resume-1", "score": 0.9, "metadata": {"job_domain": "engineering", "skills": []}},
    ])

    with patch.object(matcher, "get_db", return_value=db), \
         patch.object(matcher, "get_pinecone", return_value=pc):
        result = await matcher.match_jd_to_resume_pool(
            job_id="job-1",
            targeting={"required_domain": "engineering", "required_seniority": [], "required_skills": []},
            jd_embedding=[0.1] * 10,
        )

    assert result == [{"resume_id": "resume-1", "score": 0.9}]
    db.jobs.update_one.assert_called_once()


async def test_interview_evaluation_identical_with_and_without_demographics(monkeypatch):
    import config.database as database_module
    import services.hr_module.interview_engine as interview_engine

    eval_response = json.dumps({
        "overall_score": 74,
        "technical_score": 70, "technical_rationale": "Solid understanding of caching.",
        "communication_score": 68, "communication_rationale": "Clear and concise.",
        "problem_solving_score": 72, "problem_solving_rationale": "Methodical approach.",
        "cultural_fit_score": 66, "cultural_fit_rationale": "Team-oriented answers.",
        "confidence_score": 60, "confidence_rationale": "Composed throughout.",
        "strengths": ["Clear reasoning"],
        "areas_for_improvement": ["More depth"],
        "recommendation": "maybe",
        "summary": "Solid, average technical interview.",
        "integrity_assessment": "No flags raised.",
    })

    async def fake_ask_llm(*args, **kwargs):
        return eval_response

    monkeypatch.setattr(interview_engine, "ask_llm", fake_ask_llm)

    db = MagicMock()
    db.candidate_demographics = _PoisonedCollection(seeded=_EXTREME_DEMOGRAPHICS)
    db.coding_submissions.find_one = AsyncMock(return_value=None)
    monkeypatch.setattr(database_module, "get_db", lambda: db)

    transcript = [
        {"question": "Tell me about your Python experience.",
         "answer": "Seven years, mostly FastAPI and asyncio services.",
         "answered_at": "2026-06-06T15:01:30Z"},
    ]
    job = {"title": "Backend Engineer"}
    integrity_flags = ["tab_switch@2026-06-06T15:00:00Z"]

    score_with_demographics, report_with_demographics = await interview_engine.evaluate_interview(
        transcript=transcript, job=job,
        candidate={"candidate_id": _EXTREME_DEMOGRAPHICS["candidate_id"]},
        integrity_flags=integrity_flags,
    )
    score_control, report_control = await interview_engine.evaluate_interview(
        transcript=transcript, job=job,
        candidate={"candidate_id": "cand-control-no-demographics-record"},
        integrity_flags=integrity_flags,
    )

    assert score_with_demographics == score_control
    assert report_with_demographics == report_control
    assert "EXTREME_TEST_VALUE" not in json.dumps(report_with_demographics)


def test_compute_integrity_score_signature_admits_no_candidate_input():
    import inspect
    from services.hr_module.integrity import compute_integrity_score

    assert list(inspect.signature(compute_integrity_score).parameters) == ["flags"]


def test_compute_integrity_score_unaffected_by_extreme_demographics_value():
    from services.hr_module.integrity import compute_integrity_score, _INTEGRITY_UNKNOWN_WEIGHT

    baseline = compute_integrity_score(["tab_switch@2026-01-01T00:00:00"])
    poisoned = compute_integrity_score([
        f"{_EXTREME_DEMOGRAPHICS['gender']}@2026-01-01T00:00:00",
        "tab_switch@2026-01-01T00:00:00",
    ])
    assert poisoned == baseline + _INTEGRITY_UNKNOWN_WEIGHT
