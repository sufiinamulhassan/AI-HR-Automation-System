import uuid
from datetime import datetime, timedelta, timezone

import pytest
from passlib.context import CryptContext

from config.database import get_db

pytestmark = pytest.mark.anyio

pwd_ctx = CryptContext(schemes=["bcrypt"])


def _iso(days: float) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()


async def _insert_job(db, marker: str, label: str, *, deadline, department_id=None, salary_max=None, omit_deadline=False) -> str:
    job_id = f"{marker}-{label}"
    doc = {
        "doc_type": "job",
        "job_id": job_id,
        "title": f"{marker} {label}",
        "description": "Browse filter fixture.",
        "company_name": "Browse Test Corp",
        "salary_min": 1000,
        "salary_max": salary_max,
        "department_id": department_id,
        "parsed_criteria": {},
        "candidate_pipeline": [],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    if not omit_deadline:
        doc["deadline_at"] = deadline
    await db.jobs.insert_one(doc)
    return job_id


async def _remove_jobs(db, job_ids) -> None:
    for job_id in job_ids:
        await db.jobs.delete_one({"job_id": job_id})


@pytest.fixture
async def seeded():
    db = get_db()
    marker = f"jbrowse{uuid.uuid4().hex[:10]}"
    ids = {
        "open_null": await _insert_job(db, marker, "open-null", deadline=None, salary_max=100000),
        "open_absent": await _insert_job(db, marker, "open-absent", deadline=None, omit_deadline=True, salary_max=100000),
        "open_future": await _insert_job(db, marker, "open-future", deadline=_iso(10), salary_max=100000),
        "closed_a": await _insert_job(db, marker, "closed-a", deadline=_iso(-1), salary_max=50000),
        "closed_b": await _insert_job(db, marker, "closed-b", deadline=_iso(-30), salary_max=50000),
    }
    try:
        yield marker, ids
    finally:
        await _remove_jobs(db, ids.values())


async def _list(client, headers, marker, **params):
    resp = await client.get("/api/v1/jobs", params={"search": marker, "limit": 50, **params}, headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


def _ids(body) -> set:
    return {j["job_id"] for j in body["jobs"]}


async def test_default_is_unchanged_and_lists_every_job(client, admin_headers, seeded):
    marker, ids = seeded
    body = await _list(client, admin_headers, marker)
    assert _ids(body) == set(ids.values())
    assert body["total"] == 5
    assert body["page"] == 1 and body["limit"] == 50
    assert {"jobs", "total", "page", "limit"} <= set(body)
    assert set(body) == {"jobs", "total", "page", "limit", "counts"}


async def test_status_all_and_blank_match_default(client, admin_headers, seeded):
    marker, _ = seeded
    default = await _list(client, admin_headers, marker)
    explicit = await _list(client, admin_headers, marker, status="all")
    blank = await _list(client, admin_headers, marker, status="")
    assert _ids(explicit) == _ids(default) == _ids(blank)
    assert explicit["total"] == default["total"] == blank["total"] == 5


async def test_open_filter_returns_only_open_jobs(client, admin_headers, seeded):
    marker, ids = seeded
    body = await _list(client, admin_headers, marker, status="open")
    assert _ids(body) == {ids["open_null"], ids["open_absent"], ids["open_future"]}
    assert body["total"] == 3


async def test_closed_filter_returns_only_closed_jobs(client, admin_headers, seeded):
    marker, ids = seeded
    body = await _list(client, admin_headers, marker, status="closed")
    assert _ids(body) == {ids["closed_a"], ids["closed_b"]}
    assert body["total"] == 2


async def test_status_value_is_case_insensitive(client, admin_headers, seeded):
    marker, ids = seeded
    body = await _list(client, admin_headers, marker, status="  CLOSED ")
    assert _ids(body) == {ids["closed_a"], ids["closed_b"]}


async def test_unknown_status_is_rejected(client, admin_headers, seeded):
    marker, _ = seeded
    resp = await client.get("/api/v1/jobs", params={"search": marker, "status": "archived"}, headers=admin_headers)
    assert resp.status_code == 400
    assert "open, closed, all" in resp.json()["detail"]


async def test_counts_ignore_the_status_filter(client, admin_headers, seeded):
    marker, _ = seeded
    expected = {"open": 3, "closed": 2, "all": 5}
    for status in (None, "all", "open", "closed"):
        params = {} if status is None else {"status": status}
        body = await _list(client, admin_headers, marker, **params)
        assert body["counts"] == expected, f"status={status}"


async def test_counts_follow_search(client, admin_headers, seeded):
    marker, _ = seeded
    other = f"jbrowse{uuid.uuid4().hex[:10]}"
    db = get_db()
    other_id = await _insert_job(db, other, "closed-only", deadline=_iso(-2))
    try:
        mine = await _list(client, admin_headers, marker)
        theirs = await _list(client, admin_headers, other)
        assert mine["counts"] == {"open": 3, "closed": 2, "all": 5}
        assert theirs["counts"] == {"open": 0, "closed": 1, "all": 1}
        assert _ids(theirs) == {other_id}
    finally:
        await _remove_jobs(db, [other_id])


async def test_counts_follow_the_other_filters_too(client, admin_headers, seeded):
    marker, ids = seeded
    body = await _list(client, admin_headers, marker, salary_min=80000)
    assert body["counts"] == {"open": 3, "closed": 0, "all": 3}
    closed = await _list(client, admin_headers, marker, salary_min=80000, status="closed")
    assert closed["jobs"] == [] and closed["total"] == 0
    assert closed["counts"] == {"open": 3, "closed": 0, "all": 3}


async def test_pagination_applies_within_the_filtered_set(client, admin_headers, seeded):
    marker, ids = seeded
    page1 = await _list(client, admin_headers, marker, status="open", limit=2, page=1)
    page2 = await _list(client, admin_headers, marker, status="open", limit=2, page=2)
    assert len(page1["jobs"]) == 2 and len(page2["jobs"]) == 1
    assert _ids(page1) | _ids(page2) == {ids["open_null"], ids["open_absent"], ids["open_future"]}
    assert page1["total"] == page2["total"] == 3
    assert page2["page"] == 2 and page2["limit"] == 2
    assert page1["counts"] == page2["counts"] == {"open": 3, "closed": 2, "all": 5}


async def test_standard_user_can_filter_and_see_counts(client, standard_headers, seeded):
    marker, ids = seeded
    body = await _list(client, standard_headers, marker, status="open")
    assert body["total"] == 3
    assert body["counts"] == {"open": 3, "closed": 2, "all": 5}


async def _make_scoped_user(client, db, *, department_id: str):
    email = f"browse-dept-{uuid.uuid4().hex[:10]}@example.com"
    password = "Test@12345"
    await db.users.insert_one({
        "name": "Browse Scoped User", "email": email, "password_hash": pwd_ctx.hash(password),
        "role": "standard", "department_id": department_id, "otp_required": False, "is_active": True,
    })
    resp = await client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}, email


async def test_department_scoping_is_unaffected_by_status_and_counts(client, admin_headers):
    db = get_db()
    marker = f"jbrowse{uuid.uuid4().hex[:10]}"
    dept_a, dept_b = f"dept-a-{uuid.uuid4().hex[:6]}", f"dept-b-{uuid.uuid4().hex[:6]}"
    ids = {
        "a_open": await _insert_job(db, marker, "a-open", deadline=_iso(5), department_id=dept_a),
        "a_closed": await _insert_job(db, marker, "a-closed", deadline=_iso(-5), department_id=dept_a),
        "b_open": await _insert_job(db, marker, "b-open", deadline=_iso(5), department_id=dept_b),
        "b_closed": await _insert_job(db, marker, "b-closed", deadline=_iso(-5), department_id=dept_b),
        "none_open": await _insert_job(db, marker, "none-open", deadline=None, department_id=None),
        "none_closed": await _insert_job(db, marker, "none-closed", deadline=_iso(-5), department_id=None),
    }
    scoped_headers, email = await _make_scoped_user(client, db, department_id=dept_a)
    try:
        everything = await _list(client, admin_headers, marker)
        assert _ids(everything) == set(ids.values())
        assert everything["counts"] == {"open": 3, "closed": 3, "all": 6}

        visible = {ids["a_open"], ids["a_closed"], ids["none_open"], ids["none_closed"]}
        scoped_all = await _list(client, scoped_headers, marker)
        assert _ids(scoped_all) == visible
        assert scoped_all["counts"] == {"open": 2, "closed": 2, "all": 4}

        scoped_open = await _list(client, scoped_headers, marker, status="open")
        assert _ids(scoped_open) == {ids["a_open"], ids["none_open"]}
        assert scoped_open["total"] == 2
        assert scoped_open["counts"] == {"open": 2, "closed": 2, "all": 4}

        scoped_closed = await _list(client, scoped_headers, marker, status="closed")
        assert _ids(scoped_closed) == {ids["a_closed"], ids["none_closed"]}
        assert ids["b_open"] not in _ids(scoped_closed) and ids["b_closed"] not in _ids(scoped_closed)
    finally:
        await _remove_jobs(db, ids.values())
        await db.users.delete_one({"email": email})


@pytest.fixture
async def literal_jobs():
    db = get_db()
    marker = f"jlit{uuid.uuid4().hex[:10]}"
    future = _iso(30)
    ids = {
        "cpp": await _insert_job(db, marker, "C++ Developer", deadline=future),
        "cook": await _insert_job(db, marker, "Cook", deadline=future),
        "paren": await _insert_job(db, marker, "Analyst (Remote)", deadline=future),
        "bracket": await _insert_job(db, marker, "Tester [QA]", deadline=future),
        "dotted": await _insert_job(db, marker, "Dotted a.b.c", deadline=future),
        "undotted": await _insert_job(db, marker, "Dotted axbxc", deadline=future),
    }
    try:
        yield marker, ids
    finally:
        await _remove_jobs(db, ids.values())


@pytest.mark.parametrize("term", ["c++", "(", "[", ".*", "\\", "a|b", "$", "?"])
async def test_search_with_regex_metacharacters_never_errors(client, admin_headers, term):
    resp = await client.get("/api/v1/jobs", params={"search": term}, headers=admin_headers)
    assert resp.status_code == 200, f"search={term!r}: {resp.text}"


async def test_search_matches_literal_text_only(client, admin_headers, literal_jobs):
    marker, ids = literal_jobs

    async def found(term):
        body = await _list(client, admin_headers, f"{marker} {term}")
        return _ids(body)

    assert await found("C++") == {ids["cpp"]}
    assert await found("c++ dev") == {ids["cpp"]}
    assert await found("Analyst (") == {ids["paren"]}
    assert await found("Tester [") == {ids["bracket"]}
    assert await found("Tester [QA]") == {ids["bracket"]}
    assert await found(".*") == set()
    assert await found("Dotted a.b.c") == {ids["dotted"]}


async def test_search_still_finds_normal_text_case_insensitively(client, admin_headers, literal_jobs):
    marker, ids = literal_jobs
    body = await _list(client, admin_headers, marker.upper())
    assert _ids(body) == set(ids.values())
    assert _ids(await _list(client, admin_headers, f"{marker} COOK")) == {ids["cook"]}
    assert _ids(await _list(client, admin_headers, "Browse Test Corp", limit=100)) >= set(ids.values())
