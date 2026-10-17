async def list_job_grade_names(db) -> list[str]:
    docs = await db.job_grades.find({}, {"_id": 0, "name": 1}).to_list(length=500)
    return [d["name"] for d in docs if d.get("name")]


async def validate_job_grade(db, job_grade: str | None) -> None:
    if not job_grade:
        return
    names = await list_job_grade_names(db)
    if names and job_grade not in names:
        raise ValueError(
            f"'{job_grade}' is not a configured job grade. "
            f"Configured grades: {', '.join(sorted(names))}"
        )
