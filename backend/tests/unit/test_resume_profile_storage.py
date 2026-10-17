from unittest.mock import MagicMock

import pytest

import config.database as database
from config import tenancy
from config.tenancy import DEFAULT_COMPANY_ID, company_context
from fake_mongo import FakeRaw
from services.hr_module import resume_intel
from services.hr_module.resume_intel import resume_vector_metadata, store_resume
from services.hr_module.resume_profile import CLASSIFICATION_KEYS, PROFILE_KEYS

pytestmark = pytest.mark.anyio

COMPANY = "cmp_store_a"
OTHER = "cmp_store_b"

SEVEN = {
    "job_domain": "data_engineering",
    "seniority_level": "senior",
    "skills": ["Spark", "Kafka", "Airflow"],
    "confidence": 0.91,
    "years_experience": 9,
    "education_level": "master",
    "industry": "fintech",
}
FOUR = {
    "headline": "Senior Data Engineer",
    "location": "Lahore, Pakistan",
    "experience": [{"title": "Senior Data Engineer", "company": "Acme Payments"}],
}
TEXT = "Ali Raza\nali.raza@example.com\nSenior Data Engineer with nine years of experience building Spark pipelines."


def state(classification, **over):
    base = {
        "resume_id": "res-1",
        "filename": "ali_raza.pdf",
        "text": TEXT,
        "raw_bytes": b"",
        "classification": classification,
        "embedding": [0.1, 0.2, 0.3],
        "matched_jds": [],
    }
    base.update(over)
    return base


@pytest.fixture
def world(monkeypatch):
    raw = FakeRaw()
    pinecone = MagicMock()
    monkeypatch.setattr(database, "_db", raw)
    monkeypatch.setattr(resume_intel, "get_pinecone", lambda: pinecone)
    tenancy.use_fallback_company(None)
    yield raw, pinecone
    tenancy.use_fallback_company(DEFAULT_COMPANY_ID)


async def stored(world, classification, company=COMPANY, **over):
    raw, _ = world
    with company_context(company):
        await store_resume(state(classification, **over))
    (doc,) = raw.rows("resumes", company_id=company)
    return doc


async def test_the_profile_fields_are_written_at_the_top_level(world):
    doc = await stored(world, {**SEVEN, **FOUR})
    assert doc["headline"] == "Senior Data Engineer"
    assert doc["location"] == "Lahore, Pakistan"
    assert doc["experience"] == [{"title": "Senior Data Engineer", "company": "Acme Payments"}]
    assert doc["profile_version"] == 1


async def test_certifications_are_not_written_even_if_the_state_carries_them(world):
    doc = await stored(world, {**SEVEN, **FOUR, "certifications": ["AWS Certified Data Analytics"]})
    assert "certifications" not in doc
    assert "certifications" not in doc["classification"]


async def test_a_resume_that_already_has_certifications_keeps_them_when_it_is_stored_again(world):
    raw, _ = world
    raw.add("resumes", {"resume_id": "res-1", "certifications": ["Existing Cert"], "text": "old"}, COMPANY)
    doc = await stored(world, {**SEVEN, **FOUR})
    assert doc["certifications"] == ["Existing Cert"]
    assert doc["department"] == "Data Engineer"


async def test_the_classification_keeps_exactly_its_seven_keys(world):
    doc = await stored(world, {**SEVEN, **FOUR})
    assert doc["classification"] == SEVEN
    assert list(doc["classification"]) == list(CLASSIFICATION_KEYS)
    assert not set(PROFILE_KEYS) & set(doc["classification"])


async def test_department_is_derived_by_rules(world):
    doc = await stored(world, {**SEVEN, **FOUR})
    assert doc["department"] == "Data Engineer"


async def test_a_model_supplied_department_is_ignored(world):
    doc = await stored(world, {**SEVEN, **FOUR, "department": "Wizard"})
    assert doc["department"] == "Data Engineer"
    assert "department" not in doc["classification"]


async def test_notice_period_and_availability_are_not_written(world):
    doc = await stored(world, {**SEVEN, **FOUR, "notice_period": "Immediate joiner", "availability_status": "immediate"})
    assert "notice_period" not in doc and "availability_status" not in doc
    assert "notice_period" not in doc["classification"] and "availability_status" not in doc["classification"]


async def test_a_resume_that_already_has_notice_period_and_availability_keeps_them_when_stored_again(world):
    raw, _ = world
    raw.add(
        "resumes",
        {"resume_id": "res-1", "notice_period": "30 days", "availability_status": "within_30_days", "text": "old"},
        COMPANY,
    )
    doc = await stored(world, {**SEVEN, **FOUR})
    assert doc["notice_period"] == "30 days" and doc["availability_status"] == "within_30_days"
    assert doc["department"] == "Data Engineer"


async def test_a_missing_headline_derives_the_department_from_the_first_experience_title(world):
    doc = await stored(world, {**SEVEN, **FOUR, "headline": None, "experience": [{"title": "QA Lead", "company": "Acme"}]})
    assert doc["headline"] is None
    assert doc["department"] == "QA Engineer"


async def test_older_flows_without_the_new_keys_store_safe_defaults(world):
    doc = await stored(world, dict(SEVEN))
    assert doc["headline"] is None and doc["location"] is None
    assert doc["experience"] == []
    assert doc["profile_version"] == 1
    assert doc["department"] == "Data Engineering"
    assert doc["classification"] == SEVEN


async def test_a_partial_classification_without_new_keys_is_stored_as_it_was(world):
    legacy = {"job_domain": "software_engineering", "seniority_level": "senior", "skills": ["Python"], "confidence": 0.9}
    doc = await stored(world, legacy)
    assert doc["classification"] == legacy
    assert doc["department"] == "Software Engineering"


async def test_an_empty_classification_gives_no_department(world):
    doc = await stored(world, {})
    assert doc["classification"] == {}
    assert doc["department"] is None
    assert doc["profile_version"] == 1


async def test_a_missing_classification_does_not_raise(world):
    raw, _ = world
    with company_context(COMPANY):
        await store_resume({k: v for k, v in state({}).items() if k != "classification"})
    (doc,) = raw.rows("resumes", company_id=COMPANY)
    assert doc["classification"] == {} and doc["department"] is None


async def test_wrong_typed_profile_values_are_stored_as_defaults(world):
    doc = await stored(world, {
        **SEVEN, "headline": 12, "location": ["x"], "experience": "x",
    })
    assert doc["headline"] is None and doc["location"] is None
    assert doc["experience"] == []
    assert doc["department"] == "Data Engineering"


async def test_oversize_values_are_capped_again_at_storage(world):
    doc = await stored(world, {
        **SEVEN,
        "experience": [{"title": f"t{i}", "company": f"c{i}"} for i in range(30)],
    })
    assert len(doc["experience"]) == 8


async def test_the_other_resume_fields_are_unchanged(world):
    doc = await stored(world, {**SEVEN, **FOUR})
    assert doc["doc_type"] == "resume" and doc["resume_id"] == "res-1"
    assert doc["candidate_name"] == "Ali Raza" and doc["candidate_email"] == "ali.raza@example.com"
    assert doc["text"] == TEXT and doc["embedding"] == [0.1, 0.2, 0.3]
    assert doc["processing_status"] == "processed" and doc["version"] == 1 and doc["superseded_by"] is None


async def test_pinecone_metadata_is_exactly_what_it_was(world):
    _, pinecone = world
    await stored(world, {**SEVEN, **FOUR})
    metadata = pinecone.upsert.call_args.kwargs["vectors"][0]["metadata"]
    with company_context(COMPANY):
        expected = resume_vector_metadata(SEVEN, TEXT)
    assert metadata == expected
    assert metadata["company_id"] == COMPANY
    assert set(metadata) == {
        "doc_type", "job_domain", "seniority_level", "skills", "confidence",
        "years_experience", "education_level", "text_snippet", "company_id", "embedding_model",
    }
    for key in [*PROFILE_KEYS, "department", "notice_period", "availability_status", "profile_version"]:
        assert key not in metadata


async def test_pinecone_metadata_is_the_same_with_and_without_the_new_keys(world):
    _, pinecone = world
    await stored(world, {**SEVEN, **FOUR}, company=COMPANY, resume_id="res-with")
    with_keys = pinecone.upsert.call_args.kwargs["vectors"][0]["metadata"]
    await stored(world, dict(SEVEN), company=OTHER, resume_id="res-without")
    without = pinecone.upsert.call_args.kwargs["vectors"][0]["metadata"]
    assert {k: v for k, v in with_keys.items() if k != "company_id"} == {k: v for k, v in without.items() if k != "company_id"}


async def test_no_pinecone_upsert_without_an_embedding_but_the_profile_is_still_stored(world):
    _, pinecone = world
    doc = await stored(world, {**SEVEN, **FOUR}, embedding=[])
    pinecone.upsert.assert_not_called()
    assert doc["department"] == "Data Engineer"


async def test_the_profile_is_stored_for_the_company_in_context_only(world):
    raw, _ = world
    await stored(world, {**SEVEN, **FOUR}, company=COMPANY, resume_id="res-a")
    await stored(world, {**SEVEN, "headline": "Accountant"}, company=OTHER, resume_id="res-b")
    (a,) = raw.rows("resumes", company_id=COMPANY)
    (b,) = raw.rows("resumes", company_id=OTHER)
    assert a["resume_id"] == "res-a" and a["department"] == "Data Engineer"
    assert b["resume_id"] == "res-b" and b["department"] == "Accountant"


async def test_a_second_upload_by_the_same_person_keeps_both_profiles(world):
    raw, _ = world
    with company_context(COMPANY):
        await store_resume(state({**SEVEN, **FOUR}, resume_id="res-1"))
        await store_resume(state({**SEVEN, **FOUR, "headline": "Engineering Manager"}, resume_id="res-2"))
    docs = {d["resume_id"]: d for d in raw.rows("resumes", company_id=COMPANY)}
    assert docs["res-1"]["department"] == "Data Engineer" and docs["res-1"]["superseded_by"] == "res-2"
    assert docs["res-2"]["department"] == "Engineering Manager" and docs["res-2"]["version"] == 2
