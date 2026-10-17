import re
from pathlib import Path

import pytest

from routes.analytics import COST_CATEGORIES, _cost_categories, _empty_cost_summary

BACKEND = Path(__file__).resolve().parents[2]
ORDER = ["resume_parsing", "interviews", "reports", "voice", "job_descriptions", "coding", "offers", "matching", "email", "other"]


def src(cost, calls=1, items=0, entries=1):
    return {"cost_usd": cost, "calls": calls, "items": items, "entries": entries}


def build(by_source, **extra):
    args = {"email_cost": 0.0, "email_count": 0, "voice_cost": 0.0, "voice_calls": 0}
    args.update(extra)
    return {c["key"]: c for c in _cost_categories(by_source, **args)}


def test_every_area_is_listed_in_dashboard_order_even_when_nothing_was_spent():
    rows = _cost_categories({}, email_cost=0.0, email_count=0, voice_cost=0.0, voice_calls=0)
    assert [r["key"] for r in rows] == ORDER
    assert all(r["cost_usd"] == 0.0 and r["calls"] == 0 for r in rows)
    assert [r["label"] for r in rows] == [
        "Résumé parsing", "Interviews", "Report generation", "Interview voice", "Job descriptions", "Coding assessments",
        "Offers", "Matching", "Email", "Other",
    ]


def test_each_call_site_lands_in_its_own_area():
    areas = build({
        "resume_bulk": src(1.0, calls=100, items=100),
        "resume_classification": src(0.01, calls=1),
        "interview_question_gen": src(0.2, calls=4),
        "interview_evaluation": src(0.3, calls=3),
        "interview_followup_probe": src(0.05, calls=5),
        "interview_guide": src(0.1, calls=2),
        "interview_summary_draft": src(0.02, calls=2),
        "jd_parse": src(0.4, calls=8),
        "coding_question_generation": src(0.06, calls=1),
        "coding_quality_review": src(0.07, calls=2),
        "coding_correctness_review": src(0.08, calls=2),
        "offer_letter_drafting": src(0.09, calls=3),
        "match_second_opinion": src(0.11, calls=4),
        "embedding_reindex": src(0.12, calls=0),
    })
    assert areas["resume_parsing"]["cost_usd"] == pytest.approx(1.01) and areas["resume_parsing"]["calls"] == 101
    assert areas["interviews"]["cost_usd"] == pytest.approx(0.37) and areas["interviews"]["calls"] == 13
    assert areas["reports"]["cost_usd"] == pytest.approx(0.3) and areas["reports"]["calls"] == 3
    assert areas["job_descriptions"]["cost_usd"] == pytest.approx(0.4)
    assert areas["coding"]["cost_usd"] == pytest.approx(0.21) and areas["coding"]["calls"] == 5
    assert areas["offers"]["cost_usd"] == pytest.approx(0.09)
    assert areas["matching"]["cost_usd"] == pytest.approx(0.23) and areas["matching"]["calls"] == 4
    assert areas["other"]["cost_usd"] == 0.0


def test_a_source_nobody_listed_is_counted_under_other_rather_than_lost():
    areas = build({"jd_parse": src(0.4), "some_future_feature": src(0.25, calls=3), "another_one": src(0.05, calls=1)})
    assert areas["other"]["cost_usd"] == pytest.approx(0.30) and areas["other"]["calls"] == 4
    assert areas["job_descriptions"]["cost_usd"] == pytest.approx(0.4)


def test_voice_and_email_come_in_as_their_own_figures():
    areas = build({}, email_cost=0.2345, email_count=2345, voice_cost=0.4, voice_calls=8)
    assert areas["voice"] == {"key": "voice", "label": "Interview voice", "cost_usd": 0.4, "calls": 8}
    assert areas["email"] == {"key": "email", "label": "Email", "cost_usd": 0.2345, "calls": 2345}


def test_the_areas_add_up_to_what_was_spent():
    by_source = {
        "resume_bulk": src(1.234567, calls=50, items=50), "interview_evaluation": src(0.765432, calls=9),
        "jd_parse": src(0.1), "mystery": src(0.0000011), "offer_letter_drafting": src(0.3),
    }
    areas = _cost_categories(by_source, email_cost=0.0234, email_count=234, voice_cost=0.456789, voice_calls=7)
    spent = sum(s["cost_usd"] for s in by_source.values()) + 0.0234 + 0.456789
    assert sum(a["cost_usd"] for a in areas) == pytest.approx(spent, abs=1e-5)


def test_resume_parsing_says_how_many_resumes_it_covers_and_what_one_cost():
    areas = build({
        "resume_bulk": src(0.48, calls=200, items=200, entries=2),
        "resume_classification": src(0.0072, calls=3, entries=3),
    })
    parsing = areas["resume_parsing"]
    assert parsing["items"] == 203
    assert parsing["avg_item_usd"] == pytest.approx((0.48 + 0.0072) / 203, abs=1e-6)
    assert "items" not in areas["interviews"] and "avg_item_usd" not in areas["offers"]


def test_report_generation_says_how_many_reports_it_covers_and_what_one_cost():
    areas = build({
        "interview_evaluation": src(0.0117, calls=3, entries=3),
        "interview_question_gen": src(0.3, calls=3, entries=3),
    })
    reports = areas["reports"]
    assert reports["cost_usd"] == pytest.approx(0.0117) and reports["items"] == 3
    assert reports["avg_item_usd"] == pytest.approx(0.0039, abs=1e-6)
    assert areas["interviews"]["cost_usd"] == pytest.approx(0.3) and "items" not in areas["interviews"]


def test_report_generation_with_no_reports_has_no_average_to_divide_by():
    reports = build({})["reports"]
    assert reports["items"] == 0 and reports["avg_item_usd"] == 0.0 and reports["cost_usd"] == 0.0


def test_resume_parsing_with_nothing_processed_has_no_average_to_divide_by():
    parsing = build({})["resume_parsing"]
    assert parsing["items"] == 0 and parsing["avg_item_usd"] == 0.0


def test_a_ledger_row_with_missing_fields_counts_as_zero_not_an_error():
    areas = build({"jd_parse": {"cost_usd": None, "calls": None}, "interview_guide": {"cost_usd": 0.1}})
    assert areas["job_descriptions"]["cost_usd"] == 0.0 and areas["job_descriptions"]["calls"] == 0
    assert areas["interviews"]["cost_usd"] == pytest.approx(0.1)


def test_no_source_is_claimed_by_two_areas():
    claimed = [s for _, _, sources in COST_CATEGORIES for s in sources]
    assert len(claimed) == len(set(claimed))


def test_every_source_the_code_records_belongs_to_an_area():
    claimed = {s for _, _, sources in COST_CATEGORIES for s in sources}
    pattern = re.compile(r"(?:record_cost|track_llm_cost)\(\s*[\"']([a-z_]+)[\"']")
    found = set()
    for folder in ("routes", "services", "agents", "shared"):
        for path in (BACKEND / folder).rglob("*.py"):
            found.update(pattern.findall(path.read_text(encoding="utf-8")))
    assert found, "the scan found no call sites at all, so it checks nothing"
    assert found - claimed == set(), f"give these an area in COST_CATEGORIES: {sorted(found - claimed)}"


def test_the_empty_summary_has_the_same_areas_all_at_zero():
    summary = _empty_cost_summary()
    assert [c["key"] for c in summary["categories"]] == ORDER
    assert all(c["cost_usd"] == 0.0 for c in summary["categories"])
    assert summary["llm"]["embedding_tokens"] == 0
