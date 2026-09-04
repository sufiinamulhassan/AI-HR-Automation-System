"""
Calendar invite (.ics) generation — MVP2 §2.19 (Integrations), Calendar half only.

Deliberately scoped as a zero-OAuth, zero-new-dependency universal calendar
file: a hand-built RFC 5545 minimal VEVENT subset. This is NOT a Google/
Outlook OAuth calendar-write integration (that needs paid/complex API scopes
this pass does not have access to configure) — a plain .ics file downloads
straight into Google Calendar, Outlook, and Apple Calendar with no auth flow
at all, which covers the same real user need (get the interview slot onto
the candidate/interviewer's calendar) without the OAuth surface area.

Pure function, no I/O, no external SDK — safe to unit test directly.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

_PRODID = "-//Hirely.ai//Interview Scheduling//EN"
_FOLD_LIMIT = 75


def _to_utc_basic(dt: datetime) -> str:
    """Format a datetime as the RFC 5545 UTC 'basic' form, e.g. 20260714T090000Z.

    Timezone-aware datetimes are converted to UTC first. Naive datetimes are
    assumed to already represent UTC — this matches how `scheduled_start_at`
    is stored/interpreted elsewhere in this codebase (see the tzinfo-naive
    handling in `routes/interview.py`'s `start_session`).
    """
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc)
    else:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.strftime("%Y%m%dT%H%M%SZ")


def _escape_text(value: str) -> str:
    """Escape a RFC 5545 §3.3.11 TEXT value: backslash, semicolon, comma,
    then newlines become the literal two-character sequence backslash-n."""
    value = value.replace("\\", "\\\\")
    value = value.replace(";", "\\;")
    value = value.replace(",", "\\,")
    value = value.replace("\r\n", "\n").replace("\r", "\n")
    value = value.replace("\n", "\\n")
    return value


def _fold_line(line: str) -> str:
    """Fold a content line at 75 octets per RFC 5545 §3.1: split into
    chunks of <=75 UTF-8 octets, joining continuation chunks with
    CRLF + a single leading space (which the reader must strip)."""
    encoded = line.encode("utf-8")
    if len(encoded) <= _FOLD_LIMIT:
        return line

    chunks: list[bytes] = []
    start = 0
    limit = _FOLD_LIMIT
    while start < len(encoded):
        end = min(start + limit, len(encoded))
        while end < len(encoded) and (encoded[end] & 0xC0) == 0x80:
            end -= 1
        chunks.append(encoded[start:end])
        start = end
        limit = _FOLD_LIMIT - 1

    return "\r\n ".join(chunk.decode("utf-8") for chunk in chunks)


def build_ics_event(
    uid: str,
    summary: str,
    description: str,
    start_iso: str,
    duration_minutes: int,
    organizer_email: str,
) -> str:
    """
    Build a minimal, valid RFC 5545 VCALENDAR/VEVENT text block for a
    single interview slot.

    Args:
        uid: globally-unique identifier for this event. Pass a stable value
            (e.g. derived from candidate_id) so re-downloading after a
            reschedule is treated by calendar apps as an update to the same
            event rather than a duplicate.
        summary: event title (SUMMARY).
        description: event body (DESCRIPTION).
        start_iso: ISO-8601 start timestamp. Naive timestamps are treated as
            UTC (see `_to_utc_basic`).
        duration_minutes: event length in minutes; DTEND = DTSTART + this.
        organizer_email: ORGANIZER mailto address.

    Returns:
        A CRLF-terminated .ics text string suitable for serving with
        `Content-Type: text/calendar` and a `Content-Disposition: attachment`
        header.

    Raises:
        ValueError: if `start_iso` cannot be parsed as an ISO-8601 timestamp.
    """
    try:
        normalized = start_iso.replace("Z", "+00:00") if isinstance(start_iso, str) else start_iso
        start_dt = datetime.fromisoformat(normalized)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Invalid start_iso timestamp: {start_iso!r}") from exc

    end_dt = start_dt + timedelta(minutes=duration_minutes)
    dtstamp = datetime.now(timezone.utc)

    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        f"PRODID:{_PRODID}",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "BEGIN:VEVENT",
        f"UID:{_escape_text(uid)}",
        f"DTSTAMP:{_to_utc_basic(dtstamp)}",
        f"DTSTART:{_to_utc_basic(start_dt)}",
        f"DTEND:{_to_utc_basic(end_dt)}",
        f"SUMMARY:{_escape_text(summary)}",
        f"DESCRIPTION:{_escape_text(description)}",
        f"ORGANIZER:mailto:{organizer_email}",
        "STATUS:CONFIRMED",
        "SEQUENCE:0",
        "END:VEVENT",
        "END:VCALENDAR",
    ]
    folded = [_fold_line(line) for line in lines]
    return "\r\n".join(folded) + "\r\n"
