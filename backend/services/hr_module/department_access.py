from __future__ import annotations

from fastapi import Depends, HTTPException, Request

from config.database import get_db
from services.hr_module.permissions import get_department_scope
from shared.auth import get_current_user


def job_in_scope(job: dict | None, scope: str | None) -> bool:
    if scope is None:
        return True
    if not job:
        return False
    return (job.get("department_id") or None) in (scope, None)


async def require_job_access(db, user: dict, job_id: str | None, *, not_found: str = "Job not found") -> str | None:
    scope = await get_department_scope(user)
    if scope is None:
        return None
    job = await db.jobs.find_one({"job_id": job_id}, {"_id": 0, "department_id": 1}) if job_id else None
    if not job_in_scope(job, scope):
        raise HTTPException(404, not_found)
    return scope


async def candidate_visible(db, scope: str | None, cand: dict | None) -> bool:
    if scope is None:
        return True
    if not cand or not cand.get("job_id"):
        return False
    job = await db.jobs.find_one({"job_id": cand["job_id"]}, {"_id": 0, "department_id": 1})
    return job_in_scope(job, scope)


def _with_job_id(projection: dict | None) -> dict | None:
    if projection is None:
        return None
    inclusion = any(v for k, v in projection.items() if k != "_id")
    if inclusion and "job_id" not in projection:
        return {**projection, "job_id": 1}
    return projection


async def _load_in_scope(db, user: dict, query: dict, projection: dict | None, not_found: str) -> dict:
    proj = _with_job_id(projection)
    cand = await db.candidates.find_one(query, proj) if proj is not None else await db.candidates.find_one(query)
    if not cand:
        raise HTTPException(404, not_found)
    scope = await get_department_scope(user)
    if not await candidate_visible(db, scope, cand):
        raise HTTPException(404, not_found)
    return cand


async def require_candidate(
    db, user: dict, candidate_id: str, *, projection: dict | None = None, not_found: str = "Candidate not found",
) -> dict:
    return await _load_in_scope(db, user, {"candidate_id": candidate_id}, projection, not_found)


async def require_candidate_by_token(
    db, user: dict, secure_token: str, *, projection: dict | None = None, not_found: str = "Session not found",
) -> dict:
    return await _load_in_scope(db, user, {"secure_token": secure_token}, projection, not_found)


async def scoped_job_ids(db, scope: str) -> list[str]:
    return [
        j["job_id"] async for j in db.jobs.find({"department_id": {"$in": [scope, None]}}, {"_id": 0, "job_id": 1})
    ]


async def filter_candidates(db, user: dict, cands: list[dict]) -> list[dict]:
    scope = await get_department_scope(user)
    if scope is None:
        return cands
    allowed = set(await scoped_job_ids(db, scope))
    return [c for c in cands if c.get("job_id") in allowed]


async def require_offer_access(db, user: dict, offer: dict | None, *, not_found: str = "Offer not found") -> dict:
    if not offer:
        raise HTTPException(404, not_found)
    scope = await get_department_scope(user)
    if scope is None:
        return offer
    job = (
        await db.jobs.find_one({"job_id": offer.get("job_id")}, {"_id": 0, "department_id": 1})
        if offer.get("job_id") else None
    )
    if not job_in_scope(job, scope):
        raise HTTPException(404, not_found)
    return offer


async def enforce_candidate_path_scope(request: Request, user: dict = Depends(get_current_user)) -> None:
    candidate_id = request.path_params.get("candidate_id")
    if not candidate_id:
        return
    scope = await get_department_scope(user)
    if scope is None:
        return
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    cand = await db.candidates.find_one({"candidate_id": candidate_id}, {"_id": 0, "job_id": 1})
    if not await candidate_visible(db, scope, cand):
        raise HTTPException(404, "Candidate not found")


async def enforce_job_path_scope(request: Request, user: dict = Depends(get_current_user)) -> None:
    job_id = request.path_params.get("job_id")
    if not job_id:
        return
    scope = await get_department_scope(user)
    if scope is None:
        return
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    job = await db.jobs.find_one({"job_id": job_id}, {"_id": 0, "department_id": 1})
    if not job_in_scope(job, scope):
        raise HTTPException(404, "Job not found")


async def scope_profile(db, user: dict, profile: dict | None) -> dict | None:
    if profile is None:
        return None
    scope = await get_department_scope(user)
    if scope is None:
        return profile
    allowed = set(await scoped_job_ids(db, scope))
    linked = [c for c in profile.get("linked_candidates") or [] if c.get("job_id") in allowed]
    if not linked:
        return None
    keep = {c.get("candidate_id") for c in linked}
    return {
        **profile,
        "linked_candidates": linked,
        "candidate_ids": [i for i in profile.get("candidate_ids") or [] if i in keep],
        "job_ids": [j for j in profile.get("job_ids") or [] if j in allowed],
    }


async def limit_matched_jds(db, user: dict, docs: list[dict]) -> None:
    scope = await get_department_scope(user)
    if scope is None:
        return
    allowed = set(await scoped_job_ids(db, scope))
    for doc in docs:
        matches = doc.get("matched_jds")
        if isinstance(matches, list):
            doc["matched_jds"] = [m for m in matches if isinstance(m, dict) and m.get("job_id") in allowed]


async def ensure_candidate_in_scope(db, user: dict, candidate_id: str, *, not_found: str = "Candidate not found") -> None:
    scope = await get_department_scope(user)
    if scope is None:
        return
    cand = await db.candidates.find_one({"candidate_id": candidate_id}, {"_id": 0, "job_id": 1})
    if cand is not None and not await candidate_visible(db, scope, cand):
        raise HTTPException(404, not_found)


async def candidate_ids_in_scope(db, user: dict, candidate_ids: list[str] | None = None) -> set[str] | None:
    scope = await get_department_scope(user)
    if scope is None:
        return None
    query: dict = {"job_id": {"$in": await scoped_job_ids(db, scope)}}
    if candidate_ids is not None:
        query["candidate_id"] = {"$in": list(candidate_ids)}
    return {c["candidate_id"] async for c in db.candidates.find(query, {"_id": 0, "candidate_id": 1})}
