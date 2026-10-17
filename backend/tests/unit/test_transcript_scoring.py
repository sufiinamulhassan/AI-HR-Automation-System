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
    text = format_transcript(_REAL)

    assert "Seven years, mostly FastAPI and asyncio services." in text
    assert "Tell me about your Python experience." in text
    assert "connection-pool leak" in text
    assert "UNKNOWN" not in text, "transcript still rendering as [UNKNOWN] placeholder lines"


def test_chat_message_shape_still_works():
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


async def test_evaluate_interview_produces_score_breakdown_and_rationales(monkeypatch):
    import json
    import services.hr_module.interview_engine as interview_engine

    eval_response = json.dumps({
        "overall_score": 82,
        "technical_score": 80, "technical_rationale": "Explained the caching layer clearly.",
        "communication_score": 75, "communication_rationale": "Structured, concise answers.",
        "problem_solving_score": 78, "problem_solving_rationale": "Diagnosed the root cause methodically.",
        "cultural_fit_score": 70, "cultural_fit_rationale": "Described collaborative habits.",
        "confidence_score": 65, "confidence_rationale": "Some hesitation on edge cases.",
        "strengths": ["Clear diagnostic reasoning"],
        "areas_for_improvement": ["More depth on caching strategy"],
        "recommendation": "hire",
        "summary": "Strong, structured technical answer.",
        "integrity_assessment": "No flags raised.",
    })

    async def fake_ask_llm(*args, **kwargs):
        return eval_response

    monkeypatch.setattr(interview_engine, "ask_llm", fake_ask_llm)

    score, report = await interview_engine.evaluate_interview(
        transcript=_REAL, job={"title": "Backend Engineer"}, candidate={},
        integrity_flags=["tab_switch@2026-06-06T15:00:00Z"],
    )

    assert score == 82.0
    assert report["overall_score"] == 82
    assert report["technical_score"] == 80
    assert report["communication_score"] == 75
    assert report["problem_solving_score"] == 78
    assert report["cultural_fit_score"] == 70
    assert report["confidence_score"] == 65
    assert report["technical_rationale"] == "Explained the caching layer clearly."

    breakdown = report["score_breakdown"]
    assert {d["name"] for d in breakdown["dimensions"]} == {
        "technical", "communication", "problem_solving", "cultural_fit", "confidence",
    }
    assert breakdown["integrity_deductions"] == [
        {"event": "tab_switch", "timestamp": "2026-06-06T15:00:00Z", "points": -10},
    ]
    assert report["final_score"] == breakdown["final_score"]


def test_resolve_report_status_defaults_missing_field_to_ready_when_report_exists():
    from services.hr_module.interview_engine import resolve_report_status

    old_style_report = {"report": {"overall_score": 70}}
    assert resolve_report_status(old_style_report) == "ready"


def test_resolve_report_status_stays_none_when_never_evaluated():
    from services.hr_module.interview_engine import resolve_report_status

    never_evaluated = {"status": "invited"}
    assert resolve_report_status(never_evaluated) is None


def test_resolve_report_status_respects_explicit_value():
    from services.hr_module.interview_engine import resolve_report_status

    failed = {"report": None, "report_status": "failed", "report_error": "boom"}
    assert resolve_report_status(failed) == "failed"

    ready = {"report": {"overall_score": 90}, "report_status": "ready"}
    assert resolve_report_status(ready) == "ready"


async def test_evaluate_interview_degrades_gracefully_on_llm_timeout(monkeypatch):
    import httpx
    import openai
    import config.llm as llm_module
    from services.hr_module.interview_engine import evaluate_interview

    class _RaisingCompletions:
        async def create(self, **kwargs):
            request = httpx.Request("POST", "https://api.openai.com/v1/chat/completions")
            raise openai.APITimeoutError(request=request)

    class _RaisingChat:
        completions = _RaisingCompletions()

    class _RaisingOpenAIClient:
        chat = _RaisingChat()

    import anthropic

    class _RaisingMessages:
        async def create(self, **kwargs):
            request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
            raise anthropic.APITimeoutError(request=request)

    class _RaisingAnthropicClient:
        messages = _RaisingMessages()

    monkeypatch.setattr(llm_module, "get_openai_client", lambda: _RaisingOpenAIClient())
    monkeypatch.setattr(llm_module, "get_anthropic_client", lambda: _RaisingAnthropicClient())

    score, report = await evaluate_interview(
        transcript=_REAL, job={"title": "Backend Engineer"}, candidate={},
        integrity_flags=["tab_switch@2026-06-06T15:00:00Z"],
    )

    assert score == 50.0
    assert report["overall_score"] == 50
    assert report["technical_score"] == 50
    assert report["technical_rationale"] == ""
    assert report["recommendation"] == "maybe"
    assert "score_breakdown" in report
    assert report["final_score"] is not None
