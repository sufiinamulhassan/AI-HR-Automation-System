"""
Candidate-facing redaction for coding submissions — MVP2 §2.10 / §2.13.

The plagiarism check added in this pass stores, on every submission, a list of
OTHER candidates' ids and their similarity scores. `_sanitize_submission_for_candidate`
previously stripped only `_id` and `code`, so anything new added to the
document would have been returned to the candidate verbatim. That would leak
one candidate's identity and work to another, and tip a copier off that they
had been caught.

Reviewing that also turned up an existing leak: the whole `quality` dict —
including the explicitly recruiter-addressed `feedback_for_recruiter` — was
already being returned to candidates. These tests pin the boundary.
"""
import uuid

import pytest

from routes.coding import _sanitize_submission_for_candidate

pytestmark = pytest.mark.anyio


def _submission() -> dict:
    return {
        "_id": "mongo-object-id",
        "submission_id": str(uuid.uuid4()),
        "question_id": str(uuid.uuid4()),
        "candidate_id": "candidate-under-test",
        "language": "python",
        "code": "print('my solution')",
        "status": "completed",
        "score": 75.0,
        "quality_score": 62,
        "quality": {
            "overall_quality_score": 62,
            "readability_score": 70,
            "strengths": ["Clear naming"],
            "concerns": ["No input validation"],
            "approach_summary": "Straightforward loop.",
            "feedback_for_recruiter": "Would need mentoring on edge cases before a senior role.",
            "feedback_for_candidate": "Consider validating input before parsing.",
        },
        "complexity": {"cyclomatic_complexity": 4, "complexity_band": "low"},
        "plagiarism": {
            "checked_against": 12,
            "max_similarity": 0.94,
            "flagged": True,
            "threshold": 0.8,
            "matches": [{"submission_id": "other-sub", "candidate_id": "SOMEONE-ELSE",
                         "similarity": 0.94, "identical_normalized": False}],
            "truncated": False,
        },
        "plagiarism_flagged": True,
        "results": [
            {"test_case_index": 0, "passed": True, "is_hidden": False,
             "actual_output": "3", "expected_output": "3"},
            {"test_case_index": 1, "passed": False, "is_hidden": True,
             "actual_output": "9", "expected_output": "42"},
        ],
    }


async def test_plagiarism_data_never_reaches_the_candidate():
    out = _sanitize_submission_for_candidate(_submission())
    assert "plagiarism" not in out
    assert "plagiarism_flagged" not in out
    assert "SOMEONE-ELSE" not in repr(out)


async def test_recruiter_feedback_never_reaches_the_candidate():
    """Pre-existing leak found while adding the above."""
    out = _sanitize_submission_for_candidate(_submission())
    assert "feedback_for_recruiter" not in out.get("quality", {})
    assert "mentoring on edge cases" not in repr(out)


async def test_candidate_keeps_their_own_feedback_and_pass_rate():
    """Redaction must not become a blanket blackout — the candidate-addressed
    feedback exists precisely to be shown to them."""
    out = _sanitize_submission_for_candidate(_submission())
    assert out["quality"]["feedback_for_candidate"] == "Consider validating input before parsing."
    assert out["score"] == 75.0
    assert out["submission_id"]


async def test_internal_review_metrics_are_withheld():
    out = _sanitize_submission_for_candidate(_submission())
    assert "complexity" not in out
    assert "quality_score" not in out
    assert "code" not in out
    assert "_id" not in out


async def test_hidden_test_content_stays_hidden():
    out = _sanitize_submission_for_candidate(_submission())
    hidden = next(r for r in out["results"] if r["is_hidden"])
    assert hidden["passed"] is False
    assert "expected_output" not in hidden
    assert "actual_output" not in hidden

    visible = next(r for r in out["results"] if not r["is_hidden"])
    assert visible["expected_output"] == "3"


async def test_a_submission_without_a_quality_review_is_handled():
    doc = _submission()
    doc["quality"] = None
    out = _sanitize_submission_for_candidate(doc)
    assert out.get("quality") is None


async def test_every_submission_key_is_classified(setup_test_db, monkeypatch):
    """The guard that makes the allow-list self-maintaining.

    Runs a real evaluate_submission (sandbox + both LLM reviews stubbed) and
    asserts every key of the resulting document is classified as candidate-
    visible, partially-visible, or admin-only. Add a field to the submission
    doc without classifying it and this goes red — which is the entire point of
    inverting the deny-list: the unsafe outcome is loud in CI instead of silent
    in production.
    """
    from services.hr_module import coding_service
    from services.hr_module.assessment_view import (
        ALL_CLASSIFIED_SUBMISSION_KEYS,
        ADMIN_ONLY_SUBMISSION_KEYS,
        project_submission_for_candidate,
    )

    db = setup_test_db
    question_id = str(uuid.uuid4())
    candidate_id = str(uuid.uuid4())
    await db.coding_questions.insert_one({
        "question_id": question_id,
        "title": "Sum two integers",
        "description": "Read two ints from stdin, print their sum.",
        "language_templates": {"python": "# solve\n"},
        "test_cases": [
            {"input": "2 3", "expected_output": "5", "is_hidden": False},
            {"input": "10 20", "expected_output": "30", "is_hidden": True},
        ],
    })

    async def _fake_run(source_code, language_id, stdin):
        return {"stdout": "5\n", "stderr": None, "status": {"id": 3, "description": "Accepted"}}

    async def _fake_quality(**kwargs):
        return {"overall_quality_score": 70, "feedback_for_candidate": "ok",
                "feedback_for_recruiter": "SECRET"}

    async def _fake_correctness(**kwargs):
        return {"verdict": "correct", "confidence": 90, "notes": "n"}

    monkeypatch.setattr(coding_service, "run_on_judge0", _fake_run)
    monkeypatch.setattr(coding_service, "evaluate_code_quality", _fake_quality)
    monkeypatch.setattr(coding_service, "evaluate_output_correctness", _fake_correctness)
    monkeypatch.setattr(coding_service.settings, "JUDGE0_API_URL", "https://fake-judge0.invalid")

    try:
        doc = await coding_service.evaluate_submission(
            question_id=question_id, candidate_id=candidate_id,
            language="python", code="a,b=map(int,input().split());print(a+b)",
        )

        unclassified = set(doc) - set(ALL_CLASSIFIED_SUBMISSION_KEYS)
        assert not unclassified, (
            f"Unclassified submission field(s): {sorted(unclassified)}. Add each to "
            "services/hr_module/assessment_view.py — CANDIDATE_VISIBLE_SUBMISSION_KEYS "
            "if the candidate may see it, ADMIN_ONLY_SUBMISSION_KEYS if not."
        )

        out = project_submission_for_candidate(doc)
        assert not (set(out) & set(ADMIN_ONLY_SUBMISSION_KEYS))
        assert "SECRET" not in repr(out)
    finally:
        await db.coding_questions.delete_one({"question_id": question_id})
        await db.coding_submissions.delete_many({"candidate_id": candidate_id})


async def test_coding_scores_attach_to_the_interview_report(setup_test_db):
    """§2.13's last missing dimension, which was blocked on §2.10."""
    from services.hr_module.interview_engine import _attach_coding_scores

    db = setup_test_db
    candidate_id = str(uuid.uuid4())
    submission_id = str(uuid.uuid4())
    await db.coding_submissions.insert_one({
        "submission_id": submission_id, "candidate_id": candidate_id,
        "question_id": str(uuid.uuid4()), "status": "completed",
        "score": 80.0, "quality_score": 71,
        "submitted_at": "2026-08-01T00:00:00+00:00",
    })
    try:
        report: dict = {}
        await _attach_coding_scores(report, {"candidate_id": candidate_id})
        assert report["coding_score"] == 80.0
        assert report["coding_quality_score"] == 71
        assert report["coding_submission_id"] == submission_id
    finally:
        await db.coding_submissions.delete_one({"submission_id": submission_id})


async def test_no_coding_submission_leaves_the_keys_absent(setup_test_db):
    """An unassigned candidate must not get a fabricated 0 — every consumer
    renders an absent dimension as "—"/"N/A"."""
    from services.hr_module.interview_engine import _attach_coding_scores

    report: dict = {}
    await _attach_coding_scores(report, {"candidate_id": str(uuid.uuid4())})
    assert "coding_score" not in report
    assert "coding_quality_score" not in report


async def test_attaching_coding_scores_never_raises(setup_test_db):
    """A missing coding score must never fail an otherwise-complete evaluation."""
    from services.hr_module.interview_engine import _attach_coding_scores

    report: dict = {"overall_score": 70}
    await _attach_coding_scores(report, {})
    assert report == {"overall_score": 70}
