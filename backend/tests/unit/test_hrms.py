from datetime import date, timedelta
from types import SimpleNamespace

import pytest
from httpx import ASGITransport, AsyncClient

import config.database as database
from config import tenancy
from config.settings import settings
from fake_mongo import FakeRaw
from main import app
from services.hr_module import workforce_service as ws

pytestmark = pytest.mark.anyio

API = "/api/v1/hrms"
ADMIN = {"Authorization": "Bearer demo-superadmin-token"}
HR = {"Authorization": "Bearer demo-admin-token"}
STANDARD = {"Authorization": "Bearer demo-standard-token"}
COMPANY = tenancy.DEFAULT_COMPANY_ID
OTHER = "cmp_other"


def monday_before(day: date, weeks: int = 1) -> date:
    return day - timedelta(days=day.weekday()) - timedelta(weeks=weeks)


MON = monday_before(date.today())
FRI = MON + timedelta(days=4)


def test_working_days_skip_weekends_and_holidays():
    days = ws.working_days(MON, MON + timedelta(days=6), {MON + timedelta(days=2)})
    assert [d.weekday() for d in days] == [0, 1, 3, 4]
    assert ws.leave_length(MON, MON, set(), half_day=True) == 0.5
    assert ws.leave_length(MON + timedelta(days=5), MON + timedelta(days=6), set()) == 0


def test_dates_must_be_iso():
    with pytest.raises(ws.WorkforceError):
        ws.parse_day("12/01/2026")


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


async def add_person(world, name, **extra):
    body = {"full_name": name, "joined_on": (MON - timedelta(days=60)).isoformat(), **extra}
    response = await world.client.post(f"{API}/employees", json=body, headers=ADMIN)
    assert response.status_code == 200, response.text
    return response.json()


async def leave_type(world, code="annual"):
    types = (await world.client.get(f"{API}/leave-types", headers=ADMIN)).json()["leave_types"]
    return next(t for t in types if t["code"] == code)


async def test_hr_adds_an_employee_and_finds_them_in_the_directory(world):
    ana = await add_person(world, "Ana Ruiz", email="ANA@acme.io", department="d-eng", designation="Engineer")
    assert ana["email"] == "ana@acme.io" and ana["department_name"] == "Engineering" and ana["status"] == "active"
    assert ana["source"] == "manual" and ana["employment_type"] == "full_time"
    listed = (await world.client.get(f"{API}/employees?q=engin", headers=ADMIN)).json()
    assert [e["full_name"] for e in listed["employees"]] == ["Ana Ruiz"]
    assert "company_id" not in str(listed)


async def test_an_employee_hired_through_an_offer_shows_with_the_candidate_name(world):
    world.raw.add("candidates", {"candidate_id": "c1", "name": "Ben Cole", "email": "ben@x.io", "job_title": "Analyst"}, COMPANY)
    world.raw.add("employees", {"employee_id": "e-offer", "candidate_id": "c1", "offer_id": "o1", "status": "active", "hired_at": "2026-01-01T00:00:00+00:00", "created_at": "2026-01-01"}, COMPANY)
    people = (await world.client.get(f"{API}/employees", headers=ADMIN)).json()["employees"]
    assert people[0]["full_name"] == "Ben Cole" and people[0]["source"] == "offer" and people[0]["designation"] == "Analyst"


async def test_another_companys_employees_never_show(world):
    world.raw.add("employees", {"employee_id": "e-x", "full_name": "Foreign", "status": "active", "created_at": "x"}, OTHER)
    assert (await world.client.get(f"{API}/employees", headers=ADMIN)).json()["total"] == 0
    assert (await world.client.get(f"{API}/employees/e-x", headers=ADMIN)).status_code == 404


@pytest.mark.parametrize("body,message", [
    ({"full_name": ""}, "full_name is required."),
    ({"full_name": "A", "email": "nope"}, "email is not a valid address."),
    ({"full_name": "A", "employment_type": "slave"}, "employment_type must be one of"),
    ({"full_name": "A", "joined_on": "soon"}, "joined_on must be a date"),
])
async def test_invalid_employees_are_rejected(world, body, message):
    response = await world.client.post(f"{API}/employees", json=body, headers=ADMIN)
    assert response.status_code == 400 and message in response.json()["detail"]


async def test_two_employees_cannot_share_an_email(world):
    await add_person(world, "Ana", email="a@x.io")
    response = await world.client.post(f"{API}/employees", json={"full_name": "B", "email": "a@x.io"}, headers=ADMIN)
    assert response.status_code == 409


async def test_manager_is_shown_by_name_and_cannot_be_self(world):
    boss = await add_person(world, "Boss")
    ana = await add_person(world, "Ana", manager_id=boss["employee_id"])
    assert ana["manager_name"] == "Boss"
    response = await world.client.patch(f"{API}/employees/{ana['employee_id']}", json={"manager_id": ana["employee_id"]}, headers=ADMIN)
    assert response.status_code == 400


async def test_editing_changes_only_the_fields_sent(world):
    ana = await add_person(world, "Ana", phone="123", designation="Engineer")
    response = await world.client.patch(f"{API}/employees/{ana['employee_id']}", json={"designation": "Lead"}, headers=ADMIN)
    assert response.status_code == 200
    assert response.json()["designation"] == "Lead" and response.json()["phone"] == "123"
    assert (await world.client.patch(f"{API}/employees/{ana['employee_id']}", json={"status": "exited"}, headers=ADMIN)).status_code == 400


async def test_offboarding_records_the_exit_and_frees_their_reports(world):
    boss = await add_person(world, "Boss")
    ana = await add_person(world, "Ana", manager_id=boss["employee_id"])
    response = await world.client.post(
        f"{API}/employees/{boss['employee_id']}/offboard", json={"exited_on": MON.isoformat(), "reason": "Moved"}, headers=ADMIN,
    )
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "exited" and response.json()["exit_reason"] == "Moved"
    assert (await world.client.get(f"{API}/employees/{ana['employee_id']}", headers=ADMIN)).json()["manager_id"] is None
    again = await world.client.post(f"{API}/employees/{boss['employee_id']}/offboard", json={"exited_on": MON.isoformat()}, headers=ADMIN)
    assert again.status_code == 409


async def test_default_leave_types_are_created_once(world):
    first = (await world.client.get(f"{API}/leave-types", headers=ADMIN)).json()["leave_types"]
    second = (await world.client.get(f"{API}/leave-types", headers=ADMIN)).json()["leave_types"]
    assert {(t["code"], t["annual_allowance"]) for t in first} == {("annual", 14), ("sick", 8), ("casual", 6)}
    assert len(second) == 3


async def test_leave_counts_working_days_only_and_updates_the_balance(world):
    ana = await add_person(world, "Ana")
    annual = await leave_type(world)
    await world.client.post(f"{API}/holidays", json={"date": (MON + timedelta(days=2)).isoformat(), "name": "Founders Day"}, headers=ADMIN)
    response = await world.client.post(f"{API}/leave-requests", json={
        "employee_id": ana["employee_id"], "leave_type_id": annual["leave_type_id"],
        "start_date": MON.isoformat(), "end_date": (MON + timedelta(days=6)).isoformat(),
    }, headers=ADMIN)
    assert response.status_code == 200, response.text
    request = response.json()
    assert request["days"] == 4 and request["status"] == "pending" and request["employee_name"] == "Ana"
    profile = (await world.client.get(f"{API}/employees/{ana['employee_id']}?year={MON.year}", headers=ADMIN)).json()
    balance = next(b for b in profile["leave_balances"] if b["leave_type_id"] == annual["leave_type_id"])
    assert (balance["pending"], balance["used"], balance["remaining"]) == (4, 0, 10)


async def test_approving_leave_marks_those_days_on_leave_and_cancelling_clears_them(world):
    ana = await add_person(world, "Ana")
    sick = await leave_type(world, "sick")
    request = (await world.client.post(f"{API}/leave-requests", json={
        "employee_id": ana["employee_id"], "leave_type_id": sick["leave_type_id"],
        "start_date": MON.isoformat(), "end_date": (MON + timedelta(days=1)).isoformat(),
    }, headers=ADMIN)).json()
    approved = await world.client.post(f"{API}/leave-requests/{request['request_id']}/approve", json={"note": "Get well"}, headers=ADMIN)
    assert approved.status_code == 200 and approved.json()["status"] == "approved"
    sheet = (await world.client.get(f"{API}/attendance?date={MON.isoformat()}", headers=ADMIN)).json()
    assert sheet["rows"][0]["record"]["status"] == "on_leave" and sheet["counts"]["on_leave"] == 1
    assert (await world.client.post(f"{API}/leave-requests/{request['request_id']}/approve", headers=ADMIN)).status_code == 409

    cancelled = await world.client.post(f"{API}/leave-requests/{request['request_id']}/cancel", headers=ADMIN)
    assert cancelled.json()["status"] == "cancelled"
    sheet = (await world.client.get(f"{API}/attendance?date={MON.isoformat()}", headers=ADMIN)).json()
    assert sheet["rows"][0]["record"] is None


async def test_rejected_leave_does_not_use_the_balance(world):
    ana = await add_person(world, "Ana")
    casual = await leave_type(world, "casual")
    request = (await world.client.post(f"{API}/leave-requests", json={
        "employee_id": ana["employee_id"], "leave_type_id": casual["leave_type_id"], "start_date": MON.isoformat(),
    }, headers=ADMIN)).json()
    rejected = await world.client.post(f"{API}/leave-requests/{request['request_id']}/reject", headers=ADMIN)
    assert rejected.json()["status"] == "rejected"
    profile = (await world.client.get(f"{API}/employees/{ana['employee_id']}?year={MON.year}", headers=ADMIN)).json()
    balance = next(b for b in profile["leave_balances"] if b["leave_type_id"] == casual["leave_type_id"])
    assert balance["remaining"] == 6


async def test_overlapping_and_over_balance_requests_are_blocked(world):
    ana = await add_person(world, "Ana")
    casual = await leave_type(world, "casual")
    base = {"employee_id": ana["employee_id"], "leave_type_id": casual["leave_type_id"]}
    ok = await world.client.post(f"{API}/leave-requests", json={**base, "start_date": MON.isoformat(), "end_date": FRI.isoformat()}, headers=ADMIN)
    assert ok.status_code == 200
    overlap = await world.client.post(f"{API}/leave-requests", json={**base, "start_date": FRI.isoformat()}, headers=ADMIN)
    assert overlap.status_code == 409
    later = MON + timedelta(weeks=3)
    too_much = await world.client.post(f"{API}/leave-requests", json={**base, "start_date": later.isoformat(), "end_date": (later + timedelta(days=1)).isoformat()}, headers=ADMIN)
    assert too_much.status_code == 400 and "Only 1 day(s)" in too_much.json()["detail"]


@pytest.mark.parametrize("dates,message", [
    ({"start_date": "2026-03-10", "end_date": "2026-03-09"}, "end date cannot be before"),
    ({"start_date": "2026-12-31", "end_date": "2027-01-02"}, "crosses the new year"),
])
async def test_invalid_leave_dates_are_rejected(world, dates, message):
    ana = await add_person(world, "Ana")
    annual = await leave_type(world)
    response = await world.client.post(f"{API}/leave-requests", json={"employee_id": ana["employee_id"], "leave_type_id": annual["leave_type_id"], **dates}, headers=ADMIN)
    assert response.status_code == 400 and message in response.json()["detail"]


async def test_a_weekend_only_request_is_rejected(world):
    ana = await add_person(world, "Ana")
    annual = await leave_type(world)
    sat = MON + timedelta(days=5)
    response = await world.client.post(f"{API}/leave-requests", json={"employee_id": ana["employee_id"], "leave_type_id": annual["leave_type_id"], "start_date": sat.isoformat(), "end_date": (sat + timedelta(days=1)).isoformat()}, headers=ADMIN)
    assert response.status_code == 400 and "weekends or holidays" in response.json()["detail"]


async def test_hr_can_add_a_leave_type_and_change_an_allowance(world):
    created = await world.client.post(f"{API}/leave-types", json={"name": "Study leave", "annual_allowance": 5}, headers=ADMIN)
    assert created.status_code == 200 and created.json()["code"] == "study_leave"
    annual = await leave_type(world)
    changed = await world.client.patch(f"{API}/leave-types/{annual['leave_type_id']}", json={"annual_allowance": 20}, headers=ADMIN)
    assert changed.json()["annual_allowance"] == 20
    bad = await world.client.patch(f"{API}/leave-types/{annual['leave_type_id']}", json={"annual_allowance": 500}, headers=ADMIN)
    assert bad.status_code == 400


async def test_attendance_is_marked_once_per_day_and_summarised_for_the_month(world):
    ana = await add_person(world, "Ana")
    ben = await add_person(world, "Ben")
    mark = lambda **b: world.client.put(f"{API}/attendance", json=b, headers=ADMIN)
    first = await mark(employee_id=ana["employee_id"], date=MON.isoformat(), status="present", check_in="09:00", check_out="17:30")
    assert first.status_code == 200, first.text
    again = await mark(employee_id=ana["employee_id"], date=MON.isoformat(), status="remote", check_in="10:00", check_out="18:00")
    assert again.json()["status"] == "remote"
    await mark(employee_id=ben["employee_id"], date=MON.isoformat(), status="absent", check_in="09:00")
    sheet = (await world.client.get(f"{API}/attendance?date={MON.isoformat()}", headers=ADMIN)).json()
    assert sheet["counts"]["remote"] == 1 and sheet["counts"]["absent"] == 1 and sheet["counts"]["unmarked"] == 0
    ben_row = next(r for r in sheet["rows"] if r["full_name"] == "Ben")
    assert ben_row["record"]["check_in"] is None
    assert len([r for r in world.raw["attendance"].docs if r["employee_id"] == ana["employee_id"]]) == 1

    summary = (await world.client.get(f"{API}/attendance/summary?year={MON.year}&month={MON.month}", headers=ADMIN)).json()
    ana_row = next(r for r in summary["rows"] if r["full_name"] == "Ana")
    assert ana_row["remote"] == 1 and ana_row["hours"] == 8.0


@pytest.mark.parametrize("body,status", [
    ({"status": "sleeping"}, 400),
    ({"status": "present", "check_in": "9am"}, 400),
    ({"status": "present", "check_in": "18:00", "check_out": "09:00"}, 400),
])
async def test_invalid_attendance_is_rejected(world, body, status):
    ana = await add_person(world, "Ana")
    response = await world.client.put(f"{API}/attendance", json={"employee_id": ana["employee_id"], "date": MON.isoformat(), **body}, headers=ADMIN)
    assert response.status_code == status


async def test_attendance_cannot_be_marked_in_the_future(world):
    ana = await add_person(world, "Ana")
    tomorrow = (date.today() + timedelta(days=1)).isoformat()
    response = await world.client.put(f"{API}/attendance", json={"employee_id": ana["employee_id"], "date": tomorrow, "status": "present"}, headers=ADMIN)
    assert response.status_code == 400


async def test_holidays_are_listed_by_year_and_a_date_holds_one_holiday(world):
    first = await world.client.post(f"{API}/holidays", json={"date": "2026-08-14", "name": "Independence Day"}, headers=ADMIN)
    assert first.status_code == 200
    assert (await world.client.post(f"{API}/holidays", json={"date": "2026-08-14", "name": "Dup"}, headers=ADMIN)).status_code == 409
    await world.client.post(f"{API}/holidays", json={"date": "2027-01-01", "name": "New Year"}, headers=ADMIN)
    listed = (await world.client.get(f"{API}/holidays?year=2026", headers=ADMIN)).json()["holidays"]
    assert [h["name"] for h in listed] == ["Independence Day"]
    deleted = await world.client.delete(f"{API}/holidays/{first.json()['holiday_id']}", headers=ADMIN)
    assert deleted.status_code == 200
    assert (await world.client.delete(f"{API}/holidays/{first.json()['holiday_id']}", headers=ADMIN)).status_code == 404


async def test_the_overview_counts_people_leave_and_departments(world):
    ana = await add_person(world, "Ana", department="d-eng")
    await add_person(world, "Ben")
    ex = await add_person(world, "Cy")
    await world.client.post(f"{API}/employees/{ex['employee_id']}/offboard", json={"exited_on": MON.isoformat()}, headers=ADMIN)
    annual = await leave_type(world)
    today = date.today()
    if today.weekday() < 5:
        request = (await world.client.post(f"{API}/leave-requests", json={"employee_id": ana["employee_id"], "leave_type_id": annual["leave_type_id"], "start_date": today.isoformat()}, headers=ADMIN)).json()
        await world.client.post(f"{API}/leave-requests/{request['request_id']}/approve", headers=ADMIN)
    body = (await world.client.get(f"{API}/overview", headers=ADMIN)).json()
    assert body["headcount"] == 2 and body["exited"] == 1
    assert {d["name"]: d["count"] for d in body["departments"]} == {"Engineering": 1, "No department": 1}
    if today.weekday() < 5:
        assert [p["employee_name"] for p in body["on_leave_today"]] == ["Ana"]


async def test_recruiters_can_read_but_not_change_hrms_data(world):
    await add_person(world, "Ana")
    assert (await world.client.get(f"{API}/employees", headers=STANDARD)).status_code == 200
    assert (await world.client.post(f"{API}/employees", json={"full_name": "X"}, headers=STANDARD)).status_code == 403
    assert (await world.client.post(f"{API}/holidays", json={"date": "2026-01-01", "name": "X"}, headers=STANDARD)).status_code == 403


async def test_hr_admins_can_manage(world):
    response = await world.client.post(f"{API}/employees", json={"full_name": "From HR"}, headers=HR)
    assert response.status_code == 200, response.text


async def test_nobody_signed_in_gets_nothing(world):
    assert (await world.client.get(f"{API}/overview")).status_code == 401


def test_headcount_trend_counts_joiners_exits_and_month_end_headcount():
    today = date(2026, 10, 24)
    people = [
        {"joined_on": "2026-01-10", "status": "active"},
        {"joined_on": "2026-09-05", "status": "active"},
        {"joined_on": "2025-06-01", "status": "exited", "exited_on": "2026-09-20"},
        {"joined_on": "2026-10-02", "status": "active"},
    ]
    trend = ws.headcount_trend(people, today, months=3)
    assert [r["month"] for r in trend] == ["2026-08", "2026-09", "2026-10"]
    assert [(r["headcount"], r["joiners"], r["exits"]) for r in trend] == [(2, 0, 0), (2, 1, 1), (3, 1, 0)]


async def test_analytics_summarises_headcount_attendance_leave_mix_and_tenure(world):
    ana = await add_person(world, "Ana", employment_type="contract")
    await add_person(world, "Ben")
    gone = await add_person(world, "Cy")
    await world.client.post(f"{API}/employees/{gone['employee_id']}/offboard", json={"exited_on": MON.isoformat()}, headers=ADMIN)
    await world.client.put(f"{API}/attendance", json={"employee_id": ana["employee_id"], "date": MON.isoformat(), "status": "present"}, headers=ADMIN)
    annual = await leave_type(world)
    request = (await world.client.post(f"{API}/leave-requests", json={
        "employee_id": ana["employee_id"], "leave_type_id": annual["leave_type_id"],
        "start_date": (MON + timedelta(days=1)).isoformat(), "end_date": (MON + timedelta(days=2)).isoformat(),
    }, headers=ADMIN)).json()
    await world.client.post(f"{API}/leave-requests/{request['request_id']}/approve", headers=ADMIN)

    response = await world.client.get(f"{API}/analytics?months=6", headers=ADMIN)
    assert response.status_code == 200, response.text
    body = response.json()
    assert len(body["headcount_trend"]) == 6 and body["headcount_trend"][-1]["headcount"] == 2
    assert body["exits_12m"] == 1 and body["attrition_rate"] is not None
    assert {m["type"]: m["count"] for m in body["employment_mix"]} == {"contract": 1, "full_time": 1}
    assert sum(t["count"] for t in body["tenure"]) == 2
    assert body["leave_by_type"][0]["name"] == "Annual leave" and body["leave_by_type"][0]["approved"] == 2
    monday = next(r for r in body["attendance_trend"] if r["date"] == MON.isoformat())
    assert monday["present"] == 1 and monday["rate"] == 100.0
    assert all(date.fromisoformat(r["date"]).weekday() < 5 for r in body["attendance_trend"])


async def test_analytics_months_are_bounded(world):
    assert (await world.client.get(f"{API}/analytics?months=1", headers=ADMIN)).status_code == 422
    assert (await world.client.get(f"{API}/analytics?months=40", headers=ADMIN)).status_code == 422


async def test_leave_requests_are_paged_searchable_and_counted_by_status(world):
    ana = await add_person(world, "Ana")
    ben = await add_person(world, "Ben")
    sick = await leave_type(world, "sick")
    for i in range(5):
        day = (MON - timedelta(weeks=i + 1)).isoformat()
        who = ana if i % 2 == 0 else ben
        await world.client.post(f"{API}/leave-requests", json={"employee_id": who["employee_id"], "leave_type_id": sick["leave_type_id"], "start_date": day}, headers=ADMIN)
    first = (await world.client.get(f"{API}/leave-requests?limit=2&page=1", headers=ADMIN)).json()
    assert (first["total"], first["pages"], len(first["requests"])) == (5, 3, 2)
    assert first["counts"]["pending"] == 5 and first["counts"]["all"] == 5
    last = (await world.client.get(f"{API}/leave-requests?limit=2&page=9", headers=ADMIN)).json()
    assert last["page"] == 3 and len(last["requests"]) == 1
    search = (await world.client.get(f"{API}/leave-requests?q=ben", headers=ADMIN)).json()
    assert search["total"] == 2 and {r["employee_name"] for r in search["requests"]} == {"Ben"}
    assert (await world.client.get(f"{API}/leave-requests?limit=500", headers=ADMIN)).status_code == 422
