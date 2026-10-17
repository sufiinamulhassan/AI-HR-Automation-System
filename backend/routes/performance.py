import html as _html
import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from shared.auth import get_optional_user, require_admin, require_any_permission, require_permission
from shared.rate_limit import public_token_throttle
from shared.links import base_url
from shared.tenant_deps import bind_company_for_token
from config.database import get_db
from config.settings import settings
from services.hr_module import employee_service, performance_service
from services.hr_module.plan_service import require_feature
from services.hr_module.audit_service import log_audit_event
from services.hr_module import email_layout, email_service, mail_brand
from services.hr_module.email_service import sender_name

logger = logging.getLogger(__name__)

router = APIRouter()

_public_throttle = public_token_throttle("performance", ip_limit=120, token_limit=30, tenant="review")

def _without_workspace_id(doc):
    if isinstance(doc, dict):
        doc.pop("company_id", None)
    return doc


class CycleScope(BaseModel):
    type: str
    value: str | None = None


class CycleCreate(BaseModel):
    name: str
    period_start: str
    period_end: str
    scope: CycleScope
    review_types: list[str]


class CycleUpdate(BaseModel):
    name: str | None = None
    period_start: str | None = None
    period_end: str | None = None
    scope: CycleScope | None = None
    review_types: list[str] | None = None
    status: str | None = None


class ManagerAssignRequest(BaseModel):
    manager_id: str | None = None


class GoalCreateRequest(BaseModel):
    title: str
    description: str | None = None
    due_date: str | None = None
    parent_goal_id: str | None = None


class GoalUpdateRequest(BaseModel):
    title: str | None = None
    description: str | None = None
    due_date: str | None = None
    progress_pct: int | None = None
    status: str | None = None
    parent_goal_id: str | None = None


class GoalProgressRequest(BaseModel):
    progress_pct: int


class ReviewAssignRequest(BaseModel):
    cycle_id: str
    employee_id: str
    reviewer_type: str
    reviewer_employee_id: str | None = None


class ManagerReviewSubmitRequest(BaseModel):
    cycle_id: str
    employee_id: str
    reviewer_type: str
    ratings: dict[str, float]
    comments: str | None = None


class TokenReviewSubmitRequest(BaseModel):
    ratings: dict[str, float]
    comments: str | None = None


class RatingDimensionCreate(BaseModel):
    name: str
    description: str | None = None


class RatingDimensionUpdate(BaseModel):
    name: str | None = None
    description: str | None = None


class RatingScaleUpdate(BaseModel):
    scale_min: int
    scale_max: int


_NOT_FOUND_CODES = {
    "not_found", "employee_not_found", "cycle_not_found",
    "reviewer_employee_not_found", "manager_not_found", "parent_goal_not_found",
}
_FORBIDDEN_CODES = {"not_your_report", "not_your_goal"}


def _error(exc: ValueError) -> HTTPException:
    msg = str(exc)
    if msg == "not_found":
        return HTTPException(404, "Resource not found")
    if msg in _NOT_FOUND_CODES:
        return HTTPException(404, msg.replace("_", " ").capitalize())
    if msg in _FORBIDDEN_CODES:
        return HTTPException(403, msg.replace("_", " ").capitalize())
    if msg == "already_submitted":
        return HTTPException(409, "This review has already been submitted")
    if msg == "expired":
        return HTTPException(410, "This review link has expired: please request a new invite")
    if "already exists" in msg:
        return HTTPException(409, msg)
    return HTTPException(400, msg)


def _require_db():
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    return db


@router.post("/cycles")
async def create_cycle(
    body: CycleCreate,
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("performance:manage")),
    _plan: None = Depends(require_feature("performance")),
):
    db = _require_db()
    try:
        cycle = await performance_service.create_cycle(
            db, name=body.name, period_start=body.period_start, period_end=body.period_end,
            scope=body.scope.model_dump(), review_types=body.review_types, created_by=user["email"],
        )
    except ValueError as exc:
        raise _error(exc)

    asyncio.create_task(log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="performance_cycle_create", resource_type="performance_cycle", resource_id=cycle["cycle_id"],
        details={"name": body.name, "review_types": body.review_types},
    ))
    return cycle


@router.get("/cycles")
async def list_cycles(status: str | None = None, _: dict = Depends(require_permission("performance:read")), _plan: None = Depends(require_feature("performance"))):
    db = _require_db()
    return {"cycles": await performance_service.list_cycles(db, status=status)}


@router.get("/cycles/active")
async def list_active_cycles(
    _: dict = Depends(require_any_permission("performance:read", "performance:review")),
    _plan: None = Depends(require_feature("performance")),
):
    db = _require_db()
    cycles = await performance_service.list_cycles(db, status="active")
    return {"cycles": [
        {"cycle_id": c["cycle_id"], "name": c["name"], "status": c["status"]} for c in cycles
    ]}


@router.get("/cycles/{cycle_id}")
async def get_cycle(cycle_id: str, _: dict = Depends(require_permission("performance:read")), _plan: None = Depends(require_feature("performance"))):
    db = _require_db()
    cycle = await performance_service.get_cycle(db, cycle_id)
    if not cycle:
        raise HTTPException(404, "Cycle not found")
    return cycle


@router.patch("/cycles/{cycle_id}")
async def update_cycle(
    cycle_id: str,
    body: CycleUpdate,
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("performance:manage")),
    _plan: None = Depends(require_feature("performance")),
):
    db = _require_db()
    update = {k: v for k, v in body.model_dump().items() if v is not None}
    try:
        updated = await performance_service.update_cycle(db, cycle_id, update)
    except ValueError as exc:
        raise _error(exc)

    asyncio.create_task(log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="performance_cycle_update", resource_type="performance_cycle", resource_id=cycle_id,
        details=update,
    ))
    return updated


@router.post("/cycles/{cycle_id}/close")
async def close_cycle(
    cycle_id: str,
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("performance:manage")),
    _plan: None = Depends(require_feature("performance")),
):
    db = _require_db()
    try:
        updated = await performance_service.close_cycle(db, cycle_id)
    except ValueError as exc:
        raise _error(exc)

    asyncio.create_task(log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="performance_cycle_close", resource_type="performance_cycle", resource_id=cycle_id,
        details={},
    ))
    return updated


@router.get("/cycles/{cycle_id}/coverage")
async def get_cycle_coverage(
    cycle_id: str,
    _: dict = Depends(require_any_permission("performance:read", "performance:manage")),
    _plan: None = Depends(require_feature("performance")),
):
    db = _require_db()
    try:
        coverage = await performance_service.get_cycle_coverage(db, cycle_id)
    except ValueError as exc:
        raise _error(exc)
    return coverage


@router.get("/employees")
async def list_employees(
    department: str | None = None,
    job_grade: str | None = None,
    manager_id: str | None = None,
    _: dict = Depends(require_permission("performance:read")),
    _plan: None = Depends(require_feature("performance")),
):
    db = _require_db()
    employees = await employee_service.list_employees(
        db, department=department, job_grade=job_grade, manager_id=manager_id,
    )
    return {"employees": employees}


@router.get("/employees/{employee_id}")
async def get_employee(employee_id: str, _: dict = Depends(require_permission("performance:read")), _plan: None = Depends(require_feature("performance"))):
    db = _require_db()
    employee = await employee_service.get_employee(db, employee_id)
    if not employee:
        raise HTTPException(404, "Employee not found")
    return employee


@router.patch("/employees/{employee_id}/manager")
async def assign_manager(
    employee_id: str,
    body: ManagerAssignRequest,
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("performance:manage")),
    _plan: None = Depends(require_feature("performance")),
):
    db = _require_db()
    try:
        updated = await employee_service.set_manager(db, employee_id, body.manager_id)
    except ValueError as exc:
        raise _error(exc)

    asyncio.create_task(log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="employee_manager_assign", resource_type="employee", resource_id=employee_id,
        details={"manager_id": body.manager_id},
    ))
    return updated


@router.get("/my-reports")
async def my_reports(user: dict = Depends(require_permission("performance:review")), _plan: None = Depends(require_feature("performance"))):
    db = _require_db()
    return await employee_service.list_my_reports(db, user["email"])


@router.post("/reviews/manager-submit")
async def submit_manager_review(
    body: ManagerReviewSubmitRequest, user: dict = Depends(require_permission("performance:review")),
    _plan: None = Depends(require_feature("performance")),
):
    db = _require_db()
    try:
        review = await performance_service.submit_manager_review(
            db, cycle_id=body.cycle_id, employee_id=body.employee_id, reviewer_type=body.reviewer_type,
            reviewer_email=user["email"], ratings=body.ratings, comments=body.comments,
        )
    except ValueError as exc:
        raise _error(exc)

    asyncio.create_task(log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="performance_review_submit", resource_type="performance_review", resource_id=review["review_id"],
        details={"cycle_id": body.cycle_id, "employee_id": body.employee_id, "reviewer_type": body.reviewer_type},
    ))
    return review


@router.get("/reviews/mine")
async def my_submitted_reviews(user: dict = Depends(require_permission("performance:review")), _plan: None = Depends(require_feature("performance"))):
    db = _require_db()
    reviews = await performance_service.list_reviews(db)
    mine = [r for r in reviews if r.get("reviewer_id") == user["email"] and r.get("reviewer_type") in ("manager", "skip_level")]
    return {"reviews": mine}


async def _send_review_invite_email(db, review: dict) -> bool:
    reviewer_type = review["reviewer_type"]
    target_employee_id = review["employee_id"] if reviewer_type == "self" else review["reviewer_id"]
    target_employee = await db.employees.find_one({"employee_id": target_employee_id})
    if not target_employee:
        logger.warning("Review invite skipped: target employee not found | review_id=%s", review["review_id"])
        return False
    recipient = await db.candidates.find_one({"candidate_id": target_employee.get("candidate_id")})
    if not recipient or not recipient.get("email"):
        logger.warning("Review invite skipped: recipient/email missing | review_id=%s", review["review_id"])
        return False

    reviewee_employee = await db.employees.find_one({"employee_id": review["employee_id"]})
    reviewee = await db.candidates.find_one(
        {"candidate_id": (reviewee_employee or {}).get("candidate_id")},
    ) or {}
    cycle = await db.performance_cycles.find_one({"cycle_id": review["cycle_id"]}) or {}

    review_url = f"{base_url()}/performance-review/{review['secure_token']}"
    await mail_brand.load()
    recipient_name = recipient.get("name") or "there"
    cycle_name = cycle.get("name") or "your review cycle"
    subject_context = "your own" if reviewer_type == "self" else f"{reviewee.get('name', 'a colleague')}'s"
    subject = f"Performance Review: {cycle_name}"

    text_body = f"""Dear {recipient_name},

You have been asked to complete {subject_context} performance review for "{cycle_name}".

  Review Link: {review_url}

Please complete it at your earliest convenience.

Best regards,
{sender_name()}"""
    body_html = (
        email_layout.greeting(_html.escape(str(recipient_name)))
        + email_layout.paragraph(
            f"You have been asked to complete {_html.escape(str(subject_context))} performance review for "
            f"<strong>{_html.escape(str(cycle_name))}</strong>."
        )
        + email_service.cta(review_url, "Start Review")
        + email_layout.small("This link is unique to you.")
        + email_layout.signoff(_html.escape(sender_name()))
    )
    html_body = email_service.wrap_html(heading="Performance Review", body_html=body_html)

    from services.hr_module.email_service import send_email
    return await send_email(
        to=recipient["email"], subject=subject, html_body=html_body, text_body=text_body,
        db=db, template="performance_review_invite",
        candidate_id=recipient.get("candidate_id"), job_id=recipient.get("job_id"),
    )


@router.post("/reviews/assign")
async def assign_review(
    body: ReviewAssignRequest,
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("performance:manage")),
    _plan: None = Depends(require_feature("performance")),
):
    db = _require_db()
    try:
        review = await performance_service.create_token_review(
            db, cycle_id=body.cycle_id, employee_id=body.employee_id, reviewer_type=body.reviewer_type,
            reviewer_employee_id=body.reviewer_employee_id,
        )
    except ValueError as exc:
        raise _error(exc)

    email_sent = await _send_review_invite_email(db, review)
    if not email_sent:
        logger.warning("Performance review invite email not delivered | review_id=%s", review["review_id"])

    asyncio.create_task(log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="performance_review_assign", resource_type="performance_review", resource_id=review["review_id"],
        details={
            "cycle_id": body.cycle_id, "employee_id": body.employee_id,
            "reviewer_type": body.reviewer_type, "email_sent": email_sent,
        },
    ))
    return {**review, "email_sent": email_sent}


@router.get("/reviews")
async def list_reviews(
    cycle_id: str | None = None,
    employee_id: str | None = None,
    reviewer_type: str | None = None,
    status: str | None = None,
    _: dict = Depends(require_permission("performance:read")),
    _plan: None = Depends(require_feature("performance")),
):
    db = _require_db()
    reviews = await performance_service.list_reviews(
        db, cycle_id=cycle_id, employee_id=employee_id, reviewer_type=reviewer_type, status=status,
    )
    return {"reviews": reviews}


@router.get("/reviews/{review_id}")
async def get_review(review_id: str, _: dict = Depends(require_permission("performance:read")), _plan: None = Depends(require_feature("performance"))):
    db = _require_db()
    review = await performance_service.get_review(db, review_id)
    if not review:
        raise HTTPException(404, "Review not found")
    return review


@router.get("/employees/{employee_id}/goals")
async def list_employee_goals(employee_id: str, _: dict = Depends(require_permission("performance:read")), _plan: None = Depends(require_feature("performance"))):
    db = _require_db()
    return {"goals": await performance_service.list_goals(db, employee_id)}


@router.post("/employees/{employee_id}/goals")
async def create_employee_goal(
    employee_id: str,
    body: GoalCreateRequest,
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("performance:manage")),
    _plan: None = Depends(require_feature("performance")),
):
    db = _require_db()
    try:
        goal = await performance_service.create_goal(
            db, owner_id=employee_id, title=body.title, description=body.description,
            due_date=body.due_date, parent_goal_id=body.parent_goal_id, created_by=user["email"],
        )
    except ValueError as exc:
        raise _error(exc)

    asyncio.create_task(log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="goal_create", resource_type="goal", resource_id=goal["goal_id"],
        details={"owner_id": employee_id, "title": body.title},
    ))
    return goal


@router.patch("/goals/{goal_id}")
async def update_goal(
    goal_id: str,
    body: GoalUpdateRequest,
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("performance:manage")),
    _plan: None = Depends(require_feature("performance")),
):
    db = _require_db()
    update = {k: v for k, v in body.model_dump().items() if v is not None}
    try:
        updated = await performance_service.update_goal(db, goal_id, update)
    except ValueError as exc:
        raise _error(exc)

    asyncio.create_task(log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="goal_update", resource_type="goal", resource_id=goal_id,
        details=update,
    ))
    return updated


@router.post("/rating-dimensions")
async def create_rating_dimension(
    body: RatingDimensionCreate,
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("performance:manage")),
    _plan: None = Depends(require_feature("performance")),
):
    db = _require_db()
    try:
        dimension = await performance_service.create_rating_dimension(
            db, name=body.name, description=body.description, created_by=user["email"],
        )
    except ValueError as exc:
        raise _error(exc)

    asyncio.create_task(log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="performance_rating_dimension_create", resource_type="performance_rating_dimension",
        resource_id=dimension["dimension_id"], details={"name": body.name},
    ))
    return dimension


@router.patch("/rating-dimensions/{dimension_id}")
async def update_rating_dimension(
    dimension_id: str,
    body: RatingDimensionUpdate,
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("performance:manage")),
    _plan: None = Depends(require_feature("performance")),
):
    db = _require_db()
    update = {k: v for k, v in body.model_dump().items() if v is not None}
    try:
        await performance_service.update_rating_dimension(db, dimension_id, update)
    except ValueError as exc:
        raise _error(exc)

    asyncio.create_task(log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="performance_rating_dimension_update", resource_type="performance_rating_dimension",
        resource_id=dimension_id, details=update,
    ))
    return {"message": "Updated"}


@router.delete("/rating-dimensions/{dimension_id}")
async def delete_rating_dimension(
    dimension_id: str,
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("performance:manage")),
    _plan: None = Depends(require_feature("performance")),
):
    db = _require_db()
    try:
        await performance_service.delete_rating_dimension(db, dimension_id)
    except ValueError as exc:
        raise _error(exc)

    asyncio.create_task(log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="performance_rating_dimension_delete", resource_type="performance_rating_dimension",
        resource_id=dimension_id, details={},
    ))
    return {"message": "Deleted"}


@router.patch("/rating-scale")
async def update_rating_scale(
    body: RatingScaleUpdate,
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("performance:manage")),
    _plan: None = Depends(require_feature("performance")),
):
    db = _require_db()
    try:
        scale = await performance_service.set_rating_scale(db, body.scale_min, body.scale_max)
    except ValueError as exc:
        raise _error(exc)

    asyncio.create_task(log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="performance_rating_scale_update", resource_type="performance_rating_scale",
        resource_id=None, details=scale,
    ))
    return scale


_rating_config_lookup_throttle = public_token_throttle("performance-config", ip_limit=120, param=None)


@router.get("/rating-config")
async def get_rating_config(
    request: Request,
    token: str | None = None,
    user: dict | None = Depends(get_optional_user),
):
    if user is None:
        resolved = False
        if token:
            await _rating_config_lookup_throttle(request)
            resolved = await bind_company_for_token("review", token)
        if not resolved:
            return performance_service.default_rating_config()
    db = _require_db()
    return await performance_service.get_rating_config(db)


@router.get("/public/{secure_token}", dependencies=[Depends(_public_throttle)])
async def get_public_review(secure_token: str):
    db = _require_db()
    review = await performance_service.get_review_by_token(db, secure_token)
    if not review:
        raise HTTPException(404, "Invalid review link")
    if performance_service.is_token_review_expired(review, days=settings.PERFORMANCE_REVIEW_EXPIRY_DAYS):
        raise HTTPException(410, "This review link has expired: please request a new invite")

    employee = await employee_service.get_employee(db, review["employee_id"]) or {}
    employee_candidate = await db.candidates.find_one({"candidate_id": employee.get("candidate_id")}) or {}

    reviewer_name = None
    if review["reviewer_type"] == "peer":
        reviewer_employee = await employee_service.get_employee(db, review["reviewer_id"]) or {}
        reviewer_candidate = await db.candidates.find_one(
            {"candidate_id": reviewer_employee.get("candidate_id")},
        ) or {}
        reviewer_name = reviewer_candidate.get("name")

    cycle = await performance_service.get_cycle(db, review["cycle_id"]) or {}

    goals = None
    if review["reviewer_type"] == "self":
        goals = await performance_service.list_goals(db, review["employee_id"])

    return {
        "review_id": review["review_id"],
        "cycle_id": review["cycle_id"],
        "cycle_name": cycle.get("name"),
        "reviewer_type": review["reviewer_type"],
        "employee_name": employee_candidate.get("name"),
        "reviewer_name": reviewer_name,
        "status": review["status"],
        "ratings": review.get("ratings") or {},
        "comments": review.get("comments"),
        "rating_config": await performance_service.get_rating_config(db),
        "goals": goals,
    }


@router.post("/public/{secure_token}/submit", dependencies=[Depends(_public_throttle)])
async def submit_public_review(secure_token: str, body: TokenReviewSubmitRequest):
    db = _require_db()
    try:
        updated = await performance_service.submit_token_review(db, secure_token, body.ratings, body.comments)
    except ValueError as exc:
        raise _error(exc)
    return _without_workspace_id(updated)


@router.patch("/public/{secure_token}/goals/{goal_id}", dependencies=[Depends(_public_throttle)])
async def update_public_goal_progress(secure_token: str, goal_id: str, body: GoalProgressRequest):
    db = _require_db()
    review = await performance_service.get_review_by_token(db, secure_token)
    if not review:
        raise HTTPException(404, "Invalid review link")
    if review["reviewer_type"] != "self":
        raise HTTPException(403, "This link cannot update goals")
    if performance_service.is_token_review_expired(review, days=settings.PERFORMANCE_REVIEW_EXPIRY_DAYS):
        raise HTTPException(410, "This review link has expired: please request a new invite")

    try:
        updated = await performance_service.update_goal_progress_by_owner(
            db, goal_id, review["employee_id"], body.progress_pct,
        )
    except ValueError as exc:
        raise _error(exc)
    return _without_workspace_id(updated)
