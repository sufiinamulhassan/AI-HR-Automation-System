from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from httpx import ASGITransport, AsyncClient

import config.database as database
import routes.resumes as resumes_route
from config import llm, tenancy
from config.settings import settings
from fake_mongo import FakeRaw
from main import app
from services.hr_module import department_access, resume_search, vector_scope
from shared import quotas

pytestmark = pytest.mark.anyio

API = "/api/v1/resumes"
ADMIN = {"Authorization": "Bearer demo-superadmin-token"}
STANDARD = {"Authorization": "Bearer demo-standard-token"}
COMPANY = tenancy.DEFAULT_COMPANY_ID
OTHER = "cmp_other"
UNAVAILABLE = "Semantic search is not available right now"


def resume(resume_id, name, created, classification=None, **fields):
    doc = {
        "resume_id": resume_id, "candidate_name": name, "filename": f"{resume_id}.pdf",
        "processing_status": "processed", "created_at": created, "embedding": [0.1, 0.2],
        "text": f"private text of {name}",
    }
    if classification is not None:
        doc["classification"] = classification
    doc.update(fields)
    return doc


def dataset():
    return [
        resume(
            "ada", "Ada Lovelace", "2026-03-01T10:00:00+00:00",
            {"job_domain": "software_engineering", "seniority_level": "senior",
             "skills": ["Python", "Java", "Spring Boot"], "years_experience": 9,
             "education_level": "master", "industry": "fintech"},
            candidate_email="ada@acme.io", headline="Senior Python Engineer", department="Backend Engineer",
            location="Berlin", salary_expectation=120000,
            certifications=["PMP", "AWS SAA"], experience=[{"title": "Engineer", "company": "Google"}],
            notice_period="30 days",
            matched_jds=[{"job_id": "j1", "score": 0.9}, {"job_id": "j2", "score": 0.4}],
            recruiter_notes="strong hire",
        ),
        resume(
            "bob", "Bob Stone", "2026-02-01T10:00:00+00:00",
            {"job_domain": "devops", "seniority_level": "mid", "skills": ["JavaScript", "NoSQL", "Go"],
             "years_experience": 4, "education_level": "bachelor", "industry": "healthcare"},
            headline="Platform Engineer", department="backend engineer", location="London",
            salary_expectation=70000, certifications=["pmp"],
            processing_status="failed", matched_jds=[{"job_id": "j1", "score": 0.3}],
        ),
        resume(
            "cy", "Cy Young", "2026-04-01T10:00:00+00:00",
            {"job_domain": "marketing", "seniority_level": "junior", "skills": ["SEO", "SQL"],
             "years_experience": 2, "education_level": "high_school", "industry": "fintech"},
            headline="Growth Marketer", salary_expectation=30000,
        ),
        resume(
            "dee", "Dee Park", "2026-05-01T10:00:00+00:00",
            {"job_domain": "machine_learning", "seniority_level": "lead", "skills": ["Machine Learning", "Python"],
             "years_experience": 12, "education_level": "phd", "industry": "technology"},
            headline="Machine Learning Lead", department="Data Scientist", location="Berlin",
        ),
        resume(
            "eve", "Eve Hart", "2026-01-01T10:00:00+00:00",
            {"job_domain": "astrology", "seniority_level": "senior", "skills": [],
             "years_experience": 0, "education_level": "other", "industry": "other"},
        ),
        resume("old", "Old Timer", "2025-12-01T10:00:00+00:00"),
    ]


def foreign():
    return resume(
        "x1", "Ada Lovelace", "2026-06-01T10:00:00+00:00",
        {"job_domain": "software_engineering", "seniority_level": "senior",
         "skills": ["Python", "Java", "Cobol"], "years_experience": 9,
         "education_level": "master", "industry": "fintech"},
        headline="Senior Python Engineer", department="Backend Engineer", location="Berlin",
        salary_expectation=120000, certifications=["PMP"],
        experience=[{"title": "Engineer", "company": "Google"}], notice_period="30 days",
        matched_jds=[{"job_id": "j1", "score": 0.99}],
    )


class Embeddings:
    def __init__(self, outcome):
        self.outcome = outcome
        self.calls = []

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return SimpleNamespace(data=[SimpleNamespace(embedding=self.outcome)], usage=SimpleNamespace(total_tokens=1000))


class Index:
    def __init__(self, matches=(), fail=False):
        self.matches = list(matches)
        self.fail = fail
        self.calls = []

    def query(self, **kwargs):
        self.calls.append(kwargs)
        if self.fail:
            raise RuntimeError("pinecone is down")
        return SimpleNamespace(matches=[SimpleNamespace(id=i, score=s) for i, s in self.matches])


@pytest.fixture
async def world(monkeypatch):
    raw = FakeRaw()
    monkeypatch.setattr(database, "_db", raw)
    monkeypatch.setattr(tenancy, "_fallback_company_id", None)
    monkeypatch.setattr(settings, "ALLOW_DEMO_AUTH", True)
    monkeypatch.setattr(settings, "HACKATHON_DEMO_MODE", False)
    monkeypatch.setattr(settings, "DEMO_COMPANY_ID", "")
    quota = AsyncMock()
    monkeypatch.setattr(quotas, "check_ai_action", quota)
    resume_search.reset_skill_pool_cache()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as client:
        yield SimpleNamespace(raw=raw, client=client, quota=quota, monkeypatch=monkeypatch)
    resume_search.reset_skill_pool_cache()


@pytest.fixture
def stocked(world):
    for doc in dataset():
        world.raw.add("resumes", doc, COMPANY)
    world.raw.add("resumes", foreign(), OTHER)
    return world


def seed(world, docs, company=COMPANY):
    for doc in docs:
        world.raw.add("resumes", doc, company)


def ids(response):
    assert response.status_code == 200, response.text
    return [r["resume_id"] for r in response.json()["resumes"]]


async def listed(world, **params):
    return await world.client.get(API, params={"limit": 100, **params}, headers=ADMIN)


def use_embeddings(world, outcome=(0.25, 0.5)):
    provider = Embeddings(list(outcome) if not isinstance(outcome, Exception) else outcome)
    world.monkeypatch.setattr(llm, "get_openai_client", lambda: SimpleNamespace(embeddings=provider))
    return provider


def use_pinecone(world, index):
    world.monkeypatch.setattr(resumes_route, "get_pinecone", lambda: index)
    return index


class TestListFilters:

    TABLE = [
        ({"skill": "python"}, {"ada", "dee"}),
        ({"skill": "Python, JAVA"}, {"ada"}),
        ({"skill": "py"}, set()),
        ({"business_domain": "it_software"}, {"ada", "bob"}),
        ({"business_domain": "data_ai"}, {"dee"}),
        ({"business_domain": "marketing"}, {"cy"}),
        ({"business_domain": "other"}, {"eve", "old"}),
        ({"business_domain": "not_a_domain"}, set()),
        ({"domain": "devops"}, {"bob"}),
        ({"domain": "astrology"}, {"eve"}),
        ({"seniority": "senior"}, {"ada", "eve"}),
        ({"status": "failed"}, {"bob"}),
        ({"status": "processed"}, {"ada", "cy", "dee", "eve", "old"}),
        ({"experience_min": 5}, {"ada", "dee"}),
        ({"experience_max": 4}, {"bob", "cy", "eve"}),
        ({"experience_min": 3, "experience_max": 9}, {"ada", "bob"}),
        ({"department": "Backend Engineer"}, {"ada", "bob"}),
        ({"department": "BACKEND ENGINEER"}, {"ada", "bob"}),
        ({"department": "Backend"}, set()),
        ({"department": "Marketing"}, {"cy"}),
        ({"education_level": "phd"}, {"dee"}),
        ({"certification": "pmp"}, {"ada", "bob"}),
        ({"certification": "aws"}, {"ada"}),
        ({"industry": "fintech"}, {"ada", "cy"}),
        ({"salary_expectation_min": 100000}, {"ada"}),
        ({"salary_expectation_max": 70000}, {"bob", "cy"}),
        ({"worked_at_company": "google"}, {"ada"}),
        ({"location": "berlin"}, {"ada", "dee"}),
        ({"notice_period": "30"}, {"ada"}),
        ({"min_match_score": 0.5}, {"ada"}),
        ({"min_match_score": 0.3, "job_id": "j1"}, {"ada", "bob"}),
        ({"min_match_score": 0.5, "job_id": "j2"}, set()),
        ({"search": "berlin"}, {"ada", "dee"}),
        ({"search": "java"}, {"ada"}),
        ({"search": "python lead"}, {"dee"}),
        ({"search": "python, berlin"}, {"ada", "dee"}),
        ({"search": "spring boo"}, set()),
        ({"search": "lovel"}, {"ada"}),
        ({"search": "sql"}, {"cy"}),
        ({"search": "go"}, {"bob"}),
        ({"search": "python", "seniority": "lead", "business_domain": "data_ai"}, {"dee"}),
        ({"skill": "python", "experience_min": 10, "industry": "technology", "location": "berlin"}, {"dee"}),
    ]

    @pytest.mark.parametrize("params, expected", TABLE, ids=[str(p) for p, _ in TABLE])
    async def test_each_filter_returns_the_right_rows(self, stocked, params, expected):
        response = await listed(stocked, **params)
        assert set(ids(response)) == expected
        assert response.json()["total"] == len(expected)

    async def test_availability_is_not_a_filter(self, stocked):
        response = await listed(stocked, availability_status="immediate")
        assert len(ids(response)) == 6 and response.json()["total"] == 6
        folders = (await stocked.client.get(f"{API}/domains", params={"availability_status": "immediate"}, headers=ADMIN)).json()
        assert folders["total"] == 6

    async def test_the_response_shape_is_unchanged(self, stocked):
        body = (await stocked.client.get(API, headers=ADMIN)).json()
        assert set(body) == {"resumes", "total", "page", "limit"}
        assert body["page"] == 1 and body["limit"] == 20 and body["total"] == 6

    async def test_no_row_carries_the_embedding_the_text_or_a_mongo_id(self, stocked):
        rows = (await listed(stocked)).json()["resumes"]
        assert len(rows) == 6
        assert all(not ({"embedding", "text", "_id", "_relevance"} & set(r)) for r in rows)

    async def test_blank_params_are_ignored(self, stocked):
        blank = {
            "search": "", "skill": " ", "business_domain": "", "domain": "", "seniority": "", "status": "",
            "department": " ", "education_level": "", "certification": "",
            "industry": "", "worked_at_company": "", "location": "", "notice_period": "", "job_id": "",
        }
        assert len(ids(await listed(stocked, **blank))) == 6

    @pytest.mark.parametrize("text", ["(", "[", "*", "\\", "c++", ".net", "a|b", ".*", "(?", "$", "{1,2}", "c#"])
    async def test_hostile_text_never_breaks_the_list(self, stocked, text):
        for param in ("search", "skill", "location", "certification", "notice_period", "worked_at_company", "department"):
            response = await listed(stocked, **{param: text})
            assert response.status_code == 200, (param, text, response.text)

    async def test_unusual_text_is_taken_literally(self, stocked):
        assert ids(await listed(stocked, search="(")) != []
        assert ids(await listed(stocked, skill=".*")) == []
        assert ids(await listed(stocked, certification=".*")) == []

    async def test_non_numeric_numbers_are_a_validation_error_as_before(self, stocked):
        assert (await listed(stocked, experience_min="many")).status_code == 422
        assert (await listed(stocked, min_match_score="high")).status_code == 422

    async def test_resumes_that_lack_the_new_fields_are_never_matched_by_those_filters(self, stocked):
        for params in ({"department": "Backend Engineer"}, {"certification": "pmp"}, {"location": "berlin"},
                       {"worked_at_company": "google"},
                       {"notice_period": "days"}, {"salary_expectation_min": 1}, {"industry": "fintech"}):
            assert "old" not in ids(await listed(stocked, **params)), params


class TestListOrderAndPaging:

    async def test_the_default_order_is_newest_first(self, stocked):
        assert ids(await listed(stocked)) == ["dee", "cy", "ada", "bob", "eve", "old"]

    async def test_pages_walk_the_whole_list_and_the_total_never_changes(self, stocked):
        seen = []
        for page, expected in ((1, ["dee", "cy"]), (2, ["ada", "bob"]), (3, ["eve", "old"]), (4, [])):
            response = await stocked.client.get(API, params={"page": page, "limit": 2}, headers=ADMIN)
            body = response.json()
            assert [r["resume_id"] for r in body["resumes"]] == expected
            assert body["total"] == 6 and body["page"] == page and body["limit"] == 2
            seen += expected
        assert seen == ["dee", "cy", "ada", "bob", "eve", "old"]

    async def test_a_filtered_total_counts_every_match_not_just_the_page(self, stocked):
        response = await stocked.client.get(API, params={"seniority": "senior", "limit": 1}, headers=ADMIN)
        body = response.json()
        assert len(body["resumes"]) == 1 and body["total"] == 2

    async def test_equal_dates_fall_back_to_the_id_so_pages_never_repeat_or_drop_a_row(self, world):
        seed(world, [resume(i, i, "2026-01-01T00:00:00+00:00") for i in ("t3", "t1", "t5", "t2", "t4")])
        assert ids(await listed(world)) == ["t1", "t2", "t3", "t4", "t5"]
        first = ids(await world.client.get(API, params={"page": 1, "limit": 2}, headers=ADMIN))
        second = ids(await world.client.get(API, params={"page": 2, "limit": 2}, headers=ADMIN))
        third = ids(await world.client.get(API, params={"page": 3, "limit": 2}, headers=ADMIN))
        assert first + second + third == ["t1", "t2", "t3", "t4", "t5"]

    async def test_page_and_limit_are_kept_within_sane_bounds(self, stocked):
        body = (await stocked.client.get(API, params={"page": 0, "limit": 0}, headers=ADMIN)).json()
        assert body["page"] == 1 and body["limit"] == 20
        body = (await stocked.client.get(API, params={"page": -4, "limit": -1}, headers=ADMIN)).json()
        assert body["page"] == 1 and body["limit"] == 1
        body = (await stocked.client.get(API, params={"limit": 100000}, headers=ADMIN)).json()
        assert body["limit"] == 500

    @staticmethod
    def ranked_docs():
        python = {"job_domain": "software_engineering", "seniority_level": "mid", "skills": ["Python"]}
        return [
            resume("p1", "One", "2026-01-01T00:00:00+00:00", {**python, "years_experience": 3}, headline="Python Engineer"),
            resume("p2", "Two", "2026-01-02T00:00:00+00:00", {**python, "years_experience": 10}, headline="Data Analyst"),
            resume("p3", "Three", "2026-03-01T00:00:00+00:00", {**python, "years_experience": 10}, headline="Data Analyst"),
            resume("p4", "Four", "2026-02-01T00:00:00+00:00", {**python, "years_experience": 8}, headline="Python Developer"),
            resume("p5", "Five", "2026-06-01T00:00:00+00:00", python),
            resume("q1", "Quinn", "2026-07-01T00:00:00+00:00",
                   {"job_domain": "operations", "seniority_level": "senior", "skills": ["Excel"], "years_experience": 20},
                   headline="Senior Developer", department="Analyst"),
        ]

    async def test_a_skill_search_ranks_by_headline_then_years_then_newest(self, world):
        seed(world, self.ranked_docs())
        assert ids(await listed(world, search="python")) == ["p4", "p1", "p3", "p2", "p5"]

    async def test_the_skill_param_ranks_the_same_way(self, world):
        seed(world, self.ranked_docs())
        assert ids(await listed(world, skill="python")) == ["p4", "p1", "p3", "p2", "p5"]

    async def test_ranked_pages_continue_where_the_last_one_ended(self, world):
        seed(world, self.ranked_docs())
        pages = []
        for page in (1, 2, 3):
            body = (await world.client.get(API, params={"search": "python", "limit": 2, "page": page}, headers=ADMIN)).json()
            assert body["total"] == 5 and body["page"] == page
            pages += [r["resume_id"] for r in body["resumes"]]
        assert pages == ["p4", "p1", "p3", "p2", "p5"]

    async def test_a_word_in_the_headline_outranks_more_years(self, world):
        seed(world, self.ranked_docs())
        assert ids(await listed(world, search="analyst")) == ["p3", "p2", "q1"]

    async def test_without_anything_to_rank_by_the_order_is_newest_first(self, world):
        seed(world, self.ranked_docs())
        newest = ["q1", "p5", "p3", "p4", "p2", "p1"]
        assert ids(await listed(world)) == newest
        assert ids(await listed(world, search="(")) == newest
        assert ids(await listed(world, search="  ")) == newest
        assert ids(await listed(world, seniority="mid", experience_min=1)) == ["p3", "p4", "p2", "p1"]

    async def test_ranked_rows_carry_no_relevance_field_embedding_or_text(self, world):
        seed(world, self.ranked_docs())
        rows = (await listed(world, search="python")).json()["resumes"]
        assert rows and all(not ({"_relevance", "embedding", "text", "_id"} & set(r)) for r in rows)


class TestTenantsAndPeople:

    async def test_another_companys_resumes_never_appear(self, stocked):
        assert "x1" not in ids(await listed(stocked))
        assert (await listed(stocked)).json()["total"] == 6
        assert ids(await listed(stocked, search="cobol")) == []
        assert ids(await listed(stocked, skill="cobol")) == []
        assert "x1" not in ids(await listed(stocked, search="ada python", business_domain="it_software"))

    async def test_a_companys_skills_do_not_leak_into_another_companys_search_pool(self, world):
        seed(world, [resume("a1", "Zed", "2026-01-01T00:00:00+00:00", {"skills": ["Rust"]})], COMPANY)
        seed(world, [resume("b1", "Rustic", "2026-01-01T00:00:00+00:00", {"skills": ["Cobol"]})], OTHER)
        assert ids(await listed(world, search="rust")) == ["a1"]
        assert ids(await listed(world, search="cobol")) == []

    async def test_admin_only_fields_are_hidden_from_a_standard_user(self, stocked):
        admin_rows = {r["resume_id"]: r for r in (await listed(stocked)).json()["resumes"]}
        assert admin_rows["ada"]["recruiter_notes"] == "strong hire"
        standard = await stocked.client.get(API, params={"limit": 100}, headers=STANDARD)
        rows = {r["resume_id"]: r for r in standard.json()["resumes"]}
        assert "recruiter_notes" not in rows["ada"]

    async def test_matched_jobs_outside_the_users_department_are_hidden(self, stocked):
        stocked.raw.add("jobs", {"job_id": "j1", "department_id": "d1", "doc_type": "job"}, COMPANY)
        stocked.raw.add("jobs", {"job_id": "j2", "department_id": "d2", "doc_type": "job"}, COMPANY)
        stocked.monkeypatch.setattr(department_access, "get_department_scope", AsyncMock(return_value="d1"))
        rows = {r["resume_id"]: r for r in (await listed(stocked)).json()["resumes"]}
        assert [m["job_id"] for m in rows["ada"]["matched_jds"]] == ["j1"]

    async def test_a_job_outside_the_users_department_is_not_found_by_every_route(self, stocked):
        stocked.raw.add("jobs", {"job_id": "j2", "department_id": "d2", "doc_type": "job"}, COMPANY)
        stocked.monkeypatch.setattr(department_access, "get_department_scope", AsyncMock(return_value="d1"))
        use_pinecone(stocked, Index([("ada", 0.9)]))
        use_embeddings(stocked)
        for path, params in ((API, {"job_id": "j2"}), (f"{API}/domains", {"job_id": "j2"}),
                             (f"{API}/search/semantic", {"q": "python", "job_id": "j2"})):
            assert (await stocked.client.get(path, params=params, headers=ADMIN)).status_code == 404, path

    async def test_every_new_route_needs_a_signed_in_user(self, world):
        for path in (f"{API}/domains", f"{API}/filters/options", f"{API}/search/semantic?q=python"):
            assert (await world.client.get(path)).status_code == 401, path

    async def test_fixed_paths_are_not_swallowed_by_the_resume_id_route(self, stocked):
        folders = await stocked.client.get(f"{API}/domains", headers=ADMIN)
        options = await stocked.client.get(f"{API}/filters/options", headers=ADMIN)
        assert "folders" in folders.json() and "business_domains" in options.json()
        one = await stocked.client.get(f"{API}/ada", headers=ADMIN)
        assert one.status_code == 200 and one.json()["resume_id"] == "ada"
        assert (await stocked.client.get(f"{API}/ghost", headers=ADMIN)).status_code == 404


class TestFilterOptions:

    async def test_options_for_the_companys_resumes_in_their_documented_order(self, stocked):
        body = (await stocked.client.get(f"{API}/filters/options", headers=ADMIN)).json()
        assert set(body) == {
            "business_domains", "skills", "seniorities", "statuses", "education_levels",
            "industries", "roles", "total",
        }
        assert body["total"] == 6
        assert body["business_domains"] == [
            {"value": "it_software", "label": "IT & Software", "count": 2},
            {"value": "data_ai", "label": "Data & AI", "count": 1},
            {"value": "marketing", "label": "Marketing", "count": 1},
            {"value": "other", "label": "Other", "count": 2},
        ]
        assert body["skills"] == [
            {"value": "Python", "count": 2}, {"value": "Go", "count": 1}, {"value": "Java", "count": 1},
            {"value": "JavaScript", "count": 1}, {"value": "Machine Learning", "count": 1},
            {"value": "NoSQL", "count": 1}, {"value": "SEO", "count": 1}, {"value": "Spring Boot", "count": 1},
            {"value": "SQL", "count": 1},
        ]
        assert body["seniorities"] == [
            {"value": "junior", "label": "Junior", "count": 1}, {"value": "mid", "label": "Mid", "count": 1},
            {"value": "senior", "label": "Senior", "count": 2}, {"value": "lead", "label": "Lead", "count": 1},
        ]
        assert body["statuses"] == [{"value": "failed", "count": 1}, {"value": "processed", "count": 5}]
        assert [(o["value"], o["label"]) for o in body["education_levels"]] == [
            ("high_school", "High school"), ("bachelor", "Bachelor"), ("master", "Master"), ("phd", "PhD"),
            ("other", "Other"),
        ]
        assert [(o["value"], o["count"]) for o in body["industries"]] == [
            ("fintech", 2), ("healthcare", 1), ("other", 1), ("technology", 1),
        ]
        assert body["roles"] == [
            {"value": "Astrology", "count": 1}, {"value": "Backend Engineer", "count": 2},
            {"value": "Data Scientist", "count": 1}, {"value": "Marketing", "count": 1},
            {"value": "Not classified", "count": 1},
        ]

    async def test_job_families_and_availability_are_not_offered(self, stocked):
        body = (await stocked.client.get(f"{API}/filters/options", headers=ADMIN)).json()
        assert "job_families" not in body and "availability_statuses" not in body

    async def test_the_other_companys_values_are_not_listed_or_counted(self, stocked):
        body = (await stocked.client.get(f"{API}/filters/options", headers=ADMIN)).json()
        assert "Cobol" not in [s["value"] for s in body["skills"]]
        python = next(s for s in body["skills"] if s["value"] == "Python")
        assert python["count"] == 2
        assert body["total"] == 6

    async def test_an_empty_company_gets_empty_lists_and_a_zero_total(self, world):
        body = (await world.client.get(f"{API}/filters/options", headers=ADMIN)).json()
        assert body["total"] == 0
        assert all(body[key] == [] for key in body if key != "total")

    async def test_old_resumes_without_the_new_fields_only_count_where_they_belong(self, world):
        seed(world, [resume("legacy", "Legacy", "2026-01-01T00:00:00+00:00")])
        body = (await world.client.get(f"{API}/filters/options", headers=ADMIN)).json()
        assert body["total"] == 1
        assert body["business_domains"] == [{"value": "other", "label": "Other", "count": 1}]
        assert body["statuses"] == [{"value": "processed", "count": 1}]
        for key in ("skills", "seniorities", "education_levels", "industries"):
            assert body[key] == [], key
        assert body["roles"] == [{"value": "Not classified", "count": 1}]

    async def test_options_are_not_narrowed_by_the_other_filters(self, stocked):
        plain = (await stocked.client.get(f"{API}/filters/options", headers=ADMIN)).json()
        narrowed = (await stocked.client.get(f"{API}/filters/options", params={"skill": "go"}, headers=ADMIN)).json()
        assert plain == narrowed

    async def test_skills_and_roles_are_capped(self, world):
        docs = []
        for i in range(450):
            docs.append(resume(
                f"r{i}", f"R{i}", "2026-01-01T00:00:00+00:00", {"skills": [f"skill {i:04d}"]},
                certifications=[f"cert {i:04d}"], department=f"role {i:04d}",
            ))
        seed(world, docs)
        body = (await world.client.get(f"{API}/filters/options", headers=ADMIN)).json()
        assert len(body["skills"]) == 400
        assert "certifications" not in body
        assert len(body["roles"]) == 100
        assert [r["value"] for r in body["roles"]] == [f"role {i:04d}" for i in range(100)]

    @staticmethod
    def role_mix():
        def doc(resume_id, family=None, **fields):
            classification = {"job_domain": family, "skills": []} if family is not None else None
            return resume(resume_id, resume_id, "2026-01-01T00:00:00+00:00", classification, **fields)

        return [
            doc("d1", "software_engineering", department="Backend Engineer"),
            doc("d2", "devops", department="backend engineer"),
            doc("d3", "software_engineering"),
            doc("d4", "devops", department="Software Engineering"),
            doc("d5", "qa_testing"),
            doc("d6", "astrology"),
            doc("d7"),
            doc("d8", "", department=None),
            doc("d9", "hr", department="  "),
            doc("d10", "sales", department="Not classified"),
            doc("d11", "marketing", department=" Growth "),
            doc("d12", "sales_ops"),
            doc("d13", "software_engineering", department="Backend Engineer"),
            doc("d14", "legal", department="LEGAL"),
            doc("d15", "legal"),
        ]

    async def test_selecting_any_role_option_returns_exactly_its_count(self, world):
        seed(world, self.role_mix())
        seed(world, [resume("zz", "Zed", "2026-01-01T00:00:00+00:00", {"job_domain": "astrology", "skills": []},
                            department="Backend Engineer")], OTHER)
        roles = (await world.client.get(f"{API}/filters/options", headers=ADMIN)).json()["roles"]
        assert {r["value"]: r["count"] for r in roles} == {
            "Astrology": 1, "Backend Engineer": 3, "Growth": 1, "Human Resources": 1, "LEGAL": 2,
            "Not classified": 3, "QA and Testing": 1, "Sales Ops": 1, "Software Engineering": 2,
        }
        assert sum(r["count"] for r in roles) == 15
        for role in roles:
            response = await listed(world, department=role["value"])
            assert response.json()["total"] == role["count"], role
            assert len(ids(response)) == role["count"], role
            lowered = await listed(world, department=role["value"].lower())
            assert lowered.json()["total"] == role["count"], role

    async def test_a_department_that_equals_a_family_label_counts_with_that_family(self, world):
        seed(world, self.role_mix())
        got = set(ids(await listed(world, department="Software Engineering")))
        assert got == {"d3", "d4"}
        assert set(ids(await listed(world, department="Not classified"))) == {"d7", "d8", "d10"}
        assert set(ids(await listed(world, department="Human Resources"))) == {"d9"}
        assert set(ids(await listed(world, department="Sales Ops"))) == {"d12"}

    async def test_every_folder_role_chip_is_a_role_option_that_returns_at_least_its_count(self, world):
        seed(world, self.role_mix())
        options = {r["value"].lower(): r["count"] for r in
                   (await world.client.get(f"{API}/filters/options", headers=ADMIN)).json()["roles"]}
        folders = (await world.client.get(f"{API}/domains", headers=ADMIN)).json()["folders"]
        chips = [(f["value"], role) for f in folders for role in f["roles"]]
        assert chips
        for slug, chip in chips:
            assert chip["value"].lower() in options, chip
            inside = await listed(world, department=chip["value"], business_domain=slug)
            assert inside.json()["total"] == chip["count"], (slug, chip)
            assert chip["count"] <= options[chip["value"].lower()]

    async def test_options_do_not_use_the_ai_quota(self, stocked):
        await stocked.client.get(f"{API}/filters/options", headers=ADMIN)
        await stocked.client.get(f"{API}/domains", headers=ADMIN)
        await stocked.client.get(API, headers=ADMIN)
        stocked.quota.assert_not_awaited()


class TestFolders:

    async def test_folders_with_counts_roles_and_other_last(self, stocked):
        body = (await stocked.client.get(f"{API}/domains", headers=ADMIN)).json()
        assert set(body) == {"folders", "total"}
        assert body["total"] == 6
        assert body["folders"] == [
            {"value": "it_software", "label": "IT & Software", "count": 2,
             "roles": [{"value": "Backend Engineer", "count": 2}]},
            {"value": "data_ai", "label": "Data & AI", "count": 1,
             "roles": [{"value": "Data Scientist", "count": 1}]},
            {"value": "marketing", "label": "Marketing", "count": 1,
             "roles": [{"value": "Marketing", "count": 1}]},
            {"value": "other", "label": "Other", "count": 2,
             "roles": [{"value": "Astrology", "count": 1}, {"value": "Not classified", "count": 1}]},
        ]

    async def test_a_role_is_the_department_else_the_family_label_and_only_five_are_kept(self, world):
        sales = {"job_domain": "sales", "skills": []}
        docs = [resume(f"s{i}", f"S{i}", "2026-01-01T00:00:00+00:00", sales, department=f"Role {name}")
                for i, name in enumerate("aabbbcdefgg")]
        docs.append(resume("s_none", "None", "2026-01-01T00:00:00+00:00", sales))
        docs.append(resume("s_case", "Case", "2026-01-01T00:00:00+00:00", sales, department="role B"))
        seed(world, docs)
        body = (await world.client.get(f"{API}/domains", headers=ADMIN)).json()
        (folder,) = body["folders"]
        assert folder["value"] == "sales" and folder["count"] == 13
        assert folder["roles"] == [
            {"value": "Role b", "count": 4}, {"value": "Role a", "count": 2}, {"value": "Role g", "count": 2},
            {"value": "Role c", "count": 1}, {"value": "Role d", "count": 1},
        ]

    async def test_a_folder_with_nobody_in_it_is_not_listed(self, stocked):
        values = [f["value"] for f in (await stocked.client.get(f"{API}/domains", headers=ADMIN)).json()["folders"]]
        assert "sales" not in values and "legal" not in values

    async def test_domain_business_domain_and_department_are_ignored(self, stocked):
        plain = (await stocked.client.get(f"{API}/domains", headers=ADMIN)).json()
        for params in ({"business_domain": "marketing"}, {"domain": "devops"}, {"department": "Data Scientist"},
                       {"business_domain": "nonsense", "domain": "x", "department": "y"}):
            other = (await stocked.client.get(f"{API}/domains", params=params, headers=ADMIN)).json()
            assert other == plain, params

    async def test_other_filters_narrow_the_folders(self, stocked):
        body = (await stocked.client.get(f"{API}/domains", params={"skill": "python"}, headers=ADMIN)).json()
        assert [(f["value"], f["count"]) for f in body["folders"]] == [("data_ai", 1), ("it_software", 1)]
        assert body["total"] == 2
        body = (await stocked.client.get(f"{API}/domains", params={"search": "berlin"}, headers=ADMIN)).json()
        assert body["total"] == 2
        body = (await stocked.client.get(f"{API}/domains", params={"skill": "cobol"}, headers=ADMIN)).json()
        assert body == {"folders": [], "total": 0}

    FILTER_SETS = [
        {},
        {"skill": "python"},
        {"seniority": "senior"},
        {"search": "berlin"},
        {"search": "python lead"},
        {"status": "processed", "experience_min": 1},
        {"industry": "fintech"},
        {"salary_expectation_max": 100000},
        {"min_match_score": 0.3},
        {"worked_at_company": "google"},
    ]

    @pytest.mark.parametrize("filters", FILTER_SETS, ids=[str(f) for f in FILTER_SETS])
    async def test_every_folder_count_equals_what_the_list_returns_for_it(self, stocked, filters):
        folders = (await stocked.client.get(f"{API}/domains", params=filters, headers=ADMIN)).json()
        total = 0
        for folder in folders["folders"]:
            response = await listed(stocked, business_domain=folder["value"], **filters)
            assert response.json()["total"] == folder["count"], folder["value"]
            assert len(ids(response)) == folder["count"]
            total += folder["count"]
        assert folders["total"] == total
        assert (await listed(stocked, **filters)).json()["total"] == total

    async def test_other_companys_resumes_are_not_counted(self, stocked):
        body = (await stocked.client.get(f"{API}/domains", headers=ADMIN)).json()
        assert body["total"] == 6
        assert sum(f["count"] for f in body["folders"]) == 6

    async def test_an_empty_company_has_no_folders(self, world):
        body = (await world.client.get(f"{API}/domains", headers=ADMIN)).json()
        assert body == {"folders": [], "total": 0}


class TestSemanticSearch:

    @staticmethod
    def matches():
        return [("dee", 0.91234), ("ghost", 0.8), ("ada", 0.5), ("x1", 0.45), ("bob", 0.3)]

    async def ready(self, world, matches=None):
        use_embeddings(world)
        return use_pinecone(world, Index(self.matches() if matches is None else matches))

    async def test_results_keep_the_pinecone_order_and_carry_a_rounded_score(self, stocked):
        await self.ready(stocked)
        body = (await stocked.client.get(f"{API}/search/semantic", params={"q": " python lead "}, headers=ADMIN)).json()
        assert set(body) == {"resumes", "total", "query"}
        assert [(r["resume_id"], r["match_score"]) for r in body["resumes"]] == [
            ("dee", 0.9123), ("ada", 0.5), ("bob", 0.3),
        ]
        assert body["total"] == 3 and body["query"] == "python lead"

    async def test_rows_never_include_the_embedding_or_text(self, stocked):
        await self.ready(stocked)
        rows = (await stocked.client.get(f"{API}/search/semantic", params={"q": "python"}, headers=ADMIN)).json()["resumes"]
        assert rows and all(not ({"embedding", "text", "_id"} & set(r)) for r in rows)
        assert all(0 <= r["match_score"] <= 1 for r in rows)

    async def test_pinecone_is_asked_with_the_companys_filter_and_five_times_the_limit(self, stocked):
        index = await self.ready(stocked)
        embeddings = use_embeddings(stocked)
        await stocked.client.get(f"{API}/search/semantic", params={"q": "python dev"}, headers=ADMIN)
        (call,) = index.calls
        with tenancy.company_context(COMPANY):
            expected = vector_scope.query_filter("resume")
        assert call["filter"] == expected
        assert call["top_k"] == 100
        assert call["vector"] == [0.25, 0.5]
        assert call["namespace"] == ""
        assert call["include_metadata"] is False
        assert embeddings.calls[0]["input"] == "python dev"

    @pytest.mark.parametrize("limit, top_k", [(1, 5), (7, 35), (40, 200), (50, 200)])
    async def test_top_k_is_five_times_the_limit_capped_at_two_hundred(self, stocked, limit, top_k):
        index = await self.ready(stocked)
        await stocked.client.get(f"{API}/search/semantic", params={"q": "python", "limit": limit}, headers=ADMIN)
        assert index.calls[0]["top_k"] == top_k

    async def test_the_limit_cuts_the_results(self, stocked):
        await self.ready(stocked)
        rows = (await stocked.client.get(f"{API}/search/semantic", params={"q": "python", "limit": 2}, headers=ADMIN)).json()
        assert [r["resume_id"] for r in rows["resumes"]] == ["dee", "ada"]
        assert rows["total"] == 2

    @pytest.mark.parametrize("params, expected", [
        ({"skill": "go"}, ["bob"]),
        ({"business_domain": "data_ai"}, ["dee"]),
        ({"business_domain": "it_software"}, ["ada", "bob"]),
        ({"search": "berlin"}, ["dee", "ada"]),
        ({"seniority": "senior"}, ["ada"]),
        ({"experience_min": 5, "location": "berlin"}, ["dee", "ada"]),
        ({"min_match_score": 0.5, "job_id": "j1"}, ["ada"]),
        ({"business_domain": "not_a_domain"}, []),
        ({"department": "Data Scientist"}, ["dee"]),
        ({"industry": "healthcare"}, ["bob"]),
    ])
    async def test_the_same_filters_as_the_list_are_applied(self, stocked, params, expected):
        await self.ready(stocked)
        response = await stocked.client.get(f"{API}/search/semantic", params={"q": "python", **params}, headers=ADMIN)
        assert ids(response) == expected
        assert response.json()["total"] == len(expected)

    async def test_a_hit_from_another_company_is_never_returned(self, stocked):
        await self.ready(stocked, [("x1", 0.99), ("ada", 0.4)])
        response = await stocked.client.get(f"{API}/search/semantic", params={"q": "python"}, headers=ADMIN)
        assert ids(response) == ["ada"]

    async def test_no_hits_is_an_empty_result_not_an_error(self, stocked):
        await self.ready(stocked, [])
        body = (await stocked.client.get(f"{API}/search/semantic", params={"q": "python"}, headers=ADMIN)).json()
        assert body == {"resumes": [], "total": 0, "query": "python"}

    async def test_without_pinecone_the_answer_is_503_and_nothing_is_embedded(self, stocked):
        embeddings = use_embeddings(stocked)
        use_pinecone(stocked, None)
        response = await stocked.client.get(f"{API}/search/semantic", params={"q": "python"}, headers=ADMIN)
        assert response.status_code == 503
        assert response.json()["detail"] == UNAVAILABLE
        assert embeddings.calls == []
        assert stocked.raw.rows("cost_ledger", COMPANY) == []

    async def test_a_failed_embedding_is_503_and_pinecone_is_not_asked(self, stocked):
        embeddings = use_embeddings(stocked, ConnectionError("boom"))
        index = use_pinecone(stocked, Index(self.matches()))
        response = await stocked.client.get(f"{API}/search/semantic", params={"q": "python"}, headers=ADMIN)
        assert response.status_code == 503
        assert response.json()["detail"] == UNAVAILABLE
        assert len(embeddings.calls) == 1
        assert index.calls == []
        assert stocked.raw.rows("cost_ledger", COMPANY) == []

    async def test_a_zero_vector_is_treated_as_a_failed_embedding(self, stocked):
        use_embeddings(stocked, (0.0, 0.0))
        index = use_pinecone(stocked, Index(self.matches()))
        response = await stocked.client.get(f"{API}/search/semantic", params={"q": "python"}, headers=ADMIN)
        assert response.status_code == 503 and response.json()["detail"] == UNAVAILABLE
        assert index.calls == []

    async def test_a_pinecone_error_is_503_and_the_embedding_is_still_paid_for(self, stocked):
        use_embeddings(stocked)
        use_pinecone(stocked, Index(fail=True))
        response = await stocked.client.get(f"{API}/search/semantic", params={"q": "python"}, headers=ADMIN)
        assert response.status_code == 503 and response.json()["detail"] == UNAVAILABLE
        (entry,) = stocked.raw.rows("cost_ledger", COMPANY, source="resume_semantic_search")
        assert entry["embedding_calls"] == 1

    @pytest.mark.parametrize("params", [
        {}, {"q": ""}, {"q": "a"}, {"q": "   "}, {"q": " a "}, {"q": "x" * 301},
        {"q": "python", "limit": 0}, {"q": "python", "limit": 51}, {"q": "python", "limit": "many"},
    ])
    async def test_the_query_and_limit_are_validated(self, stocked, params):
        embeddings = use_embeddings(stocked)
        index = use_pinecone(stocked, Index(self.matches()))
        response = await stocked.client.get(f"{API}/search/semantic", params=params, headers=ADMIN)
        assert response.status_code == 422, params
        assert embeddings.calls == [] and index.calls == []

    async def test_the_edges_of_the_allowed_range_work(self, stocked):
        await self.ready(stocked)
        for params in ({"q": "ab"}, {"q": "x" * 300}, {"q": "python", "limit": 1}, {"q": "python", "limit": 50}):
            assert (await stocked.client.get(f"{API}/search/semantic", params=params, headers=ADMIN)).status_code == 200

    async def test_the_cost_of_the_search_is_recorded_under_its_own_source(self, stocked):
        await self.ready(stocked)
        await stocked.client.get(f"{API}/search/semantic", params={"q": "python"}, headers=ADMIN)
        (entry,) = stocked.raw.rows("cost_ledger", COMPANY)
        assert entry["source"] == "resume_semantic_search"
        assert entry["embedding_calls"] == 1 and entry["embedding_tokens"] == 1000
        assert entry["cost_usd"] > 0

    async def test_each_search_is_charged_to_the_company_that_ran_it(self, stocked):
        await self.ready(stocked)
        await stocked.client.get(f"{API}/search/semantic", params={"q": "python"}, headers=ADMIN)
        assert stocked.raw.rows("cost_ledger", OTHER) == []

    async def test_the_ai_action_quota_is_counted_once_per_search(self, stocked):
        await self.ready(stocked)
        await stocked.client.get(f"{API}/search/semantic", params={"q": "python"}, headers=ADMIN)
        stocked.quota.assert_awaited_once_with("resume_semantic_search", per_hour=300)

    async def test_a_company_over_its_allowance_is_refused_before_anything_is_embedded(self, stocked):
        stocked.quota.side_effect = HTTPException(429, "Too many attempts: please try again later")
        embeddings = use_embeddings(stocked)
        index = use_pinecone(stocked, Index(self.matches()))
        response = await stocked.client.get(f"{API}/search/semantic", params={"q": "python"}, headers=ADMIN)
        assert response.status_code == 429
        assert embeddings.calls == [] and index.calls == []

    async def test_matched_jobs_outside_the_users_department_are_hidden(self, stocked):
        stocked.raw.add("jobs", {"job_id": "j1", "department_id": "d1", "doc_type": "job"}, COMPANY)
        stocked.raw.add("jobs", {"job_id": "j2", "department_id": "d2", "doc_type": "job"}, COMPANY)
        stocked.monkeypatch.setattr(department_access, "get_department_scope", AsyncMock(return_value="d1"))
        await self.ready(stocked)
        rows = (await stocked.client.get(f"{API}/search/semantic", params={"q": "python"}, headers=ADMIN)).json()["resumes"]
        ada = next(r for r in rows if r["resume_id"] == "ada")
        assert [m["job_id"] for m in ada["matched_jds"]] == ["j1"]

    async def test_admin_only_fields_are_hidden_from_a_standard_user(self, stocked):
        await self.ready(stocked)
        admin = (await stocked.client.get(f"{API}/search/semantic", params={"q": "python"}, headers=ADMIN)).json()["resumes"]
        standard = (await stocked.client.get(f"{API}/search/semantic", params={"q": "python"}, headers=STANDARD)).json()["resumes"]
        assert next(r for r in admin if r["resume_id"] == "ada")["recruiter_notes"] == "strong hire"
        assert "recruiter_notes" not in next(r for r in standard if r["resume_id"] == "ada")
