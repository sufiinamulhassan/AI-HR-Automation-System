"""
Transcript-scoring regression — MVP2 §6.1.

`evaluate_interview()` built its prompt text from `msg['role']`/`msg['content']`,
but every transcript the live product has ever stored is
`{question, answer, answered_at}` (Interview.tsx → routes/interview.py, stored
verbatim). Both keys missed on every entry, so the scoring LLM received a block
of bare "[UNKNOWN]: " lines and produced overall/technical/communication/
problem-solving/cultural-fit scores, a summary and a hire recommendation with
zero grounding in what the candidate said.

§6.1 also noted why the 459-test suite stayed green: the only test exercising
this path hand-built `{role, content}` messages, and the only /submit test
posted an empty transcript. These tests assert on the REAL stored shape.
"""
import pytest

from services.hr_module.interview_engine import format_transcript

pytestmark = pytest.mark.anyio


_REAL = [
    {"question": "Tell me about your Python experience.",
     "answer": "Seven years, mostly FastAPI and asyncio services.",
     "answered_at": "2026-06-06T15:01:30Z"},
    {"question": "Describe a hard bug you fixed.",
     "answer": "A connection-pool leak under load that only showed up after an hour.",
     "answered_at": "2026-06-06T15:04:10Z"},
]

_CHAT = [
    {"role": "agent", "content": "Tell me about your Python experience."},
    {"role": "candidate", "content": "Seven years, mostly FastAPI and asyncio services."},
]


def test_question_answer_shape_reaches_the_prompt():
    """The bug in one assertion: this is the shape every real interview stores."""
    text = format_transcript(_REAL)

    assert "Seven years, mostly FastAPI and asyncio services." in text
    assert "Tell me about your Python experience." in text
    assert "connection-pool leak" in text
    assert "UNKNOWN" not in text, "transcript still rendering as [UNKNOWN] placeholder lines"


def test_chat_message_shape_still_works():
    """The older shape must keep working — the submit endpoint accepts
    list[dict[str, Any]], so an integrator can legitimately send it."""
    text = format_transcript(_CHAT)
    assert "Seven years, mostly FastAPI and asyncio services." in text
    assert "AGENT" in text and "CANDIDATE" in text


def test_mixed_and_junk_entries_are_handled():
    text = format_transcript([
        _REAL[0],
        _CHAT[0],
        {},
        {"answered_at": "x"},
        "not a dict",
    ])
    assert "Seven years" in text
    assert "Tell me about your Python experience." in text
    assert "UNKNOWN" not in text


def test_empty_transcript_yields_empty_text():
    assert format_transcript([]) == ""
    assert format_transcript([{}, {"answered_at": "x"}]) == ""


async def test_evaluation_refuses_to_score_an_empty_transcript():
    """No content → no fabricated scores.

    Score keys are left ABSENT rather than defaulted to 50, so the report and
    the PDF render "—"/"N/A" instead of a number that looks earned. Before this,
    an empty transcript still produced five confident scores and a hire
    recommendation.
    """
    from services.hr_module.interview_engine import evaluate_interview

    score, report = await evaluate_interview(
        transcript=[{}, {"answered_at": "2026-06-06T15:00:00Z"}],
        job={"title": "Backend Engineer"},
        candidate={"candidate_id": "no-such-candidate"},
        integrity_flags=[],
    )

    assert score == 0.0
    assert report["evaluation_status"] == "insufficient_transcript"
    for key in (
        "overall_score", "technical_score", "communication_score",
        "problem_solving_score", "cultural_fit_score", "confidence_score",
    ):
        assert key not in report, f"{key} was fabricated for an empty transcript"
    assert "integrity_score" in report


async def test_integrity_score_survives_an_empty_transcript():
    from services.hr_module.interview_engine import evaluate_interview

    _, clean = await evaluate_interview(
        transcript=[], job={}, candidate={}, integrity_flags=[],
    )
    _, flagged = await evaluate_interview(
        transcript=[], job={}, candidate={},
        integrity_flags=["tab_switch@2026-06-06T15:00:00Z", "screen_share_detected@2026-06-06T15:02:00Z"],
    )
    assert flagged["integrity_score"] < clean["integrity_score"]
