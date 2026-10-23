from datetime import date, timedelta
from types import SimpleNamespace

import pytest
from httpx import ASGITransport, AsyncClient

import config.database as database
from config import tenancy
from config.settings import settings
from fake_mongo import FakeRaw
from main import app
from services.hr_module import people_insights_service as insights

pytestmark = pytest.mark.anyio

API = "/api/v1/hrms"
ADMIN = {"Authorization": "Bearer demo-superadmin-token"}
STANDARD = {"Authorization": "Bearer demo-standard-token"}
COMPANY = tenancy.DEFAULT_COMPANY_ID
TODAY = date.today()


def iso(days_ago: int) -> str:
    return (TODAY - timedelta(days=days_ago)).isoformat()


def last_weekday(weekday: int, weeks_back: int = 1) -> date:
    d = TODAY - timedelta(days=(TODAY.weekday() - weekday) % 7 or 7)
    return d - timedelta(weeks=weeks_back - 1)


def test_pearson_and_its_plain_language_label():
    assert insights.pearson([1, 2, 3], [2, 4, 6]) == 1.0
    assert insights.pearson([1, 2], [1, 2]) is None
    assert insights.pearson([1, 1, 1], [1, 2, 3]) is None
    assert "predict performance well" in insights.correlation_label(0.8)
    assert "do not predict" in insights.correlation_label(0.0)
    assert "Not enough" in insights.correlation_label(None)


def test_attendance_rate_ignores_leave_and_counts_half_days():
    rows = [{"status": "present"}, {"status": "half_day"}, {"status": "absent"}, {"status": "on_leave"}]
    assert insights.attendance_rate(rows) == 50.0
    assert insights.attendance_rate([{"status": "on_leave"}]) is None


def test_verdicts():
    assert insights.verdict(80, 400) == "Strong hire"
    assert insights.verdict(55, 400) == "On track"
    assert insights.verdict(30, 400) == "Below expectations"
    assert insights.verdict(None, 30) == "Too early to tell"
    assert insights.verdict(None, 300) == "No review yet"


@pytest.fixture
async def world(monkeypatch):
    raw = FakeRaw()
    monkeypatch.setattr(database, "_db", raw)
    monkeypatch.setattr(tenancy, "_fallback_company_id", None)
    monkeypatch.setattr(settings, "ALLOW_DEMO_AUTH", True)
    monkeypatch.setattr(settings, "HACKATHON_DEMO_MODE", False)
    monkeypatch.setattr(settings, "DEMO_COMPANY_ID", "")
    raw.add("departments", {"department_id": "d-eng", "name": "Engineering"}, COMPANY)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as client:
        yield SimpleNamespace(raw=raw, client=client)


def employee(world, eid, name, joined_days_ago=400, **extra):
    world.raw.add("employees", {
        "employee_id": eid, "full_name": name, "status": "active", "joined_on": iso(joined_days_ago),
        "created_at": iso(joined_days_ago), "manager_id": "boss", **extra,
    }, COMPANY)


def review(world, eid, *ratings):
    world.raw.add("performance_reviews", {
        "review_id": f"rv-{eid}-{len(ratings)}", "employee_id": eid, "status": "submitted",
        "ratings": {f"d{i}": r for i, r in enumerate(ratings)}, "submitted_at": iso(10),
    }, COMPANY)


def hired(world, eid, name, interview, match, *ratings):
    world.raw.add("candidates", {"candidate_id": f"c-{eid}", "name": name, "final_score": interview, "match_score": match}, COMPANY)
    employee(world, eid, name, candidate_id=f"c-{eid}", offer_id=f"o-{eid}")
    if ratings:
        review(world, eid, *ratings)


async def test_hire_quality_links_hiring_scores_to_performance(world):
    hired(world, "a", "Ana", 90, 0.8, 5, 5)
    hired(world, "b", "Ben", 75, 0.7, 4, 4)
    hired(world, "c", "Cy", 50, 0.6, 2, 2)
    hired(world, "d", "Dee", 40, 0.5)
    employee(world, "m", "Manual Person")
    response = await world.client.get(f"{API}/insights/hire-quality", headers=ADMIN)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["hired_through_hirely"] == 4 and body["with_review"] == 3 and body["paired"] == 3
    assert body["correlation"] > 0.9 and "well" in body["correlation_label"]
    assert body["strong_interview_performance"] == 87.5 and body["other_interview_performance"] == 25.0
    first = body["rows"][0]
    assert (first["full_name"], first["interview_score"], first["match_score"], first["performance_score"], first["verdict"]) == ("Ana", 90, 80, 100, "Strong hire")
    assert body["rows"][-1]["full_name"] == "Dee" and body["rows"][-1]["verdict"] == "No review yet"


async def test_hire_quality_uses_the_companys_rating_scale(world):
    world.raw.add("system_config", {"key": "performance_rating_scale", "scale_min": 1, "scale_max": 10}, COMPANY)
    hired(world, "a", "Ana", 80, 0.8, 10)
    body = (await world.client.get(f"{API}/insights/hire-quality", headers=ADMIN)).json()
    assert body["rows"][0]["performance_score"] == 100


async def test_an_external_interview_score_is_not_used(world):
    world.raw.add("candidates", {"candidate_id": "c-x", "name": "X", "final_score": 99, "interview_mode": "external"}, COMPANY)
    employee(world, "x", "X", candidate_id="c-x")
    body = (await world.client.get(f"{API}/insights/hire-quality", headers=ADMIN)).json()
    assert body["rows"][0]["interview_score"] is None


async def test_risk_radar_explains_each_signal(world):
    employee(world, "boss", "Boss", manager_id=None)
    employee(world, "r", "Risky", manager_id=None)
    for weekday, weeks in ((0, 1), (4, 2), (0, 3)):
        d = last_weekday(weekday, weeks).isoformat()
        world.raw.add("leave_requests", {"request_id": f"l{weeks}", "employee_id": "r", "leave_type_name": "Sick leave", "start_date": d, "end_date": d, "status": "approved", "days": 1}, COMPANY)
    for i in range(40, 60):
        world.raw.add("attendance", {"employee_id": "r", "date": iso(i), "status": "present"}, COMPANY)
    for i in range(1, 6):
        world.raw.add("attendance", {"employee_id": "r", "date": iso(i), "status": "absent"}, COMPANY)
    review(world, "r", 1, 2)
    response = await world.client.get(f"{API}/insights/risk", headers=ADMIN)
    assert response.status_code == 200, response.text
    body = response.json()
    top = body["rows"][0]
    assert top["full_name"] == "Risky" and top["level"] == "high"
    texts = " | ".join(s["text"] for s in top["signals"])
    assert "Monday or Friday" in texts and "unplanned absences" in texts and "Attendance fell from 100% to 0%" in texts
    assert "No manager assigned" in texts and "performance score is 12.5 out of 100" in texts
    assert body["counts"]["high"] == 1


async def test_risk_radar_flags_burnout_from_long_days_and_no_leave(world):
    employee(world, "boss", "Boss", manager_id=None)
    employee(world, "w", "Workaholic")
    for i in range(1, 11):
        world.raw.add("attendance", {"employee_id": "w", "date": iso(i), "status": "present", "check_in": "08:00", "check_out": "19:30"}, COMPANY)
    review(world, "w", 4)
    body = (await world.client.get(f"{API}/insights/risk", headers=ADMIN)).json()
    row = next(r for r in body["rows"] if r["full_name"] == "Workaholic")
    assert row["burnout"] is True and row["level"] == "medium"
    assert {s["text"] for s in row["signals"]} == {"Averaging 11.5 hour days over the last 30 days", "No leave taken in the last 120 days"}
    assert body["burnout"] >= 1


async def test_a_new_joiner_with_a_manager_is_low_risk(world):
    employee(world, "boss", "Boss", manager_id=None)
    employee(world, "n", "Newbie", joined_days_ago=20)
    row = next(r for r in (await world.client.get(f"{API}/insights/risk", headers=ADMIN)).json()["rows"] if r["full_name"] == "Newbie")
    assert row["level"] == "low" and [s["text"] for s in row["signals"]] == ["In the first 90 days, when people are most likely to leave"]


async def test_exited_people_are_left_out_of_the_radar(world):
    employee(world, "gone", "Gone", status="exited", exited_on=iso(5))
    assert (await world.client.get(f"{API}/insights/risk", headers=ADMIN)).json()["rows"] == []


def next_monday() -> date:
    return TODAY + timedelta(days=(7 - TODAY.weekday()) % 7 or 7)


async def test_coverage_warns_when_most_of_the_team_is_off(world):
    for eid in ("a", "b", "c", "d"):
        employee(world, eid, eid.upper(), department="d-eng")
    employee(world, "z", "Other team")
    mon = next_monday()
    for eid in ("b", "c"):
        world.raw.add("leave_requests", {"request_id": f"r{eid}", "employee_id": eid, "leave_type_name": "Annual leave", "start_date": mon.isoformat(), "end_date": mon.isoformat(), "status": "approved"}, COMPANY)
    world.raw.add("leave_requests", {"request_id": "mine", "employee_id": "a", "leave_type_name": "Annual leave", "start_date": mon.isoformat(), "end_date": (mon + timedelta(days=1)).isoformat(), "status": "pending"}, COMPANY)
    response = await world.client.get(f"{API}/leave-requests/mine/coverage", headers=ADMIN)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["team"] == "Engineering" and body["team_size"] == 4 and body["warning"] is True
    monday, tuesday = body["days"]
    assert sorted(o["full_name"] for o in monday["off"]) == ["B", "C"]
    assert (monday["available"], monday["coverage"], monday["low"]) == (1, 0.25, True)
    assert (tuesday["available"], tuesday["low"]) == (3, False)
    assert body["worst"]["date"] == mon.isoformat() and body["low_days"] == 1


async def test_coverage_check_before_a_request_exists(world):
    employee(world, "a", "A", department="d-eng")
    employee(world, "b", "B", department="d-eng")
    mon = next_monday().isoformat()
    body = (await world.client.get(f"{API}/coverage?employee_id=a&start_date={mon}", headers=ADMIN)).json()
    assert body["team_size"] == 2 and body["days"][0]["available"] == 1 and body["warning"] is False


async def test_coverage_for_an_unknown_request_is_404(world):
    assert (await world.client.get(f"{API}/leave-requests/nope/coverage", headers=ADMIN)).status_code == 404


async def test_recruiters_cannot_see_risk_or_hire_quality(world):
    assert (await world.client.get(f"{API}/insights/risk", headers=STANDARD)).status_code == 403
    assert (await world.client.get(f"{API}/insights/hire-quality", headers=STANDARD)).status_code == 403


async def test_someone_at_the_top_with_reports_is_not_flagged_for_having_no_manager(world):
    employee(world, "ceo", "Chief", manager_id=None)
    employee(world, "rep", "Report", manager_id="ceo")
    employee(world, "solo", "Solo", manager_id=None)
    rows = {r["full_name"]: r for r in (await world.client.get(f"{API}/insights/risk", headers=ADMIN)).json()["rows"]}
    assert "No manager assigned" not in [s["text"] for s in rows["Chief"]["signals"]]
    assert "No manager assigned" in [s["text"] for s in rows["Solo"]["signals"]]
