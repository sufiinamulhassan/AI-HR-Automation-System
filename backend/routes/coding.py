"""AI Coding Assessment route — hr_module (MVP2 §2.10).

Admin CRUD:
  POST/GET/PATCH/DELETE /coding/questions        → require_admin throughout (GET includes
                                                     hidden test cases/expected output, so
                                                     reads are admin-gated too, not just writes)
  POST   /coding/questions/generate               → require_admin — AI-drafts a question via
                                                     services.hr_module.coding_service.generate_question_with_ai,
                                                     then inserts it through the SAME insert helper
                                                     create_question uses (no separate insert path)
  PATCH  /coding/assign/{candidate_id}            → require_admin — also sends the candidate a
                                                     coding-assessment invite email (link + instructions
                                                     only, no scores) to their existing secure_token URL
  GET    /coding/submissions                      → require_admin — submissions across ALL
                                                     candidates, newest first, with optional
                                                     candidate_id/question_id/status/flagged
                                                     filters and pagination
  GET    /coding/submissions/{candidate_id}       → require_admin (full detail, incl. hidden tests
                                                     and submitted source code)

Both submission reads return candidate name/email and question title alongside
the stored ids (see _enrich_submissions) — additive fields only.

Candidate-facing (token-based, same trust model as interview session endpoints —
reuses the existing candidates.secure_token, no separate invite system):
  GET  /coding/session/{secure_token}             → assigned question, hidden test
                                                       cases filtered out entirely
  POST /coding/session/{secure_token}/run         → scratch execution via Judge0 (raw
                                                       stdout/stderr, one sample case or
                                                       custom stdin) — not graded, not
                                                       persisted, "try it before you submit"
  POST /coding/session/{secure_token}/submit      → runs code via Judge0, hidden
                                                       test detail stripped from response.
                                                       Optional `keystrokes` drives the
                                                       typing-ratio integrity check.
  POST /coding/session/{secure_token}/flag        → live integrity events from the editor
                                                       (paste_blocked, paste_burst,
                                                       drop_blocked, ...), appended to
                                                       candidates.coding_integrity_flags —
                                                       a SEPARATE array from the interview's
                                                       integrity_flags (see
                                                       services.hr_module.integrity)

SECURITY: this route never executes candidate code itself — all execution is
delegated to the configured sandbox (Judge0 or Piston, see CODE_SANDBOX_PROVIDER)
via services.hr_module.coding_service. If that sandbox is not configured (blank
JUDGE0_API_URL / PISTON_API_URL), submit/run fail with 503, never a local run.
The AI question-generation endpoint never executes anything either — it only
asks the LLM (via config.llm.ask_llm) for text and validates its JSON shape.
"""
import asyncio
import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from pymongo.errors import DuplicateKeyError

from shared.auth import require_admin
from config.database import get_db
from config.settings import settings
from services.hr_module.audit_service import log_audit_event
from services.hr_module.assessment_view import (
    project_submission_for_candidate,
    redact_hidden_results,
)

logger = logging.getLogger(__name__)

router = APIRouter()


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


def _visible_test_cases(test_cases: list[dict]) -> list[dict]:
    """Non-hidden test cases only — never leak hidden inputs/outputs to a candidate."""
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
    """Single insert path for coding_questions — used by both the manual
    create_question endpoint and the AI-generate endpoint below, so a
    generated question is persisted identically to a hand-authored one."""
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
async def create_question(body: CodingQuestionCreate, user: dict = Depends(require_admin)):
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
async def generate_question(body: GenerateQuestionRequest, user: dict = Depends(require_admin)):
    """AI-draft a coding question from a job domain (+ optional topic hint),
    then persist it through the exact same insert path as create_question.

    The question is inserted into the bank immediately so an admin can inspect
    it via the normal question-detail view — it is NOT auto-assigned to any
    candidate. Assignment is a separate, explicit admin action via
    PATCH /coding/assign/{candidate_id}, same as for a hand-authored question.
    """
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")

    from services.hr_module.coding_service import generate_question_with_ai

    try:
        generated = await generate_question_with_ai(
            job_domain=body.job_domain,
            difficulty=body.difficulty,
            topic_hint=body.topic_hint,
            model=body.model_override,
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
):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
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
async def get_question(question_id: str, _: dict = Depends(require_admin)):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    doc = await db.coding_questions.find_one({"question_id": question_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Coding question not found")
    return doc


@router.patch("/questions/{question_id}")
async def update_question(question_id: str, body: CodingQuestionUpdate, user: dict = Depends(require_admin)):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    update = {k: v for k, v in body.model_dump().items() if v is not None}
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
async def delete_question(question_id: str, user: dict = Depends(require_admin)):
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
    """Best-effort candidate-facing coding-assessment invite email.

    Built INLINE here with the existing low-level
    services.hr_module.email_service.send_email (never a new named template
    function in email_service.py — a different task owns that file this
    round). Link + short instructions only — NO scores, NO recommendation,
    matching this codebase's hard candidate-email content rule. Points at
    FRONTEND_URL/coding/{secure_token}, reusing the candidate's EXISTING
    token (the /coding/session/{secure_token} route already trusts this same
    token — see this route's module docstring — so no new token is minted).

    Returns False (never raises) on any missing data or send failure — the
    assignment itself has already succeeded by the time this is called, so a
    delivery problem must not fail the whole request; it's independently
    visible via email_log / GET /candidates/{id}/emails for follow-up.
    """
    cand = await db.candidates.find_one({"candidate_id": candidate_id})
    if not cand or not cand.get("secure_token") or not cand.get("email"):
        logger.warning(
            "Coding assessment invite skipped — candidate/email/token missing | candidate_id=%s",
            candidate_id,
        )
        return False

    job = await db.jobs.find_one({"job_id": cand.get("job_id")}) or {}
    job_title = job.get("title") or "the role"
    candidate_name = cand.get("name") or "Candidate"
    coding_url = f"{settings.FRONTEND_URL}/coding/{cand['secure_token']}"

    subject = f"Coding Assessment — {job_title}"
    text_body = f"""Dear {candidate_name},

As the next step for the {job_title} position, please complete your coding assessment using the link below.

  Assessment Link: {coding_url}

Please complete it at your earliest convenience using a stable internet connection.
If you run into any issues, contact your recruiter.

Best regards,
{settings.EMAIL_FROM_NAME}"""
    html_body = f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <tr><td style="background:#0e7490;padding:28px 40px;">
          <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:600;">Coding Assessment</h1>
        </td></tr>
        <tr><td style="padding:36px 40px;">
          <p style="color:#374151;font-size:16px;">Dear <strong>{candidate_name}</strong>,</p>
          <p style="color:#374151;font-size:15px;line-height:1.6;">
            As the next step for the <strong>{job_title}</strong> position, please complete your coding assessment using the link below.
          </p>
          <div style="text-align:center;margin:32px 0;">
            <a href="{coding_url}"
               style="background:#0e7490;color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:6px;font-size:16px;font-weight:600;display:inline-block;">
              Start Coding Assessment &rarr;
            </a>
          </div>
          <p style="color:#6b7280;font-size:13px;">
            This link is unique to you. If you run into any issues, please contact your recruiter.
          </p>
        </td></tr>
        <tr><td style="background:#f9fafb;padding:16px 40px;border-top:1px solid #e5e7eb;">
          <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">
            This is an automated message. If you have questions, please contact your recruiter directly.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""

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
async def assign_question(candidate_id: str, body: AssignQuestionRequest, user: dict = Depends(require_admin)):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
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


@router.get("/session/{secure_token}")
async def get_session(secure_token: str):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")

    cand = await db.candidates.find_one({"secure_token": secure_token})
    if not cand:
        raise HTTPException(404, "Invalid link")

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


@router.post("/session/{secure_token}/submit")
async def submit_session(secure_token: str, payload: SubmitPayload):
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")

    cand = await db.candidates.find_one({"secure_token": secure_token})
    if not cand:
        raise HTTPException(404, "Invalid link")

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


@router.post("/session/{secure_token}/run")
async def run_session(secure_token: str, payload: RunPayload):
    """Execute the candidate's current draft in the configured sandbox and hand
    back raw stdout/stderr — a "try it before you submit" console, distinct from
    /submit which grades against every test case and persists a record.

    Nothing is persisted here and no grading happens: this is scratch
    execution only, so a candidate can iterate freely without burning
    submission attempts or polluting the plagiarism/quality pipeline.
    """
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")

    cand = await db.candidates.find_one({"secure_token": secure_token})
    if not cand:
        raise HTTPException(404, "Invalid link")

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
        raise HTTPException(502, "Code execution failed — please try again")

    return {
        "stdin": stdin,
        "stdout": result.get("stdout") or "",
        "stderr": result.get("stderr") or "",
        "compile_output": result.get("compile_output") or "",
        "status": (result.get("status") or {}).get("description"),
        "time": result.get("time"),
        "memory": result.get("memory"),
    }


@router.post("/session/{secure_token}/modify-probe")
async def get_modify_probe(secure_token: str):
    """
    AI-assistance mitigation: ask the candidate to make a small live modification
    to their own already-submitted solution, to check genuine understanding
    independent of whether the original submission passed. Additive, sibling to
    /run and /submit — requires a completed submission to already exist; does not
    re-score or persist anything itself.
    """
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")

    cand = await db.candidates.find_one({"secure_token": secure_token})
    if not cand:
        raise HTTPException(404, "Invalid link")

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

    from services.hr_module.coding_service import generate_live_modification_probe

    probe = await generate_live_modification_probe(
        question=question,
        language=submission.get("language", ""),
        code=submission.get("code", ""),
    )

    return {"probe": probe}


@router.post("/session/{secure_token}/flag")
async def record_coding_flag(secure_token: str, payload: CodingFlagPayload):
    """Record a coding-assessment integrity event (paste_blocked, paste_burst,
    drop_blocked, ...) live as it happens in the editor.

    Deliberately a SEPARATE array (`coding_integrity_flags`) and a separate
    endpoint from the interview's POST /interview/session/{token}/flag — see
    services/hr_module/integrity.py's module docstring for why the two must
    never merge. The token guard mirrors the interview flag endpoint: an
    unknown token is rejected, but there is no active/consumed-status check
    here since a coding assessment has no single "session over" moment the
    way the interview's token_status does.
    """
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")

    cand = await db.candidates.find_one({"secure_token": secure_token}, {"_id": 0, "candidate_id": 1})
    if not cand:
        raise HTTPException(404, "Invalid link")

    flag = f"{payload.event}@{datetime.now(timezone.utc).isoformat()}"
    await db.candidates.update_one(
        {"secure_token": secure_token},
        {"$push": {"coding_integrity_flags": flag}},
    )
    return {"recorded": True}


async def _enrich_submissions(db, submissions: list[dict]) -> list[dict]:
    """Attach candidate name/email and question title to each submission.

    A submission stores only ids. Every admin view of one wants the human
    labels, and resolving them client-side means one request per row — so the
    join happens here, in two batched queries regardless of page size.

    Purely additive: no stored field is removed or renamed, so callers that
    only read the original keys are unaffected.
    """
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
    _: dict = Depends(require_admin),
):
    """Admin-facing — submissions across all candidates, newest first.

    Exists because the only way to see a submission used to be to already know
    the candidate_id and type it in; there was no way to answer "what came in
    today" or "who got flagged for similarity". Same full detail (hidden test
    results, submitted code) as the per-candidate endpoint — this route is
    admin-gated for exactly that reason.
    """
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")

    limit = max(1, min(limit, 100))
    page = max(1, page)

    query: dict = {}
    if candidate_id:
        query["candidate_id"] = candidate_id
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
async def list_submissions(candidate_id: str, _: dict = Depends(require_admin)):
    """Admin-facing — full results for one candidate, including hidden test detail."""
    db = get_db()
    if db is None:
        raise HTTPException(503, "Database unavailable")
    cursor = db.coding_submissions.find({"candidate_id": candidate_id}, {"_id": 0}).sort("submitted_at", -1)
    submissions = await cursor.to_list(length=200)
    return {"submissions": await _enrich_submissions(db, submissions)}
