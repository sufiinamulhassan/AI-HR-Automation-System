import logging
import uuid
from datetime import datetime, timezone

from pymongo.errors import DuplicateKeyError

logger = logging.getLogger(__name__)


async def create_employee_from_offer(db, offer: dict) -> dict | None:
    if db is None:
        logger.warning("create_employee_from_offer skipped: database unavailable")
        return None
    try:
        candidate_id = offer.get("candidate_id")
        job_id = offer.get("job_id")
        job = await db.jobs.find_one({"job_id": job_id}) or {}

        now = datetime.now(timezone.utc).isoformat()
        doc = {
            "employee_id": str(uuid.uuid4()),
            "candidate_id": candidate_id,
            "job_id": job_id,
            "offer_id": offer.get("offer_id"),
            "department": job.get("department_id"),
            "job_grade": job.get("job_grade"),
            "manager_id": None,
            "hired_at": now,
            "status": "active",
            "created_at": now,
            "updated_at": now,
        }
        await db.employees.insert_one(doc)
        doc.pop("_id", None)
        logger.info(
            "Employee created from accepted offer | employee_id=%s offer_id=%s candidate_id=%s",
            doc["employee_id"], offer.get("offer_id"), candidate_id,
        )
        return doc
    except DuplicateKeyError:
        logger.info("Employee already exists for offer_id=%s: skipping create", offer.get("offer_id"))
        return await db.employees.find_one({"offer_id": offer.get("offer_id")}, {"_id": 0})
    except Exception as exc:
        logger.error(
            "create_employee_from_offer failed | offer_id=%s error=%s", offer.get("offer_id"), exc,
        )
        return None


async def get_employee(db, employee_id: str) -> dict | None:
    return await db.employees.find_one({"employee_id": employee_id}, {"_id": 0})


async def get_employee_by_candidate(db, candidate_id: str) -> dict | None:
    return await db.employees.find_one({"candidate_id": candidate_id}, {"_id": 0})


async def list_employees(
    db,
    *,
    department: str | None = None,
    job_grade: str | None = None,
    manager_id: str | None = None,
) -> list[dict]:
    query: dict = {}
    if department:
        query["department"] = department
    if job_grade:
        query["job_grade"] = job_grade
    if manager_id:
        query["manager_id"] = manager_id
    cursor = db.employees.find(query, {"_id": 0}).sort("hired_at", -1)
    return await cursor.to_list(length=1000)


async def set_manager(db, employee_id: str, manager_id: str | None) -> dict:
    employee = await db.employees.find_one({"employee_id": employee_id})
    if not employee:
        raise ValueError("employee_not_found")

    if manager_id:
        manager_user = await db.users.find_one({"email": manager_id, "is_active": True})
        if not manager_user:
            raise ValueError("manager_not_found")
        candidate = await db.candidates.find_one({"candidate_id": employee.get("candidate_id")}) or {}
        if candidate.get("email") and candidate["email"] == manager_id:
            raise ValueError("An employee cannot be their own manager")

    now = datetime.now(timezone.utc).isoformat()
    await db.employees.update_one(
        {"employee_id": employee_id}, {"$set": {"manager_id": manager_id, "updated_at": now}},
    )
    return await db.employees.find_one({"employee_id": employee_id}, {"_id": 0})


async def _employee_as_manager(db, manager_email: str) -> dict | None:
    candidate = await db.candidates.find_one({"email": manager_email}, {"_id": 0, "candidate_id": 1})
    if not candidate:
        return None
    return await db.employees.find_one({"candidate_id": candidate["candidate_id"]}, {"_id": 0})


async def reporting_relation(db, employee: dict, staff_email: str) -> str | None:
    if employee.get("manager_id") == staff_email:
        return "manager"
    direct_manager_email = employee.get("manager_id")
    if not direct_manager_email:
        return None
    manager_employee = await _employee_as_manager(db, direct_manager_email)
    if manager_employee and manager_employee.get("manager_id") == staff_email:
        return "skip_level"
    return None


async def expected_reviewers(db, employee: dict) -> dict:
    direct_manager_email = employee.get("manager_id")
    skip_manager_email = None
    if direct_manager_email:
        manager_employee = await _employee_as_manager(db, direct_manager_email)
        if manager_employee:
            skip_manager_email = manager_employee.get("manager_id")
    return {"manager": direct_manager_email, "skip_level": skip_manager_email}


async def expected_reviewers_bulk(db, employees: list[dict]) -> dict[str, dict]:
    manager_emails = sorted({e["manager_id"] for e in employees if e.get("manager_id")})
    skip_by_manager: dict[str, str | None] = {}
    if manager_emails:
        candidate_rows = await db.candidates.find(
            {"email": {"$in": manager_emails}}, {"_id": 0, "candidate_id": 1, "email": 1},
        ).to_list(length=None)
        email_by_candidate = {c["candidate_id"]: c["email"] for c in candidate_rows if c.get("candidate_id")}
        if email_by_candidate:
            employee_rows = await db.employees.find(
                {"candidate_id": {"$in": list(email_by_candidate)}},
                {"_id": 0, "candidate_id": 1, "manager_id": 1},
            ).to_list(length=None)
            for row in employee_rows:
                email = email_by_candidate.get(row.get("candidate_id"))
                if email and email not in skip_by_manager:
                    skip_by_manager[email] = row.get("manager_id")
    return {
        e["employee_id"]: {
            "manager": e.get("manager_id"),
            "skip_level": skip_by_manager.get(e["manager_id"]) if e.get("manager_id") else None,
        }
        for e in employees
    }


async def list_my_reports(db, manager_email: str) -> dict:
    direct = await list_employees(db, manager_id=manager_email)
    skip: list[dict] = []
    for report in direct:
        candidate = await db.candidates.find_one(
            {"candidate_id": report.get("candidate_id")}, {"_id": 0, "email": 1},
        )
        if candidate and candidate.get("email"):
            skip.extend(await list_employees(db, manager_id=candidate["email"]))
    return {"direct_reports": direct, "skip_level_reports": skip}
