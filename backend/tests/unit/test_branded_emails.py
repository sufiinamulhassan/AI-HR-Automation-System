import base64
import io
import re
from datetime import datetime, timedelta, timezone

import aiosmtplib
import pytest
from PIL import Image

import config.database as database
from config import tenancy
from config.settings import settings
from config.tenancy import company_context, namespaced_id
from fake_mongo import FakeRaw
from services.hr_module import branding_service, email_layout, email_service, mail_brand

pytestmark = pytest.mark.anyio

CID = "cmp_a"
COLOR = "#0b3d91"
FUTURE = (datetime.now(timezone.utc) + timedelta(days=3)).replace(microsecond=0).isoformat()
OLD_ACCENTS = ("#1a56db", "#059669", "#7c3aed", "#d97706", "#6b7280", "#0e7490", "#4338ca")


def logo_png() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (900, 300), (255, 255, 255)).save(buf, "PNG")
    return buf.getvalue()


@pytest.fixture
def world(monkeypatch):
    raw = FakeRaw()
    monkeypatch.setattr(database, "_db", raw)
    monkeypatch.setattr(settings, "EMAIL_FROM_NAME", "HR Platform")
    raw.add("company_settings", {"_id": namespaced_id(CID, "singleton"), "company_name": "Hirely & Co"}, CID)
    raw.add("branding_settings", {
        "_id": namespaced_id(CID, "singleton"), "primary_color": COLOR, "accent_color": "#000000",
        "company_logo_url": branding_service.LOGO_PATH_PREFIX + CID, "logo_base64": base64.b64encode(logo_png()).decode(),
    }, CID)
    sent: list[dict] = []

    async def record(**kwargs):
        sent.append(kwargs)
        return True

    monkeypatch.setattr(email_service, "send_email", record)
    mail_brand.reset()
    with company_context(CID, {"company_id": CID, "name": "Default"}):
        yield raw, sent
    mail_brand.reset()


def sends():
    mid = dict(to_email="c@example.com", candidate_name="Priya Sharma", job_title="Backend Engineer")
    meeting = dict(
        scheduled_start_at=FUTURE, duration_minutes=45, notes="Bring your laptop.", display_timezone="Asia/Karachi",
    )
    return {
        "interview_invitation": ("Interview Invitation", lambda: email_service.send_invite_email(
            **mid, company_name="Acme", secure_token="tok")),
        "interview_status": ("Interview Completed", lambda: email_service.send_interview_status_email(**mid)),
        "assessment_invitation": ("Assessment Invitation", lambda: email_service.send_assessment_invitation_email(
            **mid, secure_token="tok")),
        "offer_letter": ("Offer of Employment", lambda: email_service.send_offer_letter_email(
            **mid, company_name="Acme", salary="$100", joining_date="1 Dec", benefits="Leave", accept_url="https://app.test/offer/x")),
        "rejection": ("Application Update", lambda: email_service.send_rejection_email(**mid)),
        "reminder": ("Reminder", lambda: email_service.send_reminder_email(**mid, secure_token="tok")),
        "follow_up": ("Following Up", lambda: email_service.send_reminder_email(**mid, secure_token="tok", kind="follow_up")),
        "external_interview": ("Interview details", lambda: email_service.send_external_interview_email(
            **mid, company_name="Acme", platform_label="Zoom", join_url="https://zoom.us/j/1", **meeting)),
        "physical_interview_call": ("In-person interview", lambda: email_service.send_physical_interview_email(
            **mid, company_name="Acme", location="12 High Street, Lahore", **meeting)),
        "external_interview_reminder": ("Interview reminder", lambda: email_service.send_external_interview_reminder_email(
            **mid, company_name="Acme", platform_label="Zoom", join_url="https://zoom.us/j/1", **meeting)),
        "otp": ("Verification Code", lambda: email_service.send_otp_email(to_email="c@example.com", otp_code="482913")),
        "password_reset": ("Reset your password", lambda: email_service.send_password_reset_email(
            to_email="c@example.com", name="Priya", reset_url="https://app.test/reset/x")),
        "account_invitation": ("You have been invited", lambda: email_service.send_invitation_email(
            to_email="c@example.com", name="Priya", invite_url="https://app.test/invite/x")),
    }


SENDS = sends()


@pytest.mark.parametrize("template", sorted(SENDS))
async def test_a_message_has_the_companys_band_logo_heading_and_name(world, template):
    _, sent = world
    heading, send = SENDS[template]
    await send()
    (mail,) = sent
    html = mail["html_body"]
    assert mail["template"] == template
    assert f"background:{COLOR}" in html
    assert 'src="cid:company-logo"' in html and 'alt="Hirely &amp; Co"' in html
    band = html[html.index(f"background:{COLOR}"):]
    assert band.index("cid:company-logo") < band.index(f">{heading}<")
    assert f"color:#ffffff;font-family" in band[: band.index(f">{heading}<")]
    if template != "otp":
        assert mail["text_body"].rstrip().splitlines()[-1] == "Hirely & Co"
        assert re.search(r"Best regards,<br>\s*<strong[^>]*>Hirely &amp; Co</strong>", html)
    assert html.count("Hirely &amp; Co") >= (3 if template != "otp" else 2)
    assert "HR Platform" not in html and "HR Platform" not in mail["text_body"]
    assert not any(old in html for old in OLD_ACCENTS)


@pytest.mark.parametrize("template", sorted(SENDS))
async def test_the_message_names_the_company_not_the_platform_or_the_workspace(world, template):
    _, sent = world
    await SENDS[template][1]()
    (mail,) = sent
    assert "Default" not in mail["html_body"] and "Default" not in mail["text_body"]
    assert "Hirely & Co" in mail["text_body"]


@pytest.mark.parametrize("template", ["interview_invitation", "offer_letter", "external_interview", "physical_interview_call", "password_reset"])
async def test_the_call_to_action_is_in_the_brand_colour_with_readable_text(world, template):
    _, sent = world
    await SENDS[template][1]()
    html = sent[0]["html_body"]
    button = re.search(r'<a href="[^"]+" style="background:([^;]+);color:([^;]+);', html)
    assert button and button.groups() == (COLOR, "#ffffff")


async def test_without_a_logo_the_band_shows_the_company_name(world):
    raw, sent = world
    raw["branding_settings"].docs[0].pop("logo_base64")
    raw["branding_settings"].docs[0].pop("company_logo_url")
    mail_brand.reset()
    await SENDS["interview_invitation"][1]()
    html = sent[0]["html_body"]
    assert "cid:" not in html and "<img" not in html
    assert re.search(r'<span style="color:#ffffff;font-size:19px;font-weight:700;">Hirely &amp; Co</span>', html)


async def test_a_company_with_no_branding_gets_the_products_colour_and_dark_text(world):
    raw, sent = world
    raw["branding_settings"].docs.clear()
    mail_brand.reset()
    await SENDS["interview_invitation"][1]()
    html = sent[0]["html_body"]
    assert f"background:{branding_service.DEFAULT_PRIMARY_COLOR}" in html and "color:#111827;font-family" in html


async def test_what_a_person_typed_is_escaped_in_every_message(world):
    _, sent = world
    nasty = '<script>alert(1)</script> "x" & <img src=x>'
    await email_service.send_invite_email(
        to_email="c@example.com", candidate_name=nasty, job_title=nasty, company_name=nasty, secure_token="tok")
    await email_service.send_physical_interview_email(
        to_email="c@example.com", candidate_name=nasty, job_title=nasty, company_name=nasty, location=nasty,
        scheduled_start_at=FUTURE, duration_minutes=30, notes=nasty)
    for mail in sent:
        assert "<script>" not in mail["html_body"] and "<img src=x>" not in mail["html_body"]
        assert "&lt;script&gt;" in mail["html_body"]


async def test_a_link_that_is_not_http_is_not_a_button(world):
    _, sent = world
    await email_service.send_offer_letter_email(
        to_email="c@example.com", candidate_name="P", job_title="J", company_name=None, accept_url="javascript:alert(1)")
    assert "javascript:" not in sent[0]["html_body"] and "Review and Respond" not in sent[0]["html_body"]


async def test_the_status_message_keeps_its_own_footer(world):
    _, sent = world
    await SENDS["interview_status"][1]()
    assert "Please do not reply to this email." in sent[0]["html_body"]
    assert "contact your recruiter directly" not in sent[0]["html_body"]


async def test_a_message_never_carries_scores_or_report_words(world):
    _, sent = world
    for template, (_, send) in SENDS.items():
        sent.clear()
        await send()
        visible = re.sub(r"<[^>]+>", " ", sent[0]["html_body"]) + sent[0]["text_body"]
        assert not re.search(r"\b(scores?|scored|recommend\w*|evaluat\w*|ranking)\b", visible, re.I), template


def test_a_message_with_a_logo_is_html_and_the_logo_inside_a_related_part():
    msg = email_service._build_mime(
        to="a@b.co", subject="s", html_body='<img src="cid:company-logo">', text_body="x",
        inline_images=[("company-logo", b"\x89PNGdata", "image/png")],
    )
    assert msg.get_content_type() == "multipart/alternative"
    text_part, related = msg.get_payload()
    assert text_part.get_content_type() == "text/plain" and related.get_content_type() == "multipart/related"
    html_part, image = related.get_payload()
    assert html_part.get_content_type() == "text/html"
    assert image.get_content_type() == "image/png" and image["Content-ID"] == "<company-logo>"
    assert image["Content-Disposition"].startswith("inline") and image.get_payload(decode=True) == b"\x89PNGdata"


def test_without_a_logo_the_message_is_built_exactly_as_it_always_was():
    msg = email_service._build_mime(to="a@b.co", subject="s", html_body="<p>x</p>", text_body="x")
    assert [part.get_content_type() for part in msg.get_payload()] == ["text/plain", "text/html"]


def test_a_logo_and_an_attachment_together_are_mixed_around_alternative_around_related():
    msg = email_service._build_mime(
        to="a@b.co", subject="s", html_body="<p>x</p>", text_body="x",
        attachment_bytes=b"BEGIN:VCALENDAR", attachment_filename="interview.ics",
        attachment_content_type="text/calendar; method=REQUEST; charset=UTF-8",
        inline_images=[("company-logo", b"png", "image/jpeg")],
    )
    assert msg.get_content_type() == "multipart/mixed"
    alternative, calendar = msg.get_payload()
    assert alternative.get_content_type() == "multipart/alternative" and calendar.get_filename() == "interview.ics"
    assert [p.get_content_type() for p in alternative.get_payload()[1].get_payload()] == ["text/html", "image/jpeg"]


async def test_send_email_puts_the_logo_in_the_message_that_leaves(monkeypatch):
    raw = FakeRaw()
    monkeypatch.setattr(database, "_db", raw)
    monkeypatch.setattr(settings, "EMAIL_HOST", "smtp.platform.test")
    monkeypatch.setattr(settings, "AWS_SES_ENABLED", False)
    raw.add("branding_settings", {
        "_id": namespaced_id(CID, "singleton"), "primary_color": COLOR,
        "company_logo_url": branding_service.LOGO_PATH_PREFIX + CID, "logo_base64": base64.b64encode(logo_png()).decode(),
    }, CID)
    captured: list = []

    async def fake_smtp(msg, **kwargs):
        captured.append(msg)

    monkeypatch.setattr(aiosmtplib, "send", fake_smtp)
    mail_brand.reset()
    with company_context(CID, {"company_id": CID, "name": "Acme"}):
        assert await email_service.send_invite_email(
            to_email="c@example.com", candidate_name="P", job_title="J", company_name=None, secure_token="tok") is True
    (msg,) = captured
    related = msg.get_payload()[1]
    assert related.get_content_type() == "multipart/related"
    image = related.get_payload()[1]
    assert image["Content-ID"] == "<company-logo>" and Image.open(io.BytesIO(image.get_payload(decode=True))).size == (240, 80)
    assert msg["From"].startswith("Acme <")


async def test_a_message_that_does_not_use_the_logo_does_not_carry_it(monkeypatch):
    raw = FakeRaw()
    monkeypatch.setattr(database, "_db", raw)
    monkeypatch.setattr(settings, "EMAIL_HOST", "smtp.platform.test")
    raw.add("branding_settings", {
        "_id": namespaced_id(CID, "singleton"), "company_logo_url": branding_service.LOGO_PATH_PREFIX + CID,
        "logo_base64": base64.b64encode(logo_png()).decode(),
    }, CID)
    captured: list = []

    async def fake_smtp(msg, **kwargs):
        captured.append(msg)

    monkeypatch.setattr(aiosmtplib, "send", fake_smtp)
    mail_brand.reset()
    with company_context(CID, {"company_id": CID, "name": "Acme"}):
        await email_service.send_email(to="c@example.com", subject="s", html_body="<p>plain</p>", text_body="plain")
    assert [p.get_content_type() for p in captured[0].get_payload()] == ["text/plain", "text/html"]


async def test_a_company_template_can_use_the_brand_colour_and_logo_and_nothing_it_types_is_trusted(world):
    raw, sent = world
    raw.add("email_templates", {
        "key": "send_invite_email", "subject_template": "Hi {{candidate_name}}",
        "html_body_template": '<div style="background:{{brand_color}};color:{{brand_on_color}}">{{brand_logo_html}}</div><p>{{candidate_name}}</p>',
        "text_body_template": None,
    }, CID)
    await email_service.send_invite_email(
        to_email="c@example.com", candidate_name="<b>Eve</b>", job_title="J", company_name=None, secure_token="tok")
    html = sent[0]["html_body"]
    assert f"background:{COLOR};color:#ffffff" in html and 'src="cid:company-logo"' in html
    assert "&lt;b&gt;Eve&lt;/b&gt;" in html and "<b>Eve</b>" not in html
    assert sent[0]["subject"] == "Hi <b>Eve</b>"


def test_the_brand_tokens_are_offered_to_every_template():
    from services.hr_module.email_template_service import BRAND_PLACEHOLDERS, TEMPLATE_KEYS

    assert BRAND_PLACEHOLDERS == ("brand_color", "brand_on_color", "brand_logo_html")
    for key, meta in TEMPLATE_KEYS.items():
        assert set(BRAND_PLACEHOLDERS) <= set(meta["placeholders"]), key


def test_a_sample_looks_like_the_built_in_message_with_tokens_for_the_company_values():
    from services.hr_module.email_template_samples import SAMPLES

    html = SAMPLES["send_invite_email"]["html"]
    assert "background:{{brand_color}}" in html and "{{brand_logo_html}}" in html and "color:{{brand_on_color}}" in html
    assert "Interview Invitation" in html and "{{email_from_name}}" in html
    assert not any(old in html for old in OLD_ACCENTS)


def test_the_layout_is_one_card_with_a_band_a_body_and_a_footer():
    html = email_layout.shell("Offer", "<p>x</p>", color="#123456", on_color="#ffffff", logo="LOGO", footer_name="Acme")
    assert html.count("<tr><td style=\"background:#123456") == 1
    assert html.index("LOGO") < html.index(">Offer<") < html.index("<p>x</p>") < html.index("Acme")
    assert "__" not in html


def test_a_details_box_carries_the_brand_colour_down_its_edge():
    html = email_layout.details([("Position", "Engineer")], color="#123456")
    assert "border-left:4px solid #123456" in html and "Position" in html and "Engineer" in html
