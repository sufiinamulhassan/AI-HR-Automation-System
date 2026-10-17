from __future__ import annotations

import logging
from datetime import datetime, timezone
from urllib.parse import urlparse, urlsplit, urlunsplit

logger = logging.getLogger(__name__)

PLATFORMS = ("zoom", "meet", "teams", "other", "physical")

PHYSICAL = "physical"
MAX_LOCATION_CHARS = 300

PLATFORM_LABELS = {
    "zoom": "Zoom",
    "meet": "Google Meet",
    "teams": "Microsoft Teams",
    "physical": "In person",
}

_HOST_SUFFIXES = {
    "zoom": ("zoom.us", "zoom.com", "zoomgov.com"),
    "meet": ("meet.google.com",),
    "teams": ("teams.microsoft.com", "teams.live.com", "teams.microsoft.us"),
}

RATING_KEYS = ("technical", "communication", "problem_solving", "cultural_fit", "confidence")
RATING_ALIASES = {"culture_fit": "cultural_fit"}
RECOMMENDATIONS = ("strong_hire", "hire", "hold", "no_hire")

MIN_SUMMARY_CHARS = 20

REVIEW_REQUIRED_MESSAGE = "Add the interview review first."


class ExternalInterviewError(ValueError):
    pass


class InterviewReviewRequired(Exception):

    def __init__(self, message: str = REVIEW_REQUIRED_MESSAGE):
        super().__init__(message)


def is_external(candidate: dict | None) -> bool:
    return bool(candidate) and candidate.get("interview_mode") == "external"


def has_review(candidate: dict | None) -> bool:
    return bool(candidate) and bool(candidate.get("external_review"))


def needs_review(candidate: dict | None) -> bool:
    return is_external(candidate) and not has_review(candidate)


def require_review(candidate: dict | None) -> None:
    if needs_review(candidate):
        raise InterviewReviewRequired()


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def normalise_iso(value: str | None) -> str | None:
    parsed = _parse_iso(value)
    return parsed.isoformat() if parsed else None


def external_status(candidate: dict | None, now: datetime | None = None) -> str | None:
    if not is_external(candidate):
        return None
    if has_review(candidate):
        return "reviewed"
    ext = candidate.get("external_interview") or {}
    if ext.get("status") == "no_show":
        return "no_show"
    start = _parse_iso(ext.get("scheduled_start_at"))
    duration = int(ext.get("duration_minutes") or 0)
    now = now or datetime.now(timezone.utc)
    if start is not None:
        end_ts = start.timestamp() + duration * 60
        if now.timestamp() >= end_ts:
            return "awaiting_review"
    return "scheduled"


def pipeline_fields(candidate: dict | None) -> dict:
    ext = (candidate or {}).get("external_interview") or {}
    external = is_external(candidate)
    return {
        "interview_mode": "external" if external else "platform",
        "external_status": external_status(candidate),
        "external_platform": ext.get("platform") if external else None,
        "external_platform_label": ext.get("platform_label") if external else None,
        "external_scheduled_at": ext.get("scheduled_start_at") if external else None,
        "external_join_url": ext.get("join_url") if external else None,
        "external_location": ext.get("location") if external else None,
        "review_submitted": has_review(candidate),
    }


def platform_label(platform: str, custom: str | None) -> str:
    if platform == "other":
        label = (custom or "").strip()
        if not label:
            raise ExternalInterviewError("Enter the name of the platform for 'Other'.")
        return label[:40]
    return PLATFORM_LABELS[platform]


def validate_join_url(platform: str, url: str | None) -> str:
    value = (url or "").strip()
    if not value:
        raise ExternalInterviewError("Add the meeting link.")
    if len(value) > 2048 or any(ch.isspace() or ord(ch) < 32 for ch in value):
        raise ExternalInterviewError("That meeting link is not valid.")
    parsed = urlparse(value)
    if parsed.scheme != "https" or not parsed.hostname:
        raise ExternalInterviewError("The meeting link must start with https://")
    suffixes = _HOST_SUFFIXES.get(platform)
    if suffixes:
        host = parsed.hostname.lower()
        if not any(host == s or host.endswith("." + s) for s in suffixes):
            label = PLATFORM_LABELS[platform]
            raise ExternalInterviewError(
                f"That does not look like a {label} link. Choose 'Other' to use any link."
            )
    return value


def validate_location(text: str | None) -> str:
    value = " ".join(str(text or "").split())
    if not value:
        raise ExternalInterviewError("Add the address where the interview will be held.")
    if len(value) > MAX_LOCATION_CHARS:
        raise ExternalInterviewError(f"The address can be at most {MAX_LOCATION_CHARS} characters.")
    if any(ord(ch) < 32 for ch in value):
        raise ExternalInterviewError("That address is not valid.")
    return value


def validate_start(start_iso: str | None) -> str:
    start = _parse_iso(start_iso)
    if start is None:
        raise ExternalInterviewError("Enter a valid date and time for the interview.")
    if start <= datetime.now(timezone.utc):
        raise ExternalInterviewError("The interview time must be in the future.")
    return start.isoformat()


MAX_HISTORY_ENTRIES = 50


def _without_query(url: str | None) -> str | None:
    if not url:
        return None
    parts = urlsplit(str(url))
    return urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))


def reschedule_changes(old: dict | None, new: dict | None) -> dict[str, list]:
    old, new = old or {}, new or {}
    changes: dict[str, list] = {}

    old_start, new_start = _parse_iso(old.get("scheduled_start_at")), _parse_iso(new.get("scheduled_start_at"))
    if old_start != new_start:
        changes["scheduled_start_at"] = [
            old_start.isoformat() if old_start else None,
            new_start.isoformat() if new_start else None,
        ]

    if old.get("platform") != new.get("platform") or old.get("platform_label") != new.get("platform_label"):
        changes["platform"] = [
            old.get("platform_label") or old.get("platform"),
            new.get("platform_label") or new.get("platform"),
        ]

    if (old.get("location") or None) != (new.get("location") or None):
        changes["location"] = [old.get("location"), new.get("location")]

    if (old.get("join_url") or None) != (new.get("join_url") or None):
        before, after = _without_query(old.get("join_url")), _without_query(new.get("join_url"))
        if before == after:
            after = f"{after} (passcode changed)"
        changes["join_url"] = [before, after]

    if (old.get("duration_minutes") or None) != (new.get("duration_minutes") or None):
        changes["duration_minutes"] = [old.get("duration_minutes"), new.get("duration_minutes")]
    return changes


def history_with(history: list | None, *, at: str, by: str | None, changes: dict) -> list[dict]:
    entries = [e for e in (history or []) if isinstance(e, dict)]
    if changes:
        entries.append({"at": at, "by": by, "changes": changes})
    return entries[-MAX_HISTORY_ENTRIES:]


def validate_timezone(name: str | None) -> str | None:
    if not name:
        return None
    try:
        from zoneinfo import ZoneInfo
        ZoneInfo(name)
        return name
    except Exception:
        return None


POST_INTERVIEW_STAGES = frozenset({"completed", "hired"})


async def blocked_by_missing_review(db, job_id: str, resume_id: str, stage: str) -> bool:
    if stage not in POST_INTERVIEW_STAGES:
        return False
    cand = await db.candidates.find_one(
        {"job_id": job_id, "resume_id": resume_id},
        {"_id": 0, "interview_mode": 1, "external_review": 1},
    )
    return needs_review(cand)
