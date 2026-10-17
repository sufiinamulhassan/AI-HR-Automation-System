from __future__ import annotations

import re

from config.settings import settings
from config.tenancy import current_company

_LABEL = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")
MAX_HOSTNAME_CHARS = 253


def valid_hostname(value) -> str | None:
    if not isinstance(value, str):
        return None
    text = value.strip().lower()
    if not text or len(text) > MAX_HOSTNAME_CHARS:
        return None
    if any(ord(ch) <= 32 or ord(ch) >= 127 for ch in text):
        return None
    labels = text.split(".")
    if len(labels) < 2 or not all(_LABEL.match(label) for label in labels):
        return None
    if labels[-1].isdigit():
        return None
    return text


def custom_domain(company: dict | None = None) -> str | None:
    from services.hr_module.plan_service import feature_enabled

    company = company if company is not None else current_company()
    if not company or not feature_enabled("custom_domain", company):
        return None
    for domain in company.get("custom_domains") or []:
        host = valid_hostname(domain)
        if host:
            return host
    return None


def base_url(company: dict | None = None) -> str:
    host = custom_domain(company)
    return f"https://{host}" if host else settings.FRONTEND_URL
