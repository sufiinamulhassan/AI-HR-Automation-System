import logging

from services.hr_module.webhook_service import emit_event

logger = logging.getLogger(__name__)


def _who(candidate_id, name, job_id) -> dict:
    return {"candidate_id": candidate_id, "candidate_name": name, "job_id": job_id}


async def _safe_emit(event: str, payload: dict) -> None:
    try:
        await emit_event(event, payload)
    except Exception as exc:
        logger.warning("Lifecycle webhook skipped | event=%s error=%s", event, type(exc).__name__)


async def announce_candidate_invited(*, candidate_id, name, job_id, invite_type: str) -> None:
    await _safe_emit("candidate.invited", {
        **_who(candidate_id, name, job_id), "stage": "invited", "invite_type": invite_type,
    })


async def announce_stage_change(*, candidate_id, name, job_id, stage: str, decision: str | None = None) -> None:
    payload = {**_who(candidate_id, name, job_id), "stage": stage}
    if decision:
        payload["decision"] = decision
    await _safe_emit("candidate.status_changed", payload)
    if decision == "hire":
        await _safe_emit("candidate.hired", payload)
    elif decision == "reject":
        await _safe_emit("candidate.rejected", payload)


async def announce_interview_completed(*, candidate_id, name, job_id) -> None:
    await _safe_emit("interview.completed", {**_who(candidate_id, name, job_id), "stage": "completed"})


async def announce_external_scheduled(
    *, candidate_id, name, job_id, platform_label: str | None, scheduled_start_at: str | None,
) -> None:
    await _safe_emit("interview.external_scheduled", {
        **_who(candidate_id, name, job_id), "stage": "interviewing",
        "platform": platform_label, "scheduled_start_at": scheduled_start_at,
    })


async def announce_scorecard_submitted(*, candidate_id, name, job_id, scorecard_id, stage: str | None = None) -> None:
    payload = {**_who(candidate_id, name, job_id), "scorecard_id": scorecard_id}
    if stage:
        payload["stage"] = stage
    await _safe_emit("scorecard.submitted", payload)
