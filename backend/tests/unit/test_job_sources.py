"""Tests for external JD source connectors — hr_module."""
import pytest
from unittest.mock import MagicMock, patch

pytestmark = pytest.mark.anyio


class _FakeResp:
    def __init__(self, data): self._data = data
    def raise_for_status(self): pass
    def json(self): return self._data


class _FakeClient:
    def __init__(self, data): self._data = data
    async def __aenter__(self): return self
    async def __aexit__(self, *a): return False
    async def get(self, _url, params=None): return _FakeResp(self._data)


def test_list_sources_marks_free_vs_keyed():
    from services.hr_module.job_sources import list_sources
    by_id = {s["id"]: s for s in list_sources()}
    assert by_id["remotive"]["configured"] is True
    assert by_id["arbeitnow"]["configured"] is True
    assert by_id["linkedin"]["requires_key"] is True
    assert by_id["linkedin"]["configured"] is False


def test_list_sources_includes_dice_careerbuilder_indeed():
    from services.hr_module.job_sources import SOURCES, list_sources

    by_source = {s["id"]: s for s in SOURCES}
    assert by_source["dice"]["requires_key"] is True
    assert by_source["dice"]["key"] == "DICE_API_KEY"
    assert by_source["careerbuilder"]["requires_key"] is True
    assert by_source["careerbuilder"]["key"] == "CAREERBUILDER_API_KEY"
    assert by_source["indeed"]["requires_key"] is True
    assert by_source["indeed"]["key"] == "INDEED_API_KEY"

    by_id = {s["id"]: s for s in list_sources()}
    for source_id in ("dice", "careerbuilder", "indeed"):
        assert by_id[source_id]["requires_key"] is True
        assert by_id[source_id]["configured"] is False


@pytest.mark.parametrize("source_id", ["dice", "careerbuilder", "indeed"])
async def test_new_keyed_sources_not_configured_raise(source_id):
    from services.hr_module.job_sources import fetch_jobs, JobSourceNotConfigured
    with pytest.raises(JobSourceNotConfigured):
        await fetch_jobs(source_id, query="engineer", limit=2)


def test_extract_salary_range_dollar_comma():
    from services.hr_module.job_sources import extract_salary_range
    assert extract_salary_range(
        "We offer a competitive salary of $80,000 - $120,000 per year plus benefits."
    ) == (80000, 120000)


def test_extract_salary_range_k_suffix():
    from services.hr_module.job_sources import extract_salary_range
    assert extract_salary_range("Compensation: 80k-120k depending on experience.") == (80000, 120000)


def test_extract_salary_range_gbp_to():
    from services.hr_module.job_sources import extract_salary_range
    assert extract_salary_range("Salary £45,000 to £60,000 depending on seniority.") == (45000, 60000)


def test_extract_salary_range_usd_plain_numbers():
    from services.hr_module.job_sources import extract_salary_range
    assert extract_salary_range("Pay range: USD 90000-110000 annually.") == (90000, 110000)


def test_extract_salary_range_reversed_order_normalised():
    from services.hr_module.job_sources import extract_salary_range
    assert extract_salary_range("Budget $120,000 - $80,000 for this role.") == (80000, 120000)


def test_extract_salary_range_no_salary_info():
    from services.hr_module.job_sources import extract_salary_range
    assert extract_salary_range(
        "We are looking for a Senior Python Developer with 5+ years of experience."
    ) == (None, None)


def test_extract_salary_range_empty_text():
    from services.hr_module.job_sources import extract_salary_range
    assert extract_salary_range("") == (None, None)


def test_strip_html_removes_tags():
    from services.hr_module.job_sources import _strip_html
    out = _strip_html("<p>Build <b>pipelines</b></p><ul><li>AWS</li></ul>")
    assert "<" not in out and ">" not in out
    assert "Build" in out and "AWS" in out


async def test_keyed_source_not_configured_raises():
    from services.hr_module.job_sources import fetch_jobs, JobSourceNotConfigured
    with pytest.raises(JobSourceNotConfigured):
        await fetch_jobs("linkedin", query="x", limit=2)


async def test_remotive_normalises_jobs():
    from services.hr_module import job_sources as js
    data = {"jobs": [{
        "title": "DevOps Engineer",
        "company_name": "Acme",
        "candidate_required_location": "USA",
        "job_type": "full_time",
        "description": "<p>Build <b>pipelines</b></p><ul><li>AWS</li></ul>",
        "url": "https://example.com/jobs/1",
    }]}
    with patch.object(js.httpx, "AsyncClient", MagicMock(return_value=_FakeClient(data))):
        jobs = await js.fetch_jobs("remotive", query="devops", limit=5)

    assert len(jobs) == 1
    j = jobs[0]
    assert j["title"] == "DevOps Engineer"
    assert j["company_name"] == "Acme"
    assert j["employment_type"] == "full-time"
    assert j["is_remote"] is True
    assert j["source_url"] == "https://example.com/jobs/1"
    assert "<" not in j["description"]


async def test_remoteok_skips_metadata_row():
    from services.hr_module import job_sources as js
    data = [
        {"legal": "metadata, no position"},
        {"position": "Backend Engineer", "company": "Acme", "location": "Worldwide",
         "description": "<p>Go, Postgres</p>", "url": "https://remoteok.com/x"},
    ]
    with patch.object(js.httpx, "AsyncClient", MagicMock(return_value=_FakeClient(data))):
        jobs = await js.fetch_jobs("remoteok", query="engineer", limit=10)
    assert len(jobs) == 1
    assert jobs[0]["title"] == "Backend Engineer" and jobs[0]["is_remote"] is True
    assert "<" not in jobs[0]["description"]


async def test_themuse_normalises():
    from services.hr_module import job_sources as js
    data = {"results": [{
        "name": "Data Engineer", "contents": "<p>Spark, Airflow</p>",
        "company": {"name": "X"}, "locations": [{"name": "Remote"}],
        "type": "Full Time", "refs": {"landing_page": "https://themuse.com/x"},
    }]}
    with patch.object(js.httpx, "AsyncClient", MagicMock(return_value=_FakeClient(data))):
        jobs = await js.fetch_jobs("themuse", query="engineer", limit=10)
    assert any(j["title"] == "Data Engineer" for j in jobs)
    j = next(j for j in jobs if j["title"] == "Data Engineer")
    assert j["employment_type"] == "full-time" and j["is_remote"] is True


async def test_jobicy_normalises_list_jobtype():
    from services.hr_module import job_sources as js
    data = {"jobs": [{
        "jobTitle": "ML Engineer", "companyName": "Y", "jobGeo": "USA",
        "jobType": ["full_time"], "jobDescription": "<p>PyTorch</p>", "url": "https://jobicy.com/x",
    }]}
    with patch.object(js.httpx, "AsyncClient", MagicMock(return_value=_FakeClient(data))):
        jobs = await js.fetch_jobs("jobicy", query="engineer", limit=10)
    assert len(jobs) == 1
    assert jobs[0]["title"] == "ML Engineer" and jobs[0]["employment_type"] == "full-time"


async def test_arbeitnow_filters_by_query():
    from services.hr_module import job_sources as js
    data = {"data": [
        {"title": "Java Developer", "company_name": "X", "location": "Berlin",
         "description": "<p>Java Spring</p>", "url": "u1", "job_types": ["full_time"], "remote": False},
        {"title": "Marketing Lead", "company_name": "Y", "location": "Berlin",
         "description": "<p>SEO</p>", "url": "u2", "job_types": ["full_time"], "remote": True},
    ]}
    with patch.object(js.httpx, "AsyncClient", MagicMock(return_value=_FakeClient(data))):
        jobs = await js.fetch_jobs("arbeitnow", query="java", limit=10)

    assert len(jobs) == 1
    assert jobs[0]["title"] == "Java Developer"
