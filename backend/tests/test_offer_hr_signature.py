import io

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
    "company_name": "Signature Compositing Corp",
}

OFFER_PAYLOAD = {
    "salary": "130000 USD/year",
    "benefits": "Health, dental",
    "joining_date": "2026-10-15",
}


def _fake_png_bytes() -> bytes:
    from PIL import Image as PILImage

    buf = io.BytesIO()
    PILImage.new("RGB", (40, 20), color="black").save(buf, format="PNG")
    return buf.getvalue()


async def _create_job(client, headers):
    response = await client.post("/api/v1/jobs", json=JOB_PAYLOAD, headers=headers)
    assert response.status_code == 200
    return response.json()["job_id"]


async def _create_candidate(client, headers, job_id, email):
    response = await client.post(
        "/api/v1/candidates",
        json={"job_id": job_id, "name": "Signature Candidate", "email": email},
        headers=headers,
    )
    assert response.status_code == 200
    return response.json()["candidate_id"]


async def _create_offer(client, admin_headers, email_suffix):
    job_id = await _create_job(client, admin_headers)
    candidate_id = await _create_candidate(client, admin_headers, job_id, f"sig.{email_suffix}@example.com")
    resp = await client.post(
        "/api/v1/offers",
        json={"candidate_id": candidate_id, **OFFER_PAYLOAD},
        headers=admin_headers,
    )
    assert resp.status_code == 200
    return resp.json()["offer_id"]


async def test_upload_signature_requires_admin(client, standard_headers):
    resp = await client.post(
        "/api/v1/offers/signature",
        files={"file": ("sig.png", _fake_png_bytes(), "image/png")},
        headers=standard_headers,
    )
    assert resp.status_code == 403


async def test_upload_signature_rejects_non_image_content_type(client, admin_headers):
    resp = await client.post(
        "/api/v1/offers/signature",
        files={"file": ("sig.txt", b"not an image", "text/plain")},
        headers=admin_headers,
    )
    assert resp.status_code == 400


async def test_upload_signature_rejects_oversized_file(client, admin_headers, monkeypatch):
    import routes.offers as offers_route

    monkeypatch.setattr(offers_route, "_MAX_SIGNATURE_IMAGE_BYTES", 4)
    resp = await client.post(
        "/api/v1/offers/signature",
        files={"file": ("sig.png", _fake_png_bytes(), "image/png")},
        headers=admin_headers,
    )
    assert resp.status_code == 400


async def test_upload_and_fetch_my_signature_roundtrip(client, admin_headers):
    png = _fake_png_bytes()
    upload_resp = await client.post(
        "/api/v1/offers/signature",
        files={"file": ("sig.png", png, "image/png")},
        headers=admin_headers,
    )
    assert upload_resp.status_code == 200, upload_resp.text
    assert upload_resp.json()["content_type"] == "image/png"

    get_resp = await client.get("/api/v1/offers/signature/me", headers=admin_headers)
    assert get_resp.status_code == 200
    body = get_resp.json()
    assert body["configured"] is True
    assert body["content_type"] == "image/png"
    assert body["image_base64"]


async def test_get_my_signature_when_none_uploaded(client, superadmin_headers):
    resp = await client.get("/api/v1/offers/signature/me", headers=superadmin_headers)
    assert resp.status_code == 200
    assert resp.json() == {"configured": False}


async def test_save_and_get_signature_image_roundtrip():
    from services.hr_module.offer_service import get_signature_image, save_signature_image

    saved = await save_signature_image(
        email="signer@example.com", raw_bytes=_fake_png_bytes(),
        content_type="image/png", filename="mine.png",
    )
    assert saved["email"] == "signer@example.com"

    fetched = await get_signature_image("signer@example.com")
    assert fetched["content_type"] == "image/png"
    assert fetched["image_base64"] == saved["image_base64"]


async def test_resolve_signature_for_offer_prefers_approver_over_creator():
    from config.database import get_db
    from services.hr_module.offer_service import resolve_signature_for_offer, save_signature_image

    db = get_db()
    await save_signature_image(email="approver@example.com", raw_bytes=_fake_png_bytes(), content_type="image/png")
    await save_signature_image(email="creator@example.com", raw_bytes=_fake_png_bytes(), content_type="image/png")

    offer = {"created_by": "creator@example.com", "approved_by": "approver@example.com"}
    resolved = await resolve_signature_for_offer(db, offer)
    assert resolved["signer_email"] == "approver@example.com"


async def test_resolve_signature_for_offer_falls_back_to_creator_when_not_yet_approved():
    from config.database import get_db
    from services.hr_module.offer_service import resolve_signature_for_offer, save_signature_image

    db = get_db()
    await save_signature_image(email="justcreated@example.com", raw_bytes=_fake_png_bytes(), content_type="image/png")

    offer = {"created_by": "justcreated@example.com", "approved_by": None}
    resolved = await resolve_signature_for_offer(db, offer)
    assert resolved["signer_email"] == "justcreated@example.com"


async def test_resolve_signature_for_offer_returns_none_when_nobody_has_uploaded_one():
    from config.database import get_db
    from services.hr_module.offer_service import resolve_signature_for_offer

    db = get_db()
    offer = {"created_by": "nosignature-ever@example.com", "approved_by": None}
    resolved = await resolve_signature_for_offer(db, offer)
    assert resolved is None


_OFFER = {
    "offer_id": "off-sig-1", "candidate_id": "cand-1", "job_id": "job-1",
    "salary": "100000 USD/year", "benefits": "Health cover", "joining_date": "2026-01-01",
}
_JOB = {"title": "Engineer", "company_name": "Acme Inc"}
_CANDIDATE = {"name": "Jane Doe"}


async def test_render_offer_pdf_with_signature_image_composited():
    from services.hr_module.offer_service import render_offer_pdf
    import base64

    signature_image = {
        "image_base64": base64.b64encode(_fake_png_bytes()).decode("ascii"),
        "content_type": "image/png",
        "signer_name": "Pat Approver",
    }
    pdf_bytes = await render_offer_pdf(_OFFER, _JOB, _CANDIDATE, {}, signature_image=signature_image)
    assert pdf_bytes[:4] == b"%PDF"


async def test_render_offer_pdf_without_signature_image_still_renders():
    from services.hr_module.offer_service import render_offer_pdf

    pdf_bytes = await render_offer_pdf(_OFFER, _JOB, _CANDIDATE, {}, signature_image=None)
    assert pdf_bytes[:4] == b"%PDF"


async def test_render_offer_pdf_degrades_gracefully_on_corrupt_signature_base64():
    from services.hr_module.offer_service import render_offer_pdf

    signature_image = {"image_base64": "not-valid-base64!!!", "signer_name": "Broken Signature"}
    pdf_bytes = await render_offer_pdf(_OFFER, _JOB, _CANDIDATE, {}, signature_image=signature_image)
    assert pdf_bytes[:4] == b"%PDF"


async def test_render_offer_pdf_with_ai_body_paragraph():
    from services.hr_module.offer_service import render_offer_pdf

    pdf_bytes = await render_offer_pdf(
        _OFFER, _JOB, _CANDIDATE, {}, ai_body="We are glad to welcome you to the team.",
    )
    assert pdf_bytes[:4] == b"%PDF"


async def test_render_offer_pdf_with_letterhead_template_body_paragraphs():
    from services.hr_module.offer_service import render_offer_pdf

    branding = {
        "letterhead_template": {
            "header_text": "Acme HQ",
            "footer_text": "Confidential",
            "logo_base64": None,
            "body_paragraphs": ["Dear {{candidate_name}}, welcome to {{company_name}} as {{job_title}}."],
        },
    }
    pdf_bytes = await render_offer_pdf(_OFFER, _JOB, _CANDIDATE, branding)
    assert pdf_bytes[:4] == b"%PDF"


async def test_offer_pdf_download_composites_creators_signature(client, admin_headers):
    await client.post(
        "/api/v1/offers/signature",
        files={"file": ("sig.png", _fake_png_bytes(), "image/png")},
        headers=admin_headers,
    )
    offer_id = await _create_offer(client, admin_headers, "pdfdownload")
    resp = await client.get(f"/api/v1/offers/{offer_id}/pdf", headers=admin_headers)
    assert resp.status_code == 200
    assert resp.content[:4] == b"%PDF"
