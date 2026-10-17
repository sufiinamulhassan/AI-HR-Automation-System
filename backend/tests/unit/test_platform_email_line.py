import pytest

from config.settings import settings
from services.hr_module import platform_service as svc

RATE = 0.0001


@pytest.fixture(autouse=True)
def rate(monkeypatch):
    monkeypatch.setattr(settings, "EMAIL_ESTIMATED_COST_PER_EMAIL", RATE)


def usage(total_emails: int, window_emails: int = 0) -> svc.Usage:
    entry = svc.Usage()
    entry.total["emails"] = total_emails
    entry.window["emails"] = window_emails
    return entry


LEDGER = [
    {"source": "jd_parse", "cost_usd": 0.3022, "calls": 55},
    {"source": "interview_tts", "cost_usd": 0.0047, "calls": 2},
    {"source": "resume_bulk", "cost_usd": 0.0036, "calls": 14},
]


def test_a_window_gets_all_the_mail_ever_sent_as_one_line():
    rows = svc._with_email_estimate(LEDGER, usage(9, window_emails=3), svc.window_period(30))
    line = next(r for r in rows if r["source"] == "email_estimated")
    assert line == {"source": "email_estimated", "cost_usd": pytest.approx(9 * RATE), "calls": 9, "unit": "emails"}


def test_a_calendar_month_gets_only_that_months_mail():
    rows = svc._with_email_estimate(LEDGER, usage(9, window_emails=3), svc.month_period("2026-03"))
    line = next(r for r in rows if r["source"] == "email_estimated")
    assert (line["calls"], line["cost_usd"]) == (3, pytest.approx(3 * RATE))


def test_the_lines_add_up_to_the_total_cost_the_dashboard_shows():
    ai = sum(r["cost_usd"] for r in LEDGER)
    rows = svc._with_email_estimate(LEDGER, usage(9), svc.window_period(30))
    assert sum(r["cost_usd"] for r in rows) == pytest.approx(svc._cost_fields(ai, 9)["total_cost_usd"])
    assert svc._cost_fields(ai, 9) == {"email_cost_usd": pytest.approx(0.0009), "total_cost_usd": pytest.approx(0.3114)}


def test_the_dashboards_own_total_is_reproduced():
    assert svc._cost_fields(0.3330, 9)["total_cost_usd"] == pytest.approx(0.3339)


def test_the_lines_stay_largest_first():
    rows = svc._with_email_estimate(LEDGER, usage(100), svc.window_period(30))
    costs = [r["cost_usd"] for r in rows]
    assert costs == sorted(costs, reverse=True)
    assert [r["source"] for r in rows][:2] == ["jd_parse", "email_estimated"]


def test_nothing_is_added_when_no_mail_went_out_or_the_estimate_is_off(monkeypatch):
    assert svc._with_email_estimate(LEDGER, usage(0), svc.window_period(30)) == LEDGER
    monkeypatch.setattr(settings, "EMAIL_ESTIMATED_COST_PER_EMAIL", 0.0)
    assert svc._with_email_estimate(LEDGER, usage(9), svc.window_period(30)) == LEDGER
    assert svc._cost_fields(0.333, 9) == {"email_cost_usd": 0.0, "total_cost_usd": 0.333}


def test_the_ledger_lines_are_not_changed_in_place():
    before = [dict(r) for r in LEDGER]
    svc._with_email_estimate(LEDGER, usage(9), svc.window_period(30))
    assert LEDGER == before
