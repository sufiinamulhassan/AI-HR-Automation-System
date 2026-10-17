import logging
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

import httpx

from config.settings import settings
from services.hr_module import integrations_settings_service

logger = logging.getLogger(__name__)

_TIMEOUT = 15.0

_TRANSPORT = None

PROVIDERS = ("zoom", "teams")


class MeetingServiceError(RuntimeError):
    pass


def configured_providers() -> list[str]:
    return [name for name in PROVIDERS if integrations_settings_service.environment_config(name)]


def is_configured(provider: str | None = None) -> bool:
    available = configured_providers()
    return bool(available) if provider is None else provider in available


async def available_providers() -> list[str]:
    out = []
    for name in PROVIDERS:
        if await integrations_settings_service.runtime_config(name):
            out.append(name)
    for name in configured_providers():
        if name not in out:
            out.append(name)
    return [name for name in PROVIDERS if name in out]


def default_provider() -> str:
    return settings.MEETING_PROVIDER if integrations_settings_service.is_default_company() else ""


def _parse_start(start_iso: str) -> datetime:
    try:
        dt = datetime.fromisoformat(start_iso.replace("Z", "+00:00"))
    except (AttributeError, TypeError, ValueError) as exc:
        raise MeetingServiceError(f"Unparsable meeting start time: {start_iso!r}") from exc
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


async def _zoom_token(client: httpx.AsyncClient, creds: dict) -> str:
    resp = await client.post(
        "https://zoom.us/oauth/token",
        params={"grant_type": "account_credentials", "account_id": creds["account_id"]},
        auth=(creds["client_id"], creds["client_secret"]),
    )
    resp.raise_for_status()
    token = resp.json().get("access_token")
    if not token:
        raise MeetingServiceError("Zoom did not return an access token")
    return token


async def _create_zoom_meeting(
    *, creds: dict, topic: str, start: datetime, duration_minutes: int, agenda: str,
) -> dict:
    async with httpx.AsyncClient(timeout=_TIMEOUT, transport=_TRANSPORT) as client:
        token = await _zoom_token(client, creds)
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


async def _teams_token(client: httpx.AsyncClient, creds: dict) -> str:
    resp = await client.post(
        f"https://login.microsoftonline.com/{quote(creds['tenant_id'], safe='')}/oauth2/v2.0/token",
        data={
            "grant_type": "client_credentials",
            "client_id": creds["client_id"],
            "client_secret": creds["client_secret"],
            "scope": "https://graph.microsoft.com/.default",
        },
    )
    resp.raise_for_status()
    token = resp.json().get("access_token")
    if not token:
        raise MeetingServiceError("Microsoft Graph did not return an access token")
    return token


async def _create_teams_meeting(*, creds: dict, topic: str, start: datetime, duration_minutes: int) -> dict:
    end = start + timedelta(minutes=duration_minutes)
    async with httpx.AsyncClient(timeout=_TIMEOUT, transport=_TRANSPORT) as client:
        token = await _teams_token(client, creds)
        resp = await client.post(
            f"https://graph.microsoft.com/v1.0/users/{quote(creds['organizer'], safe='@')}/onlineMeetings",
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
    available = await available_providers()
    if not available:
        raise MeetingServiceError(
            "No video-meeting provider is configured: add your Zoom or Teams account in Company Settings, Integrations"
        )

    chosen = provider or default_provider() or (available[0] if len(available) == 1 else None)
    if not chosen:
        raise MeetingServiceError(
            f"Several providers are configured ({', '.join(available)}): choose one explicitly "
            "(or set MEETING_PROVIDER)"
        )
    if chosen not in PROVIDERS:
        raise MeetingServiceError(f"Unknown meeting provider: {chosen}")
    if chosen not in available:
        raise MeetingServiceError(f"Meeting provider '{chosen}' is not configured")

    start = _parse_start(start_iso)
    duration = duration_minutes or settings.INTERVIEW_DURATION_MINUTES
    creds = await integrations_settings_service.runtime_config(chosen)
    if not creds:
        raise MeetingServiceError(f"Meeting provider '{chosen}' is not configured")

    try:
        if chosen == "zoom":
            return await _create_zoom_meeting(
                creds=creds, topic=topic, start=start, duration_minutes=duration, agenda=agenda,
            )
        return await _create_teams_meeting(creds=creds, topic=topic, start=start, duration_minutes=duration)
    except MeetingServiceError:
        raise
    except httpx.HTTPStatusError as exc:
        body = (exc.response.text or "")[:300]
        logger.warning("%s meeting creation failed: %s %s", chosen, exc.response.status_code, body)
        raise MeetingServiceError(f"{chosen} rejected the request ({exc.response.status_code}): {body}")
    except Exception as exc:
        logger.warning("%s meeting creation failed: %s", chosen, exc)
        raise MeetingServiceError(f"Could not reach {chosen}: {exc}")


__all__ = [
    "create_meeting", "configured_providers", "available_providers", "default_provider", "is_configured",
    "MeetingServiceError", "PROVIDERS",
]
