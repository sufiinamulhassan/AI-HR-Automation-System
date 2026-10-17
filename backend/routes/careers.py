from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, Response, UploadFile

from services.hr_module import application_service, careers_service
from shared.rate_limit import public_token_throttle

router = APIRouter()

_read_throttle = public_token_throttle("careers_read", ip_limit=240, param=None)
_apply_throttle = public_token_throttle(
    "careers_apply", ip_limit=12, token_limit=300, param="job_id", window_seconds=3600, tenant="job",
)

CACHE_HEADER = "public, max-age=30, stale-while-revalidate=60"


@router.get("/jobs", dependencies=[Depends(_read_throttle)])
async def list_jobs(
    response: Response,
    q: str | None = None,
    company: str | None = None,
    location: str | None = None,
    type: str | None = None,
    remote: bool = False,
    page: int = Query(default=1, ge=1, le=1000),
    limit: int = Query(default=careers_service.DEFAULT_PAGE_SIZE, ge=1, le=careers_service.MAX_PAGE_SIZE),
):
    response.headers["Cache-Control"] = CACHE_HEADER
    return await careers_service.list_public_jobs(
        q=q, company=company, location=location, employment_type=type, remote=remote, page=page, limit=limit,
    )


@router.get("/filters", dependencies=[Depends(_read_throttle)])
async def filters(response: Response):
    response.headers["Cache-Control"] = CACHE_HEADER
    return await careers_service.public_filters()


@router.get("/jobs/{job_id}", dependencies=[Depends(_read_throttle)])
async def get_job(job_id: str, response: Response):
    job = await careers_service.get_public_job(job_id)
    if not job:
        raise HTTPException(404, "This job is no longer open.")
    response.headers["Cache-Control"] = CACHE_HEADER
    return job


@router.post("/jobs/{job_id}/apply", dependencies=[Depends(_apply_throttle)])
async def apply(
    job_id: str,
    bg: BackgroundTasks,
    name: str = Form(...),
    email: str = Form(...),
    phone: str = Form(default=""),
    cover_note: str = Form(default=""),
    consent: bool = Form(default=False),
    website: str = Form(default=""),
    resume: UploadFile = File(...),
):
    if website.strip():
        return {"status": "received", "application_id": "", "reference": "", "job_title": "", "company_name": ""}
    form = application_service.validate_form(
        name=name, email=email, phone=phone, cover_note=cover_note, consent=consent,
    )
    raw = await resume.read(application_service.max_resume_bytes() + 1)
    filename = application_service.validate_file(resume.filename, raw)
    await application_service.ensure_readable(filename, raw)
    return await application_service.submit_application(job_id, form=form, filename=filename, raw=raw, bg=bg)
