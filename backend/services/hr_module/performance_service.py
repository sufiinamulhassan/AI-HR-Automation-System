import logging
import uuid
from datetime import datetime, timezone

from pymongo.errors import DuplicateKeyError

from shared.utils import is_invite_expired, new_secure_token

logger = logging.getLogger(__name__)

CYCLE_STATUSES = ("draft", "active", "closed")
REVIEW_TYPES = ("self", "manager", "peer", "skip_level")
TOKEN_REVIEW_TYPES = ("self", "peer")
GOAL_STATUSES = ("active", "completed", "abandoned")
CYCLE_SCOPE_TYPES = ("org_wide", "department", "job_grade")

_DEFAULT_SCALE = {"scale_min": 1, "scale_max": 5}
_RATING_SCALE_CONFIG_KEY = "performance_rating_scale"


async def list_rating_dimensions(db) -> list[dict]:
    return await db.performance_rating_dimensions.find({}, {"_id": 0}).sort("name", 1).to_list(length=None)


async def create_rating_dimension(db, *, name: str, description: str | None, created_by: str) -> dict:
    doc = {
        "dimension_id": str(uuid.uuid4()),
        "name": name,
        "description": description,
        "created_by": created_by,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        await db.performance_rating_dimensions.insert_one(doc)
    except DuplicateKeyError:
        raise ValueError("A rating dimension with this name already exists")
    doc.pop("_id", None)
    return doc


async def update_rating_dimension(db, dimension_id: str, update: dict) -> None:
    if not update:
        raise ValueError("No fields to update")
    try:
        result = await db.performance_rating_dimensions.update_one(
            {"dimension_id": dimension_id}, {"$set": update},
        )
    except DuplicateKeyError:
        raise ValueError("A rating dimension with this name already exists")
    if result.matched_count == 0:
        raise ValueError("not_found")


async def delete_rating_dimension(db, dimension_id: str) -> None:
    result = await db.performance_rating_dimensions.delete_one({"dimension_id": dimension_id})
    if result.deleted_count == 0:
        raise ValueError("not_found")


async def get_rating_scale(db) -> dict:
    doc = await db.system_config.find_one({"key": _RATING_SCALE_CONFIG_KEY}, {"_id": 0})
    if not doc:
        return dict(_DEFAULT_SCALE)
    return {"scale_min": doc.get("scale_min", 1), "scale_max": doc.get("scale_max", 5)}


async def set_rating_scale(db, scale_min: int, scale_max: int) -> dict:
    if scale_min >= scale_max:
        raise ValueError("scale_min must be less than scale_max")
    await db.system_config.update_one(
        {"key": _RATING_SCALE_CONFIG_KEY},
        {"$set": {"key": _RATING_SCALE_CONFIG_KEY, "scale_min": scale_min, "scale_max": scale_max}},
        upsert=True,
    )
    return {"scale_min": scale_min, "scale_max": scale_max}


def default_rating_config() -> dict:
    return {**_DEFAULT_SCALE, "dimensions": []}


async def get_rating_config(db) -> dict:
    scale = await get_rating_scale(db)
    dimensions = await list_rating_dimensions(db)
    return {**scale, "dimensions": dimensions}


def validate_ratings(ratings: dict, scale: dict, dimension_names: list[str]) -> None:
    if not isinstance(ratings, dict) or not ratings:
        raise ValueError("ratings must be a non-empty object of dimension name -> score")
    allowed = set(dimension_names)
    for dim, score in ratings.items():
        if allowed and dim not in allowed:
            raise ValueError(f"'{dim}' is not a configured rating dimension")
        try:
            score_num = float(score)
        except (TypeError, ValueError):
            raise ValueError(f"Rating for '{dim}' must be numeric")
        if not (scale["scale_min"] <= score_num <= scale["scale_max"]):
            raise ValueError(
                f"Rating for '{dim}' must be between {scale['scale_min']} and {scale['scale_max']}"
            )


async def create_cycle(
    db, *, name: str, period_start: str, period_end: str, scope: dict, review_types: list[str],
    created_by: str,
) -> dict:
    if scope.get("type") not in CYCLE_SCOPE_TYPES:
        raise ValueError(f"scope.type must be one of {', '.join(CYCLE_SCOPE_TYPES)}")
    if scope.get("type") != "org_wide" and not scope.get("value"):
        raise ValueError("scope.value is required when scope.type is not 'org_wide'")
    if not review_types:
        raise ValueError("review_types must include at least one of " + ", ".join(REVIEW_TYPES))
    bad_types = sorted(set(review_types) - set(REVIEW_TYPES))
    if bad_types:
        raise ValueError(f"Unknown review_types: {bad_types}")

    normalized_scope = {"type": scope["type"], "value": scope.get("value") if scope["type"] != "org_wide" else None}
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "cycle_id": str(uuid.uuid4()),
        "name": name,
        "period_start": period_start,
        "period_end": period_end,
        "scope": normalized_scope,
        "review_types": review_types,
        "status": "draft",
        "created_by": created_by,
        "created_at": now,
        "updated_at": now,
    }
    await db.performance_cycles.insert_one(doc)
    doc.pop("_id", None)
    return doc


async def list_cycles(db, status: str | None = None) -> list[dict]:
    query = {"status": status} if status else {}
    cursor = db.performance_cycles.find(query, {"_id": 0}).sort("created_at", -1)
    return await cursor.to_list(length=500)


async def get_cycle(db, cycle_id: str) -> dict | None:
    return await db.performance_cycles.find_one({"cycle_id": cycle_id}, {"_id": 0})


async def update_cycle(db, cycle_id: str, update: dict) -> dict:
    cycle = await db.performance_cycles.find_one({"cycle_id": cycle_id})
    if not cycle:
        raise ValueError("not_found")
    if cycle.get("status") == "closed":
        raise ValueError("Cannot update a closed cycle")

    if not update:
        raise ValueError("No fields to update")

    if "review_types" in update:
        review_types = update["review_types"]
        if not review_types:
            raise ValueError("review_types must include at least one of " + ", ".join(REVIEW_TYPES))
        bad_types = sorted(set(review_types) - set(REVIEW_TYPES))
        if bad_types:
            raise ValueError(f"Unknown review_types: {bad_types}")

    if "scope" in update:
        scope = update["scope"]
        if scope.get("type") not in CYCLE_SCOPE_TYPES:
            raise ValueError(f"scope.type must be one of {', '.join(CYCLE_SCOPE_TYPES)}")
        if scope.get("type") != "org_wide" and not scope.get("value"):
            raise ValueError("scope.value is required when scope.type is not 'org_wide'")
        update["scope"] = {"type": scope["type"], "value": scope.get("value") if scope["type"] != "org_wide" else None}

    if "status" in update:
        new_status = update["status"]
        if new_status not in CYCLE_STATUSES:
            raise ValueError(f"Unknown status: {new_status}")
        if not (cycle.get("status") == "draft" and new_status == "active"):
            raise ValueError(
                "This endpoint only allows a draft -> active transition; "
                "use POST /cycles/{cycle_id}/close to close a cycle"
            )

    update = {**update, "updated_at": datetime.now(timezone.utc).isoformat()}
    await db.performance_cycles.update_one({"cycle_id": cycle_id}, {"$set": update})
    return await db.performance_cycles.find_one({"cycle_id": cycle_id}, {"_id": 0})


async def close_cycle(db, cycle_id: str) -> dict:
    cycle = await db.performance_cycles.find_one({"cycle_id": cycle_id})
    if not cycle:
        raise ValueError("not_found")
    if cycle.get("status") == "closed":
        raise ValueError("Cycle is already closed")
    now = datetime.now(timezone.utc).isoformat()
    await db.performance_cycles.update_one(
        {"cycle_id": cycle_id}, {"$set": {"status": "closed", "updated_at": now}},
    )
    return await db.performance_cycles.find_one({"cycle_id": cycle_id}, {"_id": 0})


async def get_cycle_coverage(db, cycle_id: str) -> dict:
    cycle = await db.performance_cycles.find_one({"cycle_id": cycle_id}, {"_id": 0})
    if not cycle:
        raise ValueError("cycle_not_found")

    from services.hr_module import employee_service

    reviewer_types = [rt for rt in ("manager", "skip_level") if rt in cycle.get("review_types", [])]

    scope = cycle.get("scope") or {"type": "org_wide"}
    if scope.get("type") == "department":
        employees = await employee_service.list_employees(db, department=scope.get("value"))
    elif scope.get("type") == "job_grade":
        employees = await employee_service.list_employees(db, job_grade=scope.get("value"))
    else:
        employees = await employee_service.list_employees(db)

    submitted_pairs: set[tuple[str, str]] = set()
    if reviewer_types and employees:
        cursor = db.performance_reviews.find(
            {"cycle_id": cycle_id, "reviewer_type": {"$in": reviewer_types}, "status": "submitted"},
            {"_id": 0, "employee_id": 1, "reviewer_type": 1},
        )
        submitted_pairs = {(r["employee_id"], r["reviewer_type"]) for r in await cursor.to_list(length=10000)}

    reviewers_by_employee: dict[str, dict] = {}
    names_by_candidate: dict[str, str | None] = {}
    if reviewer_types and employees:
        reviewers_by_employee = await employee_service.expected_reviewers_bulk(db, employees)
        candidate_ids = list({e["candidate_id"] for e in employees if e.get("candidate_id")})
        if candidate_ids:
            name_rows = await db.candidates.find(
                {"candidate_id": {"$in": candidate_ids}}, {"_id": 0, "candidate_id": 1, "name": 1},
            ).to_list(length=None)
            names_by_candidate = {r["candidate_id"]: r.get("name") for r in name_rows}

    outstanding: list[dict] = []
    for employee in employees:
        if not reviewer_types:
            continue
        reviewers = reviewers_by_employee.get(employee["employee_id"], {})
        for reviewer_type in reviewer_types:
            if (employee["employee_id"], reviewer_type) in submitted_pairs:
                continue
            expected_reviewer_email = reviewers.get(reviewer_type)
            outstanding.append({
                "employee_id": employee["employee_id"],
                "employee_name": names_by_candidate.get(employee.get("candidate_id")),
                "reviewer_type": reviewer_type,
                "expected_reviewer_email": expected_reviewer_email,
                "blocked": expected_reviewer_email is None,
            })

    expected_total = len(employees) * len(reviewer_types)
    return {
        "cycle_id": cycle_id,
        "cycle_name": cycle.get("name"),
        "reviewer_types": reviewer_types,
        "employees_in_scope": len(employees),
        "expected_reviews": expected_total,
        "submitted_reviews": expected_total - len(outstanding),
        "outstanding_reviews": len(outstanding),
        "outstanding": outstanding,
    }


def is_token_review_expired(review: dict, *, days: int) -> bool:
    if review.get("status") != "pending":
        return False
    return is_invite_expired(review, days=days)


async def create_token_review(
    db, *, cycle_id: str, employee_id: str, reviewer_type: str, reviewer_employee_id: str | None,
) -> dict:
    if reviewer_type not in TOKEN_REVIEW_TYPES:
        raise ValueError(
            f"reviewer_type must be one of {TOKEN_REVIEW_TYPES} here; "
            "manager/skip_level reviews are submitted directly via the manager-submit endpoint"
        )
    cycle = await db.performance_cycles.find_one({"cycle_id": cycle_id})
    if not cycle:
        raise ValueError("cycle_not_found")
    if cycle.get("status") != "active":
        raise ValueError("Reviews can only be assigned on an active cycle")
    if reviewer_type not in cycle.get("review_types", []):
        raise ValueError(f"Cycle '{cycle.get('name')}' does not include '{reviewer_type}' reviews")

    employee = await db.employees.find_one({"employee_id": employee_id})
    if not employee:
        raise ValueError("employee_not_found")

    if reviewer_type == "self":
        reviewer_id = employee_id
    else:
        if not reviewer_employee_id:
            raise ValueError("reviewer_employee_id is required for a peer review")
        peer = await db.employees.find_one({"employee_id": reviewer_employee_id})
        if not peer:
            raise ValueError("reviewer_employee_not_found")
        reviewer_id = reviewer_employee_id

    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "review_id": str(uuid.uuid4()),
        "cycle_id": cycle_id,
        "employee_id": employee_id,
        "reviewer_id": reviewer_id,
        "reviewer_type": reviewer_type,
        "secure_token": new_secure_token(),
        "ratings": {},
        "comments": None,
        "status": "pending",
        "submitted_at": None,
        "created_at": now,
    }
    await db.performance_reviews.insert_one(doc)
    doc.pop("_id", None)
    return doc


async def submit_manager_review(
    db, *, cycle_id: str, employee_id: str, reviewer_type: str, reviewer_email: str,
    ratings: dict, comments: str | None,
) -> dict:
    if reviewer_type not in ("manager", "skip_level"):
        raise ValueError("reviewer_type must be 'manager' or 'skip_level'")
    cycle = await db.performance_cycles.find_one({"cycle_id": cycle_id})
    if not cycle:
        raise ValueError("cycle_not_found")
    if cycle.get("status") != "active":
        raise ValueError("Reviews can only be submitted on an active cycle")
    if reviewer_type not in cycle.get("review_types", []):
        raise ValueError(f"Cycle '{cycle.get('name')}' does not include '{reviewer_type}' reviews")

    employee = await db.employees.find_one({"employee_id": employee_id})
    if not employee:
        raise ValueError("employee_not_found")

    from services.hr_module.employee_service import reporting_relation
    relation = await reporting_relation(db, employee, reviewer_email)
    if relation != reviewer_type:
        raise ValueError("not_your_report")

    existing = await db.performance_reviews.find_one({
        "cycle_id": cycle_id, "employee_id": employee_id,
        "reviewer_id": reviewer_email, "reviewer_type": reviewer_type,
    })
    if existing:
        raise ValueError("already_submitted")

    scale = await get_rating_scale(db)
    dimension_names = [d["name"] for d in await list_rating_dimensions(db)]
    validate_ratings(ratings, scale, dimension_names)

    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "review_id": str(uuid.uuid4()),
        "cycle_id": cycle_id,
        "employee_id": employee_id,
        "reviewer_id": reviewer_email,
        "reviewer_type": reviewer_type,
        "ratings": ratings,
        "comments": comments,
        "status": "submitted",
        "submitted_at": now,
        "created_at": now,
    }
    await db.performance_reviews.insert_one(doc)
    doc.pop("_id", None)
    return doc


async def get_review_by_token(db, secure_token: str) -> dict | None:
    return await db.performance_reviews.find_one({"secure_token": secure_token}, {"_id": 0})


async def submit_token_review(db, secure_token: str, ratings: dict, comments: str | None) -> dict:
    from config.settings import settings

    review = await db.performance_reviews.find_one({"secure_token": secure_token})
    if not review:
        raise ValueError("not_found")
    if review.get("status") != "pending":
        raise ValueError("already_submitted")
    if is_token_review_expired(review, days=settings.PERFORMANCE_REVIEW_EXPIRY_DAYS):
        raise ValueError("expired")

    scale = await get_rating_scale(db)
    dimension_names = [d["name"] for d in await list_rating_dimensions(db)]
    validate_ratings(ratings, scale, dimension_names)

    now = datetime.now(timezone.utc).isoformat()
    await db.performance_reviews.update_one(
        {"secure_token": secure_token},
        {"$set": {"ratings": ratings, "comments": comments, "status": "submitted", "submitted_at": now}},
    )
    return await db.performance_reviews.find_one({"secure_token": secure_token}, {"_id": 0})


async def list_reviews(
    db, *, cycle_id: str | None = None, employee_id: str | None = None,
    reviewer_type: str | None = None, status: str | None = None,
) -> list[dict]:
    query: dict = {}
    if cycle_id:
        query["cycle_id"] = cycle_id
    if employee_id:
        query["employee_id"] = employee_id
    if reviewer_type:
        query["reviewer_type"] = reviewer_type
    if status:
        query["status"] = status
    cursor = db.performance_reviews.find(query, {"_id": 0}).sort("created_at", -1)
    return await cursor.to_list(length=1000)


async def get_review(db, review_id: str) -> dict | None:
    return await db.performance_reviews.find_one({"review_id": review_id}, {"_id": 0})


async def create_goal(
    db, *, owner_id: str, title: str, description: str | None, due_date: str | None,
    parent_goal_id: str | None, created_by: str,
) -> dict:
    employee = await db.employees.find_one({"employee_id": owner_id})
    if not employee:
        raise ValueError("employee_not_found")
    if parent_goal_id:
        parent = await db.goals.find_one({"goal_id": parent_goal_id})
        if not parent:
            raise ValueError("parent_goal_not_found")

    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "goal_id": str(uuid.uuid4()),
        "owner_id": owner_id,
        "title": title,
        "description": description,
        "due_date": due_date,
        "progress_pct": 0,
        "parent_goal_id": parent_goal_id,
        "status": "active",
        "created_by": created_by,
        "created_at": now,
        "updated_at": now,
    }
    await db.goals.insert_one(doc)
    doc.pop("_id", None)
    return doc


async def list_goals(db, owner_id: str) -> list[dict]:
    cursor = db.goals.find({"owner_id": owner_id}, {"_id": 0}).sort("created_at", -1)
    return await cursor.to_list(length=500)


async def get_goal(db, goal_id: str) -> dict | None:
    return await db.goals.find_one({"goal_id": goal_id}, {"_id": 0})


async def update_goal(db, goal_id: str, update: dict) -> dict:
    goal = await db.goals.find_one({"goal_id": goal_id})
    if not goal:
        raise ValueError("not_found")
    if not update:
        raise ValueError("No fields to update")
    if "progress_pct" in update and update["progress_pct"] is not None:
        if not (0 <= update["progress_pct"] <= 100):
            raise ValueError("progress_pct must be between 0 and 100")
    if "status" in update and update["status"] is not None and update["status"] not in GOAL_STATUSES:
        raise ValueError(f"Unknown status: {update['status']}")
    if update.get("parent_goal_id"):
        if update["parent_goal_id"] == goal_id:
            raise ValueError("A goal cannot be its own parent")
        if not await db.goals.find_one({"goal_id": update["parent_goal_id"]}):
            raise ValueError("parent_goal_not_found")

    update = {**update, "updated_at": datetime.now(timezone.utc).isoformat()}
    await db.goals.update_one({"goal_id": goal_id}, {"$set": update})
    return await db.goals.find_one({"goal_id": goal_id}, {"_id": 0})


async def update_goal_progress_by_owner(db, goal_id: str, owner_id: str, progress_pct: int) -> dict:
    goal = await db.goals.find_one({"goal_id": goal_id})
    if not goal:
        raise ValueError("not_found")
    if goal.get("owner_id") != owner_id:
        raise ValueError("not_your_goal")
    if not (0 <= progress_pct <= 100):
        raise ValueError("progress_pct must be between 0 and 100")

    now = datetime.now(timezone.utc).isoformat()
    await db.goals.update_one(
        {"goal_id": goal_id}, {"$set": {"progress_pct": progress_pct, "updated_at": now}},
    )
    return await db.goals.find_one({"goal_id": goal_id}, {"_id": 0})
