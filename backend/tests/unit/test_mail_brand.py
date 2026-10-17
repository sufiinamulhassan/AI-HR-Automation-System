import base64
import io

import pytest
from PIL import Image

import config.database as database
from config import tenancy
from config.settings import settings
from config.tenancy import company_context, namespaced_id
from fake_mongo import FakeRaw
from services.hr_module import branding_service, email_service, mail_brand

pytestmark = pytest.mark.anyio

A, B = "cmp_a", "cmp_b"


@pytest.fixture(autouse=True)
def fresh(monkeypatch):
    monkeypatch.setattr(settings, "EMAIL_FROM_NAME", "HR Platform")
    mail_brand.reset()
    yield
    mail_brand.reset()


def png(width=600, height=200, color=(20, 120, 220), mode="RGB") -> bytes:
    buf = io.BytesIO()
    Image.new(mode, (width, height), color).save(buf, "PNG")
    return buf.getvalue()


def jpeg(width=400, height=100) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (width, height), (200, 50, 50)).save(buf, "JPEG")
    return buf.getvalue()


def size_of(data: bytes) -> tuple[int, int]:
    return Image.open(io.BytesIO(data)).size


@pytest.mark.parametrize("color, expected", [
    ("#4778f3", "#111827"),
    ("#ffff00", "#111827"),
    ("#ffffff", "#111827"),
    ("#222022", "#ffffff"),
    ("#1a56db", "#ffffff"),
    ("#7c3aed", "#ffffff"),
    ("#0b3d91", "#ffffff"),
])
def test_the_text_on_a_brand_colour_is_whichever_of_white_and_dark_reads_better(color, expected):
    assert mail_brand.on_color_for(color) == expected


def test_a_big_logo_is_shrunk_to_twice_the_size_it_is_drawn_at():
    data, kind, shown = mail_brand.prepare_logo(png(1200, 400))
    assert kind == "image/png"
    assert shown == (120, 40)
    assert size_of(data) == (240, 80)


def test_a_very_wide_logo_is_held_to_the_width_the_band_allows():
    data, _, shown = mail_brand.prepare_logo(png(2000, 100))
    assert shown[0] == mail_brand.LOGO_MAX_WIDTH and shown[1] <= mail_brand.LOGO_MAX_HEIGHT
    assert size_of(data)[0] == mail_brand.LOGO_MAX_WIDTH * mail_brand.LOGO_SCALE


def test_a_small_logo_is_never_enlarged():
    data, _, shown = mail_brand.prepare_logo(png(60, 30))
    assert size_of(data) == (60, 30) and shown == (60, 30)


def test_a_jpeg_stays_a_jpeg():
    data, kind, shown = mail_brand.prepare_logo(jpeg())
    assert kind == "image/jpeg" and data.startswith(b"\xff\xd8\xff") and shown == (150, 38)


def test_a_logo_with_transparency_keeps_it():
    data, kind, _ = mail_brand.prepare_logo(png(300, 100, (0, 0, 0, 0), mode="RGBA"))
    assert kind == "image/png" and Image.open(io.BytesIO(data)).mode == "RGBA"


@pytest.mark.parametrize("data", [
    b'<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    b"GIF89a....", b"RIFF....WEBPVP8 ", b"", b"not an image at all",
])
def test_anything_but_a_png_or_a_jpeg_is_left_out(data):
    assert mail_brand.prepare_logo(data) is None


def test_a_png_that_cannot_be_read_goes_as_it_is_without_a_size():
    broken = b"\x89PNG\r\n\x1a\n" + b"this is not a real png body" * 4
    assert mail_brand.prepare_logo(broken) == (broken, "image/png", None)


def brand(**over):
    values = dict(company_id=A, name="Acme Talent", color="#4778f3", on_color="#111827")
    values.update(over)
    return mail_brand.MailBrand(**values)


def test_a_logo_sits_on_a_white_chip_and_is_a_content_id_image_with_its_size():
    html = mail_brand.logo_html(brand(logo=b"x", logo_type="image/png", logo_size=(120, 40)))
    assert 'src="cid:company-logo"' in html and 'width="120" height="40"' in html and "background:#ffffff" in html
    assert 'alt="Acme Talent"' in html


def test_a_logo_of_unknown_size_is_given_a_height_only():
    html = mail_brand.logo_html(brand(logo=b"x", logo_type="image/png", logo_size=None))
    assert "width=" not in html and "height:36px" in html


def test_without_a_logo_the_band_shows_the_company_name_in_the_text_colour():
    html = mail_brand.logo_html(brand(color="#222022", on_color="#ffffff"))
    assert "<img" not in html and "Acme Talent" in html and "color:#ffffff" in html


def test_a_name_is_escaped_wherever_it_is_written_into_the_markup():
    nasty = brand(name='Acme "<b>&</b>"', logo=b"x", logo_type="image/png", logo_size=(10, 10))
    assert "<b>" not in mail_brand.logo_html(nasty) and "&lt;b&gt;" in mail_brand.logo_html(nasty)
    assert "<b>" not in mail_brand.logo_html(brand(name=nasty.name))


def test_the_tokens_a_template_may_use_are_the_colour_the_text_colour_and_the_logo():
    tokens = mail_brand.html_tokens(brand())
    assert set(tokens) == {"brand_color", "brand_on_color", "brand_logo_html"}
    assert tokens["brand_color"] == "#4778f3" and tokens["brand_on_color"] == "#111827"
    assert "Acme Talent" in tokens["brand_logo_html"]


def world(monkeypatch, *, org_name=None, workspace="Default", colour="#112233", logo=None, kind="workspace", cid=A):
    raw = FakeRaw()
    monkeypatch.setattr(database, "_db", raw)
    if org_name is not None:
        raw.add("company_settings", {"_id": namespaced_id(cid, "singleton"), "company_name": org_name}, cid)
    branding = {"_id": namespaced_id(cid, "singleton"), "primary_color": colour, "accent_color": "#000000"}
    if logo is not None:
        branding.update(company_logo_url=branding_service.LOGO_PATH_PREFIX + cid, logo_base64=base64.b64encode(logo).decode())
    raw.add("branding_settings", branding, cid)
    return raw, {"company_id": cid, "name": workspace, "kind": kind}


async def test_the_brand_is_the_companys_colour_logo_and_organization_name(monkeypatch):
    raw, company = world(monkeypatch, org_name="Hirely.ai", colour="#4778f3", logo=png(900, 300))
    with company_context(A, company):
        loaded = await mail_brand.load()
    assert (loaded.name, loaded.color, loaded.on_color) == ("Hirely.ai", "#4778f3", "#111827")
    assert loaded.logo_type == "image/png" and loaded.logo_size == (120, 40) and size_of(loaded.logo) == (240, 80)


async def test_a_dark_brand_colour_gets_white_text(monkeypatch):
    raw, company = world(monkeypatch, colour="#0b3d91")
    with company_context(A, company):
        assert (await mail_brand.load()).on_color == "#ffffff"


async def test_a_colour_that_is_not_a_colour_falls_back_to_the_products(monkeypatch):
    raw, company = world(monkeypatch, colour="red; background:url(x)")
    with company_context(A, company):
        assert (await mail_brand.load()).color == branding_service.DEFAULT_PRIMARY_COLOR


async def test_a_company_with_no_branding_at_all_still_gets_a_brand(monkeypatch):
    monkeypatch.setattr(database, "_db", FakeRaw())
    with company_context(A, {"company_id": A, "name": "Acme"}):
        loaded = await mail_brand.load()
    assert loaded.name == "Acme" and loaded.color == branding_service.DEFAULT_PRIMARY_COLOR and loaded.logo is None


@pytest.mark.parametrize("org_name, workspace, kind, expected", [
    ("Hirely.ai", "Default", "workspace", "Hirely.ai"),
    ("  Hirely   ai  ", "Default", "workspace", "Hirely ai"),
    (None, "Acme, Inc.", "workspace", "Acme, Inc."),
    ("", "Acme, Inc.", "workspace", "Acme, Inc."),
    (None, "Default", "workspace", "HR Platform"),
    (None, "", "workspace", "HR Platform"),
    (None, "Platform Operations", "platform", "HR Platform"),
])
async def test_the_name_is_the_organization_pages_then_the_workspaces_then_the_platforms(monkeypatch, org_name, workspace, kind, expected):
    cid = tenancy.DEFAULT_COMPANY_ID if workspace == "Default" else A
    raw, company = world(monkeypatch, org_name=org_name, workspace=workspace, kind=kind, cid=cid)
    with company_context(cid, company):
        loaded = await mail_brand.load()
        assert loaded.name == expected
        assert email_service.sender_name() == expected


async def test_an_organization_name_beats_even_the_platform_workspace_rule(monkeypatch):
    raw, company = world(monkeypatch, org_name="Hirely.ai", workspace="Default", cid=tenancy.DEFAULT_COMPANY_ID)
    with company_context(tenancy.DEFAULT_COMPANY_ID, company):
        assert (await mail_brand.load()).name == "Hirely.ai"


async def test_the_brand_is_read_once_and_kept_for_the_rest_of_the_request(monkeypatch):
    raw, company = world(monkeypatch, org_name="Hirely.ai")
    reads = []
    real = branding_service.resolve_logo_bytes

    async def counting(branding):
        reads.append(1)
        return await real(branding)

    monkeypatch.setattr(branding_service, "resolve_logo_bytes", counting)
    with company_context(A, {**company, "company_id": A}):
        first = await mail_brand.load()
        writes_before = raw.writes
        second = await mail_brand.load()
        assert second is first and mail_brand.current() is first and raw.writes == writes_before


async def test_a_brand_is_never_carried_to_another_company(monkeypatch):
    raw, company = world(monkeypatch, org_name="Alpha Co")
    raw.add("company_settings", {"_id": namespaced_id(B, "singleton"), "company_name": "Beta Co"}, B)
    with company_context(A, {"company_id": A, "name": "Default"}):
        assert (await mail_brand.load()).name == "Alpha Co"
        assert mail_brand.current().company_id == A
    with company_context(B, {"company_id": B, "name": "Default"}):
        assert mail_brand.current() is None
        assert (await mail_brand.load()).name == "Beta Co"
        assert email_service.sender_name() == "Beta Co"


async def test_with_nothing_loaded_the_sender_is_the_workspace_as_before(monkeypatch):
    monkeypatch.setattr(database, "_db", FakeRaw())
    with company_context(A, {"company_id": A, "name": "Acme"}):
        assert mail_brand.current() is None
        assert email_service.sender_name() == "Acme"


async def test_a_failure_to_read_the_brand_never_stops_a_message(monkeypatch):
    class Broken:
        def __getattr__(self, name):
            raise RuntimeError("database is down")

    monkeypatch.setattr(database, "_db", Broken())
    with company_context(A, {"company_id": A, "name": "Acme"}):
        loaded = await mail_brand.load()
    assert loaded.name == "Acme" and loaded.logo is None and loaded.color == branding_service.DEFAULT_PRIMARY_COLOR


async def test_the_logo_travels_in_the_message_only_when_its_html_points_at_it(monkeypatch):
    raw, company = world(monkeypatch, logo=png(300, 100))
    with company_context(A, {**company, "company_id": A}):
        loaded = await mail_brand.load()
        assert mail_brand.inline_images('<img src="cid:company-logo">') == [("company-logo", loaded.logo, "image/png")]
        assert mail_brand.inline_images("<p>no logo here</p>") == []


async def test_no_logo_means_nothing_travels(monkeypatch):
    raw, company = world(monkeypatch)
    with company_context(A, {**company, "company_id": A}):
        await mail_brand.load()
        assert mail_brand.inline_images('<img src="cid:company-logo">') == []
