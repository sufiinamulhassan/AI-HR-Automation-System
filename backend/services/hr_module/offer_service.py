import asyncio
import base64
import json
import logging
import uuid
from datetime import datetime, timezone

from config.database import get_db
from shared.utils import new_secure_token, sha256_hex

logger = logging.getLogger(__name__)

_NON_TERMINAL_STATUSES = {"draft", "pending_approval", "approved", "sent"}

_DRAFTABLE_STATUSES = {"draft", "pending_approval", "approved"}

_SIGNATURE_TERMS_FIELDS = ("offer_id", "candidate_id", "job_id", "salary", "benefits", "joining_date")


def offer_terms_hash(offer: dict) -> str:
    terms = {field: offer.get(field) for field in _SIGNATURE_TERMS_FIELDS}
    canonical = json.dumps(terms, sort_keys=True, separators=(",", ":"))
    return sha256_hex(canonical.encode("utf-8"))


def _offer_context(offer: dict, workflow_depth: int) -> dict:
    return {
        "offer_id": offer.get("offer_id"), "candidate_id": offer.get("candidate_id"),
        "job_id": offer.get("job_id"), "status": offer.get("status"),
        "salary": offer.get("salary"), "joining_date": offer.get("joining_date"),
        "_workflow_depth": workflow_depth,
    }


def _fire_offer_status_changed(offer: dict, workflow_depth: int = 0) -> None:
    from services.hr_module.workflow_engine import TRIGGER_OFFER_STATUS_CHANGED, evaluate_and_apply_rules
    asyncio.create_task(evaluate_and_apply_rules(
        trigger_type=TRIGGER_OFFER_STATUS_CHANGED,
        context=_offer_context(offer, workflow_depth),
    ))


async def _announce_offer(event: str, offer: dict, candidate_name: str | None = None) -> None:
    try:
        from services.hr_module.webhook_service import emit_event

        name = candidate_name
        if name is None and offer.get("candidate_id"):
            db = get_db()
            cand = await db.candidates.find_one({"candidate_id": offer["candidate_id"]}, {"_id": 0, "name": 1}) if db is not None else None
            name = (cand or {}).get("name")
        await emit_event(event, {
            "offer_id": offer.get("offer_id"),
            "candidate_id": offer.get("candidate_id"),
            "candidate_name": name,
            "job_id": offer.get("job_id"),
            "status": offer.get("status"),
        })
    except Exception as exc:
        logger.warning("Offer webhook announcement skipped | event=%s error=%s", event, type(exc).__name__)


def _fire_offer_created(offer: dict) -> None:
    from services.hr_module.workflow_engine import TRIGGER_OFFER_CREATED, evaluate_and_apply_rules
    asyncio.create_task(evaluate_and_apply_rules(
        trigger_type=TRIGGER_OFFER_CREATED,
        context=_offer_context(offer, 0),
    ))


async def create_offer(
    candidate_id: str,
    salary: str,
    benefits: str | None,
    joining_date: str | None,
    created_by: str,
) -> dict:
    db = get_db()
    if db is None:
        raise RuntimeError("Database unavailable")

    cand = await db.candidates.find_one({"candidate_id": candidate_id})
    if not cand or cand.get("erased"):
        raise ValueError("Candidate not found")

    from services.hr_module.external_interview_service import require_review
    require_review(cand)

    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "doc_type": "offer",
        "offer_id": str(uuid.uuid4()),
        "candidate_id": candidate_id,
        "job_id": cand.get("job_id"),
        "salary": salary,
        "benefits": benefits,
        "joining_date": joining_date,
        "status": "draft",
        "secure_token": new_secure_token(),
        "created_by": created_by,
        "approved_by": None,
        "sent_at": None,
        "responded_at": None,
        "decline_reason": None,
        "created_at": now,
        "updated_at": now,
    }
    await db.offers.insert_one(doc)
    doc.pop("_id", None)
    _fire_offer_created(doc)
    await _announce_offer("offer.created", doc, cand.get("name"))
    return doc


async def get_offer(offer_id: str) -> dict | None:
    db = get_db()
    if db is None:
        raise RuntimeError("Database unavailable")
    return await db.offers.find_one({"offer_id": offer_id}, {"_id": 0})


async def list_offers(
    candidate_id: str | None = None,
    job_id: str | None = None,
    status: str | None = None,
) -> list[dict]:
    db = get_db()
    if db is None:
        raise RuntimeError("Database unavailable")
    query: dict = {"doc_type": "offer"}
    if candidate_id:
        query["candidate_id"] = candidate_id
    if job_id:
        query["job_id"] = job_id
    if status:
        query["status"] = status
    cursor = db.offers.find(query, {"_id": 0}).sort("created_at", -1)
    return await cursor.to_list(length=1000)


async def approve_offer(offer_id: str, approved_by: str, workflow_depth: int = 0) -> dict:
    db = get_db()
    if db is None:
        raise RuntimeError("Database unavailable")
    offer = await db.offers.find_one({"offer_id": offer_id})
    if not offer:
        raise ValueError("Offer not found")
    if offer.get("status") not in ("draft", "pending_approval"):
        raise ValueError(f"Cannot approve an offer in status '{offer.get('status')}'")

    now = datetime.now(timezone.utc).isoformat()
    await db.offers.update_one(
        {"offer_id": offer_id},
        {"$set": {"status": "approved", "approved_by": approved_by, "updated_at": now}},
    )
    updated = await db.offers.find_one({"offer_id": offer_id}, {"_id": 0})
    _fire_offer_status_changed(updated, workflow_depth)
    return updated


async def send_offer(offer_id: str, workflow_depth: int = 0) -> dict:
    db = get_db()
    if db is None:
        raise RuntimeError("Database unavailable")
    offer = await db.offers.find_one({"offer_id": offer_id})
    if not offer:
        raise ValueError("Offer not found")
    if offer.get("status") != "approved":
        raise ValueError(f"Cannot send an offer in status '{offer.get('status')}'")
    if offer.get("ai_letter_body") and not offer.get("ai_letter_approved"):
        raise ValueError("AI-drafted letter content must be approved before sending")

    cand = await db.candidates.find_one({"candidate_id": offer.get("candidate_id")}) or {}
    job = await db.jobs.find_one({"job_id": offer.get("job_id")}) or {}

    from config.settings import settings
    from shared.links import base_url
    accept_url = f"{base_url()}/offer/{offer['secure_token']}"

    pdf_bytes = None
    try:
        from services.hr_module.branding_service import get_branding_settings
        branding = await get_branding_settings()
        signature_image = await resolve_signature_for_offer(db, offer)
        pdf_bytes = await render_offer_pdf(
            offer, job, cand, branding,
            ai_body=offer.get("ai_letter_body"), signature_image=signature_image,
        )
    except Exception as exc:
        logger.warning("send_offer: PDF render failed, email will be sent without attachment | offer_id=%s error=%s", offer_id, exc)
        pdf_bytes = None

    from services.hr_module.email_service import send_offer_letter_email
    import logging
    delivered = await send_offer_letter_email(
        to_email=cand.get("email", ""),
        candidate_name=cand.get("name", "Candidate"),
        job_title=job.get("title", ""),
        company_name=job.get("company_name"),
        salary=offer.get("salary"),
        joining_date=offer.get("joining_date"),
        benefits=offer.get("benefits"),
        accept_url=accept_url,
        db=db,
        candidate_id=offer.get("candidate_id"),
        job_id=offer.get("job_id"),
        pdf_bytes=pdf_bytes,
        pdf_filename=f"offer_{offer_id[:8]}.pdf",
    )
    if not delivered:
        logging.getLogger(__name__).warning("Offer letter email failed to send | offer_id=%s", offer_id)
        raise RuntimeError(
            "The offer email could not be sent. Check Email Delivery in Platform Settings, "
            "then send the offer again. It stays approved until it goes out."
        )

    now = datetime.now(timezone.utc).isoformat()
    await db.offers.update_one(
        {"offer_id": offer_id},
        {"$set": {"status": "sent", "sent_at": now, "updated_at": now}},
    )
    updated = await db.offers.find_one({"offer_id": offer_id}, {"_id": 0})
    _fire_offer_status_changed(updated, workflow_depth)
    await _announce_offer("offer.sent", updated, cand.get("name"))
    return updated


async def withdraw_offer(offer_id: str, workflow_depth: int = 0) -> dict:
    db = get_db()
    if db is None:
        raise RuntimeError("Database unavailable")
    offer = await db.offers.find_one({"offer_id": offer_id})
    if not offer:
        raise ValueError("Offer not found")
    if offer.get("status") not in _NON_TERMINAL_STATUSES:
        raise ValueError(f"Cannot withdraw an offer in status '{offer.get('status')}'")

    now = datetime.now(timezone.utc).isoformat()
    await db.offers.update_one(
        {"offer_id": offer_id},
        {"$set": {"status": "withdrawn", "updated_at": now}},
    )
    updated = await db.offers.find_one({"offer_id": offer_id}, {"_id": 0})
    _fire_offer_status_changed(updated, workflow_depth)
    return updated


async def respond_to_offer(
    secure_token: str,
    accept: bool,
    reason: str | None,
    *,
    typed_name: str | None = None,
    consent: bool = False,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> dict:
    db = get_db()
    if db is None:
        raise RuntimeError("Database unavailable")
    offer = await db.offers.find_one({"secure_token": secure_token})
    if not offer:
        raise ValueError("not_found")
    if offer.get("status") != "sent":
        raise ValueError("not_respondable")

    if accept:
        if not typed_name or not typed_name.strip():
            raise ValueError("typed_name_required")
        if not consent:
            raise ValueError("consent_required")

    now = datetime.now(timezone.utc).isoformat()
    new_status = "accepted" if accept else "declined"
    update: dict = {
        "status": new_status,
        "responded_at": now,
        "decline_reason": (reason if not accept else None),
        "updated_at": now,
    }
    if accept:
        update["signature"] = {
            "typed_name": typed_name.strip(),
            "consented": True,
            "ip_address": ip_address,
            "user_agent": user_agent,
            "signed_at": now,
            "document_hash": offer_terms_hash(offer),
        }
    await db.offers.update_one({"secure_token": secure_token}, {"$set": update})
    updated = await db.offers.find_one({"secure_token": secure_token}, {"_id": 0})

    if accept:
        from services.hr_module.employee_service import create_employee_from_offer
        employee = await create_employee_from_offer(db, updated)
        if employee is None:
            logger.warning(
                "Employee record was not created for accepted offer | offer_id=%s", offer.get("offer_id"),
            )

    _fire_offer_status_changed(updated, 0)
    await _announce_offer("offer.accepted" if accept else "offer.declined", updated)
    if not accept:
        from services.hr_module.notification_settings_service import notify
        await notify("offer_declined", {
            "offer_id": updated.get("offer_id"),
            "candidate_id": updated.get("candidate_id"),
            "job_id": updated.get("job_id"),
        })
    return updated


_EM_DASH_MARKERS = (chr(0x2014), "--")

_AI_TELL_PHRASES = (
    "moreover", "furthermore", "in conclusion", "it's important to note",
    "it is important to note", "needless to say", "in today's fast-paced",
    "in today's digital age", "delve into", "boasts a", "stands as a testament",
    "plays a vital role", "unwavering commitment", "game-changer", "game changer",
    "robust, scalable", "comprehensive, scalable", "comprehensive, scalable, and robust",
)

_LETTER_BODY_SYSTEM_PROMPT = (
    "You write a single short, warm, human-sounding paragraph for an offer "
    "letter on behalf of an HR team. Write 2 to 4 plain sentences welcoming "
    "the candidate and expressing genuine, specific enthusiasm about them "
    "joining. Do not restate or invent salary, benefits, or start-date "
    "figures: those are handled separately elsewhere in the letter.\n\n"
    "Avoid common signs of AI-generated writing:\n"
    "- Never use an em dash or a double hyphen (--); use a period or comma instead.\n"
    "- Never use stock transition words like 'Moreover', 'Furthermore', 'In conclusion', "
    "or hedges like 'It's important to note'.\n"
    "- Never use the 'not only X but also Y' construction.\n"
    "- Never stack three adjectives in a row (e.g. 'comprehensive, scalable, and robust').\n"
    "- Do not use a title-case heading or bullet points; this is one short paragraph of "
    "plain prose, not a list.\n"
    "- Write the way one person would write a short, sincere note to another, not like "
    "marketing or corporate copy."
)

_FALLBACK_LETTER_BODY = (
    "We are glad you are joining the team. We are looking forward to the energy "
    "and ideas you will bring to this role, and to supporting you as you get started."
)


def _contains_ai_writing_tell(text: str) -> bool:
    if not text or not text.strip():
        return True
    if any(marker in text for marker in _EM_DASH_MARKERS):
        return True
    lowered = text.lower()
    if any(phrase in lowered for phrase in _AI_TELL_PHRASES):
        return True
    if "not only" in lowered and "but also" in lowered:
        return True
    return False


async def generate_offer_letter_body(offer_id: str, model_override: str | None = None) -> dict:
    db = get_db()
    if db is None:
        raise RuntimeError("Database unavailable")
    offer = await db.offers.find_one({"offer_id": offer_id})
    if not offer:
        raise ValueError("not_found")
    if offer.get("status") not in _DRAFTABLE_STATUSES:
        raise ValueError(f"Cannot draft letter content for an offer in status '{offer.get('status')}'")

    cand = await db.candidates.find_one({"candidate_id": offer.get("candidate_id")}) or {}
    job = await db.jobs.find_one({"job_id": offer.get("job_id")}) or {}

    candidate_name = cand.get("name") or "the candidate"
    job_title = job.get("title") or "the role"
    company_name = job.get("company_name") or "our company"

    from config.llm import ask_llm, model_for, track_llm_cost
    from services.hr_module.prompt_guard import fence, with_guard
    prompt = (
        fence(
            "OFFER DETAILS",
            f"Candidate name: {candidate_name}\nRole: {job_title}\nCompany: {company_name}",
        )
        + "\n\nWrite the welcome paragraph now."
    )

    body: str | None = None
    source = "template_fallback"
    async with track_llm_cost("offer_letter_drafting", offer_id):
        for _attempt in range(2):
            raw = await ask_llm(
                prompt, system=with_guard(_LETTER_BODY_SYSTEM_PROMPT), model=model_for("offer_letter", model_override),
                max_tokens=300, temperature=0.6,
            )
            candidate_text = (raw or "").strip()
            if not _contains_ai_writing_tell(candidate_text):
                body = candidate_text
                source = "ai"
                break

    if body is None:
        logger.warning(
            "generate_offer_letter_body: LLM output failed the AI-tell filter twice, "
            "using the plain template fallback | offer_id=%s", offer_id,
        )
        body = _FALLBACK_LETTER_BODY

    now = datetime.now(timezone.utc).isoformat()
    update = {
        "ai_letter_body": body,
        "ai_letter_source": source,
        "ai_letter_approved": False,
        "ai_letter_approved_by": None,
        "ai_letter_approved_at": None,
        "ai_letter_generated_at": now,
        "updated_at": now,
    }
    await db.offers.update_one({"offer_id": offer_id}, {"$set": update})
    return await db.offers.find_one({"offer_id": offer_id}, {"_id": 0})


async def approve_offer_letter(offer_id: str, approved_by: str) -> dict:
    db = get_db()
    if db is None:
        raise RuntimeError("Database unavailable")
    offer = await db.offers.find_one({"offer_id": offer_id})
    if not offer:
        raise ValueError("Offer not found")
    if not offer.get("ai_letter_body"):
        raise ValueError("No AI-drafted letter content to approve")

    now = datetime.now(timezone.utc).isoformat()
    await db.offers.update_one(
        {"offer_id": offer_id},
        {"$set": {
            "ai_letter_approved": True, "ai_letter_approved_by": approved_by,
            "ai_letter_approved_at": now, "updated_at": now,
        }},
    )
    return await db.offers.find_one({"offer_id": offer_id}, {"_id": 0})


async def save_signature_image(*, email: str, raw_bytes: bytes, content_type: str, filename: str | None = None) -> dict:
    db = get_db()
    if db is None:
        raise RuntimeError("Database unavailable")
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "email": email,
        "image_base64": base64.b64encode(raw_bytes).decode("ascii"),
        "content_type": content_type,
        "filename": filename,
        "uploaded_at": now,
    }
    await db.offer_signatures.update_one({"email": email}, {"$set": doc}, upsert=True)
    return doc


async def get_signature_image(email: str) -> dict | None:
    db = get_db()
    if db is None:
        return None
    return await db.offer_signatures.find_one({"email": email}, {"_id": 0})


async def resolve_signature_for_offer(db, offer: dict) -> dict | None:
    signer_email = offer.get("approved_by") or offer.get("created_by")
    if not signer_email:
        return None
    sig = await get_signature_image(signer_email)
    if not sig:
        return None

    signer_name = signer_email
    try:
        user_doc = await db.users.find_one({"email": signer_email}, {"_id": 0, "name": 1})
        if user_doc and user_doc.get("name"):
            signer_name = user_doc["name"]
    except Exception as exc:
        logger.warning("resolve_signature_for_offer: signer name lookup failed, using email | error=%s", exc)

    return {
        "image_base64": sig.get("image_base64"),
        "content_type": sig.get("content_type"),
        "signer_name": signer_name,
        "signer_email": signer_email,
    }


def _pdf_inline(value) -> str:
    from xml.sax.saxutils import escape

    return escape(" ".join(str("" if value is None else value).split()))


def _pdf_text(value) -> str:
    from xml.sax.saxutils import escape

    text = escape("" if value is None else str(value))
    return text.replace("\r\n", "\n").replace("\r", "\n").replace("\n", "<br/>")


async def render_offer_pdf(
    offer: dict, job: dict, candidate: dict, branding: dict,
    ai_body: str | None = None, signature_image: dict | None = None,
) -> bytes:
    import io

    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib.units import inch
    from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer

    branding = branding or {}
    template = branding.get("letterhead_template") or {}

    styles = getSampleStyleSheet()
    company_name = (job or {}).get("company_name") or "Our Company"
    candidate_name = (candidate or {}).get("name") or "Candidate"
    job_title = (job or {}).get("title") or "the role"

    logo_flowable = None
    from services.hr_module.branding_service import resolve_logo_bytes

    logo_bytes = await resolve_logo_bytes(branding)
    if logo_bytes:
        try:
            logo_flowable = Image(io.BytesIO(logo_bytes), width=1.4 * inch, height=1.4 * inch, kind="proportional")
        except Exception as exc:
            logger.warning("render_offer_pdf: logo could not be placed, rendering without it | error=%s", exc)
            logo_flowable = None

    story: list = []
    if logo_flowable is not None:
        story += [logo_flowable, Spacer(1, 8)]

    header_text = template.get("header_text") or branding.get("letterhead_header_text")
    if header_text:
        story += [Paragraph(_pdf_text(header_text), styles["Normal"]), Spacer(1, 12)]

    story += [
        Paragraph(f"Offer of Employment: {_pdf_inline(company_name)}", styles["Title"]),
        Spacer(1, 16),
        Paragraph(f"Dear {_pdf_inline(candidate_name)},", styles["Normal"]),
        Spacer(1, 10),
    ]

    body_paragraphs = template.get("body_paragraphs") or []
    if body_paragraphs:
        placeholder_context = {
            "candidate_name": candidate_name, "job_title": job_title, "company_name": company_name,
            "salary": offer.get("salary") or "N/A", "benefits": offer.get("benefits") or "",
            "joining_date": offer.get("joining_date") or "",
        }
        for raw_paragraph in body_paragraphs:
            rendered = _pdf_text(raw_paragraph)
            for key, value in placeholder_context.items():
                rendered = rendered.replace("{{" + key + "}}", _pdf_text(value))
            if rendered.strip():
                story.append(Paragraph(rendered, styles["Normal"]))
                story.append(Spacer(1, 8))
    else:
        story += [
            Paragraph(
                f"We are pleased to offer you the position of <b>{_pdf_inline(job_title)}</b> at "
                f"{_pdf_inline(company_name)}, on the following terms:",
                styles["Normal"],
            ),
            Spacer(1, 12),
        ]

    story.append(Paragraph(f"<b>Salary:</b> {_pdf_inline(offer.get('salary') or 'N/A')}", styles["Normal"]))
    if offer.get("benefits"):
        story.append(Spacer(1, 4))
        story.append(Paragraph(f"<b>Benefits:</b> {_pdf_text(offer['benefits'])}", styles["Normal"]))
    if offer.get("joining_date"):
        story.append(Spacer(1, 4))
        story.append(Paragraph(f"<b>Joining Date:</b> {_pdf_inline(offer['joining_date'])}", styles["Normal"]))

    if ai_body:
        story.append(Spacer(1, 14))
        story.append(Paragraph(_pdf_text(ai_body), styles["Normal"]))

    story += [
        Spacer(1, 20),
        Paragraph(
            "Please review the details above. To accept or decline, use the secure link sent to "
            "your email.",
            styles["Normal"],
        ),
    ]

    if signature_image and signature_image.get("image_base64"):
        story.append(Spacer(1, 24))
        story.append(Paragraph("Sincerely,", styles["Normal"]))
        story.append(Spacer(1, 6))
        try:
            sig_bytes = base64.b64decode(signature_image["image_base64"])
            story.append(Image(io.BytesIO(sig_bytes), width=1.6 * inch, height=0.6 * inch, kind="proportional"))
        except Exception as exc:
            logger.warning("render_offer_pdf: signature image decode failed, rendering without it | error=%s", exc)
        signer_name = signature_image.get("signer_name") or signature_image.get("signer_email")
        if signer_name:
            story.append(Paragraph(_pdf_inline(signer_name), styles["Normal"]))

    footer_text = template.get("footer_text") or branding.get("letterhead_footer_text")
    if footer_text:
        story += [Spacer(1, 28), Paragraph(_pdf_text(footer_text), styles["Normal"])]

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter, topMargin=40, bottomMargin=50)
    doc.build(story)
    return buf.getvalue()
