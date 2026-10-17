import contextlib
import html
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from config import tenancy
from config.settings import settings
from config.tenancy import company_context
from services.hr_module import (
    credentials_service,
    email_service,
    notification_settings_service,
    offer_service,
    workflow_engine,
    workspace_service,
)

pytestmark = pytest.mark.anyio

NAME = 'Eve <script>alert(1)</script> "quoted"'
TITLE = 'Dev <img src=x onerror=alert(1)> & "Lead"'
COMPANY = "Acme & <b>Sons</b>"
FORBIDDEN_IN_HTML = ("<script>", "<img", "<b>Sons</b>", "<u>", "<i>")


@contextlib.contextmanager
def _no_fallback():
    previous = tenancy._fallback_company_id
    tenancy.use_fallback_company(None)
    try:
        yield
    finally:
        tenancy.use_fallback_company(previous)


def _capture(monkeypatch, override=None):
    sent: list[dict] = []

    async def fake_send_email(**kwargs):
        sent.append(kwargs)
        return True

    monkeypatch.setattr(email_service, "send_email", fake_send_email)
    monkeypatch.setattr(email_service, "get_template_override", AsyncMock(return_value=override))
    return sent


async def _send_every_template(**extra):
    to = "c@example.com"
    send = email_service
    await send.send_invite_email(
        to_email=to, candidate_name=NAME, job_title=TITLE, company_name=COMPANY, secure_token='tok_x"><script>',
    )
    await send.send_interview_status_email(to_email=to, candidate_name=NAME, job_title=TITLE)
    await send.send_assessment_invitation_email(
        to_email=to, candidate_name=NAME, job_title=TITLE, secure_token='tok"x><script>',
    )
    await send.send_offer_letter_email(
        to_email=to, candidate_name=NAME, job_title=TITLE, company_name=COMPANY, salary="<b>1</b> & 2",
        joining_date='"<i>soon</i>"', benefits="<u>health</u>", accept_url='https://app.example.com/o?a=1&b="2"',
    )
    await send.send_rejection_email(to_email=to, candidate_name=NAME, job_title=TITLE)
    await send.send_reminder_email(
        to_email=to, candidate_name=NAME, job_title=TITLE, secure_token='tok_x"><script>', kind="follow_up",
    )
    meeting = dict(
        to_email=to, candidate_name=NAME, job_title=TITLE, company_name=COMPANY, platform_label="Zoom <i>x</i>",
        join_url='https://zoom.example/j?a=1&b="><script>', scheduled_start_at="2026-11-03T10:00:00+00:00",
        duration_minutes=30, notes="<script>note</script>",
    )
    await send.send_external_interview_email(**meeting)
    await send.send_external_interview_reminder_email(**meeting)
    await send.send_password_reset_email(to_email=to, name=NAME, reset_url='https://app.example.com/r?token="><script>')
    await send.send_invitation_email(to_email=to, name=NAME, invite_url='https://app.example.com/r?token="><script>&invite=1')


async def test_every_html_body_escapes_what_it_is_given(monkeypatch):
    sent = _capture(monkeypatch)
    with company_context("cmp_hyg", {"name": 'Evil "Co" <script>x</script>'}):
        await _send_every_template()
        await email_service.send_otp_email(to_email="c@example.com", otp_code="12<3")
    assert len(sent) == 11
    for mail in sent:
        page = mail["html_body"]
        for markup in FORBIDDEN_IN_HTML:
            assert markup not in page, (mail["template"], markup)
        assert "onmouseover=" not in page, mail["template"]
    invite = next(m for m in sent if m["template"] == "interview_invitation")
    assert html.escape(NAME) in invite["html_body"]
    assert NAME in invite["text_body"]
    assert "Evil &quot;Co&quot; &lt;script&gt;" in invite["html_body"]


async def test_a_link_that_is_not_http_or_https_never_becomes_a_button(monkeypatch):
    sent = _capture(monkeypatch)
    await email_service.send_offer_letter_email(
        to_email="c@example.com", candidate_name="Eve", job_title="Dev", company_name="Acme",
        accept_url="javascript:alert(document.cookie)",
    )
    await email_service.send_external_interview_email(
        to_email="c@example.com", candidate_name="Eve", job_title="Dev", company_name="Acme", platform_label="Zoom",
        join_url="javascript:alert(1)", scheduled_start_at="2026-11-03T10:00:00+00:00", duration_minutes=30,
    )
    await email_service.send_password_reset_email(to_email="c@example.com", name="Eve", reset_url="data:text/html,x")
    for mail in sent:
        assert "javascript:" not in mail["html_body"] and "data:text" not in mail["html_body"], mail["template"]
        assert "href=" not in mail["html_body"], mail["template"]
    assert "javascript:" not in sent[0]["text_body"]


def test_safe_url_allows_only_http_and_https_with_a_host():
    assert email_service.safe_url("https://a.example/x?y=1") == "https://a.example/x?y=1"
    assert email_service.safe_url("  http://a.example  ") == "http://a.example"
    for bad in (
        "javascript:alert(1)", "JaVaScRiPt:alert(1)", "vbscript:x", "data:text/html,x", "ftp://a.example", "mailto:a@b.co",
        "//evil.example", "/relative/path", "a.example", "", None, "https://", "https://a.example/\nX", "https://a.example/\x00",
    ):
        assert email_service.safe_url(bad) == "", bad
    assert "&quot;" in email_service._href('https://a.example/?q="><x>') and '"' not in email_service._href('https://a.example/?q="')


async def test_an_admin_written_template_keeps_its_markup_and_only_the_values_are_escaped(monkeypatch):
    override = {
        "subject_template": "S {{job_title}}",
        "html_body_template": '<h2 class="x">{{candidate_name}}</h2><p>{{job_title}}</p>',
        "text_body_template": None,
    }
    sent = _capture(monkeypatch, override=override)
    to = "c@example.com"
    await email_service.send_invite_email(to_email=to, candidate_name=NAME, job_title=TITLE, company_name=COMPANY, secure_token="tok_1")
    await email_service.send_interview_status_email(to_email=to, candidate_name=NAME, job_title=TITLE)
    await email_service.send_assessment_invitation_email(to_email=to, candidate_name=NAME, job_title=TITLE, secure_token="tok_1")
    await email_service.send_offer_letter_email(to_email=to, candidate_name=NAME, job_title=TITLE, company_name=COMPANY)
    await email_service.send_rejection_email(to_email=to, candidate_name=NAME, job_title=TITLE)
    await email_service.send_reminder_email(to_email=to, candidate_name=NAME, job_title=TITLE, secure_token="tok_1")
    expected = f'<h2 class="x">{html.escape(NAME, quote=True)}</h2><p>{html.escape(TITLE, quote=True)}</p>'
    assert len(sent) == 6
    for mail in sent:
        assert mail["html_body"] == expected, mail["template"]
        assert mail["subject"] == "S " + TITLE


async def test_an_override_link_variable_is_escaped_and_must_be_http(monkeypatch):
    override = {"html_body_template": '<a href="{{interview_url}}">go</a>'}
    sent = _capture(monkeypatch, override=override)
    await email_service.send_invite_email(
        to_email="c@example.com", candidate_name="Eve", job_title="Dev", company_name=None, secure_token='x"onmouseover="y',
    )
    page = sent[0]["html_body"]
    assert '"onmouseover="' not in page and "&quot;onmouseover=&quot;" in page and page.startswith('<a href="http')


async def test_the_one_time_code_email_names_the_company_not_the_product(monkeypatch):
    sent = _capture(monkeypatch)
    monkeypatch.setattr(settings, "EMAIL_FROM_NAME", "HR Platform")
    with company_context("cmp_hyg", {"name": "Acme Hiring"}):
        await email_service.send_otp_email(to_email="c@example.com", otp_code="123456")
    with company_context("cmp_platform", {"name": "Platform Operations", "kind": "platform"}):
        await email_service.send_otp_email(to_email="c@example.com", otp_code="123456")
    assert sent[0]["subject"] == "Acme Hiring: Your login verification code"
    assert sent[1]["subject"] == "HR Platform: Your login verification code"
    assert "for <strong>Acme Hiring</strong>" in sent[0]["html_body"]
    assert "for Acme Hiring is: 123456" in sent[0]["text_body"]


async def test_the_credential_emails_are_link_and_instructions_only(monkeypatch):
    sent = _capture(monkeypatch)
    with company_context("cmp_hyg", {"name": "Acme Hiring"}):
        await email_service.send_password_reset_email(
            to_email="c@example.com", name="Eve", reset_url="https://app.example.com/reset-password?token=abc",
        )
        await email_service.send_invitation_email(
            to_email="c@example.com", name="", invite_url="https://app.example.com/reset-password?token=abc&invite=1",
            expires_in="7 days",
        )
    reset, invite = sent
    assert reset["subject"] == "Acme Hiring: Reset your password" and reset["template"] == "password_reset"
    assert invite["subject"] == "You have been invited to Acme Hiring" and invite["template"] == "account_invitation"
    for mail in sent:
        assert "token=abc" in mail["text_body"] and "token=abc" in mail["html_body"]
        assert "Acme Hiring" in mail["text_body"] and mail["text_body"].rstrip().endswith("Acme Hiring")
        assert chr(0x2014) not in mail["subject"] + mail["text_body"] + mail["html_body"]
        low = (mail["text_body"] + mail["html_body"]).lower()
        assert "score" not in low and "recommendation" not in low
    assert "expires in 1 hour" in reset["text_body"] and "expires in 7 days" in invite["text_body"]
    assert invite["text_body"].startswith("Hello,\n")


def test_valid_email_address_takes_one_plain_mailbox_and_nothing_else():
    assert email_service.valid_email_address("  Ops.Team+hr@Example.co.uk ") == "Ops.Team+hr@Example.co.uk"
    assert email_service.valid_email_address("ops@example.com\r\n") == "ops@example.com"
    for bad in (
        "", None, "ops", "ops@", "@example.com", "ops@example", "a b@example.com", "a@b.com, c@d.com", "a@b.com;c@d.com",
        "<a@b.com>", "Name <a@b.com>", "ops@example.com\r\nBcc: spy@example.com", "ops@@example.com", "a@b..com",
        "a" * 250 + "@example.com",
    ):
        assert email_service.valid_email_address(bad) is None, bad


class _Profile:

    def __init__(self, value):
        self.value, self.calls = value, 0

    async def find_one(self, flt, projection=None):
        self.calls += 1
        if isinstance(self.value, Exception):
            raise self.value
        return {"primary_contact_email": self.value}


def _profile_db(monkeypatch, value):
    profile = _Profile(value)
    monkeypatch.setattr(email_service, "get_db", lambda: SimpleNamespace(company_settings=profile))
    return profile


async def test_reply_to_is_the_companys_contact_address_when_it_is_valid(monkeypatch):
    profile = _profile_db(monkeypatch, "ops@example.com")
    with company_context("cmp_hyg"):
        assert await email_service._reply_to_address() == "ops@example.com"
    profile.value = "  "
    with company_context("cmp_hyg"):
        assert await email_service._reply_to_address() is None
    profile.value = "not an address"
    with company_context("cmp_hyg"):
        assert await email_service._reply_to_address() is None


async def test_no_company_bound_means_no_reply_to_and_no_lookup(monkeypatch):
    profile = _profile_db(monkeypatch, "ops@example.com")
    with _no_fallback():
        assert await email_service._reply_to_address() is None
    with company_context(tenancy.NO_MATCH):
        assert await email_service._reply_to_address() is None
    assert profile.calls == 0


async def test_a_failed_reply_to_read_never_fails_a_send(monkeypatch):
    _profile_db(monkeypatch, RuntimeError("mongo is down"))
    with company_context("cmp_hyg"):
        assert await email_service._reply_to_address() is None

    def broken():
        raise tenancy.TenantContextMissing("nothing bound")

    monkeypatch.setattr(email_service, "get_db", broken)
    with company_context("cmp_hyg"):
        assert await email_service._reply_to_address() is None


async def _smtp_send(monkeypatch, **kwargs):
    import aiosmtplib

    captured = {}

    async def fake_send(msg, **_):
        captured["msg"] = msg

    monkeypatch.setattr(settings, "AWS_SES_ENABLED", False)
    monkeypatch.setattr(settings, "EMAIL_HOST", "smtp.test.invalid")
    monkeypatch.setattr(aiosmtplib, "send", fake_send)
    ok = await email_service.send_email(to="a@example.com", html_body="<p>x</p>", text_body="x", **kwargs)
    assert ok is True
    return captured["msg"]


async def test_a_sent_message_carries_the_companys_reply_to(monkeypatch):
    _profile_db(monkeypatch, "ops@example.com")
    with company_context("cmp_hyg", {"name": "Acme"}):
        msg = await _smtp_send(monkeypatch, subject="Hello")
    assert msg["Reply-To"] == "ops@example.com"
    with _no_fallback():
        assert (await _smtp_send(monkeypatch, subject="Hello"))["Reply-To"] is None


async def test_a_reply_to_with_a_line_break_cannot_add_a_header(monkeypatch):
    _profile_db(monkeypatch, "ops@example.com\r\nBcc: spy@example.com")
    with company_context("cmp_hyg"):
        msg = await _smtp_send(monkeypatch, subject="Hello")
    assert msg["Reply-To"] is None and msg["Bcc"] is None
    _profile_db(monkeypatch, "ops@example.com\r\n")
    with company_context("cmp_hyg"):
        msg = await _smtp_send(monkeypatch, subject="Hello")
    assert msg["Reply-To"] == "ops@example.com" and "\n" not in msg["Reply-To"]


async def test_a_subject_or_recipient_with_a_line_break_cannot_add_a_header(monkeypatch):
    _profile_db(monkeypatch, None)
    with company_context("cmp_hyg"):
        msg = await _smtp_send(monkeypatch, subject="Offer: Dev\r\nBcc: spy@example.com")
    assert msg["Bcc"] is None and "\n" not in msg["Subject"] and "\r" not in msg["Subject"]
    built = email_service._build_mime(
        to="a@example.com\r\nBcc: spy@example.com", subject="s", html_body="<p>x</p>", text_body="x",
        reply_to="a@b.co\r\nBcc: spy@example.com",
    )
    assert built["Bcc"] is None and built["Reply-To"] is None and "\n" not in built["To"]


def test_a_workflow_link_must_be_https_on_the_apps_own_host(monkeypatch):
    monkeypatch.setattr(settings, "FRONTEND_URL", "https://app.example.com")
    ok = "https://app.example.com/offer/tok_1?x=1"
    assert workflow_engine.trusted_link(ok) == ok
    assert workflow_engine.trusted_link("https://APP.example.com/offer/tok_1") == "https://APP.example.com/offer/tok_1"
    for bad in (
        "http://app.example.com/offer/tok_1", "https://evil.example/offer/tok_1", "https://app.example.com.evil.example/x",
        "https://app.example.com@evil.example/x", "https://evil.example/?u=https://app.example.com",
        "https://user:pw@app.example.com/x", "javascript:alert(1)", "//app.example.com/x", "/offer/tok_1", "", None,
        "https://app.example.com/x\r\nSet-Cookie: a=b",
    ):
        assert workflow_engine.trusted_link(bad) is None, bad


class _Limiter:

    def __init__(self, allow=10_000):
        self.allow, self.calls = allow, []

    async def __call__(self, db, *, key, limit, window_seconds):
        self.calls.append((key, limit, window_seconds))
        if len(self.calls) > self.allow:
            raise HTTPException(429, "Too many attempts: please try again later")


class _Offers:
    async def find_one(self, flt, projection=None):
        return {"secure_token": "tok_abc"} if flt == {"offer_id": "o1"} else None


def _workflow(monkeypatch, limiter=None):
    mail = {"reminder": [], "offer": []}

    async def reminder(**kwargs):
        mail["reminder"].append(kwargs)
        return True

    async def offer(**kwargs):
        mail["offer"].append(kwargs)
        return True

    monkeypatch.setattr(workflow_engine, "send_reminder_email", reminder)
    monkeypatch.setattr(workflow_engine, "send_offer_letter_email", offer)
    monkeypatch.setattr(workflow_engine, "get_db", lambda: SimpleNamespace(offers=_Offers()))
    monkeypatch.setattr(workflow_engine, "enforce_rate_limit", limiter or _Limiter())
    monkeypatch.setattr(settings, "FRONTEND_URL", "https://app.example.com")
    return mail


async def test_a_workflow_email_goes_only_to_one_valid_address(monkeypatch):
    limiter = _Limiter()
    mail = _workflow(monkeypatch, limiter)
    with company_context("cmp_hyg_wf"):
        for bad in (
            "not-an-email", "a@b.co, c@d.co", "a@b.co;c@d.co", "a@b.co\r\nBcc: x@y.co", "<a@b.co>", "a b@c.co", "a@b", "",
        ):
            await workflow_engine._apply_send_email({"to_email": bad}, {})
        assert mail["reminder"] == [] and limiter.calls == []

        await workflow_engine._apply_send_email({"to_email": "Jane.Doe+tag@example.co.uk"}, {})
        await workflow_engine._apply_send_email({}, {"candidate_email": "from.context@example.com\r\n"})
    assert [m["to_email"] for m in mail["reminder"]] == ["Jane.Doe+tag@example.co.uk", "from.context@example.com"]


async def test_a_company_sends_at_most_200_workflow_emails_an_hour_and_the_rest_are_skipped(monkeypatch):
    limiter = _Limiter(allow=2)
    mail = _workflow(monkeypatch, limiter)
    with company_context("cmp_hyg_wf"):
        for n in range(4):
            await workflow_engine._apply_send_email({"to_email": f"c{n}@example.com"}, {})
    assert [m["to_email"] for m in mail["reminder"]] == ["c0@example.com", "c1@example.com"]
    assert limiter.calls[0] == ("co:cmp_hyg_wf:workflow_email", 200, 3600)
    assert workflow_engine.WORKFLOW_EMAIL_PER_HOUR == 200


async def test_a_limiter_that_cannot_be_reached_does_not_stop_a_rule(monkeypatch):
    async def broken(db, *, key, limit, window_seconds):
        raise RuntimeError("counter store is down")

    mail = _workflow(monkeypatch)
    monkeypatch.setattr(workflow_engine, "enforce_rate_limit", broken)
    with company_context("cmp_hyg_wf"):
        await workflow_engine._apply_send_email({"to_email": "c@example.com"}, {})
    assert len(mail["reminder"]) == 1


async def test_an_offer_rule_cannot_point_the_accept_button_at_another_site(monkeypatch):
    mail = _workflow(monkeypatch)
    offer_params = {"to_email": "c@example.com", "email_kind": "offer"}
    own = "https://app.example.com/offer/tok_1"
    with company_context("cmp_hyg_wf"):
        await workflow_engine._apply_send_email({**offer_params, "accept_url": own}, {"offer_id": "o1"})
        await workflow_engine._apply_send_email({**offer_params, "accept_url": "https://evil.example/pay"}, {"offer_id": "o1"})
        await workflow_engine._apply_send_email({**offer_params, "accept_url": "https://evil.example/pay"}, {})
        await workflow_engine._apply_send_email({**offer_params, "accept_url": "javascript:alert(1)"}, {"offer_id": "unknown"})
        await workflow_engine._apply_send_email(offer_params, {"offer_id": "o1"})
    links = [m["accept_url"] for m in mail["offer"]]
    assert links == [own, "https://app.example.com/offer/tok_abc", None, None, None]


async def test_a_workflow_reminder_only_takes_something_shaped_like_a_link_token(monkeypatch):
    mail = _workflow(monkeypatch)
    with company_context("cmp_hyg_wf"):
        await workflow_engine._apply_send_email({"to_email": "c@example.com", "secure_token": "../../evil?x="}, {})
        await workflow_engine._apply_send_email({"to_email": "c@example.com"}, {"secure_token": "tok_0123456789abcdef"})
    assert [m["secure_token"] for m in mail["reminder"]] == [None, "tok_0123456789abcdef"]


def test_alert_recipients_are_valid_addresses_and_at_most_ten():
    many = ", ".join(f"a{n}@example.com" for n in range(12))
    got = notification_settings_service._recipients(many + ", not-an-address")
    assert got == [f"a{n}@example.com" for n in range(10)]
    assert notification_settings_service._recipients("one@example.com") == ["one@example.com"]
    assert notification_settings_service._recipients("bad, @x") == []
    assert notification_settings_service.MAX_RECIPIENTS == 10


async def test_the_offer_pdf_escapes_what_a_paragraph_would_read_as_markup(monkeypatch):
    import reportlab.platypus as platypus

    texts: list[str] = []
    real_paragraph = platypus.Paragraph

    def recording(text, *args, **kwargs):
        texts.append(text)
        return real_paragraph(text, *args, **kwargs)

    monkeypatch.setattr(platypus, "Paragraph", recording)

    offer = {"salary": "<b>9</b> & more", "benefits": "<u>health</u>\nsecond line", "joining_date": "1 <i>Jan</i>"}
    job = {"title": "Dev <i>x</i>", "company_name": 'A&B <font color="red">Co</font> <img src="file:///etc/passwd"/>'}
    candidate = {"name": 'Eve <b>Bold</b> & <img src="http://169.254.169.254/x"/>'}
    branding = {"letterhead_header_text": "Head <a href='http://x.example'>link</a>", "letterhead_footer_text": "Foot\nline"}
    signature = {"image_base64": "not-valid-base64!!!", "signer_name": "Sig <i>ner</i>"}
    pdf = await offer_service.render_offer_pdf(
        offer, job, candidate, branding, ai_body="Welcome <b>aboard</b>.\nSecond <para>line</para>", signature_image=signature,
    )
    assert pdf[:4] == b"%PDF"

    template = {"letterhead_template": {
        "body_paragraphs": ["Dear {{candidate_name}} <b>x</b> & {{company_name}}\nas {{job_title}}"],
    }}
    pdf = await offer_service.render_offer_pdf(offer, job, candidate, template)
    assert pdf[:4] == b"%PDF"

    everything = "\n".join(texts)
    for raw in ("<img", "<font", "<i>", "<u>", "<a ", "<para>", "<b>Bold</b>", "<b>9</b>", "<b>aboard</b>", "<b>x</b>"):
        assert raw not in everything, raw
    assert "Eve &lt;b&gt;Bold&lt;/b&gt; &amp; &lt;img" in everything
    assert "<b>Benefits:</b> &lt;u&gt;health&lt;/u&gt;<br/>second line" in everything
    assert "Welcome &lt;b&gt;aboard&lt;/b&gt;.<br/>Second &lt;para&gt;line&lt;/para&gt;" in everything
    assert "Foot<br/>line" in everything and "Sig &lt;i&gt;ner&lt;/i&gt;" in everything
    assert "Dear Eve &lt;b&gt;Bold&lt;/b&gt;" in everything and "&lt;b&gt;x&lt;/b&gt; &amp; A&amp;B" in everything
    assert "<br/>as Dev &lt;i&gt;x&lt;/i&gt;" in everything
    assert "<b>Salary:</b> &lt;b&gt;9&lt;/b&gt; &amp; more" in everything


def test_pdf_text_helpers():
    assert offer_service._pdf_inline("a  <b>\n b </b> & c") == "a &lt;b&gt; b &lt;/b&gt; &amp; c"
    assert offer_service._pdf_inline(None) == ""
    assert offer_service._pdf_text("one\r\ntwo\rthree\n<x>") == "one<br/>two<br/>three<br/>&lt;x&gt;"
    assert offer_service._pdf_text(None) == ""


class _Tokens:

    def __init__(self):
        self.docs: list[dict] = []

    @staticmethod
    def _match(doc, flt):
        for key, want in flt.items():
            if isinstance(want, dict) and "$gt" in want:
                if not doc.get(key) or not doc[key] > want["$gt"]:
                    return False
            elif doc.get(key) != want:
                return False
        return True

    async def insert_one(self, doc):
        self.docs.append(dict(doc))

    async def update_many(self, flt, update):
        for doc in self.docs:
            if self._match(doc, flt):
                doc.update(update["$set"])

    async def find_one(self, flt):
        return next((dict(d) for d in self.docs if self._match(d, flt)), None)

    async def find_one_and_update(self, flt, update):
        for doc in self.docs:
            if self._match(doc, flt):
                before = dict(doc)
                doc.update(update["$set"])
                return before
        return None

    async def delete_one(self, flt):
        for doc in self.docs:
            if self._match(doc, flt):
                self.docs.remove(doc)
                return


def _db(tokens=None):
    return SimpleNamespace(password_tokens=tokens or _Tokens())


async def test_only_the_hash_of_a_token_is_stored_and_the_lifetimes_are_as_contracted():
    db = _db()
    before = datetime.now(timezone.utc)
    reset = await credentials_service.issue_token(db, email="a@example.com", purpose="reset", company_id="cmp_x")
    invite = await credentials_service.issue_token(db, email="b@example.com", purpose="invite", company_id="cmp_x", invited_by="boss@example.com")
    assert len(reset) >= 43 and reset != invite
    rows = {d["email"]: d for d in db.password_tokens.docs}
    assert rows["a@example.com"]["token_hash"] == credentials_service.hash_token(reset)
    assert reset not in str(db.password_tokens.docs) and invite not in str(db.password_tokens.docs)
    assert rows["a@example.com"]["used_at"] is None and rows["a@example.com"]["purpose"] == "reset"
    assert timedelta(minutes=59) < rows["a@example.com"]["expires_at"] - before < timedelta(minutes=61)
    assert timedelta(days=6, hours=23) < rows["b@example.com"]["expires_at"] - before < timedelta(days=7, hours=1)
    assert isinstance(rows["a@example.com"]["expires_at"], datetime)
    with pytest.raises(ValueError):
        await credentials_service.issue_token(db, email="a@example.com", purpose="admin")


async def test_a_new_token_voids_the_older_ones_for_that_address_only():
    db = _db()
    first = await credentials_service.issue_token(db, email="a@example.com", purpose="reset")
    other = await credentials_service.issue_token(db, email="b@example.com", purpose="reset")
    second = await credentials_service.issue_token(db, email="a@example.com", purpose="reset")
    assert await credentials_service.find_open_token(db, first) is None
    assert (await credentials_service.find_open_token(db, second))["email"] == "a@example.com"
    assert (await credentials_service.find_open_token(db, other))["email"] == "b@example.com"


async def test_a_token_can_be_used_exactly_once_and_not_after_it_expires():
    db = _db()
    token = await credentials_service.issue_token(db, email="a@example.com", purpose="reset")
    assert (await credentials_service.claim_token(db, token))["email"] == "a@example.com"
    assert await credentials_service.claim_token(db, token) is None
    assert await credentials_service.find_open_token(db, token) is None
    assert await credentials_service.claim_token(db, "") is None
    assert await credentials_service.claim_token(db, "not-a-real-token") is None

    stale = await credentials_service.issue_token(db, email="b@example.com", purpose="reset")
    db.password_tokens.docs[-1]["expires_at"] = datetime.now(timezone.utc) - timedelta(seconds=1)
    assert await credentials_service.find_open_token(db, stale) is None
    assert await credentials_service.claim_token(db, stale) is None


def test_the_link_and_the_unusable_password(monkeypatch):
    monkeypatch.setattr(settings, "FRONTEND_URL", "https://app.example.com")
    assert credentials_service.build_link("abc", "reset") == "https://app.example.com/reset-password?token=abc"
    assert credentials_service.build_link("abc", "invite") == "https://app.example.com/reset-password?token=abc&invite=1"
    monkeypatch.setattr(settings, "FRONTEND_URL", "https://app.example.com/")
    assert credentials_service.build_link("abc", "reset") == "https://app.example.com/reset-password?token=abc"
    first, second = credentials_service.unusable_password(), credentials_service.unusable_password()
    assert first != second and len(first) == 64 and int(first, 16) >= 0


def _send_invite_harness(monkeypatch, *, sender_result=True, company=None):
    tokens = _Tokens()
    calls: list[dict] = []

    async def load_company(company_id):
        return company

    def sender(kind):
        async def send(**kwargs):
            calls.append({"kind": kind, "sender_name": email_service.sender_name(), **kwargs})
            if isinstance(sender_result, Exception):
                raise sender_result
            return sender_result
        return send

    monkeypatch.setattr(workspace_service, "load_company", load_company)
    monkeypatch.setattr(credentials_service, "get_db", lambda: _db(tokens))
    monkeypatch.setattr(email_service, "send_invitation_email", sender("invite"))
    monkeypatch.setattr(email_service, "send_password_reset_email", sender("reset"))
    monkeypatch.setattr(settings, "FRONTEND_URL", "https://app.example.com")
    monkeypatch.setattr(settings, "EMAIL_FROM_NAME", "HR Platform")
    return tokens, calls


async def test_send_invite_mails_the_right_link_as_that_company(monkeypatch):
    tokens, calls = _send_invite_harness(monkeypatch, company={"company_id": "cmp_inv", "name": "Acme Hiring", "settings": {}})
    with _no_fallback():
        assert await credentials_service.send_invite(
            email="  New.Person@Example.com ", name="New Person", company_id="cmp_inv", invited_by="boss@example.com",
        ) is True
        assert await credentials_service.send_invite(
            email="new.person@example.com", name="New Person", company_id="cmp_inv", invited_by=None, purpose="reset",
        ) is True
    invite, reset = calls
    assert invite["kind"] == "invite" and reset["kind"] == "reset"
    assert invite["to_email"] == "new.person@example.com" and invite["name"] == "New Person"
    assert invite["sender_name"] == "Acme Hiring"
    assert invite["invite_url"].startswith("https://app.example.com/reset-password?token=")
    assert invite["invite_url"].endswith("&invite=1") and invite["expires_in"] == "7 days"
    assert reset["reset_url"].startswith("https://app.example.com/reset-password?token=")
    assert "invite=1" not in reset["reset_url"] and reset["expires_in"] == "1 hour"
    open_rows = [d for d in tokens.docs if d["used_at"] is None]
    assert len(open_rows) == 1 and open_rows[0]["purpose"] == "reset" and open_rows[0]["company_id"] == "cmp_inv"


async def test_send_invite_reports_a_message_that_did_not_leave_and_keeps_no_dead_link(monkeypatch):
    tokens, calls = _send_invite_harness(
        monkeypatch, sender_result=False, company={"company_id": "cmp_inv", "name": "Acme Hiring", "settings": {}},
    )
    with _no_fallback():
        assert await credentials_service.send_invite(
            email="a@example.com", name="A", company_id="cmp_inv", invited_by="boss@example.com",
        ) is False
    assert len(calls) == 1 and tokens.docs == []


async def test_send_invite_never_raises_into_the_caller(monkeypatch):
    tokens, _ = _send_invite_harness(
        monkeypatch, sender_result=RuntimeError("smtp exploded"), company={"company_id": "cmp_inv", "name": "Acme", "settings": {}},
    )
    with _no_fallback():
        assert await credentials_service.send_invite(email="a@example.com", name="A", company_id="cmp_inv", invited_by=None) is False

    _, calls = _send_invite_harness(monkeypatch, company=None)
    with _no_fallback():
        assert await credentials_service.send_invite(email="a@example.com", name="A", company_id="cmp_gone", invited_by=None) is False
    assert calls == []
    with pytest.raises(ValueError):
        await credentials_service.send_invite(email="a@example.com", name="A", company_id="cmp_inv", invited_by=None, purpose="admin")
