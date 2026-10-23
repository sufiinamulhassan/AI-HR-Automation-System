from __future__ import annotations

import re
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any

EMPLOYEE_STATUSES = ("active", "on_leave", "exited")
EMPLOYMENT_TYPES = ("full_time", "part_time", "contract", "intern")
ATTENDANCE_STATUSES = ("present", "absent", "half_day", "remote", "on_leave")
LEAVE_STATUSES = ("pending", "approved", "rejected", "cancelled")
COUNTED_LEAVE = ("pending", "approved")
DEFAULT_LEAVE_TYPES = (
    ("annual", "Annual leave", 14),
    ("sick", "Sick leave", 8),
    ("casual", "Casual leave", 6),
)
MAX_LEAVE_DAYS = 120
MAX_LIST = 2000

EMPLOYEE_FIELDS = (
    "full_name", "email", "phone", "designation", "department", "manager_id", "employment_type",
    "location", "joined_on", "employee_code", "job_grade",
)


class WorkforceError(ValueError):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def parse_day(value: Any, field: str = "date") -> date:
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value or "")[:10])
    except ValueError:
        raise WorkforceError(f"{field} must be a date in the form YYYY-MM-DD.")


def days_between(start: date, end: date) -> list[date]:
    return [start + timedelta(days=i) for i in range((end - start).days + 1)]


def working_days(start: date, end: date, holidays: set[date]) -> list[date]:
    return [d for d in days_between(start, end) if d.weekday() < 5 and d not in holidays]


def leave_length(start: date, end: date, holidays: set[date], half_day: bool = False) -> float:
    days = working_days(start, end, holidays)
    if half_day:
        return 0.5 if days else 0.0
    return float(len(days))


def _clean(value: Any, limit: int = 200) -> str:
    return " ".join(str(value or "").split())[:limit]


def _strip(doc: dict | None) -> dict | None:
    if doc is None:
        return None
    doc.pop("_id", None)
    doc.pop("company_id", None)
    return doc


async def holiday_dates(db, start: date, end: date) -> set[date]:
    rows = await db.holidays.find(
        {"date": {"$gte": start.isoformat(), "$lte": end.isoformat()}}, {"_id": 0, "date": 1},
    ).to_list(length=MAX_LIST)
    return {parse_day(r["date"]) for r in rows if r.get("date")}


async def _department_names(db) -> dict[str, str]:
    rows = await db.departments.find({}, {"_id": 0, "department_id": 1, "name": 1}).to_list(length=500)
    return {r["department_id"]: r.get("name") or "" for r in rows if r.get("department_id")}


async def _enrich(db, employees: list[dict]) -> list[dict]:
    missing = [e["candidate_id"] for e in employees if e.get("candidate_id") and not (e.get("full_name") and e.get("email"))]
    people: dict[str, dict] = {}
    if missing:
        rows = await db.candidates.find(
            {"candidate_id": {"$in": missing}}, {"_id": 0, "candidate_id": 1, "name": 1, "email": 1, "job_title": 1},
        ).to_list(length=len(missing))
        people = {r["candidate_id"]: r for r in rows}
    departments = await _department_names(db)
    out = []
    for e in employees:
        person = people.get(e.get("candidate_id") or "", {})
        view = dict(e)
        view["full_name"] = e.get("full_name") or person.get("name") or "Unnamed employee"
        view["email"] = e.get("email") or person.get("email") or ""
        view["designation"] = e.get("designation") or person.get("job_title") or ""
        view["department_name"] = departments.get(e.get("department") or "", "")
        view["source"] = e.get("source") or ("offer" if e.get("offer_id") else "manual")
        view["status"] = e.get("status") or "active"
        out.append(_strip(view))
    names = {v["employee_id"]: v["full_name"] for v in out}
    unknown = [v["manager_id"] for v in out if v.get("manager_id") and v["manager_id"] not in names]
    if unknown:
        for row in await db.employees.find({"employee_id": {"$in": unknown}}, {"_id": 0, "employee_id": 1, "full_name": 1}).to_list(length=len(unknown)):
            names[row["employee_id"]] = row.get("full_name") or "Unnamed employee"
    for v in out:
        v["manager_name"] = names.get(v.get("manager_id") or "", "")
    return out


def _employee_payload(data: dict, *, partial: bool) -> dict:
    out: dict = {}
    for key in EMPLOYEE_FIELDS:
        if key not in data or (partial and data[key] is None):
            continue
        value = data[key]
        if key == "joined_on":
            out[key] = parse_day(value, "joined_on").isoformat() if value else None
        elif key == "employment_type":
            if value and value not in EMPLOYMENT_TYPES:
                raise WorkforceError("employment_type must be one of: " + ", ".join(EMPLOYMENT_TYPES))
            out[key] = value or None
        elif key == "email":
            text = _clean(value, 200).lower()
            if text and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", text):
                raise WorkforceError("email is not a valid address.")
            out[key] = text or None
        elif key == "manager_id":
            out[key] = value or None
        else:
            out[key] = _clean(value) or None
    return out


async def list_employees(db, *, q: str | None = None, department: str | None = None, status: str | None = None) -> list[dict]:
    query: dict = {}
    if department:
        query["department"] = department
    if status:
        if status not in EMPLOYEE_STATUSES:
            raise WorkforceError("status must be one of: " + ", ".join(EMPLOYEE_STATUSES))
        query["status"] = status
    rows = await db.employees.find(query, {"_id": 0}).sort("created_at", -1).to_list(length=MAX_LIST)
    people = await _enrich(db, rows)
    term = _clean(q).lower()
    if term:
        people = [
            p for p in people
            if term in " ".join(str(p.get(k) or "") for k in ("full_name", "email", "designation", "employee_code", "department_name")).lower()
        ]
    people.sort(key=lambda p: (p["status"] == "exited", p["full_name"].lower()))
    return people


async def get_employee(db, employee_id: str) -> dict:
    row = await db.employees.find_one({"employee_id": employee_id}, {"_id": 0})
    if not row:
        raise WorkforceError("Employee not found", 404)
    return (await _enrich(db, [row]))[0]


async def _check_manager(db, employee_id: str | None, manager_id: str | None) -> None:
    if not manager_id:
        return
    if manager_id == employee_id:
        raise WorkforceError("An employee cannot be their own manager.")
    if not await db.employees.find_one({"employee_id": manager_id}, {"_id": 1}):
        raise WorkforceError("The manager was not found.")


async def _check_email_free(db, email: str | None, employee_id: str | None = None) -> None:
    if not email:
        return
    other = await db.employees.find_one({"email": email}, {"_id": 0, "employee_id": 1})
    if other and other.get("employee_id") != employee_id:
        raise WorkforceError("Another employee already uses this email.", 409)


async def create_employee(db, data: dict, actor: str) -> dict:
    payload = _employee_payload(data, partial=False)
    if not payload.get("full_name"):
        raise WorkforceError("full_name is required.")
    await _check_email_free(db, payload.get("email"))
    employee_id = str(uuid.uuid4())
    await _check_manager(db, employee_id, payload.get("manager_id"))
    now = _now()
    doc = {
        "employee_id": employee_id,
        **payload,
        "joined_on": payload.get("joined_on") or date.today().isoformat(),
        "employment_type": payload.get("employment_type") or "full_time",
        "status": "active",
        "source": "manual",
        "hired_at": now,
        "created_by": actor,
        "created_at": now,
        "updated_at": now,
    }
    await db.employees.insert_one(doc)
    return await get_employee(db, employee_id)


async def update_employee(db, employee_id: str, data: dict) -> dict:
    current = await db.employees.find_one({"employee_id": employee_id}, {"_id": 0})
    if not current:
        raise WorkforceError("Employee not found", 404)
    payload = _employee_payload(data, partial=True)
    if "full_name" in payload and not payload["full_name"]:
        raise WorkforceError("full_name cannot be empty.")
    if "email" in payload:
        await _check_email_free(db, payload["email"], employee_id)
    if "manager_id" in payload:
        await _check_manager(db, employee_id, payload["manager_id"])
    if "status" in data and data["status"] is not None:
        if data["status"] not in ("active", "on_leave"):
            raise WorkforceError("Use offboarding to mark an employee as exited.")
        payload["status"] = data["status"]
    payload["updated_at"] = _now()
    await db.employees.update_one({"employee_id": employee_id}, {"$set": payload})
    return await get_employee(db, employee_id)


async def offboard_employee(db, employee_id: str, *, exited_on: Any, reason: str | None, actor: str) -> dict:
    current = await db.employees.find_one({"employee_id": employee_id}, {"_id": 0})
    if not current:
        raise WorkforceError("Employee not found", 404)
    if current.get("status") == "exited":
        raise WorkforceError("This employee has already exited.", 409)
    day = parse_day(exited_on, "exited_on")
    joined = current.get("joined_on")
    if joined and day < parse_day(joined):
        raise WorkforceError("The exit date cannot be before the join date.")
    await db.employees.update_one({"employee_id": employee_id}, {"$set": {
        "status": "exited", "exited_on": day.isoformat(), "exit_reason": _clean(reason, 500) or None,
        "offboarded_by": actor, "updated_at": _now(),
    }})
    await db.employees.update_many({"manager_id": employee_id}, {"$set": {"manager_id": None}})
    await db.leave_requests.update_many(
        {"employee_id": employee_id, "status": "pending"},
        {"$set": {"status": "cancelled", "decided_by": actor, "decided_at": _now(), "decision_note": "Employee exited"}},
    )
    return await get_employee(db, employee_id)


async def ensure_leave_types(db) -> list[dict]:
    rows = await db.leave_types.find({}, {"_id": 0}).to_list(length=100)
    if not rows:
        now = _now()
        for code, name, days in DEFAULT_LEAVE_TYPES:
            await db.leave_types.insert_one({
                "leave_type_id": str(uuid.uuid4()), "code": code, "name": name,
                "annual_allowance": days, "active": True, "created_at": now,
            })
        rows = await db.leave_types.find({}, {"_id": 0}).to_list(length=100)
    return sorted((_strip(r) for r in rows), key=lambda r: r["name"].lower())


async def save_leave_type(db, data: dict, leave_type_id: str | None = None) -> dict:
    await ensure_leave_types(db)
    name = _clean(data.get("name"), 80)
    allowance = data.get("annual_allowance")
    if leave_type_id is None and not name:
        raise WorkforceError("name is required.")
    if allowance is not None and (not isinstance(allowance, (int, float)) or allowance < 0 or allowance > 366):
        raise WorkforceError("annual_allowance must be between 0 and 366 days.")
    if leave_type_id is None:
        doc = {
            "leave_type_id": str(uuid.uuid4()),
            "code": re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_") or "leave",
            "name": name, "annual_allowance": float(allowance or 0), "active": True, "created_at": _now(),
        }
        await db.leave_types.insert_one(doc)
        return _strip(doc)
    update: dict = {}
    if name:
        update["name"] = name
    if allowance is not None:
        update["annual_allowance"] = float(allowance)
    if "active" in data and data["active"] is not None:
        update["active"] = bool(data["active"])
    result = await db.leave_types.update_one({"leave_type_id": leave_type_id}, {"$set": update})
    if not result.matched_count:
        raise WorkforceError("Leave type not found", 404)
    return _strip(await db.leave_types.find_one({"leave_type_id": leave_type_id}, {"_id": 0}))


async def leave_balances(db, employee_id: str, year: int) -> list[dict]:
    types = await ensure_leave_types(db)
    rows = await db.leave_requests.find(
        {"employee_id": employee_id, "status": {"$in": list(COUNTED_LEAVE)}, "year": year},
        {"_id": 0, "leave_type_id": 1, "days": 1, "status": 1},
    ).to_list(length=MAX_LIST)
    out = []
    for t in types:
        used = sum(r["days"] for r in rows if r["leave_type_id"] == t["leave_type_id"] and r["status"] == "approved")
        pending = sum(r["days"] for r in rows if r["leave_type_id"] == t["leave_type_id"] and r["status"] == "pending")
        allowance = float(t.get("annual_allowance") or 0)
        out.append({
            "leave_type_id": t["leave_type_id"], "name": t["name"], "allowance": allowance,
            "used": used, "pending": pending, "remaining": max(0.0, allowance - used - pending),
            "active": t.get("active", True),
        })
    return out


async def create_leave_request(db, data: dict, actor: str) -> dict:
    employee = await db.employees.find_one({"employee_id": data.get("employee_id")}, {"_id": 0})
    if not employee:
        raise WorkforceError("Employee not found", 404)
    if employee.get("status") == "exited":
        raise WorkforceError("Leave cannot be requested for an employee who has exited.")
    types = {t["leave_type_id"]: t for t in await ensure_leave_types(db)}
    leave_type = types.get(data.get("leave_type_id") or "")
    if not leave_type or not leave_type.get("active", True):
        raise WorkforceError("Choose an active leave type.")
    start = parse_day(data.get("start_date"), "start_date")
    end = parse_day(data.get("end_date") or data.get("start_date"), "end_date")
    if end < start:
        raise WorkforceError("The end date cannot be before the start date.")
    if start.year != end.year:
        raise WorkforceError("Split leave that crosses the new year into two requests.")
    if (end - start).days + 1 > MAX_LEAVE_DAYS:
        raise WorkforceError(f"A single request can cover at most {MAX_LEAVE_DAYS} days.")
    half_day = bool(data.get("half_day")) and start == end
    days = leave_length(start, end, await holiday_dates(db, start, end), half_day)
    if days <= 0:
        raise WorkforceError("These dates fall on weekends or holidays, so there is nothing to request.")
    overlapping = await db.leave_requests.find(
        {"employee_id": employee["employee_id"], "status": {"$in": list(COUNTED_LEAVE)},
         "start_date": {"$lte": end.isoformat()}, "end_date": {"$gte": start.isoformat()}},
        {"_id": 1},
    ).to_list(length=1)
    if overlapping:
        raise WorkforceError("These dates overlap another leave request for this employee.", 409)
    balance = next(b for b in await leave_balances(db, employee["employee_id"], start.year) if b["leave_type_id"] == leave_type["leave_type_id"])
    if days > balance["remaining"]:
        raise WorkforceError(f"Only {balance['remaining']:g} day(s) of {leave_type['name']} are left this year.")
    now = _now()
    doc = {
        "request_id": str(uuid.uuid4()),
        "employee_id": employee["employee_id"],
        "leave_type_id": leave_type["leave_type_id"],
        "leave_type_name": leave_type["name"],
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "half_day": half_day,
        "days": days,
        "year": start.year,
        "reason": _clean(data.get("reason"), 500) or None,
        "status": "pending",
        "requested_by": actor,
        "created_at": now,
        "updated_at": now,
    }
    await db.leave_requests.insert_one(doc)
    return (await _leave_views(db, [doc]))[0]


async def _leave_views(db, rows: list[dict]) -> list[dict]:
    ids = list({r["employee_id"] for r in rows})
    people = {e["employee_id"]: e for e in await _enrich(db, await db.employees.find(
        {"employee_id": {"$in": ids}}, {"_id": 0},
    ).to_list(length=len(ids) or 1))} if ids else {}
    out = []
    for r in rows:
        person = people.get(r["employee_id"], {})
        view = _strip(dict(r))
        view["employee_name"] = person.get("full_name") or "Unknown employee"
        view["department_name"] = person.get("department_name") or ""
        out.append(view)
    return out


async def list_leave_requests(db, *, status: str | None = None, employee_id: str | None = None, year: int | None = None) -> list[dict]:
    query: dict = {}
    if status:
        if status not in LEAVE_STATUSES:
            raise WorkforceError("status must be one of: " + ", ".join(LEAVE_STATUSES))
        query["status"] = status
    if employee_id:
        query["employee_id"] = employee_id
    if year:
        query["year"] = year
    rows = await db.leave_requests.find(query, {"_id": 0}).sort("start_date", -1).to_list(length=MAX_LIST)
    return await _leave_views(db, rows)


async def _mark_leave_days(db, request: dict, actor: str) -> None:
    start, end = parse_day(request["start_date"]), parse_day(request["end_date"])
    for day in working_days(start, end, await holiday_dates(db, start, end)):
        await db.attendance.update_one(
            {"employee_id": request["employee_id"], "date": day.isoformat()},
            {"$set": {
                "status": "on_leave", "source": "leave", "leave_request_id": request["request_id"],
                "check_in": None, "check_out": None, "marked_by": actor, "updated_at": _now(),
            }, "$setOnInsert": {"attendance_id": str(uuid.uuid4())}},
            upsert=True,
        )


async def decide_leave(db, request_id: str, *, approve: bool, actor: str, note: str | None = None) -> dict:
    request = await db.leave_requests.find_one({"request_id": request_id}, {"_id": 0})
    if not request:
        raise WorkforceError("Leave request not found", 404)
    if request["status"] != "pending":
        raise WorkforceError(f"This request is already {request['status']}.", 409)
    if approve:
        balance = next(
            (b for b in await leave_balances(db, request["employee_id"], request["year"]) if b["leave_type_id"] == request["leave_type_id"]),
            None,
        )
        if balance is not None and balance["used"] + request["days"] > balance["allowance"]:
            raise WorkforceError("Approving this would go over the yearly allowance.", 409)
    status = "approved" if approve else "rejected"
    await db.leave_requests.update_one({"request_id": request_id}, {"$set": {
        "status": status, "decided_by": actor, "decided_at": _now(), "decision_note": _clean(note, 500) or None,
        "updated_at": _now(),
    }})
    request["status"] = status
    if approve:
        await _mark_leave_days(db, request, actor)
    return (await _leave_views(db, [await db.leave_requests.find_one({"request_id": request_id}, {"_id": 0})]))[0]


async def cancel_leave(db, request_id: str, actor: str) -> dict:
    request = await db.leave_requests.find_one({"request_id": request_id}, {"_id": 0})
    if not request:
        raise WorkforceError("Leave request not found", 404)
    if request["status"] not in COUNTED_LEAVE:
        raise WorkforceError(f"This request is already {request['status']}.", 409)
    await db.leave_requests.update_one({"request_id": request_id}, {"$set": {
        "status": "cancelled", "decided_by": actor, "decided_at": _now(), "updated_at": _now(),
    }})
    await db.attendance.delete_many({"leave_request_id": request_id, "source": "leave"})
    return (await _leave_views(db, [await db.leave_requests.find_one({"request_id": request_id}, {"_id": 0})]))[0]


def _clock(value: Any, field: str) -> str | None:
    if value in (None, ""):
        return None
    text = str(value)
    if not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", text):
        raise WorkforceError(f"{field} must be a time like 09:30.")
    return text


async def mark_attendance(db, data: dict, actor: str) -> dict:
    employee = await db.employees.find_one({"employee_id": data.get("employee_id")}, {"_id": 0})
    if not employee:
        raise WorkforceError("Employee not found", 404)
    day = parse_day(data.get("date"))
    if day > date.today():
        raise WorkforceError("Attendance cannot be marked for a future date.")
    if employee.get("status") == "exited" and employee.get("exited_on") and day > parse_day(employee["exited_on"]):
        raise WorkforceError("This employee had already exited on that date.")
    status = data.get("status")
    if status not in ATTENDANCE_STATUSES:
        raise WorkforceError("status must be one of: " + ", ".join(ATTENDANCE_STATUSES))
    check_in = _clock(data.get("check_in"), "check_in")
    check_out = _clock(data.get("check_out"), "check_out")
    if status in ("absent", "on_leave"):
        check_in = check_out = None
    if check_in and check_out and check_out < check_in:
        raise WorkforceError("check_out cannot be before check_in.")
    await db.attendance.update_one(
        {"employee_id": employee["employee_id"], "date": day.isoformat()},
        {"$set": {
            "status": status, "check_in": check_in, "check_out": check_out,
            "note": _clean(data.get("note"), 300) or None, "source": "manual", "leave_request_id": None,
            "marked_by": actor, "updated_at": _now(),
        }, "$setOnInsert": {"attendance_id": str(uuid.uuid4())}},
        upsert=True,
    )
    return _strip(await db.attendance.find_one({"employee_id": employee["employee_id"], "date": day.isoformat()}, {"_id": 0}))


def _worked_minutes(record: dict) -> int:
    if not record.get("check_in") or not record.get("check_out"):
        return 0
    h1, m1 = map(int, record["check_in"].split(":"))
    h2, m2 = map(int, record["check_out"].split(":"))
    return max(0, (h2 * 60 + m2) - (h1 * 60 + m1))


def _on_roll(employee: dict, day: date) -> bool:
    joined = employee.get("joined_on")
    if joined and parse_day(joined) > day:
        return False
    if employee.get("status") == "exited":
        exited = employee.get("exited_on")
        return bool(exited) and parse_day(exited) >= day
    return True


async def attendance_sheet(db, day_value: Any) -> dict:
    day = parse_day(day_value)
    employees = [e for e in await list_employees(db) if _on_roll(e, day)]
    records = {
        r["employee_id"]: _strip(r)
        for r in await db.attendance.find({"date": day.isoformat()}, {"_id": 0}).to_list(length=MAX_LIST)
    }
    holiday = await db.holidays.find_one({"date": day.isoformat()}, {"_id": 0, "name": 1})
    rows = [{
        "employee_id": e["employee_id"], "full_name": e["full_name"], "designation": e["designation"],
        "department_name": e["department_name"], "record": records.get(e["employee_id"]),
    } for e in employees]
    counts = {s: sum(1 for r in rows if (r["record"] or {}).get("status") == s) for s in ATTENDANCE_STATUSES}
    counts["unmarked"] = sum(1 for r in rows if not r["record"])
    return {
        "date": day.isoformat(), "weekend": day.weekday() >= 5,
        "holiday": (holiday or {}).get("name"), "rows": rows, "counts": counts,
    }


async def monthly_summary(db, year: int, month: int) -> dict:
    if not 1 <= month <= 12 or not 2000 <= year <= 2100:
        raise WorkforceError("Choose a valid month.")
    start = date(year, month, 1)
    end = (date(year + (month == 12), month % 12 + 1, 1)) - timedelta(days=1)
    last = min(end, date.today())
    holidays = await holiday_dates(db, start, end)
    workdays = working_days(start, last, holidays) if last >= start else []
    records = await db.attendance.find(
        {"date": {"$gte": start.isoformat(), "$lte": end.isoformat()}}, {"_id": 0},
    ).to_list(length=MAX_LIST * 31)
    by_person: dict[str, list[dict]] = {}
    for r in records:
        by_person.setdefault(r["employee_id"], []).append(r)
    rows = []
    for e in await list_employees(db):
        mine = by_person.get(e["employee_id"], [])
        if not mine and not any(_on_roll(e, d) for d in workdays):
            continue
        counts = {s: sum(1 for r in mine if r.get("status") == s) for s in ATTENDANCE_STATUSES}
        expected = sum(1 for d in workdays if _on_roll(e, d))
        attended = counts["present"] + counts["remote"] + 0.5 * counts["half_day"]
        rows.append({
            "employee_id": e["employee_id"], "full_name": e["full_name"], "department_name": e["department_name"],
            **counts, "working_days": expected,
            "unmarked": max(0, expected - len({r["date"] for r in mine if parse_day(r["date"]) in set(workdays)})),
            "attendance_rate": round(100 * attended / expected, 1) if expected else None,
            "hours": round(sum(_worked_minutes(r) for r in mine) / 60, 1),
        })
    return {"year": year, "month": month, "working_days": len(workdays), "rows": rows}


async def list_holidays(db, year: int | None = None) -> list[dict]:
    query: dict = {}
    if year:
        query["date"] = {"$gte": f"{year}-01-01", "$lte": f"{year}-12-31"}
    rows = await db.holidays.find(query, {"_id": 0}).sort("date", 1).to_list(length=500)
    return [_strip(r) for r in rows]


async def add_holiday(db, data: dict, actor: str) -> dict:
    day = parse_day(data.get("date"))
    name = _clean(data.get("name"), 120)
    if not name:
        raise WorkforceError("name is required.")
    if await db.holidays.find_one({"date": day.isoformat()}, {"_id": 1}):
        raise WorkforceError("There is already a holiday on this date.", 409)
    doc = {
        "holiday_id": str(uuid.uuid4()), "date": day.isoformat(), "name": name,
        "optional": bool(data.get("optional")), "created_by": actor, "created_at": _now(),
    }
    await db.holidays.insert_one(doc)
    return _strip(doc)


async def delete_holiday(db, holiday_id: str) -> None:
    result = await db.holidays.delete_one({"holiday_id": holiday_id})
    if not result.deleted_count:
        raise WorkforceError("Holiday not found", 404)


async def overview(db, today: date | None = None) -> dict:
    today = today or date.today()
    people = await list_employees(db)
    current = [p for p in people if p["status"] != "exited"]
    on_leave_today = await db.leave_requests.find(
        {"status": "approved", "start_date": {"$lte": today.isoformat()}, "end_date": {"$gte": today.isoformat()}},
        {"_id": 0},
    ).to_list(length=MAX_LIST)
    sheet = await attendance_sheet(db, today)
    pending = await db.leave_requests.count_documents({"status": "pending"})
    since = (today - timedelta(days=30)).isoformat()
    joiners = [p for p in current if (p.get("joined_on") or (p.get("hired_at") or "")[:10]) >= since]
    upcoming = await db.holidays.find(
        {"date": {"$gte": today.isoformat()}}, {"_id": 0},
    ).sort("date", 1).limit(5).to_list(length=5)
    departments: dict[str, int] = {}
    for p in current:
        key = p["department_name"] or "No department"
        departments[key] = departments.get(key, 0) + 1
    leave_people = await _leave_views(db, on_leave_today)
    return {
        "date": today.isoformat(),
        "headcount": len(current),
        "active": sum(1 for p in current if p["status"] == "active"),
        "exited": sum(1 for p in people if p["status"] == "exited"),
        "on_leave_today": [{"employee_id": r["employee_id"], "employee_name": r["employee_name"], "leave_type_name": r["leave_type_name"], "end_date": r["end_date"]} for r in leave_people],
        "pending_leave": pending,
        "attendance_today": sheet["counts"],
        "new_joiners": [{"employee_id": p["employee_id"], "full_name": p["full_name"], "designation": p["designation"], "joined_on": p.get("joined_on") or (p.get("hired_at") or "")[:10]} for p in joiners][:10],
        "upcoming_holidays": [_strip(h) for h in upcoming],
        "departments": sorted(({"name": k, "count": v} for k, v in departments.items()), key=lambda d: (-d["count"], d["name"])),
    }


TENURE_BUCKETS = (
    ("Under 6 months", 0, 183),
    ("6 to 12 months", 183, 365),
    ("1 to 2 years", 365, 730),
    ("2 to 4 years", 730, 1461),
    ("4 years or more", 1461, None),
)


def _month_end(year: int, month: int) -> date:
    return date(year + (month == 12), month % 12 + 1, 1) - timedelta(days=1)


def _joined_day(p: dict) -> date | None:
    raw = p.get("joined_on") or (p.get("hired_at") or "")[:10]
    try:
        return parse_day(raw) if raw else None
    except WorkforceError:
        return None


def _exited_day(p: dict) -> date | None:
    if p.get("status") != "exited" or not p.get("exited_on"):
        return None
    try:
        return parse_day(p["exited_on"])
    except WorkforceError:
        return None


def headcount_trend(people: list[dict], today: date, months: int = 12) -> list[dict]:
    rows = []
    year, month = today.year, today.month
    marks = []
    for _ in range(months):
        marks.append((year, month))
        year, month = (year - 1, 12) if month == 1 else (year, month - 1)
    for year, month in reversed(marks):
        start, end = date(year, month, 1), min(_month_end(year, month), today)
        joined = exits = headcount = 0
        for p in people:
            j, x = _joined_day(p), _exited_day(p)
            if j and start <= j <= end:
                joined += 1
            if x and start <= x <= end:
                exits += 1
            if j and j <= end and (x is None or x > end):
                headcount += 1
        rows.append({"month": f"{year}-{month:02d}", "headcount": headcount, "joiners": joined, "exits": exits})
    return rows


async def attendance_trend(db, today: date, days: int = 30) -> list[dict]:
    start = today - timedelta(days=days * 2)
    workdays = [d for d in working_days(start, today, await holiday_dates(db, start, today)) if d <= today][-days:]
    if not workdays:
        return []
    rows = await db.attendance.find(
        {"date": {"$gte": workdays[0].isoformat(), "$lte": workdays[-1].isoformat()}},
        {"_id": 0, "date": 1, "status": 1},
    ).to_list(length=MAX_LIST * days)
    by_day: dict[str, dict[str, int]] = {}
    for r in rows:
        by_day.setdefault(r["date"], {}).setdefault(r.get("status") or "", 0)
        by_day[r["date"]][r.get("status") or ""] += 1
    out = []
    for d in workdays:
        counts = {s: by_day.get(d.isoformat(), {}).get(s, 0) for s in ATTENDANCE_STATUSES}
        counted = counts["present"] + counts["remote"] + counts["half_day"] + counts["absent"]
        attended = counts["present"] + counts["remote"] + 0.5 * counts["half_day"]
        out.append({
            "date": d.isoformat(),
            **counts,
            "marked": sum(counts.values()),
            "rate": round(100 * attended / counted, 1) if counted else None,
        })
    return out


async def analytics(db, today: date | None = None, months: int = 12) -> dict:
    today = today or date.today()
    months = max(3, min(int(months or 12), 24))
    people = await list_employees(db)
    current = [p for p in people if p["status"] != "exited"]
    trend = headcount_trend(people, today, months)
    year_start = date(today.year, 1, 1).isoformat()
    leave_rows = await db.leave_requests.find(
        {"year": today.year, "status": {"$in": list(COUNTED_LEAVE)}},
        {"_id": 0, "leave_type_name": 1, "days": 1, "status": 1},
    ).to_list(length=MAX_LIST * 5)
    leave: dict[str, dict] = {}
    for r in leave_rows:
        entry = leave.setdefault(r.get("leave_type_name") or "Other", {"name": r.get("leave_type_name") or "Other", "approved": 0.0, "pending": 0.0})
        entry[r["status"]] += float(r.get("days") or 0)
    mix: dict[str, int] = {}
    for p in current:
        key = p.get("employment_type") or "full_time"
        mix[key] = mix.get(key, 0) + 1
    tenure = []
    for label, low, high in TENURE_BUCKETS:
        count = 0
        for p in current:
            j = _joined_day(p)
            if j is None:
                continue
            days = (today - j).days
            if days >= low and (high is None or days < high):
                count += 1
        tenure.append({"label": label, "count": count})
    exits_12 = sum(r["exits"] for r in trend[-12:])
    average = sum(r["headcount"] for r in trend[-12:]) / max(1, len(trend[-12:]))
    attendance = await attendance_trend(db, today)
    rates = [r["rate"] for r in attendance if r["rate"] is not None]
    return {
        "date": today.isoformat(),
        "since": year_start,
        "headcount_trend": trend,
        "attendance_trend": attendance,
        "leave_by_type": sorted(leave.values(), key=lambda r: -(r["approved"] + r["pending"])),
        "employment_mix": sorted(({"type": k, "count": v} for k, v in mix.items()), key=lambda r: -r["count"]),
        "tenure": tenure,
        "attrition_rate": round(100 * exits_12 / average, 1) if average else None,
        "average_attendance": round(sum(rates) / len(rates), 1) if rates else None,
        "joiners_12m": sum(r["joiners"] for r in trend[-12:]),
        "exits_12m": exits_12,
    }


async def paged_leave_requests(db, *, status: str | None, employee_id: str | None, year: int | None, q: str | None,
                               page: int, limit: int) -> dict:
    rows = await list_leave_requests(db, status=status, employee_id=employee_id, year=year)
    term = _clean(q).lower()
    if term:
        rows = [r for r in rows if term in f"{r['employee_name']} {r['leave_type_name']} {r.get('department_name') or ''}".lower()]
    base = await list_leave_requests(db, employee_id=employee_id, year=year)
    counts = {s: sum(1 for r in base if r["status"] == s) for s in LEAVE_STATUSES}
    counts["all"] = len(base)
    limit = max(1, min(int(limit or 25), 100))
    pages = max(1, -(-len(rows) // limit))
    page = max(1, min(int(page or 1), pages))
    return {
        "requests": rows[(page - 1) * limit: page * limit],
        "total": len(rows),
        "page": page,
        "limit": limit,
        "pages": pages,
        "counts": counts,
    }
