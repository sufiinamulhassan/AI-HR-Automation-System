import uuid
from datetime import datetime, timezone

import pytest

from config.database import get_db

pytestmark = pytest.mark.anyio

PARAMS = ["location", "skill", "certification", "notice_period", "worked_at_company"]


@pytest.fixture
async def resumes():
    db = get_db()
    marker = f"rlit{uuid.uuid4().hex[:10]}"
    now = datetime.now(timezone.utc).isoformat()
    first = {
        "resume_id": f"{marker}-1", "candidate_name": f"{marker} First", "filename": f"{marker}-1.pdf",
        "processing_status": "processed", "created_at": now,
        "location": "New York (NY)",
        "classification": {"skills": ["C++", "Python"]},
        "certifications": ["AWS (SAA-C03)"],
        "notice_period": "30 days (negotiable)",
        "experience": [{"company": "A+B Corp"}],
    }
    second = {
        "resume_id": f"{marker}-2", "candidate_name": f"{marker} Second", "filename": f"{marker}-2.pdf",
        "processing_status": "processed", "created_at": now,
        "location": "Newark",
        "classification": {"skills": ["Cobol"]},
        "certifications": ["PMP"],
        "notice_period": "15 days",
        "experience": [{"company": "AAB Corp"}],
    }
    await db.resumes.insert_one(first)
    await db.resumes.insert_one(second)
    try:
        yield marker, first["resume_id"], second["resume_id"]
    finally:
        for rid in (first["resume_id"], second["resume_id"]):
            await db.resumes.delete_one({"resume_id": rid})


async def _ids(client, headers, marker, **params):
    resp = await client.get("/api/v1/resumes", params={"search": marker, "limit": 100, **params}, headers=headers)
    assert resp.status_code == 200, f"{params}: {resp.text}"
    return {r["resume_id"] for r in resp.json()["resumes"]}


@pytest.mark.parametrize("param", PARAMS)
@pytest.mark.parametrize("term", ["(", "[", "c++", ".*", "\\", "a|b"])
async def test_filter_with_regex_metacharacters_never_errors(client, standard_headers, param, term):
    resp = await client.get("/api/v1/resumes", params={param: term}, headers=standard_headers)
    assert resp.status_code == 200, f"{param}={term!r}: {resp.text}"


@pytest.mark.parametrize("param,term", [
    ("location", "(NY)"),
    ("skill", "c++"),
    ("certification", "(SAA"),
    ("notice_period", "(negotiable)"),
    ("worked_at_company", "A+B"),
])
async def test_filter_matches_only_the_literal_text(client, standard_headers, resumes, param, term):
    marker, first, second = resumes
    assert await _ids(client, standard_headers, marker, **{param: term}) == {first}


@pytest.mark.parametrize("param", PARAMS)
async def test_dot_star_is_not_a_wildcard(client, standard_headers, resumes, param):
    marker, _first, _second = resumes
    assert await _ids(client, standard_headers, marker, **{param: ".*"}) == set()


@pytest.mark.parametrize("param,term,expected_first", [
    ("location", "new york", True),
    ("skill", "PYTHON", True),
    ("certification", "pmp", False),
    ("notice_period", "DAYS", None),
    ("worked_at_company", "corp", None),
])
async def test_normal_text_is_still_a_case_insensitive_substring(client, standard_headers, resumes, param, term, expected_first):
    marker, first, second = resumes
    got = await _ids(client, standard_headers, marker, **{param: term})
    if expected_first is None:
        assert got == {first, second}
    else:
        assert got == ({first} if expected_first else {second})
