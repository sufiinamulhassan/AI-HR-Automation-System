from datetime import datetime, timezone


async def submit_demographics(
    db, candidate_id: str, gender: str | None, location: str | None,
) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "candidate_id": candidate_id,
        "gender": gender,
        "location": location,
        "submitted_at": now,
    }
    await db.candidate_demographics.update_one(
        {"candidate_id": candidate_id}, {"$set": doc}, upsert=True,
    )
    return doc


async def compute_diversity_breakdown(db, scope=None) -> dict:
    visible_demo = scope.by_candidate_id() if scope else {}
    visible_candidates = scope.candidates if scope else (lambda q=None: q or {})
    demo_docs = await db.candidate_demographics.find(visible_demo, {"_id": 0}).to_list(length=None)
    if not demo_docs:
        return {"status": "insufficient_data", "breakdown": None}

    by_gender: dict[str, int] = {}
    by_location: dict[str, int] = {}
    for d in demo_docs:
        gender = d.get("gender") or "unspecified"
        location = d.get("location") or "unspecified"
        by_gender[gender] = by_gender.get(gender, 0) + 1
        by_location[location] = by_location.get(location, 0) + 1

    candidate_ids = [d["candidate_id"] for d in demo_docs if d.get("candidate_id")]
    cand_docs = await db.candidates.find(
        {"candidate_id": {"$in": candidate_ids}}, {"_id": 0, "candidate_id": 1, "job_id": 1},
    ).to_list(length=None)
    job_id_by_candidate = {c["candidate_id"]: c.get("job_id") for c in cand_docs if c.get("candidate_id")}

    job_ids = list({jid for jid in job_id_by_candidate.values() if jid})
    job_docs = await db.jobs.find(
        {"job_id": {"$in": job_ids}}, {"_id": 0, "job_id": 1, "job_grade": 1},
    ).to_list(length=None)
    grade_by_job = {j["job_id"]: j.get("job_grade") for j in job_docs}

    by_grade: dict[str, int] = {}
    for d in demo_docs:
        job_id = job_id_by_candidate.get(d.get("candidate_id"))
        grade = grade_by_job.get(job_id) or "unspecified"
        by_grade[grade] = by_grade.get(grade, 0) + 1

    asked = await db.candidates.count_documents(visible_candidates({"doc_type": "candidate"}))
    response_rate = round(len(demo_docs) / asked, 4) if asked else None

    return {
        "status": "ready",
        "breakdown": {
            "by_gender": by_gender,
            "by_location": by_location,
            "by_grade": by_grade,
            "response_rate": response_rate,
        },
    }
