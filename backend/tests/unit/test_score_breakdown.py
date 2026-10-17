import pytest

from services.hr_module.interview_engine import compute_score_breakdown
from config.settings import settings


def _dims(**scores) -> dict:
    return {name: {"score": score, "rationale": f"rationale for {name}"} for name, score in scores.items()}


def test_weights_sum_to_one_by_default():
    assert sum(settings.SCORE_DIMENSION_WEIGHTS.values()) == pytest.approx(1.0)


def test_perfect_integrity_uniform_dimensions_multiplier_is_one():
    breakdown = compute_score_breakdown(
        dimension_scores=_dims(
            technical=80, communication=80, problem_solving=80,
            cultural_fit=80, confidence=80,
        ),
        integrity_score=100,
        integrity_flags=[],
    )

    assert breakdown["integrity_multiplier"] == pytest.approx(1.0)
    assert breakdown["final_score"] == 80
    assert breakdown["integrity_deductions"] == []
    assert len(breakdown["dimensions"]) == 5
    names = {d["name"] for d in breakdown["dimensions"]}
    assert names == {"technical", "communication", "problem_solving", "cultural_fit", "confidence"}
    for dim in breakdown["dimensions"]:
        assert dim["weight"] == settings.SCORE_DIMENSION_WEIGHTS[dim["name"]]
        assert dim["rationale"] == f"rationale for {dim['name']}"


def test_mixed_scores_with_integrity_deductions_and_rounding():
    breakdown = compute_score_breakdown(
        dimension_scores=_dims(
            technical=90, communication=85, problem_solving=88,
            cultural_fit=92, confidence=78,
        ),
        integrity_score=60,
        integrity_flags=[
            "tab_switch@2026-09-29T10:15:00Z",
            "window_blur@2026-09-29T10:16:00Z",
            "face_detected@2026-09-29T10:17:00Z",
        ],
    )

    assert breakdown["integrity_multiplier"] == pytest.approx(0.84)
    assert breakdown["final_score"] == 74
    assert breakdown["integrity_deductions"] == [
        {"event": "tab_switch", "timestamp": "2026-09-29T10:15:00Z", "points": -10},
        {"event": "window_blur", "timestamp": "2026-09-29T10:16:00Z", "points": -8},
    ]


def test_unknown_event_uses_fallback_weight_and_missing_dimension_defaults_to_zero():
    breakdown = compute_score_breakdown(
        dimension_scores=_dims(technical=50, communication=50),
        integrity_score=97,
        integrity_flags=["mystery_event@2026-09-29T10:00:00Z"],
    )

    assert breakdown["integrity_deductions"] == [
        {"event": "mystery_event", "timestamp": "2026-09-29T10:00:00Z", "points": -3},
    ]
    missing = {d["name"]: d for d in breakdown["dimensions"] if d["name"] not in ("technical", "communication")}
    assert len(missing) == 3
    for dim in missing.values():
        assert dim["score"] == 0
        assert dim["rationale"] == ""


def test_integrity_multiplier_floor_bounds_a_zero_integrity_score():
    breakdown = compute_score_breakdown(
        dimension_scores=_dims(
            technical=100, communication=100, problem_solving=100,
            cultural_fit=100, confidence=100,
        ),
        integrity_score=0,
        integrity_flags=["terminated_tab_switches@2026-09-29T10:00:00Z"],
    )

    assert breakdown["integrity_multiplier"] == pytest.approx(settings.INTEGRITY_MULTIPLIER_FLOOR)
    assert breakdown["final_score"] == round(100 * settings.INTEGRITY_MULTIPLIER_FLOOR)
