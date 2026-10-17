import uuid

import pytest

from services.hr_module import email_service

pytestmark = pytest.mark.anyio


async def test_build_mime_without_attachment_is_unchanged_alternative_structure():
    msg = email_service._build_mime(
        to="a@example.com", subject="Subj", html_body="<p>hi</p>", text_body="hi",
    )
    assert msg.get_content_type() == "multipart/alternative"
    assert msg["To"] == "a@example.com"


async def test_build_mime_with_attachment_wraps_in_mixed_and_carries_the_pdf():
    pdf_bytes = b"%PDF-1.4 fake offer letter content"
    msg = email_service._build_mime(
        to="candidate@example.com", subject="Offer", html_body="<p>hi</p>", text_body="hi",
        attachment_bytes=pdf_bytes, attachment_filename="offer_abc123.pdf",
    )
    assert msg.get_content_type() == "multipart/mixed"

    parts = msg.get_payload()
    assert len(parts) == 2
    alt_part, attachment_part = parts
    assert alt_part.get_content_type() == "multipart/alternative"
    assert attachment_part.get_content_type() == "application/pdf"
    assert attachment_part.get_filename() == "offer_abc123.pdf"
    assert attachment_part.get_payload(decode=True) == pdf_bytes
    assert "attachment" in attachment_part.get("Content-Disposition", "")


async def test_send_email_forwards_attachment_to_build_mime(monkeypatch):
    captured = {}
    original_build_mime = email_service._build_mime

    def _spy_build_mime(**kwargs):
        captured.update(kwargs)
        return original_build_mime(**kwargs)

    monkeypatch.setattr(email_service, "_build_mime", _spy_build_mime)
    monkeypatch.setattr(email_service.settings, "EMAIL_HOST", "smtp.example.com")

    async def _fake_smtp_send(msg, **kwargs):
        return None

    import aiosmtplib
    monkeypatch.setattr(aiosmtplib, "send", _fake_smtp_send)

    delivered = await email_service.send_email(
        to="candidate@example.com", subject="Offer", html_body="<p>hi</p>", text_body="hi",
        attachment_bytes=b"%PDF-1.4 content", attachment_filename="offer.pdf",
    )
    assert delivered is True
    assert captured["attachment_bytes"] == b"%PDF-1.4 content"
    assert captured["attachment_filename"] == "offer.pdf"


async def test_send_offer_letter_email_passes_pdf_through_to_send_email(monkeypatch):
    captured = {}

    async def _fake_send_email(**kwargs):
        captured.update(kwargs)
        return True

    monkeypatch.setattr(email_service, "send_email", _fake_send_email)

    await email_service.send_offer_letter_email(
        to_email="candidate@example.com", candidate_name="Jane Doe", job_title="Engineer",
        company_name="Acme Inc", salary="120000 USD/year", joining_date="2026-01-01",
        benefits="Health", accept_url="https://example.com/offer/tok_123",
        pdf_bytes=b"%PDF-1.4 the actual letter", pdf_filename="offer_12345678.pdf",
    )
    assert captured["attachment_bytes"] == b"%PDF-1.4 the actual letter"
    assert captured["attachment_filename"] == "offer_12345678.pdf"


async def test_send_offer_letter_email_without_pdf_sends_no_attachment(monkeypatch):
    captured = {}

    async def _fake_send_email(**kwargs):
        captured.update(kwargs)
        return True

    monkeypatch.setattr(email_service, "send_email", _fake_send_email)

    await email_service.send_offer_letter_email(
        to_email="candidate@example.com", candidate_name="Jane Doe", job_title="Engineer",
        company_name="Acme Inc",
    )
    assert captured["attachment_bytes"] is None
    assert captured["attachment_filename"] is None


JOB_PAYLOAD = {
    "title": "Backend Engineer",
    "description": "Build APIs and services.",
    "difficulty": "mid",
    "employment_type": "full-time",
    "location": "Remote",
    "salary_min": 90000,
    "salary_max": 130000,
    "is_remote": True,
    "company_name": "Email Attachment Test Corp",
}

OFFER_PAYLOAD = {
    "salary": "145000 USD/year",
    "benefits": "Health, dental",
    "joining_date": "2026-11-15",
}


async def test_send_offer_attaches_rendered_pdf_to_the_candidate_email(client, admin_headers, monkeypatch):
    captured = {}

    async def _fake_send_offer_letter_email(**kwargs):
        captured.update(kwargs)
        return True

    monkeypatch.setattr(email_service, "send_offer_letter_email", _fake_send_offer_letter_email)

    job_resp = await client.post("/api/v1/jobs", json=JOB_PAYLOAD, headers=admin_headers)
    job_id = job_resp.json()["job_id"]
    cand_resp = await client.post(
        "/api/v1/candidates",
        json={"job_id": job_id, "name": "Attachment Candidate", "email": f"attach.{uuid.uuid4().hex[:8]}@example.com"},
        headers=admin_headers,
    )
    candidate_id = cand_resp.json()["candidate_id"]
    offer_resp = await client.post(
        "/api/v1/offers", json={"candidate_id": candidate_id, **OFFER_PAYLOAD}, headers=admin_headers,
    )
    offer_id = offer_resp.json()["offer_id"]

    await client.post(f"/api/v1/offers/{offer_id}/approve", headers=admin_headers)
    send_resp = await client.post(f"/api/v1/offers/{offer_id}/send", headers=admin_headers)
    assert send_resp.status_code == 200

    assert captured.get("pdf_bytes") is not None
    assert captured["pdf_bytes"][:4] == b"%PDF"
    assert captured["pdf_filename"] == f"offer_{offer_id[:8]}.pdf"
