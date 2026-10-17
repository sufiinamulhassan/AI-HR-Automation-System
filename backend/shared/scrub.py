import re

from config.settings import settings

_SECRET_SETTINGS = (
    "SECRET_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "PINECONE_API_KEY",
    "JUDGE0_API_KEY", "PISTON_API_KEY", "EMAIL_PASSWORD", "WEBHOOK_SIGNING_SECRET",
    "CRON_SECRET", "GOOGLE_OAUTH_CLIENT_SECRET", "ZOOM_CLIENT_SECRET",
    "MS_TEAMS_CLIENT_SECRET", "LINKEDIN_API_KEY", "INDEED_API_KEY",
    "HRMS_AUTH_TOKEN", "DEFAULT_SUPERADMIN_PASSWORD",
)
_MIN_SECRET_LENGTH = 6

_URL = re.compile(r"https?://[^\s'\"<>]+")
_AUTH_HEADER = re.compile(r"(?i)\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}")
_KEY_SHAPES = re.compile(r"\b(?:sk-[A-Za-z0-9_-]{8,}|pcsk_[A-Za-z0-9_-]{8,}|xox[a-z]-[A-Za-z0-9-]{8,})")


def _clean_url(match: re.Match) -> str:
    url = match.group(0)
    scheme, _, rest = url.partition("://")
    rest = rest.split("#", 1)[0].split("?", 1)[0]
    host, slash, path = rest.partition("/")
    if "@" in host:
        host = host.rsplit("@", 1)[1]
    return f"{scheme}://{host}{slash}{path}"


def configured_secrets() -> list[str]:
    values = []
    for name in _SECRET_SETTINGS:
        value = getattr(settings, name, "") or ""
        if isinstance(value, str) and len(value) >= _MIN_SECRET_LENGTH:
            values.append(value)
    return sorted(set(values), key=len, reverse=True)


def scrub_secrets(text, *, limit: int | None = 300, extra: tuple[str, ...] = ()) -> str | None:
    if text is None or text == "":
        return None
    out = str(text)
    for secret in [*configured_secrets(), *(s for s in extra if s and len(s) >= _MIN_SECRET_LENGTH)]:
        out = out.replace(secret, "***")
    out = _URL.sub(_clean_url, out)
    out = _AUTH_HEADER.sub(lambda m: f"{m.group(1)} ***", out)
    out = _KEY_SHAPES.sub("***", out)
    return out[:limit] if limit else out
