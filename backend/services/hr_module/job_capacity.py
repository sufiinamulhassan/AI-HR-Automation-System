from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime, timezone
from typing import Any

PROTECTED_STAGES = frozenset({"hired"})
PRUNE_MODES = frozenset({"job", "system"})
REMOVED_REASON = "below_min_score"


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def max_resumes(job: Mapping | None) -> int | None:
    value = _number((job or {}).get("max_resumes"))
    if value is None or value <= 0:
        return None
    return int(value)


def min_match_percent(job: Mapping | None) -> float | None:
    value = _number((job or {}).get("min_match_score"))
    if value is None or value <= 0:
        return None
    return min(100.0, value)


def pipeline_size(job: Mapping | None) -> int:
    return len((job or {}).get("candidate_pipeline") or [])


def remaining_slots(job: Mapping | None) -> int | None:
    cap = max_resumes(job)
    if cap is None:
        return None
    return max(0, cap - pipeline_size(job))


def is_full(job: Mapping | None) -> bool:
    return remaining_slots(job) == 0


def removed_ids(job: Mapping | None) -> set[str]:
    return {
        str(entry.get("resume_id"))
        for entry in (job or {}).get("removed_candidates") or []
        if isinstance(entry, Mapping) and entry.get("resume_id")
    }


def below_minimum(job: Mapping | None, score: float | None) -> bool:
    floor = min_match_percent(job)
    if floor is None or score is None:
        return False
    return float(score) * 100 < floor


def capacity_view(job: Mapping | None) -> dict:
    cap = max_resumes(job)
    used = pipeline_size(job)
    return {
        "max_resumes": cap,
        "resume_count": used,
        "remaining": None if cap is None else max(0, cap - used),
        "accepting": cap is None or used < cap,
    }


def push_filter(job_id: str, resume_id: str) -> dict:
    return {
        "job_id": job_id,
        "candidate_pipeline.resume_id": {"$ne": resume_id},
        "removed_candidates.resume_id": {"$ne": resume_id},
    }


def pipeline_score(entry: Mapping) -> float | None:
    if entry.get("targeted_upload") and not _number(entry.get("similarity_score")):
        return None
    return _number(entry.get("similarity_score"))


def prune_targets(job: Mapping, min_percent: float) -> tuple[list[dict], list[dict]]:
    targets: list[dict] = []
    kept_protected: list[dict] = []
    for entry in job.get("candidate_pipeline") or []:
        if not isinstance(entry, Mapping) or not entry.get("resume_id"):
            continue
        score = pipeline_score(entry)
        if score is None or score * 100 >= min_percent:
            continue
        row = {
            "resume_id": entry["resume_id"],
            "similarity_score": round(score, 4),
            "pipeline_stage": entry.get("pipeline_stage") or "matched",
        }
        if row["pipeline_stage"] in PROTECTED_STAGES:
            kept_protected.append(row)
        else:
            targets.append(row)
    targets.sort(key=lambda r: r["similarity_score"])
    return targets, kept_protected


def removal_records(targets: list[dict], *, min_percent: float, actor: str) -> list[dict]:
    now = datetime.now(timezone.utc).isoformat()
    return [
        {
            "resume_id": t["resume_id"],
            "similarity_score": t["similarity_score"],
            "pipeline_stage": t["pipeline_stage"],
            "reason": REMOVED_REASON,
            "min_match_score": min_percent,
            "removed_by": actor,
            "removed_at": now,
        }
        for t in targets
    ]
