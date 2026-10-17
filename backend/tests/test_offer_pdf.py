import io
import uuid

import pytest

pytestmark = pytest.mark.anyio

JOB_PAYLOAD = {
    "title": "Backend Engineer",
    "description": "Build APIs and services.",
    "difficulty": "mid",
    "employment_type": "full-time",
    "location": "Remote",
    "salary_min": 90000,
    "salary_max": 130000,
    "is_remote": True,
    "company_name": "Letterhead Test Corp",
}

OFFER_PAYLOAD = {
    "salary": "150000 USD/year",
    "benefits": "Health, dental, 401k",
    "joining_date": "2026-10-01",
}


async def _create_job(client, headers):
    response = await client.post("/api/v1/jobs", json=JOB_PAYLOAD, headers=headers)
    assert response.status_code == 200
    return response.json()["job_id"]


async def _create_candidate(client, headers, job_id, email):
    response = await client.post(
        "/api/v1/candidates",
        json={"job_id": job_id, "name": "PDF Candidate", "email": email},
        headers=headers,
    )
    assert response.status_code == 200
    return response.json()["candidate_id"]


async def _create_offer(client, admin_headers, email_suffix):
    job_id = await _create_job(client, admin_headers)
    candidate_id = await _create_candidate(client, admin_headers, job_id, f"pdf.{email_suffix}@example.com")
    resp = await client.post(
        "/api/v1/offers",
        json={"candidate_id": candidate_id, **OFFER_PAYLOAD},
        headers=admin_headers,
    )
    assert resp.status_code == 200
    return resp.json()["offer_id"]


async def test_offer_pdf_requires_auth_at_all(client, admin_headers):
    offer_id = await _create_offer(client, admin_headers, "noauth")
    resp = await client.get(f"/api/v1/offers/{offer_id}/pdf")
    assert resp.status_code == 401


async def test_offer_pdf_rejects_standard_role(client, admin_headers, standard_headers):
    offer_id = await _create_offer(client, admin_headers, "standardrole")
    resp = await client.get(f"/api/v1/offers/{offer_id}/pdf", headers=standard_headers)
    assert resp.status_code == 403


async def test_offer_pdf_allows_admin(client, admin_headers):
    offer_id = await _create_offer(client, admin_headers, "admin")
    resp = await client.get(f"/api/v1/offers/{offer_id}/pdf", headers=admin_headers)
    assert resp.status_code == 200


async def test_offer_pdf_allows_superadmin(client, admin_headers, superadmin_headers):
    offer_id = await _create_offer(client, admin_headers, "superadmin")
    resp = await client.get(f"/api/v1/offers/{offer_id}/pdf", headers=superadmin_headers)
    assert resp.status_code == 200


async def test_offer_pdf_unknown_offer_404(client, admin_headers):
    resp = await client.get(
        f"/api/v1/offers/no-such-offer-{uuid.uuid4().hex[:8]}/pdf", headers=admin_headers,
    )
    assert resp.status_code == 404


async def test_offer_pdf_returns_pdf_bytes(client, admin_headers):
    offer_id = await _create_offer(client, admin_headers, "bytes")
    resp = await client.get(f"/api/v1/offers/{offer_id}/pdf", headers=admin_headers)
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert resp.content[:4] == b"%PDF"
    assert "attachment" in resp.headers["content-disposition"]


_OFFER = {
    "offer_id": "off-1", "candidate_id": "cand-1", "job_id": "job-1",
    "salary": "100000 USD/year", "benefits": "Health cover", "joining_date": "2026-01-01",
}
_JOB = {"title": "Engineer", "company_name": "Acme Inc"}
_CANDIDATE = {"name": "Jane Doe"}


async def test_render_offer_pdf_without_logo_configured():
    from services.hr_module.offer_service import render_offer_pdf

    branding = {"company_logo_url": "", "letterhead_header_text": "", "letterhead_footer_text": ""}
    pdf_bytes = await render_offer_pdf(_OFFER, _JOB, _CANDIDATE, branding)
    assert isinstance(pdf_bytes, bytes)
    assert pdf_bytes[:4] == b"%PDF"


async def test_render_offer_pdf_with_header_and_footer_text_no_logo():
    from services.hr_module.offer_service import render_offer_pdf

    branding = {
        "company_logo_url": "",
        "letterhead_header_text": "Acme Inc, 1 Main St, Springfield",
        "letterhead_footer_text": "Confidential, property of Acme Inc",
    }
    pdf_bytes = await render_offer_pdf(_OFFER, _JOB, _CANDIDATE, branding)
    assert pdf_bytes[:4] == b"%PDF"


async def test_render_offer_pdf_with_missing_branding_doc():
    from services.hr_module.offer_service import render_offer_pdf

    pdf_bytes = await render_offer_pdf(_OFFER, _JOB, _CANDIDATE, {})
    assert pdf_bytes[:4] == b"%PDF"


def _fake_png_bytes() -> bytes:
    from PIL import Image as PILImage

    buf = io.BytesIO()
    PILImage.new("RGB", (4, 4), color="red").save(buf, format="PNG")
    return buf.getvalue()


async def _fake_logo_request(method, url, **kwargs):
    from shared.safe_http import SafeResponse

    png = _fake_png_bytes()
    return SafeResponse(200, {"content-type": "image/png", "content-length": str(len(png))}, png)


async def _failing_logo_request(method, url, **kwargs):
    raise RuntimeError("simulated network failure")


async def test_render_offer_pdf_with_configured_logo(monkeypatch):
    from services.hr_module import offer_service, url_safety, webhook_service

    monkeypatch.setattr(url_safety, "safe_request", _fake_logo_request)
    monkeypatch.setattr(webhook_service, "is_url_ssrf_safe", lambda url: True)

    branding = {"company_logo_url": "https://example.com/logo.png"}
    pdf_bytes = await offer_service.render_offer_pdf(_OFFER, _JOB, _CANDIDATE, branding)
    assert pdf_bytes[:4] == b"%PDF"


async def test_render_offer_pdf_logo_fetch_failure_degrades_gracefully(monkeypatch):
    from services.hr_module import offer_service, url_safety, webhook_service

    monkeypatch.setattr(url_safety, "safe_request", _failing_logo_request)
    monkeypatch.setattr(webhook_service, "is_url_ssrf_safe", lambda url: True)

    branding = {"company_logo_url": "https://example.com/logo.png"}
    pdf_bytes = await offer_service.render_offer_pdf(_OFFER, _JOB, _CANDIDATE, branding)
    assert pdf_bytes[:4] == b"%PDF"
