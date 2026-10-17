from __future__ import annotations

import io
import logging
from contextvars import ContextVar
from dataclasses import dataclass, replace
from html import escape

from config.settings import settings
from config.tenancy import DEFAULT_COMPANY_ID, current_company, current_company_id
from services.hr_module import branding_service
from services.hr_module.branding_service import DEFAULT_PRIMARY_COLOR

logger = logging.getLogger(__name__)

LOGO_CID = "company-logo"
LOGO_MAX_HEIGHT = 40
LOGO_MAX_WIDTH = 150
LOGO_SCALE = 2
_FALLBACK_HEIGHT = 36
_DARK = "#111827"
_WHITE = "#ffffff"
_UNNAMED_DEFAULT_WORKSPACE = "default"


@dataclass(frozen=True)
class MailBrand:
    company_id: str | None = None
    name: str = ""
    color: str = DEFAULT_PRIMARY_COLOR
    on_color: str = _DARK
    logo: bytes | None = None
    logo_type: str | None = None
    logo_size: tuple[int, int] | None = None


_loaded: ContextVar[MailBrand | None] = ContextVar("mail_brand", default=None)


def platform_default() -> MailBrand:
    return MailBrand(name=settings.EMAIL_FROM_NAME)


def current() -> MailBrand | None:
    brand = _loaded.get()
    return brand if brand is not None and brand.company_id == current_company_id() else None


def reset() -> None:
    _loaded.set(None)


def _channel(value: int) -> float:
    c = value / 255
    return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4


def _luminance(color: str) -> float:
    red, green, blue = (int(color[i:i + 2], 16) for i in (1, 3, 5))
    return 0.2126 * _channel(red) + 0.7152 * _channel(green) + 0.0722 * _channel(blue)


def on_color_for(color: str) -> str:
    lum = _luminance(color)
    against_white = 1.05 / (lum + 0.05)
    against_dark = (lum + 0.05) / (_luminance(_DARK) + 0.05)
    return _WHITE if against_white > against_dark else _DARK


def workspace_signing_name() -> str:
    company = current_company() or {}
    name = " ".join(str(company.get("name") or "").split())
    unnamed = current_company_id() == DEFAULT_COMPANY_ID and name.lower() == _UNNAMED_DEFAULT_WORKSPACE
    if not name or company.get("kind") == "platform" or unnamed:
        return settings.EMAIL_FROM_NAME
    return name


def prepare_logo(data: bytes) -> tuple[bytes, str, tuple[int, int] | None] | None:
    kind = branding_service.sniff_logo_type(data)
    if kind is None:
        return None
    try:
        from PIL import Image
    except ImportError:
        return data, kind, None
    try:
        with Image.open(io.BytesIO(data)) as source:
            source.load()
            width, height = source.size
            if width <= 0 or height <= 0:
                return None
            ratio = width / height
            shown_h = min(LOGO_MAX_HEIGHT, height)
            shown_w = round(shown_h * ratio)
            if shown_w > LOGO_MAX_WIDTH:
                shown_w, shown_h = LOGO_MAX_WIDTH, max(1, round(LOGO_MAX_WIDTH / ratio))
            target = (min(width, shown_w * LOGO_SCALE), min(height, shown_h * LOGO_SCALE))
            image = source if target == (width, height) else source.resize(target, Image.LANCZOS)
            out = io.BytesIO()
            if kind == "image/jpeg":
                image.convert("RGB").save(out, "JPEG", quality=88)
            else:
                image.save(out, "PNG", optimize=True)
            return out.getvalue(), kind, (max(shown_w, 1), max(shown_h, 1))
    except Exception as exc:
        logger.warning("mail logo could not be resized, sending it as it is | error=%s", exc)
        return data, kind, None


async def _logo_for(doc: dict):
    for candidate in (
        {"company_logo_url": doc.get("company_logo_url")} if doc.get("company_logo_url") else None,
        {"letterhead_template": doc["letterhead_template"]} if (doc.get("letterhead_template") or {}).get("logo_base64") else None,
    ):
        if candidate is None:
            continue
        data = await branding_service.resolve_logo_bytes(candidate)
        prepared = prepare_logo(data) if data else None
        if prepared is not None:
            return prepared
    return None


async def _build() -> MailBrand:
    from config.database import get_db
    from services.hr_module import company_settings_service

    cid = current_company_id()
    try:
        name = await company_settings_service.organization_name() or workspace_signing_name()
        db = get_db()
        doc = (
            await db.branding_settings.find_one(
                {"_id": branding_service.SINGLETON_ID},
                {"primary_color": 1, "company_logo_url": 1, "letterhead_template": 1},
            ) if db is not None else None
        ) or {}
        color = doc.get("primary_color")
        color = color if branding_service._HEX_COLOR_RE.match(color or "") else DEFAULT_PRIMARY_COLOR
        logo = await _logo_for(doc)
    except Exception as exc:
        logger.warning("mail brand could not be loaded, using the platform's | company=%s error=%s", cid, type(exc).__name__)
        return replace(platform_default(), company_id=cid, name=workspace_signing_name())
    return MailBrand(
        company_id=cid, name=name, color=color, on_color=on_color_for(color),
        logo=logo[0] if logo else None, logo_type=logo[1] if logo else None, logo_size=logo[2] if logo else None,
    )


async def load() -> MailBrand:
    brand = current()
    if brand is None:
        brand = await _build()
        _loaded.set(brand)
    return brand


def logo_html(brand: MailBrand | None = None) -> str:
    brand = brand or current() or platform_default()
    name = escape(brand.name or settings.EMAIL_FROM_NAME, quote=True)
    if brand.logo:
        width, height = brand.logo_size or (None, _FALLBACK_HEIGHT)
        size = f' width="{width}" height="{height}"' if width else ""
        return (
            '<table role="presentation" cellpadding="0" cellspacing="0"><tr>'
            '<td style="background:#ffffff;border-radius:8px;padding:7px 12px;">'
            f'<img src="cid:{LOGO_CID}" alt="{name}"{size} '
            f'style="display:block;border:0;height:{height}px;width:auto;">'
            "</td></tr></table>"
        )
    return f'<span style="color:{brand.on_color};font-size:19px;font-weight:700;">{name}</span>'


def html_tokens(brand: MailBrand | None = None) -> dict[str, str]:
    brand = brand or current() or platform_default()
    return {"brand_color": brand.color, "brand_on_color": brand.on_color, "brand_logo_html": logo_html(brand)}


def inline_images(html: str) -> list[tuple[str, bytes, str]]:
    brand = current()
    if brand is not None and brand.logo and brand.logo_type and f"cid:{LOGO_CID}" in html:
        return [(LOGO_CID, brand.logo, brand.logo_type)]
    return []
