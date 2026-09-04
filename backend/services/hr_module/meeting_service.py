"""
Video-meeting connectors — hr_module Integrations (MVP2 §2.19).

Creates a real Zoom or Microsoft Teams meeting for a scheduled interview slot
and hands back a join URL, closing the "no Zoom/Teams connector" half of
§2.19's remaining gap.

Both providers use a server-to-server credential (no per-user OAuth consent,
no refresh-token storage), which is what makes them buildable here at all:

  Zoom   Server-to-Server OAuth app — account_id + client_id + client_secret,
         exchanged for a short-lived token per call.
         https://developers.zoom.us/docs/internal-apps/s2s-oauth/
  Teams  Microsoft Graph client-credentials flow — tenant_id + client_id +
         client_secret, plus MS_TEAMS_ORGANIZER_USER_ID (Graph's
         /users/{id}/onlineMeetings needs an organiser; application permissions
         cannot infer "me").
         https://learn.microsoft.com/graph/api/application-post-onlinemeetings

Both are OFF unless configured, exactly like Judge0 and the keyed job sources:
`is_configured()` reports availability and every call raises
MeetingServiceError rather than half-succeeding. Nothing in the interview flow
depends on a meeting existing — scheduling continues to work, and the .ics
download remains the zero-config path.

Deliberately NOT built here: Google/Outlook *calendar* write. That needs
per-admin OAuth consent, refresh-token storage and a refresh path — a
different shape of problem from these two, and the existing .ics download
already covers "get this slot into my calendar".
"""
import logging
from datetime import datetime, timedelta, timezone

import httpx

from config.settings import settings

logger = logging.getLogger(__name__)

_TIMEOUT = 15.0

PROVIDERS = ("zoom", "teams")


class MeetingServiceError(RuntimeError):
    """Raised for any provider failure. Route layer maps this to HTTP 502/503."""


def configured_providers() -> list[str]:
    """Which providers have complete credentials right now."""
    out = []
    if settings.ZOOM_ACCOUNT_ID and settings.ZOOM_CLIENT_ID and settings.ZOOM_CLIENT_SECRET:
        out.append("zoom")
    if (
        settings.MS_TEAMS_TENANT_ID
        and settings.MS_TEAMS_CLIENT_ID
        and settings.MS_TEAMS_CLIENT_SECRET
        and settings.MS_TEAMS_ORGANIZER_USER_ID
    ):
        out.append("teams")
    return out


def is_configured(provider: str | None = None) -> bool:
    available = configured_providers()
    return bool(available) if provider is None else provider in available


def _parse_start(start_iso: str) -> datetime:
    """Parse the stored `scheduled_start_at` into an aware UTC datetime.

    Naive values are treated as UTC — that is what routes/interview.py's own
    schedule check already assumes, so the meeting and the session gate agree.
    """
    try:
        dt = datetime.fromisoformat(start_iso.replace("Z", "+00:00"))
    except (AttributeError, TypeError, ValueError) as exc:
        raise MeetingServiceError(f"Unparsable meeting start time: {start_iso!r}") from exc
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


async def _zoom_token(client: httpx.AsyncClient) -> str:
    resp = await client.post(
        "https://zoom.us/oauth/token",
        params={"grant_type": "account_credentials", "account_id": settings.ZOOM_ACCOUNT_ID},
        auth=(settings.ZOOM_CLIENT_ID, settings.ZOOM_CLIENT_SECRET),
    )
    resp.raise_for_status()
    token = resp.json().get("access_token")
    if not token:
        raise MeetingServiceError("Zoom did not return an access token")
    return token


async def _create_zoom_meeting(*, topic: str, start: datetime, duration_minutes: int, agenda: str) -> dict:
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        token = await _zoom_token(client)
        resp = await client.post(
            "https://api.zoom.us/v2/users/me/meetings",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "topic": topic[:200],
                "type": 2,
                "start_time": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "duration": duration_minutes,
                "timezone": "UTC",
                "agenda": agenda[:2000],
                "settings": {
                    "join_before_host": False,
                    "waiting_room": True,
                    "approval_type": 2,
                },
            },
        )
        resp.raise_for_status()
        data = resp.json()

    return {
        "provider": "zoom",
        "meeting_id": str(data.get("id", "")),
        "join_url": data.get("join_url"),
        "host_url": data.get("start_url"),
        "password": data.get("password"),
    }


async def _teams_token(client: httpx.AsyncClient) -> str:
    resp = await client.post(
        f"https://login.microsoftonline.com/{settings.MS_TEAMS_TENANT_ID}/oauth2/v2.0/token",
        data={
            "grant_type": "client_credentials",
            "client_id": settings.MS_TEAMS_CLIENT_ID,
            "client_secret": settings.MS_TEAMS_CLIENT_SECRET,
            "scope": "https://graph.microsoft.com/.default",
        },
    )
    resp.raise_for_status()
    token = resp.json().get("access_token")
    if not token:
        raise MeetingServiceError("Microsoft Graph did not return an access token")
    return token


async def _create_teams_meeting(*, topic: str, start: datetime, duration_minutes: int) -> dict:
    end = start + timedelta(minutes=duration_minutes)
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        token = await _teams_token(client)
        resp = await client.post(
            f"https://graph.microsoft.com/v1.0/users/{settings.MS_TEAMS_ORGANIZER_USER_ID}/onlineMeetings",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "subject": topic[:250],
                "startDateTime": start.isoformat().replace("+00:00", "Z"),
                "endDateTime": end.isoformat().replace("+00:00", "Z"),
                "lobbyBypassSettings": {"scope": "organizer"},
            },
        )
        resp.raise_for_status()
        data = resp.json()

    return {
        "provider": "teams",
        "meeting_id": data.get("id"),
        "join_url": data.get("joinWebUrl"),
        "host_url": data.get("joinWebUrl"),
        "password": None,
    }


async def create_meeting(
    *,
    topic: str,
    start_iso: str,
    duration_minutes: int | None = None,
    agenda: str = "",
    provider: str | None = None,
) -> dict:
    """Create a meeting and return {provider, meeting_id, join_url, host_url, password}.

    `provider` defaults to MEETING_PROVIDER, then to whichever single provider
    is configured. Raises MeetingServiceError when nothing is configured, the
    requested provider isn't, or the provider call fails — callers decide
    whether that is fatal (it isn't, for interview scheduling).
    """
    available = configured_providers()
    if not available:
        raise MeetingServiceError(
            "No video-meeting provider is configured — set the ZOOM_* or MS_TEAMS_* settings"
        )

    chosen = provider or settings.MEETING_PROVIDER or (available[0] if len(available) == 1 else None)
    if not chosen:
        raise MeetingServiceError(
            f"Several providers are configured ({', '.join(available)}) — set MEETING_PROVIDER "
            "or pass one explicitly"
        )
    if chosen not in PROVIDERS:
        raise MeetingServiceError(f"Unknown meeting provider: {chosen}")
    if chosen not in available:
        raise MeetingServiceError(f"Meeting provider '{chosen}' is not configured")

    start = _parse_start(start_iso)
    duration = duration_minutes or settings.INTERVIEW_DURATION_MINUTES

    try:
        if chosen == "zoom":
            return await _create_zoom_meeting(
                topic=topic, start=start, duration_minutes=duration, agenda=agenda,
            )
        return await _create_teams_meeting(topic=topic, start=start, duration_minutes=duration)
    except MeetingServiceError:
        raise
    except httpx.HTTPStatusError as exc:
        body = (exc.response.text or "")[:300]
        logger.warning("%s meeting creation failed: %s %s", chosen, exc.response.status_code, body)
        raise MeetingServiceError(f"{chosen} rejected the request ({exc.response.status_code}): {body}")
    except Exception as exc:
        logger.warning("%s meeting creation failed: %s", chosen, exc)
        raise MeetingServiceError(f"Could not reach {chosen}: {exc}")


__all__ = ["create_meeting", "configured_providers", "is_configured", "MeetingServiceError", "PROVIDERS"]
