import logging
import uuid
from datetime import datetime, timezone

from config.database import get_db
from services.hr_module.candidate_identity import (
    hydrate_job_titles,
    normalize_linkedin,
    normalize_phone,
)

logger = logging.getLogger(__name__)


async def upsert_candidate_profile(candidate_doc: dict) -> str | None:
    db = get_db()
    if db is None:
        return None

    email = (candidate_doc.get("email") or "").strip().lower()
    if not email:
        logger.info("upsert_candidate_profile skipped: no email on candidate_id=%s", candidate_doc.get("candidate_id"))
        return None

    phone_normalized = candidate_doc.get("phone_normalized") or normalize_phone(candidate_doc.get("phone"))
    linkedin_normalized = candidate_doc.get("linkedin_normalized") or normalize_linkedin(candidate_doc.get("linkedin_url"))
    name = candidate_doc.get("name")
    candidate_id = candidate_doc.get("candidate_id")
    job_id = candidate_doc.get("job_id")
    resume_id = candidate_doc.get("resume_id")

    now = datetime.now(timezone.utc).isoformat()

    existing = await db.candidate_profiles.find_one({"email": email}, {"_id": 0, "profile_id": 1})

    if existing:
        profile_id = existing["profile_id"]
        set_fields: dict = {"last_seen_at": now, "updated_at": now}
        if name:
            set_fields["name"] = name
        if phone_normalized:
            set_fields["phone_normalized"] = phone_normalized
        if linkedin_normalized:
            set_fields["linkedin_normalized"] = linkedin_normalized

        add_to_set: dict = {}
        if candidate_id:
            add_to_set["candidate_ids"] = candidate_id
        if job_id:
            add_to_set["job_ids"] = job_id
        if resume_id:
            add_to_set["resume_ids"] = resume_id

        update: dict = {"$set": set_fields}
        if add_to_set:
            update["$addToSet"] = add_to_set

        await db.candidate_profiles.update_one({"profile_id": profile_id}, update)
        return profile_id

    profile_id = str(uuid.uuid4())
    doc = {
        "profile_id": profile_id,
        "email": email,
        "phone_normalized": phone_normalized,
        "linkedin_normalized": linkedin_normalized,
        "name": name,
        "profile_notes": None,
        "candidate_ids": [candidate_id] if candidate_id else [],
        "job_ids": [job_id] if job_id else [],
        "resume_ids": [resume_id] if resume_id else [],
        "first_seen_at": now,
        "last_seen_at": now,
        "updated_at": now,
    }
    await db.candidate_profiles.insert_one(doc)
    return profile_id


async def _hydrate_profile(db, profile: dict) -> dict:
    candidate_ids = profile.get("candidate_ids") or []
    linked_candidates: list[dict] = []
    if candidate_ids:
        cursor = db.candidates.find({"candidate_id": {"$in": candidate_ids}}, {"_id": 0}).sort("created_at", 1)
        others = await cursor.to_list(length=None)
        job_ids = list({c["job_id"] for c in others if c.get("job_id")})
        jobs_by_id = await hydrate_job_titles(db, job_ids)
        linked_candidates = [
            {
                "candidate_id": c.get("candidate_id"),
                "job_id": c.get("job_id"),
                "job_title": jobs_by_id.get(c.get("job_id")),
                "status": c.get("status"),
                "decision": c.get("decision"),
                "invite_type": c.get("invite_type"),
                "created_at": c.get("created_at"),
                "decided_at": c.get("decided_at"),
            }
            for c in others
        ]
    return {**profile, "linked_candidates": linked_candidates}


async def get_candidate_profile(profile_id: str) -> dict | None:
    db = get_db()
    if db is None:
        return None
    profile = await db.candidate_profiles.find_one({"profile_id": profile_id}, {"_id": 0})
    if not profile:
        return None
    return await _hydrate_profile(db, profile)


async def get_candidate_profile_by_email(email: str) -> dict | None:
    db = get_db()
    if db is None:
        return None
    normalized_email = (email or "").strip().lower()
    if not normalized_email:
        return None
    profile = await db.candidate_profiles.find_one({"email": normalized_email}, {"_id": 0})
    if not profile:
        return None
    return await _hydrate_profile(db, profile)


async def update_profile_notes(profile_id: str, notes: str) -> dict | None:
    db = get_db()
    if db is None:
        return None
    existing = await db.candidate_profiles.find_one({"profile_id": profile_id}, {"_id": 0, "profile_id": 1})
    if not existing:
        return None
    now = datetime.now(timezone.utc).isoformat()
    await db.candidate_profiles.update_one(
        {"profile_id": profile_id},
        {"$set": {"profile_notes": notes, "updated_at": now}},
    )
    return {"profile_id": profile_id, "profile_notes": notes, "updated_at": now}
