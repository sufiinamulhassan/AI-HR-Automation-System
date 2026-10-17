from __future__ import annotations

from datetime import datetime, timedelta, timezone

_PRODID = "-//Hirely.ai//Interview Scheduling//EN"
_FOLD_LIMIT = 75
_METHODS = ("PUBLISH", "REQUEST", "CANCEL")


def _to_utc_basic(dt: datetime) -> str:
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc)
    else:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.strftime("%Y%m%dT%H%M%SZ")


def _escape_text(value: str) -> str:
    value = value.replace("\\", "\\\\")
    value = value.replace(";", "\\;")
    value = value.replace(",", "\\,")
    value = value.replace("\r\n", "\n").replace("\r", "\n")
    value = value.replace("\n", "\\n")
    return value


def _fold_line(line: str) -> str:
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
    *,
    method: str = "PUBLISH",
    sequence: int = 0,
    attendee_email: str | None = None,
    location: str | None = None,
) -> str:
    try:
        normalized = start_iso.replace("Z", "+00:00") if isinstance(start_iso, str) else start_iso
        start_dt = datetime.fromisoformat(normalized)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Invalid start_iso timestamp: {start_iso!r}") from exc

    method = str(method).upper()
    if method not in _METHODS:
        raise ValueError(f"Unsupported calendar method: {method!r}")
    sequence = max(0, int(sequence))

    end_dt = start_dt + timedelta(minutes=duration_minutes)
    dtstamp = datetime.now(timezone.utc)

    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        f"PRODID:{_PRODID}",
        "CALSCALE:GREGORIAN",
        f"METHOD:{method}",
        "BEGIN:VEVENT",
        f"UID:{_escape_text(uid)}",
        f"DTSTAMP:{_to_utc_basic(dtstamp)}",
        f"DTSTART:{_to_utc_basic(start_dt)}",
        f"DTEND:{_to_utc_basic(end_dt)}",
        f"SUMMARY:{_escape_text(summary)}",
        f"DESCRIPTION:{_escape_text(description)}",
        f"ORGANIZER:mailto:{organizer_email}",
    ]
    if location:
        lines.append(f"LOCATION:{_escape_text(location)}")
    if attendee_email:
        lines.append(f"ATTENDEE;ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:{attendee_email}")
    lines += [
        "STATUS:CONFIRMED",
        f"SEQUENCE:{sequence}",
        "END:VEVENT",
        "END:VCALENDAR",
    ]
    folded = [_fold_line(line) for line in lines]
    return "\r\n".join(folded) + "\r\n"
