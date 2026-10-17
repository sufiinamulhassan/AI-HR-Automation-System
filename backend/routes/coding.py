import html as _html
import asyncio
import logging
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from pymongo.errors import DuplicateKeyError

from shared.auth import require_admin, require_permission
from shared.quotas import ai_action
from shared.rate_limit import public_token_throttle
from shared.links import base_url
from shared.utils import require_selectable_model
from config.database import get_db
from config.settings import settings
from services.hr_module import department_access
from services.hr_module.audit_service import log_audit_event
from services.hr_module.coding_link_service import (
    EXPIRY_PROJECTION,
    coding_expiry_stamp,
    coding_link_expired,
    require_live_coding_link,
)
from services.hr_module import email_layout, email_service, mail_brand
from services.hr_module.email_service import sender_name
from services.hr_module.erasure_service import ensure_not_erased
from services.hr_module.plan_service import require_feature
from services.hr_module.assessment_view import (
    project_submission_for_candidate,
    redact_hidden_results,
)

logger = logging.getLogger(__name__)

router = APIRouter()

_session_throttle = public_token_throttle("coding", ip_limit=1500, token_limit=60, tenant="candidate")
_sandbox_throttle = public_token_throttle("coding-run", ip_limit=1500, token_limit=30, tenant="candidate")
_editor_throttle = public_token_throttle("coding-editor", ip_limit=1500, token_limit=240, tenant="candidate")


class TestCasePayload(BaseModel):
    input: str = ""
    expected_output: str = ""
    is_hidden: bool = False
    is_edge_case: bool = False


class CodingQuestionCreate(BaseModel):
    title: str
    description: str
    language_templates: dict[str, str] = Field(default_factory=dict)
    test_cases: list[TestCasePayload] = Field(default_factory=list)
    job_domain: str | None = None
    difficulty: str = "medium"


class CodingQuestionUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    language_templates: dict[str, str] | None = None
    test_cases: list[TestCasePayload] | None = None
    job_domain: str | None = None
    difficulty: str | None = None


class GenerateQuestionRequest(BaseModel):
    job_domain: str
    difficulty: str = "medium"
    topic_hint: str | None = None
    model_override: str | None = None


class AssignQuestionRequest(BaseModel):
    question_id: str


class SubmitPayload(BaseModel):
    language: str
    code: str
    keystrokes: int | None = None


class RunPayload(BaseModel):
    language: str
    code: str
    stdin: str | None = None


class CodingFlagPayload(BaseModel):
    event: str


class AutosavePayload(BaseModel):
    language: str
    code: str


def _visible_test_cases(test_cases: list[dict]) -> list[dict]:
    return [tc for tc in test_cases if not tc.get("is_hidden", False)]


_redact_hidden_results = redact_hidden_results
_sanitize_submission_for_candidate = project_submission_for_candidate


async def _insert_question(
    db,
    *,
    title: str,
    description: str,
    language_templates: dict[str, str],
    test_cases: list[dict],
    job_domain: str | None,
    difficulty: str,
    created_by: str,
) -> dict:
    doc = {
        "question_id": str(uuid.uuid4()),
        "title": title,
        "description": description,
        "language_templates": language_templates,
        "test_cases": test_cases,
        "job_domain": job_domain,
        "difficulty": difficulty,
        "created_by": created_by,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        await db.coding_questions.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(409, "A coding question with this id already exists")
    doc.pop("_id", None)
    return doc


@router.post("/questions")
async def create_question(
    body: CodingQuestionCreate,
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("coding:manage")),
    _plan: None = Depends(require_feature("coding")),
):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")

    doc = await _insert_question(
        db,
        title=body.title,
        description=body.description,
        language_templates=body.language_templates,
        test_cases=[tc.model_dump() for tc in body.test_cases],
        job_domain=body.job_domain,
        difficulty=body.difficulty,
        created_by=user["email"],
    )
    asyncio.create_task(log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="coding_question_create", resource_type="coding_question", resource_id=doc["question_id"],
        details={"title": body.title, "job_domain": body.job_domain},
    ))
    return doc


@router.post("/questions/generate")
async def generate_question(
    body: GenerateQuestionRequest,
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("coding:manage")),
    _plan: None = Depends(require_feature("coding")),
    _quota: None = Depends(ai_action("coding_generate", per_hour=120)),
):
    model_override = require_selectable_model(body.model_override)
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")

    from config.llm import track_llm_cost
    from services.hr_module.coding_service import generate_question_with_ai

    try:
        async with track_llm_cost("coding_question_generation"):
            generated = await generate_question_with_ai(
                job_domain=body.job_domain,
                difficulty=body.difficulty,
                topic_hint=body.topic_hint,
                model=model_override,
            )
    except RuntimeError as e:
        raise HTTPException(502, str(e))

    validated_cases = [TestCasePayload(**tc).model_dump() for tc in generated["test_cases"]]

    return await _insert_question(
        db,
        title=generated["title"],
        description=generated["description"],
        language_templates=generated["language_templates"],
        test_cases=validated_cases,
        job_domain=generated.get("job_domain") or body.job_domain,
        difficulty=generated.get("difficulty") or body.difficulty,
        created_by=user["email"],
    )


@router.get("/questions")
async def list_questions(
    job_domain: str | None = None,
    difficulty: str | None = None,
    page: int = 1,
    limit: int = 20,
    _: dict = Depends(require_admin),
    __: dict = Depends(require_permission("coding:read")),
    _plan: None = Depends(require_feature("coding")),
):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    limit = max(1, min(limit, 100))
    page = max(1, page)
    query: dict = {}
    if job_domain:
        query["job_domain"] = job_domain
    if difficulty:
        query["difficulty"] = difficulty
    total = await db.coding_questions.count_documents(query)
    cursor = (
        db.coding_questions.find(query, {"_id": 0})
        .sort("created_at", -1)
        .skip((page - 1) * limit)
        .limit(limit)
    )
    return {"questions": await cursor.to_list(length=limit), "total": total}


@router.get("/questions/{question_id}")
async def get_question(
    question_id: str,
    _: dict = Depends(require_admin),
    __: dict = Depends(require_permission("coding:read")),
    _plan: None = Depends(require_feature("coding")),
):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    doc = await db.coding_questions.find_one({"question_id": question_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Coding question not found")
    return doc


@router.patch("/questions/{question_id}")
async def update_question(
    question_id: str,
    body: CodingQuestionUpdate,
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("coding:manage")),
    _plan: None = Depends(require_feature("coding")),
):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    provided = body.model_dump(exclude_unset=True)
    update = {k: v for k, v in provided.items() if v is not None}
    if "job_domain" in provided:
        update["job_domain"] = (provided["job_domain"] or "").strip() or None
    if "test_cases" in update:
        update["test_cases"] = [
            tc if isinstance(tc, dict) else tc.model_dump() for tc in update["test_cases"]
        ]
    if not update:
        raise HTTPException(400, "No fields to update")
    result = await db.coding_questions.update_one({"question_id": question_id}, {"$set": update})
    if result.matched_count == 0:
        raise HTTPException(404, "Coding question not found")

    asyncio.create_task(log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="coding_question_update", resource_type="coding_question", resource_id=question_id,
        details=update,
    ))
    return {"message": "Updated"}


@router.delete("/questions/{question_id}")
async def delete_question(
    question_id: str,
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("coding:manage")),
    _plan: None = Depends(require_feature("coding")),
):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    await db.coding_questions.delete_one({"question_id": question_id})

    asyncio.create_task(log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="coding_question_delete", resource_type="coding_question", resource_id=question_id,
        details={},
    ))
    return {"message": "Deleted"}


async def _send_coding_assessment_invite(db, candidate_id: str) -> bool:
    cand = await db.candidates.find_one({"candidate_id": candidate_id})
    if not cand or not cand.get("secure_token") or not cand.get("email"):
        logger.warning(
            "Coding assessment invite skipped: candidate/email/token missing | candidate_id=%s",
            candidate_id,
        )
        return False

    job = await db.jobs.find_one({"job_id": cand.get("job_id")}) or {}
    job_title = job.get("title") or "the role"
    candidate_name = cand.get("name") or "Candidate"
    coding_url = f"{base_url()}/coding/{cand['secure_token']}"
    await mail_brand.load()

    subject = f"Coding Assessment: {job_title}"
    text_body = f"""Dear {candidate_name},

As the next step for the {job_title} position, please complete your coding assessment using the link below.

  Assessment Link: {coding_url}

Please complete it at your earliest convenience using a stable internet connection.
If you run into any issues, contact your recruiter.

Best regards,
{sender_name()}"""
    body_html = (
        email_layout.greeting(_html.escape(str(candidate_name)))
        + email_layout.paragraph(
            f"As the next step for the <strong>{_html.escape(str(job_title))}</strong> position, "
            "please complete your coding assessment using the link below."
        )
        + email_service.cta(coding_url, "Start Coding Assessment")
        + email_layout.small("This link is unique to you. If you run into any issues, please contact your recruiter.")
        + email_layout.signoff(_html.escape(sender_name()))
    )
    html_body = email_service.wrap_html(heading="Coding Assessment", body_html=body_html)

    await db.candidates.update_one(
        {"candidate_id": candidate_id}, {"$set": {"coding_invite_expires_at": coding_expiry_stamp()}},
    )

    from services.hr_module.email_service import send_email
    return await send_email(
        to=cand["email"],
        subject=subject,
        html_body=html_body,
        text_body=text_body,
        db=db,
        template="coding_assessment_invite",
        candidate_id=candidate_id,
        job_id=cand.get("job_id"),
    )


@router.patch("/assign/{candidate_id}")
async def assign_question(
    candidate_id: str,
    body: AssignQuestionRequest,
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("coding:manage")),
    _plan: None = Depends(require_feature("coding")),
):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    await department_access.ensure_candidate_in_scope(db, user, candidate_id)
    await ensure_not_erased(db, candidate_id)
    if not await db.coding_questions.find_one({"question_id": body.question_id}):
        raise HTTPException(404, "Coding question not found")

    result = await db.candidates.update_one(
        {"candidate_id": candidate_id},
        {"$set": {"coding_question_id": body.question_id}},
    )
    if result.matched_count == 0:
        raise HTTPException(404, "Candidate not found")

    email_sent = await _send_coding_assessment_invite(db, candidate_id)
    if not email_sent:
        logger.warning("Coding assessment invite email not delivered | candidate_id=%s", candidate_id)

    asyncio.create_task(log_audit_event(
        db, actor_email=user["email"], actor_role=user.get("role"),
        action="coding_question_assign", resource_type="candidate", resource_id=candidate_id,
        details={"question_id": body.question_id, "email_sent": email_sent},
    ))
    return {
        "candidate_id": candidate_id,
        "coding_question_id": body.question_id,
        "email_sent": email_sent,
    }


@router.get("/session/{secure_token}", dependencies=[Depends(_session_throttle)])
async def get_session(secure_token: str):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")

    cand = await db.candidates.find_one({"secure_token": secure_token})
    if not cand:
        raise HTTPException(404, "Invalid link")
    require_live_coding_link(cand)

    question_id = cand.get("coding_question_id")
    if not question_id:
        raise HTTPException(400, "No coding assessment has been assigned yet")

    question = await db.coding_questions.find_one({"question_id": question_id}, {"_id": 0})
    if not question:
        raise HTTPException(404, "Assigned coding question not found")

    from services.hr_module.coding_service import supported_languages

    return {
        "question_id": question["question_id"],
        "title": question.get("title"),
        "description": question.get("description"),
        "difficulty": question.get("difficulty"),
        "job_domain": question.get("job_domain"),
        "language_templates": question.get("language_templates", {}),
        "supported_languages": supported_languages(),
        "test_cases": _visible_test_cases(question.get("test_cases", [])),
    }


@router.post("/session/{secure_token}/submit", dependencies=[Depends(_sandbox_throttle)])
async def submit_session(secure_token: str, payload: SubmitPayload):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")

    cand = await db.candidates.find_one({"secure_token": secure_token})
    if not cand:
        raise HTTPException(404, "Invalid link")
    require_live_coding_link(cand)

    question_id = cand.get("coding_question_id")
    if not question_id:
        raise HTTPException(400, "No coding assessment has been assigned yet")

    from services.hr_module.coding_service import evaluate_submission

    try:
        submission = await evaluate_submission(
            question_id=question_id,
            candidate_id=cand["candidate_id"],
            language=payload.language,
            code=payload.code,
            keystrokes=payload.keystrokes,
        )
    except RuntimeError as e:
        raise HTTPException(503, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))

    return _sanitize_submission_for_candidate(submission)


@router.post("/session/{secure_token}/run", dependencies=[Depends(_sandbox_throttle)])
async def run_session(secure_token: str, payload: RunPayload):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")

    cand = await db.candidates.find_one({"secure_token": secure_token})
    if not cand:
        raise HTTPException(404, "Invalid link")
    require_live_coding_link(cand)

    question_id = cand.get("coding_question_id")
    if not question_id:
        raise HTTPException(400, "No coding assessment has been assigned yet")

    question = await db.coding_questions.find_one({"question_id": question_id})
    if not question:
        raise HTTPException(404, "Assigned coding question not found")

    from services.hr_module.coding_service import run_in_sandbox, supported_language

    if not supported_language(payload.language):
        raise HTTPException(400, f"Unsupported language: {payload.language}")

    if payload.stdin is not None:
        stdin = payload.stdin
    else:
        visible = _visible_test_cases(question.get("test_cases", []))
        stdin = visible[0]["input"] if visible else ""

    try:
        result = await run_in_sandbox(payload.code, payload.language, stdin)
    except RuntimeError as e:
        raise HTTPException(503, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.warning("Sandbox run failed for question=%s: %s", question_id, e)
        raise HTTPException(502, "Code execution failed: please try again")

    return {
        "stdin": stdin,
        "stdout": result.get("stdout") or "",
        "stderr": result.get("stderr") or "",
        "compile_output": result.get("compile_output") or "",
        "status": (result.get("status") or {}).get("description"),
        "time": result.get("time"),
        "memory": result.get("memory"),
    }


@router.post("/session/{secure_token}/modify-probe", dependencies=[Depends(_sandbox_throttle)])
async def get_modify_probe(secure_token: str):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")

    cand = await db.candidates.find_one({"secure_token": secure_token})
    if not cand:
        raise HTTPException(404, "Invalid link")
    require_live_coding_link(cand)

    question_id = cand.get("coding_question_id")
    if not question_id:
        raise HTTPException(400, "No coding assessment has been assigned yet")

    submission = await db.coding_submissions.find_one(
        {"candidate_id": cand["candidate_id"], "question_id": question_id, "status": "completed"},
        sort=[("submitted_at", -1)],
    )
    if not submission:
        raise HTTPException(400, "Submit a solution before requesting a modification probe")

    question = await db.coding_questions.find_one({"question_id": question_id}, {"_id": 0})
    if not question:
        raise HTTPException(404, "Assigned coding question not found")

    from config.llm import track_llm_cost
    from services.hr_module.coding_service import generate_live_modification_probe

    async with track_llm_cost("coding_quality_review"):
        probe = await generate_live_modification_probe(
            question=question,
            language=submission.get("language", ""),
            code=submission.get("code", ""),
        )

    return {"probe": probe}


@router.post("/session/{secure_token}/flag", dependencies=[Depends(_editor_throttle)])
async def record_coding_flag(secure_token: str, payload: CodingFlagPayload):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")

    cand = await db.candidates.find_one(
        {"secure_token": secure_token}, {"_id": 0, "candidate_id": 1, **EXPIRY_PROJECTION},
    )
    if not cand:
        raise HTTPException(404, "Invalid link")
    require_live_coding_link(cand)

    flag = f"{payload.event}@{datetime.now(timezone.utc).isoformat()}"
    await db.candidates.update_one(
        {"secure_token": secure_token},
        {"$push": {"coding_integrity_flags": flag}},
    )
    return {"recorded": True}


@router.post("/session/{secure_token}/autosave", dependencies=[Depends(_editor_throttle)])
async def autosave_session(secure_token: str, payload: AutosavePayload):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")

    cand = await db.candidates.find_one(
        {"secure_token": secure_token},
        {"_id": 0, "candidate_id": 1, "coding_question_id": 1, **EXPIRY_PROJECTION},
    )
    if not cand:
        raise HTTPException(404, "Invalid link")
    require_live_coding_link(cand)

    question_id = cand.get("coding_question_id")
    if not question_id:
        raise HTTPException(400, "No coding assessment has been assigned yet")

    now = datetime.now(timezone.utc).isoformat()
    await db.coding_session_state.update_one(
        {"candidate_id": cand["candidate_id"], "question_id": question_id},
        {"$set": {
            "candidate_id": cand["candidate_id"],
            "question_id": question_id,
            "language": payload.language,
            "code": payload.code,
            "updated_at": now,
        }},
        upsert=True,
    )
    return {"saved": True, "updated_at": now}


ACTIVE_SESSION_WINDOW_MINUTES = 30
_MAX_LIVE_SESSIONS = 200


@router.get("/live/sessions")
async def list_live_sessions(
    _admin: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("coding:read_submissions")),
    _plan: None = Depends(require_feature("coding")),
):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")

    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=ACTIVE_SESSION_WINDOW_MINUTES)).isoformat()
    cursor = (
        db.coding_session_state.find(
            {"updated_at": {"$gte": cutoff}},
            {"_id": 0, "candidate_id": 1, "question_id": 1, "language": 1, "updated_at": 1},
        )
        .sort("updated_at", -1)
        .limit(_MAX_LIVE_SESSIONS)
    )
    states = await cursor.to_list(length=_MAX_LIVE_SESSIONS)
    visible = await department_access.candidate_ids_in_scope(
        db, _admin, list({s["candidate_id"] for s in states if s.get("candidate_id")}),
    )
    if visible is not None:
        states = [s for s in states if s.get("candidate_id") in visible]
    if not states:
        return {"sessions": []}

    candidate_ids = list({s["candidate_id"] for s in states if s.get("candidate_id")})
    question_ids = list({s["question_id"] for s in states if s.get("question_id")})

    submitted = {
        (s["candidate_id"], s["question_id"])
        async for s in db.coding_submissions.find(
            {"candidate_id": {"$in": candidate_ids}, "question_id": {"$in": question_ids}},
            {"_id": 0, "candidate_id": 1, "question_id": 1},
        )
    }
    names = {
        c["candidate_id"]: c.get("name")
        async for c in db.candidates.find({"candidate_id": {"$in": candidate_ids}}, {"_id": 0, "candidate_id": 1, "name": 1})
    }
    titles = {
        q["question_id"]: q.get("title")
        async for q in db.coding_questions.find({"question_id": {"$in": question_ids}}, {"_id": 0, "question_id": 1, "title": 1})
    }

    return {"sessions": [
        {
            "candidate_id": s["candidate_id"],
            "candidate_name": names.get(s["candidate_id"]),
            "question_title": titles.get(s.get("question_id")),
            "language": s.get("language"),
            "last_saved_at": s.get("updated_at"),
        }
        for s in states
        if (s.get("candidate_id"), s.get("question_id")) not in submitted
    ]}


@router.get("/live/{candidate_id}")
async def get_live_session(
    candidate_id: str,
    _admin: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("coding:read_submissions")),
    _plan: None = Depends(require_feature("coding")),
):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")

    cand = await department_access.require_candidate(
        db, _admin, candidate_id, projection={"_id": 0, "candidate_id": 1, "coding_question_id": 1},
    )

    question_id = cand.get("coding_question_id")
    if not question_id:
        return {
            "candidate_id": candidate_id,
            "question_id": None,
            "question_title": None,
            "language": None,
            "code": None,
            "last_saved_at": None,
            "status": "not_assigned",
        }

    submitted = await db.coding_submissions.find_one(
        {"candidate_id": candidate_id, "question_id": question_id}, {"_id": 0, "submission_id": 1},
    )
    draft = await db.coding_session_state.find_one(
        {"candidate_id": candidate_id, "question_id": question_id}, {"_id": 0},
    )
    question = await db.coding_questions.find_one({"question_id": question_id}, {"_id": 0, "title": 1})

    if submitted:
        status_value = "submitted"
    elif draft:
        status_value = "in_progress"
    else:
        status_value = "not_started"

    return {
        "candidate_id": candidate_id,
        "question_id": question_id,
        "question_title": (question or {}).get("title"),
        "language": (draft or {}).get("language"),
        "code": (draft or {}).get("code"),
        "last_saved_at": (draft or {}).get("updated_at"),
        "status": status_value,
    }


async def _enrich_submissions(db, submissions: list[dict]) -> list[dict]:
    if not submissions:
        return submissions

    candidate_ids = {s["candidate_id"] for s in submissions if s.get("candidate_id")}
    question_ids = {s["question_id"] for s in submissions if s.get("question_id")}

    candidates: dict[str, dict] = {}
    if candidate_ids:
        cursor = db.candidates.find(
            {"candidate_id": {"$in": list(candidate_ids)}},
            {"_id": 0, "candidate_id": 1, "name": 1, "email": 1},
        )
        candidates = {c["candidate_id"]: c for c in await cursor.to_list(length=len(candidate_ids))}

    questions: dict[str, dict] = {}
    if question_ids:
        cursor = db.coding_questions.find(
            {"question_id": {"$in": list(question_ids)}},
            {"_id": 0, "question_id": 1, "title": 1, "difficulty": 1},
        )
        questions = {q["question_id"]: q for q in await cursor.to_list(length=len(question_ids))}

    for s in submissions:
        cand = candidates.get(s.get("candidate_id"), {})
        ques = questions.get(s.get("question_id"), {})
        s["candidate_name"] = cand.get("name")
        s["candidate_email"] = cand.get("email")
        s["question_title"] = ques.get("title")
        s["question_difficulty"] = ques.get("difficulty")
    return submissions


@router.get("/submissions")
async def list_all_submissions(
    candidate_id: str | None = None,
    question_id: str | None = None,
    status: str | None = None,
    flagged: bool | None = None,
    page: int = 1,
    limit: int = 25,
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("coding:read_submissions")),
    _plan: None = Depends(require_feature("coding")),
):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")

    limit = max(1, min(limit, 100))
    page = max(1, page)

    query: dict = {}
    if candidate_id:
        query["candidate_id"] = candidate_id
    visible = await department_access.candidate_ids_in_scope(db, user)
    if visible is not None:
        if candidate_id and candidate_id not in visible:
            return {"submissions": [], "total": 0}
        query.setdefault("candidate_id", {"$in": list(visible)})
    if question_id:
        query["question_id"] = question_id
    if status:
        query["status"] = status
    if flagged is not None:
        query["plagiarism_flagged"] = True if flagged else {"$ne": True}

    total = await db.coding_submissions.count_documents(query)
    cursor = (
        db.coding_submissions.find(query, {"_id": 0})
        .sort("submitted_at", -1)
        .skip((page - 1) * limit)
        .limit(limit)
    )
    submissions = await cursor.to_list(length=limit)
    return {"submissions": await _enrich_submissions(db, submissions), "total": total}


@router.get("/submissions/{candidate_id}")
async def list_submissions(
    candidate_id: str,
    user: dict = Depends(require_admin),
    _perm: dict = Depends(require_permission("coding:read_submissions")),
    _plan: None = Depends(require_feature("coding")),
):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    await department_access.ensure_candidate_in_scope(db, user, candidate_id)
    cursor = db.coding_submissions.find({"candidate_id": candidate_id}, {"_id": 0}).sort("submitted_at", -1)
    submissions = await cursor.to_list(length=200)
    return {"submissions": await _enrich_submissions(db, submissions)}
