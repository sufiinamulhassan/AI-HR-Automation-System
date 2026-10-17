from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient

import config.database as database
from config import tenancy
from config.settings import settings
from config.tenancy import DEFAULT_COMPANY_ID, TenantDB
from fake_mongo import FakeRaw
from main import app
from services.hr_module import application_service, careers_service, erasure_service, resume_intel, webhook_service
from shared.schemas import HRJobCreate, HRJobUpdate
from shared import quotas, rate_limit, tenant_deps
from test_erasure_service import ACTOR, EMAIL, REASON, FakeIndex, seed_person

pytestmark = pytest.mark.anyio

API = "/api/v1/careers"
A, B, C, P, S = "cmp_a", "cmp_b", "cmp_c", "cmp_platform", "cmp_s"
PDF = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\n" + b"x" * 200
NOW = datetime.now(timezone.utc)


def iso(days=0):
    return (NOW + timedelta(days=days)).isoformat()


def add_company(raw, cid, slug, name, *, status="active", kind="workspace", client_status="active", org=None, logo=None, **settings_extra):
    client_id = f"cl_{cid}"
    raw["clients"].docs.append({
        "client_id": client_id, "name": name, "slug": slug, "status": client_status, "kind": "workspace",
        "plan": {}, "subscription": {}, "created_at": iso(-30),
    })
    raw["companies"].docs.append({
        "company_id": cid, "client_id": client_id, "name": name, "slug": slug, "status": status, "kind": kind,
        "settings": {}, "created_at": iso(-30),
    })
    if org or settings_extra:
        raw["company_settings"].docs.append({"_id": f"{cid}:singleton", "company_name": org or "", **settings_extra})
    if logo:
        raw["branding_settings"].docs.append({"_id": f"{cid}:singleton", "company_logo_url": logo})


def add_job(raw, cid, job_id, title, **extra):
    raw["jobs"].docs.append({
        "doc_type": "job", "job_id": job_id, "company_id": cid, "title": title,
        "description": f"{title} description. We build things.", "location": "Lahore", "employment_type": "full-time",
        "is_remote": False, "source": "manual", "is_public": True, "deadline_at": None, "created_at": iso(-1),
        "candidate_pipeline": [], "embedding": [0.1], "salary_min": 1000, "salary_max": 2000, "created_by": "hr@x.test",
        **extra,
    })


@pytest.fixture
async def world(monkeypatch):
    raw = FakeRaw()
    monkeypatch.setattr(database, "_db", raw)
    tenancy.use_fallback_company(None)

    keys: list[str] = []

    async def record(db, *, key, limit, window_seconds):
        keys.append(key)

    monkeypatch.setattr(rate_limit, "enforce_rate_limit", record)
    monkeypatch.setattr(quotas, "enforce_rate_limit", record)

    async def load(company_id):
        row = next((c for c in raw["companies"].docs if c["company_id"] == company_id), None)
        if row is None:
            return None
        client = next((c for c in raw["clients"].docs if c["client_id"] == row["client_id"]), {})
        return {**row, "client_status": client.get("status", "active"), "client_plan": client.get("plan"), "client_subscription": client.get("subscription")}

    monkeypatch.setattr(tenant_deps, "load_company", load)

    started: list[tuple] = []

    async def fake_agent(*args, **kwargs):
        started.append((args, kwargs))

    monkeypatch.setattr(application_service, "run_resume_agent", fake_agent)

    events: list[tuple] = []

    async def emit(event, payload):
        events.append((event, payload))

    monkeypatch.setattr(webhook_service, "emit_event", emit)

    async def readable(raw, filename):
        return "Sara Khan. Senior Python engineer with ten years of experience building APIs."

    monkeypatch.setattr(resume_intel, "extract_text", readable)

    add_company(raw, A, "acme", "Acme Holdings", org="Acme Corp", logo="/api/v1/branding/logo/cmp_a?v=1",
                website="https://acme.test", industry="Software", privacy_url="https://acme.test/privacy", terms_url="https://acme.test/terms")
    add_company(raw, B, "globex", "Globex Inc")
    add_company(raw, C, "default", "Default")
    add_company(raw, P, "platform", "Platform Operations", kind="platform")
    add_company(raw, S, "suspended", "Suspended Co", client_status="suspended")

    add_job(raw, A, "a-new", "Backend Engineer", created_at=iso(-1),
            targeting={"required_skills": ["Python", "FastAPI", "python", "MongoDB"]})
    add_job(raw, A, "a-old", "Data Analyst", created_at=iso(-10), employment_type="contract", location="Karachi")
    add_job(raw, A, "a-private", "Hidden Role", is_public=False)
    add_job(raw, A, "a-closed", "Closed Role", deadline_at=iso(-2))
    add_job(raw, A, "a-open-deadline", "Deadline Role", deadline_at=iso(5), created_at=iso(-3), is_remote=True, location="Remote")
    add_job(raw, A, "a-imported", "Imported Role", source="remotive", is_public=False)
    raw["jobs"].docs.append({
        "doc_type": "job", "job_id": "a-legacy", "company_id": A, "title": "Legacy Manual", "description": "d",
        "source": "manual", "created_at": iso(-4), "candidate_pipeline": [],
    })
    raw["jobs"].docs.append({
        "doc_type": "job", "job_id": "a-legacy-import", "company_id": A, "title": "Legacy Import", "description": "d",
        "source": "themuse", "created_at": iso(-4), "candidate_pipeline": [],
    })
    add_job(raw, B, "b-1", "Product Designer", created_at=iso(-2), location="Dubai")
    add_job(raw, C, "c-1", "Support Agent", company_name="Initech", created_at=iso(-5))
    add_job(raw, P, "p-1", "Platform Job")
    add_job(raw, S, "s-1", "Suspended Job")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as client:
        yield SimpleNamespace(raw=raw, client=client, keys=keys, started=started, events=events)
    tenancy.use_fallback_company(DEFAULT_COMPANY_ID)


def ids(body):
    return [j["job_id"] for j in body["jobs"]]


async def test_every_active_company_lists_its_open_public_jobs_newest_first(world):
    response = await world.client.get(f"{API}/jobs")
    assert response.status_code == 200
    body = response.json()
    assert ids(body) == ["a-new", "b-1", "a-open-deadline", "a-legacy", "c-1", "a-old"]
    assert body["total"] == 6 and body["page"] == 1 and body["pages"] == 1
    assert "max-age" in response.headers["cache-control"]


async def test_hidden_closed_imported_platform_and_suspended_jobs_never_show(world):
    shown = set(ids((await world.client.get(f"{API}/jobs?limit=50")).json()))
    for hidden in ("a-private", "a-closed", "a-imported", "a-legacy-import", "p-1", "s-1"):
        assert hidden not in shown


async def test_a_job_shows_only_a_safe_public_view_of_it(world):
    body = (await world.client.get(f"{API}/jobs?company=acme&q=backend")).json()
    (job,) = body["jobs"]
    assert set(job) == {
        "job_id", "title", "summary", "location", "employment_type", "is_remote", "skills", "posted_at",
        "deadline_at", "company",
    }
    assert job["skills"] == ["Python", "FastAPI", "MongoDB"]
    assert job["company"] == {"slug": "acme", "name": "Acme Corp", "logo_url": "/api/v1/branding/logo/cmp_a?v=1"}
    dumped = str(body)
    for secret in ("cmp_a", "hr@x.test", "salary", "embedding", "candidate_pipeline", "created_by"):
        assert secret not in dumped.replace("/api/v1/branding/logo/cmp_a", "")


async def test_company_names_fall_back_from_the_organization_page_to_the_record_to_the_job(world):
    by_id = {j["job_id"]: j["company"]["name"] for j in (await world.client.get(f"{API}/jobs?limit=50")).json()["jobs"]}
    assert by_id["a-new"] == "Acme Corp"
    assert by_id["b-1"] == "Globex Inc"
    assert by_id["c-1"] == "Initech"


async def test_search_and_every_filter_narrow_the_list(world):
    async def run(query):
        return ids((await world.client.get(f"{API}/jobs?{query}")).json())

    assert await run("company=globex") == ["b-1"]
    assert await run("company=nope") == []
    assert await run("q=analyst") == ["a-old"]
    assert await run("q=DESIGNER") == ["b-1"]
    assert await run("location=dubai") == ["b-1"]
    assert await run("type=contract") == ["a-old"]
    assert await run("type=CONTRACT") == ["a-old"]
    assert await run("remote=true") == ["a-open-deadline"]
    assert await run("q=a.b") == []
    assert await run("company=acme&q=backend&location=lahore") == ["a-new"]


async def test_pagination_reports_the_total_and_pages(world):
    first = (await world.client.get(f"{API}/jobs?limit=4&page=1")).json()
    second = (await world.client.get(f"{API}/jobs?limit=4&page=2")).json()
    assert len(first["jobs"]) == 4 and len(second["jobs"]) == 2
    assert first["total"] == 6 and first["pages"] == 2
    assert not set(ids(first)) & set(ids(second))
    assert (await world.client.get(f"{API}/jobs?limit=500")).status_code == 422
    assert (await world.client.get(f"{API}/jobs?page=0")).status_code == 422


async def test_the_filter_lists_count_open_jobs_per_company(world):
    body = (await world.client.get(f"{API}/filters")).json()
    assert body["total_open"] == 6 and body["remote_jobs"] == 1
    assert body["companies"][0] == {"slug": "acme", "name": "Acme Corp", "logo_url": "/api/v1/branding/logo/cmp_a?v=1", "open_jobs": 4}
    assert {c["slug"] for c in body["companies"]} == {"acme", "globex", "default"}
    assert set(body["employment_types"]) == {"full-time", "contract"}
    assert "Dubai" in body["locations"] and "Lahore" in body["locations"]


async def test_a_job_page_has_the_full_text_and_the_company_legal_links(world):
    response = await world.client.get(f"{API}/jobs/a-new")
    assert response.status_code == 200
    job = response.json()
    assert job["description"] == "Backend Engineer description. We build things."
    assert job["accepting"] is True
    assert job["company"]["website"] == "https://acme.test" and job["company"]["privacy_url"] == "https://acme.test/privacy"
    assert job["company"]["terms_url"] == "https://acme.test/terms" and job["company"]["industry"] == "Software"
    assert "candidate_pipeline" not in job and "embedding" not in job


@pytest.mark.parametrize("job_id", ["a-private", "a-closed", "a-imported", "p-1", "s-1", "missing"])
async def test_a_job_that_is_not_public_and_open_is_a_plain_404(world, job_id):
    response = await world.client.get(f"{API}/jobs/{job_id}")
    assert response.status_code == 404 and response.json()["detail"] == "This job is no longer open."


def form(**over):
    data = {"name": "Sara Khan", "email": "Sara@Example.com", "phone": "+92 300 1234567", "cover_note": "Hello", "consent": "true"}
    data.update(over)
    return data


def files(name="cv.pdf", body=PDF):
    return {"resume": (name, body, "application/octet-stream")}


async def test_the_confirmation_names_the_company_the_way_the_public_pages_do(world):
    public = (await world.client.get(f"{API}/jobs/a-new")).json()["company"]["name"]
    response = await world.client.post(f"{API}/jobs/a-new/apply", data=form(), files=files())
    assert response.status_code == 200, response.text
    assert public == "Acme Corp" and response.json()["company_name"] == public


async def test_an_application_lands_in_the_company_that_owns_the_job_and_nowhere_else(world):
    response = await world.client.post(f"{API}/jobs/b-1/apply", data=form(), files=files())
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "received" and body["job_title"] == "Product Designer" and body["company_name"] == "Globex Inc"
    assert len(body["reference"]) == 8

    (application,) = world.raw.rows("applications", company_id=B)
    assert application["job_id"] == "b-1" and application["email_normalized"] == "sara@example.com"
    assert application["name"] == "Sara Khan" and application["source"] == "career_page" and application["cover_note"] == "Hello"
    (resume,) = world.raw.rows("resumes", company_id=B)
    assert resume["applied_job_id"] == "b-1" and resume["source"] == "career_page" and resume["processing_status"] == "pending"
    assert resume["applicant"] == {"name": "Sara Khan", "email": "sara@example.com", "phone": "+92 300 1234567"}
    assert application["resume_id"] == resume["resume_id"]
    for other in (A, C, P, S):
        assert world.raw.rows("applications", company_id=other) == []
        assert world.raw.rows("resumes", company_id=other) == []

    (args, kwargs) = world.started[0]
    assert args[0] == resume["resume_id"] and args[1] == "cv.pdf" and args[3] == "b-1"
    assert kwargs["pipeline_extra"] == {"source": "career_page", "application_id": application["application_id"]}
    assert kwargs["applicant"] == {"name": "Sara Khan", "email": "sara@example.com"}
    assert world.events == [("application.received", {"application_id": application["application_id"], "job_id": "b-1", "title": "Product Designer"})]
    (audit,) = world.raw.rows("audit_log", company_id=B, action="application_received")
    assert audit["actor_role"] == "candidate"
    assert any(k.startswith("public:careers_apply:ip:") for k in world.keys)
    assert any(k.startswith("public:careers_apply:token:") for k in world.keys)
    assert any(k.endswith(":careers_apply") for k in world.keys)


@pytest.mark.parametrize("data,message", [
    ({"name": "S"}, "Enter your full name."),
    ({"email": "nope"}, "Enter a valid email address."),
    ({"phone": "abc"}, "Enter a valid phone number, or leave it empty."),
    ({"cover_note": "x" * 2001}, "Your note must be at most 2000 characters."),
    ({"consent": "false"}, "Please agree to the processing of your application to continue."),
])
async def test_a_bad_form_is_refused_and_stores_nothing(world, data, message):
    response = await world.client.post(f"{API}/jobs/b-1/apply", data=form(**data), files=files())
    assert response.status_code == 400 and response.json()["detail"] == message
    assert world.raw.rows("applications", company_id=B) == [] and world.raw.rows("resumes", company_id=B) == []


@pytest.mark.parametrize("name,body,status", [
    ("cv.exe", PDF, 415),
    ("cv.pdf", b"not a pdf at all", 415),
    ("cv.docx", b"%PDF-1.4 mislabelled", 415),
    ("cv.doc", b"\xd0\xcf\x11\xe0" + b"0" * 50, 415),
    ("cv.doc", b"%PDF-1.4 mislabelled", 415),
    ("cv.txt", b"abc\x00def", 415),
    ("cv.pdf", b"", 400),
])
async def test_a_bad_file_is_refused(world, name, body, status):
    response = await world.client.post(f"{API}/jobs/b-1/apply", data=form(), files=files(name, body))
    assert response.status_code == status
    assert world.raw.rows("applications", company_id=B) == []


async def test_plain_text_and_word_files_are_accepted(world):
    docx = b"PK\x03\x04" + b"0" * 50
    doc = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"0" * 50
    cases = (
        ("cv.txt", b"Sara Khan\nSenior Python engineer with ten years of experience"),
        ("cv.docx", docx),
        ("cv.doc", doc),
    )
    for index, (name, body) in enumerate(cases):
        response = await world.client.post(
            f"{API}/jobs/b-1/apply", data=form(email=f"s{index}@example.com"), files=files(name, body),
        )
        assert response.status_code == 200, (name, response.text)
    assert len(world.raw.rows("applications", company_id=B)) == 3


async def test_a_file_with_no_readable_text_is_refused_before_anything_is_stored(world, monkeypatch):
    async def nothing(raw, filename):
        return "  \n "

    monkeypatch.setattr(resume_intel, "extract_text", nothing)
    response = await world.client.post(f"{API}/jobs/b-1/apply", data=form(), files=files())
    assert response.status_code == 422 and "could not read any text" in response.json()["detail"]
    assert world.raw.rows("applications", company_id=B) == [] and world.raw.rows("resumes", company_id=B) == []

    async def broken(raw, filename):
        raise ValueError("encrypted")

    monkeypatch.setattr(resume_intel, "extract_text", broken)
    response = await world.client.post(f"{API}/jobs/b-1/apply", data=form(), files=files())
    assert response.status_code == 422


async def test_a_file_over_the_limit_is_refused(world, monkeypatch):
    monkeypatch.setattr(settings, "CAREERS_MAX_RESUME_MB", 1)
    big = b"%PDF" + b"0" * (1024 * 1024)
    response = await world.client.post(f"{API}/jobs/b-1/apply", data=form(), files=files("big.pdf", big))
    assert response.status_code == 413 and "limit is 1 MB" in response.json()["detail"]


async def test_the_same_email_cannot_apply_twice_to_one_job_but_can_to_another(world):
    ok = await world.client.post(f"{API}/jobs/a-new/apply", data=form(), files=files())
    assert ok.status_code == 200
    again = await world.client.post(f"{API}/jobs/a-new/apply", data=form(email="SARA@example.com"), files=files("other.pdf", PDF + b"y"))
    assert again.status_code == 409 and again.json()["detail"] == "You have already applied to this job with this email address."
    other = await world.client.post(f"{API}/jobs/a-old/apply", data=form(), files=files("other.pdf", PDF + b"z"))
    assert other.status_code == 200
    assert len(world.raw.rows("applications", company_id=A)) == 2


async def test_a_resume_already_on_file_is_attached_to_the_new_job_without_reprocessing(world):
    first = await world.client.post(f"{API}/jobs/a-new/apply", data=form(), files=files())
    assert first.status_code == 200
    (resume,) = world.raw.rows("resumes", company_id=A)
    world.raw["resumes"].docs[0]["file_hash"] = application_service_hash(PDF)
    world.started.clear()

    second = await world.client.post(f"{API}/jobs/a-old/apply", data=form(email="other@example.com"), files=files())
    assert second.status_code == 200
    assert world.started == []
    assert len(world.raw.rows("resumes", company_id=A)) == 1
    (job,) = [j for j in world.raw.rows("jobs", company_id=A) if j["job_id"] == "a-old"]
    (entry,) = job["candidate_pipeline"]
    assert entry["resume_id"] == resume["resume_id"] and entry["source"] == "career_page" and entry["targeted_upload"] is True


def application_service_hash(raw):
    from services.hr_module.resume_intel import _file_hash

    return _file_hash(raw)


@pytest.mark.parametrize("job_id", ["a-private", "a-closed", "a-imported", "p-1", "s-1", "missing"])
async def test_applying_to_a_job_that_is_not_open_and_public_is_a_404(world, job_id):
    response = await world.client.post(f"{API}/jobs/{job_id}/apply", data=form(), files=files())
    assert response.status_code == 404
    assert all(world.raw.rows("applications", company_id=c) == [] for c in (A, B, C, P, S))


async def test_a_filled_honeypot_looks_successful_and_stores_nothing(world):
    response = await world.client.post(f"{API}/jobs/b-1/apply", data=form(website="http://spam.test"), files=files())
    assert response.status_code == 200 and response.json()["status"] == "received" and response.json()["reference"] == ""
    assert world.raw.rows("applications", company_id=B) == [] and world.started == [] and world.events == []


async def test_a_company_over_its_budget_or_storage_says_it_is_not_accepting(world, monkeypatch):
    async def over_budget(scope, *, per_hour):
        raise HTTPException(402, "AI budget reached")

    monkeypatch.setattr(application_service, "check_ai_action", over_budget)
    response = await world.client.post(f"{API}/jobs/b-1/apply", data=form(), files=files())
    assert response.status_code == 503 and response.json()["detail"] == application_service.CLOSED_MESSAGE

    async def fine(scope, *, per_hour):
        return None

    async def full(size):
        raise HTTPException(413, "storage full")

    monkeypatch.setattr(application_service, "check_ai_action", fine)
    monkeypatch.setattr(application_service.plan_service, "ensure_storage_available", full)
    response = await world.client.post(f"{API}/jobs/b-1/apply", data=form(), files=files())
    assert response.status_code == 503 and response.json()["detail"] == application_service.CLOSED_MESSAGE
    assert world.raw.rows("applications", company_id=B) == []


async def test_a_rate_limited_applicant_gets_the_limiters_own_answer(world, monkeypatch):
    async def limited(scope, *, per_hour):
        raise HTTPException(429, "Too many requests. Try again later.")

    monkeypatch.setattr(application_service, "check_ai_action", limited)
    response = await world.client.post(f"{API}/jobs/b-1/apply", data=form(), files=files())
    assert response.status_code == 429


async def test_erasing_a_person_removes_the_applications_they_made(world):
    raw = FakeRaw()
    index = FakeIndex()
    monkeypatch_target = erasure_service
    monkeypatch_target.get_pinecone = lambda: index
    tenancy.use_fallback_company("cmp_a")
    w = SimpleNamespace(raw=raw, db=TenantDB(raw, "cmp_a"), index=index)
    seed_person(w, tag="1")
    raw.add("applications", {"application_id": "ap1", "job_id": "job-1", "resume_id": "res-1", "email_normalized": EMAIL.lower(), "name": "Jane"}, "cmp_a")
    raw.add("applications", {"application_id": "ap2", "job_id": "job-1", "resume_id": "res-x", "email_normalized": "other@example.com", "name": "Other"}, "cmp_a")
    raw.add("applications", {"application_id": "ap3", "job_id": "job-1", "resume_id": "res-1", "email_normalized": EMAIL.lower(), "name": "Jane"}, "cmp_b")

    result = await erasure_service.erase_by_email(w.db, EMAIL, actor=ACTOR, reason=REASON)

    assert result["counts"]["applications"] == 1
    assert [a["application_id"] for a in raw.rows("applications", "cmp_a")] == ["ap2"]
    assert [a["application_id"] for a in raw.rows("applications", "cmp_b")] == ["ap3"]
    tenancy.use_fallback_company(None)


async def test_removing_a_resume_removes_the_application_that_brought_it(world):
    raw = FakeRaw()
    tenancy.use_fallback_company("cmp_a")
    db = TenantDB(raw, "cmp_a")
    raw.add("resumes", {"resume_id": "r1", "filename": "a.pdf", "candidate_email": "sara@example.com"}, "cmp_a")
    raw.add("applications", {"application_id": "ap1", "resume_id": "r1", "email_normalized": "sara@example.com"}, "cmp_a")
    raw.add("applications", {"application_id": "ap2", "resume_id": "r2", "email_normalized": "other@example.com"}, "cmp_a")

    result = await erasure_service.erase_resumes(db, ["r1"])

    assert result["counts"]["applications"] == 1
    assert [a["application_id"] for a in raw.rows("applications", "cmp_a")] == ["ap2"]
    tenancy.use_fallback_company(None)


def test_summaries_are_plain_short_and_cut_on_a_word():
    text = "# Heading\n\n**Bold** words " + "word " * 100
    out = careers_service.summarise(text)
    assert len(out) <= careers_service.SUMMARY_CHARS + 3 and out.endswith("...") and "#" not in out and "*" not in out
    assert careers_service.summarise("short text") == "short text"


def test_a_new_job_is_public_by_default_and_an_update_without_the_flag_leaves_it_alone():
    assert HRJobCreate(title="T", description="D").is_public is True
    assert HRJobCreate(title="T", description="D", is_public=False).is_public is False
    assert HRJobUpdate().model_dump()["is_public"] is None
    assert HRJobUpdate(is_public=False).model_dump()["is_public"] is False
