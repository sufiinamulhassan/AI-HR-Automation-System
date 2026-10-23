import asyncio
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from config.database import get_db
from services.hr_module import people_insights_service as insights
from services.hr_module import workforce_service as ws
from services.hr_module.audit_service import log_audit_event
from shared.auth import require_permission

router = APIRouter()

_read = require_permission("hrms:read")
_manage = require_permission("hrms:manage")


def _db():
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    return db


async def _run(coro):
    try:
        return await coro
    except ws.WorkforceError as exc:
        raise HTTPException(exc.status, str(exc))


def _audit(db, user: dict, action: str, resource_type: str, resource_id: str, details: dict | None = None) -> None:
    asyncio.create_task(log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action=action, resource_type=resource_type, resource_id=resource_id, details=details or {},
    ))


class EmployeeIn(BaseModel):
    full_name: str | None = Field(default=None, max_length=200)
    email: str | None = Field(default=None, max_length=200)
    phone: str | None = Field(default=None, max_length=40)
    designation: str | None = Field(default=None, max_length=200)
    department: str | None = None
    manager_id: str | None = None
    employment_type: str | None = None
    location: str | None = Field(default=None, max_length=200)
    joined_on: str | None = None
    employee_code: str | None = Field(default=None, max_length=60)
    job_grade: str | None = Field(default=None, max_length=80)
    status: str | None = None


class OffboardIn(BaseModel):
    exited_on: str
    reason: str | None = Field(default=None, max_length=500)


class LeaveTypeIn(BaseModel):
    name: str | None = Field(default=None, max_length=80)
    annual_allowance: float | None = None
    active: bool | None = None


class LeaveRequestIn(BaseModel):
    employee_id: str
    leave_type_id: str
    start_date: str
    end_date: str | None = None
    half_day: bool = False
    reason: str | None = Field(default=None, max_length=500)


class DecisionIn(BaseModel):
    note: str | None = Field(default=None, max_length=500)


class AttendanceIn(BaseModel):
    employee_id: str
    date: str
    status: str
    check_in: str | None = None
    check_out: str | None = None
    note: str | None = Field(default=None, max_length=300)


class HolidayIn(BaseModel):
    date: str
    name: str = Field(max_length=120)
    optional: bool = False


@router.get("/overview")
async def get_overview(_: dict = Depends(_read)):
    return await _run(ws.overview(_db()))


@router.get("/analytics")
async def get_analytics(months: int = Query(default=12, ge=3, le=24), _: dict = Depends(_read)):
    return await _run(ws.analytics(_db(), months=months))


@router.get("/employees")
async def list_employees(
    q: str | None = None, department: str | None = None, status: str | None = None, _: dict = Depends(_read),
):
    employees = await _run(ws.list_employees(_db(), q=q, department=department, status=status))
    return {"employees": employees, "total": len(employees)}


@router.post("/employees")
async def create_employee(body: EmployeeIn, user: dict = Depends(_manage)):
    db = _db()
    employee = await _run(ws.create_employee(db, body.model_dump(exclude={"status"}), user["email"]))
    _audit(db, user, "employee_create", "employee", employee["employee_id"], {"full_name": employee["full_name"]})
    return employee


@router.get("/employees/{employee_id}")
async def get_employee(employee_id: str, year: int | None = None, _: dict = Depends(_read)):
    db = _db()
    employee = await _run(ws.get_employee(db, employee_id))
    year = year or date.today().year
    return {
        **employee,
        "leave_balances": await _run(ws.leave_balances(db, employee_id, year)),
        "leave_requests": await _run(ws.list_leave_requests(db, employee_id=employee_id)),
    }


@router.patch("/employees/{employee_id}")
async def update_employee(employee_id: str, body: EmployeeIn, user: dict = Depends(_manage)):
    db = _db()
    data = body.model_dump(exclude_unset=True)
    employee = await _run(ws.update_employee(db, employee_id, data))
    _audit(db, user, "employee_update", "employee", employee_id, {"fields": sorted(data)})
    return employee


@router.post("/employees/{employee_id}/offboard")
async def offboard_employee(employee_id: str, body: OffboardIn, user: dict = Depends(_manage)):
    db = _db()
    employee = await _run(ws.offboard_employee(db, employee_id, exited_on=body.exited_on, reason=body.reason, actor=user["email"]))
    _audit(db, user, "employee_offboard", "employee", employee_id, {"exited_on": body.exited_on})
    return employee


@router.get("/leave-types")
async def list_leave_types(_: dict = Depends(_read)):
    return {"leave_types": await _run(ws.ensure_leave_types(_db()))}


@router.post("/leave-types")
async def create_leave_type(body: LeaveTypeIn, user: dict = Depends(_manage)):
    return await _run(ws.save_leave_type(_db(), body.model_dump()))


@router.patch("/leave-types/{leave_type_id}")
async def update_leave_type(leave_type_id: str, body: LeaveTypeIn, user: dict = Depends(_manage)):
    return await _run(ws.save_leave_type(_db(), body.model_dump(exclude_unset=True), leave_type_id))


@router.get("/leave-requests")
async def list_leave_requests(
    status: str | None = None, employee_id: str | None = None, year: int | None = None, q: str | None = None,
    page: int = Query(default=1, ge=1, le=10000), limit: int = Query(default=25, ge=1, le=100),
    _: dict = Depends(_read),
):
    return await _run(ws.paged_leave_requests(
        _db(), status=status, employee_id=employee_id, year=year, q=q, page=page, limit=limit,
    ))


@router.post("/leave-requests")
async def create_leave_request(body: LeaveRequestIn, user: dict = Depends(_manage)):
    db = _db()
    request = await _run(ws.create_leave_request(db, body.model_dump(), user["email"]))
    _audit(db, user, "leave_request_create", "leave_request", request["request_id"], {"days": request["days"]})
    return request


@router.post("/leave-requests/{request_id}/approve")
async def approve_leave(request_id: str, body: DecisionIn | None = None, user: dict = Depends(_manage)):
    db = _db()
    request = await _run(ws.decide_leave(db, request_id, approve=True, actor=user["email"], note=(body or DecisionIn()).note))
    _audit(db, user, "leave_request_approve", "leave_request", request_id)
    return request


@router.post("/leave-requests/{request_id}/reject")
async def reject_leave(request_id: str, body: DecisionIn | None = None, user: dict = Depends(_manage)):
    db = _db()
    request = await _run(ws.decide_leave(db, request_id, approve=False, actor=user["email"], note=(body or DecisionIn()).note))
    _audit(db, user, "leave_request_reject", "leave_request", request_id)
    return request


@router.post("/leave-requests/{request_id}/cancel")
async def cancel_leave(request_id: str, user: dict = Depends(_manage)):
    db = _db()
    request = await _run(ws.cancel_leave(db, request_id, user["email"]))
    _audit(db, user, "leave_request_cancel", "leave_request", request_id)
    return request


@router.get("/leave-requests/{request_id}/coverage")
async def leave_request_coverage(request_id: str, _: dict = Depends(_read)):
    return await _run(insights.request_coverage(_db(), request_id))


@router.get("/coverage")
async def coverage_check(employee_id: str, start_date: str, end_date: str | None = None, _: dict = Depends(_read)):
    return await _run(insights.leave_coverage(_db(), employee_id=employee_id, start=start_date, end=end_date))


@router.get("/insights/hire-quality")
async def hire_quality(_: dict = Depends(_manage)):
    return await _run(insights.hire_quality(_db()))


@router.get("/insights/risk")
async def risk_radar(_: dict = Depends(_manage)):
    return await _run(insights.risk_radar(_db()))


@router.get("/attendance")
async def get_attendance(day: str | None = Query(default=None, alias="date"), _: dict = Depends(_read)):
    return await _run(ws.attendance_sheet(_db(), day or date.today().isoformat()))


@router.put("/attendance")
async def mark_attendance(body: AttendanceIn, user: dict = Depends(_manage)):
    return await _run(ws.mark_attendance(_db(), body.model_dump(), user["email"]))


@router.get("/attendance/summary")
async def attendance_summary(year: int, month: int, _: dict = Depends(_read)):
    return await _run(ws.monthly_summary(_db(), year, month))


@router.get("/holidays")
async def list_holidays(year: int | None = None, _: dict = Depends(_read)):
    return {"holidays": await _run(ws.list_holidays(_db(), year))}


@router.post("/holidays")
async def add_holiday(body: HolidayIn, user: dict = Depends(_manage)):
    db = _db()
    holiday = await _run(ws.add_holiday(db, body.model_dump(), user["email"]))
    _audit(db, user, "holiday_create", "holiday", holiday["holiday_id"], {"date": holiday["date"]})
    return holiday


@router.delete("/holidays/{holiday_id}")
async def delete_holiday(holiday_id: str, user: dict = Depends(_manage)):
    db = _db()
    await _run(ws.delete_holiday(db, holiday_id))
    _audit(db, user, "holiday_delete", "holiday", holiday_id)
    return {"message": "Holiday deleted"}
