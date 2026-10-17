from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from config.settings import settings
from config.tenancy import company_context
from services.hr_module import domains_service
from services.hr_module.domains_service import DomainError, normalize_domains
from shared import links, tenant_deps
from shared.links import base_url, valid_hostname

pytestmark = pytest.mark.anyio


@pytest.fixture(autouse=True)
def product_address(monkeypatch):
    monkeypatch.setattr(settings, "FRONTEND_URL", "https://app.hrbot.example")


@pytest.mark.parametrize("value,expected", [
    ("careers.acme.com", "careers.acme.com"),
    ("  Careers.ACME.com ", "careers.acme.com"),
    ("acme.com\n", "acme.com"),
    ("jobs.acme.co.uk", "jobs.acme.co.uk"),
    ("a-b.c-d.example", "a-b.c-d.example"),
    ("xn--bcher-kva.example", "xn--bcher-kva.example"),
    ("1.example.com", "1.example.com"),
    ("a" * 63 + ".example.com", "a" * 63 + ".example.com"),
])
def test_valid_host_names_are_lower_cased(value, expected):
    assert valid_hostname(value) == expected


@pytest.mark.parametrize("value", [
    "", " ", None, 42, "localhost", "acme", "acme.com.", ".acme.com", "acme..com",
    "https://acme.com", "http://acme.com", "acme.com/jobs", "acme.com:8080", "user@acme.com", "acme.com?x=1",
    "acme.com#top", "ac me.com", "acme.com\nx", "acme.com\r\nHost: evil", "-acme.com", "acme-.com", "ac_me.com",
    "192.168.1.1", "10.0.0.5", "1.2.3.4", "[::1]", "::1", "acme.123", "bücher.example", "a" * 64 + ".example.com",
    ("a" * 60 + ".") * 5 + "com", "*.acme.com",
])
def test_everything_else_is_refused(value):
    assert valid_hostname(value) is None


def test_a_domain_list_is_cleaned_deduplicated_and_capped():
    assert normalize_domains(["Careers.Acme.com", "jobs.acme.com", "careers.acme.com"]) == ["careers.acme.com", "jobs.acme.com"]
    assert normalize_domains([]) == [] and normalize_domains(None) == []
    five = [f"h{i}.acme.com" for i in range(5)]
    assert normalize_domains(five) == five
    with pytest.raises(DomainError, match="at most 5"):
        normalize_domains(five + ["h5.acme.com"])
    assert len(normalize_domains(five + five)) == 5


@pytest.mark.parametrize("bad", ["https://careers.acme.com", "careers.acme.com/jobs", "192.168.0.1", "careers", ""])
def test_a_bad_entry_names_itself_in_a_plain_sentence(bad):
    with pytest.raises(DomainError) as refused:
        normalize_domains(["ok.acme.com", bad])
    assert "not a valid domain" in str(refused.value) and "\n" not in str(refused.value)


def test_a_domain_list_must_be_a_list():
    with pytest.raises(DomainError):
        normalize_domains("careers.acme.com")


def test_the_products_own_address_can_never_be_a_company_domain():
    with pytest.raises(DomainError, match="product itself"):
        normalize_domains(["App.HRBot.example"])


class _Companies:
    def __init__(self, others=()):
        self.others = list(others)
        self.updates = []
        self.raise_on_update = None

    async def find_one(self, flt, projection=None):
        wanted = set(flt["custom_domains"]["$in"])
        for company_id, domains in self.others:
            if company_id != flt["company_id"]["$ne"] and wanted & set(domains):
                return {"company_id": company_id}
        return None

    async def update_one(self, flt, update):
        if self.raise_on_update:
            raise self.raise_on_update
        self.updates.append((flt, update))


@pytest.fixture
def directory(monkeypatch):
    companies = _Companies(others=[("cmp_other", ["taken.example.com"])])
    monkeypatch.setattr(domains_service, "get_platform_db", lambda: SimpleNamespace(companies=companies))
    state = {"company": {"company_id": "cmp_acme", "kind": "workspace", "client_plan": {}}}

    async def load(company_id):
        return state["company"] if company_id == "cmp_acme" else None

    monkeypatch.setattr(domains_service, "load_company", load)
    companies.state = state
    return companies


async def test_domains_are_saved_cleaned(directory):
    saved = await domains_service.set_domains("cmp_acme", ["Careers.Acme.com", "careers.acme.com"])
    assert saved == ["careers.acme.com"]
    assert directory.updates == [({"company_id": "cmp_acme"}, {"$set": {"custom_domains": ["careers.acme.com"]}})]


async def test_a_domain_another_company_uses_is_a_409(directory):
    with pytest.raises(HTTPException) as refused:
        await domains_service.set_domains("cmp_acme", ["fresh.example.com", "TAKEN.example.com"])
    assert refused.value.status_code == 409 and refused.value.detail == "That domain is already used by another company."
    assert directory.updates == []


async def test_the_unique_index_decides_a_race(directory):
    directory.raise_on_update = RuntimeError("E11000 duplicate key error collection: companies index: custom_domains_unique")
    with pytest.raises(HTTPException) as refused:
        await domains_service.set_domains("cmp_acme", ["fresh.example.com"])
    assert refused.value.status_code == 409 and refused.value.detail == domains_service.CONFLICT_MESSAGE
    directory.raise_on_update = RuntimeError("connection reset")
    with pytest.raises(RuntimeError):
        await domains_service.set_domains("cmp_acme", ["fresh.example.com"])


async def test_a_plan_without_custom_domains_is_a_402_but_clearing_is_always_allowed(directory):
    directory.state["company"] = {
        "company_id": "cmp_acme", "kind": "workspace", "client_plan": {"features": {"custom_domain": False}},
    }
    with pytest.raises(HTTPException) as refused:
        await domains_service.set_domains("cmp_acme", ["careers.acme.com"])
    assert refused.value.status_code == 402 and "custom domain" in refused.value.detail
    assert await domains_service.set_domains("cmp_acme", []) == []
    assert directory.updates[-1][1] == {"$set": {"custom_domains": []}}


async def test_an_invalid_list_is_a_400_and_an_unknown_or_platform_company_a_404(directory):
    with pytest.raises(HTTPException) as bad:
        await domains_service.set_domains("cmp_acme", ["https://careers.acme.com"])
    assert bad.value.status_code == 400
    with pytest.raises(HTTPException) as missing:
        await domains_service.set_domains("cmp_nobody", ["careers.acme.com"])
    assert missing.value.status_code == 404
    directory.state["company"]["kind"] = "platform"
    with pytest.raises(HTTPException) as platform:
        await domains_service.set_domains("cmp_acme", ["careers.acme.com"])
    assert platform.value.status_code == 404


def req(**headers):
    return SimpleNamespace(headers={k.replace("_", "-").lower(): v for k, v in headers.items()})


@pytest.mark.parametrize("headers,host", [
    ({"host": "careers.acme.com"}, "careers.acme.com"),
    ({"host": "Careers.ACME.com:8443"}, "careers.acme.com"),
    ({"host": "api.hrbot.example", "x_forwarded_host": "careers.acme.com"}, "careers.acme.com"),
    ({"host": "api.hrbot.example", "x_forwarded_host": "Careers.Acme.com:443, evil.example, other.example"}, "careers.acme.com"),
    ({"host": "api.hrbot.example", "x_forwarded_host": " "}, "api.hrbot.example"),
    ({"host": "careers.acme.com."}, "careers.acme.com"),
    ({"host": "[::1]:8000"}, ""),
    ({"host": "::1"}, ""),
    ({}, ""),
])
def test_the_host_is_the_first_forwarded_host_else_the_host_header(headers, host):
    assert tenant_deps.request_host(req(**headers)) == host


@pytest.mark.parametrize("headers,candidate", [
    ({"host": "careers.acme.com"}, "careers.acme.com"),
    ({"host": "test"}, None),
    ({"host": "localhost:8000"}, None),
    ({"host": "127.0.0.1:8000"}, None),
    ({"host": "app.hrbot.example"}, None),
    ({"host": "APP.HRBOT.EXAMPLE:443"}, None),
    ({"host": "app.hrbot.example", "x_forwarded_host": "careers.acme.com"}, "careers.acme.com"),
    ({}, None),
])
def test_only_a_host_that_could_be_a_company_domain_is_worth_a_lookup(headers, candidate):
    assert tenant_deps.custom_host_candidate(req(**headers)) == candidate


def test_without_a_custom_domain_links_start_from_the_products_address_untouched(monkeypatch):
    assert base_url() == "https://app.hrbot.example"
    with company_context("cmp_plain", {"name": "Plain"}):
        assert base_url() == "https://app.hrbot.example"
    with company_context("cmp_plain", {"name": "Plain", "custom_domains": []}):
        assert base_url() == "https://app.hrbot.example"
    monkeypatch.setattr(settings, "FRONTEND_URL", "https://app.hrbot.example/")
    assert base_url() == "https://app.hrbot.example/"
    monkeypatch.setattr(settings, "FRONTEND_URL", "http://localhost:5173")
    assert base_url() == "http://localhost:5173"


def test_a_company_with_a_custom_domain_is_linked_on_its_primary_domain():
    company = {"name": "Acme", "custom_domains": ["careers.acme.com", "jobs.acme.com"]}
    with company_context("cmp_acme", company):
        assert base_url() == "https://careers.acme.com"
    assert base_url(company) == "https://careers.acme.com"


def test_an_unusable_first_entry_is_skipped():
    with company_context("cmp_acme", {"custom_domains": ["https://nope", "jobs.acme.com"]}):
        assert base_url() == "https://jobs.acme.com"
    with company_context("cmp_acme", {"custom_domains": ["https://nope", "10.0.0.1"]}):
        assert base_url() == "https://app.hrbot.example"


def test_a_plan_that_no_longer_includes_a_custom_domain_goes_back_to_the_product_address():
    off = {"name": "Acme", "custom_domains": ["careers.acme.com"], "client_plan": {"features": {"custom_domain": False}}}
    with company_context("cmp_acme", off):
        assert base_url() == "https://app.hrbot.example"
    on = {**off, "client_plan": {"features": {"custom_domain": True}}}
    with company_context("cmp_acme", on):
        assert base_url() == "https://careers.acme.com"
    assert links.custom_domain(off) is None and links.custom_domain(on) == "careers.acme.com"


def test_the_emailed_links_of_every_kind_use_the_companys_domain(monkeypatch):
    from services.hr_module import credentials_service, interviewer_link_service, report_share_service

    company = {"name": "Acme", "custom_domains": ["careers.acme.com"]}
    with company_context("cmp_acme", company):
        assert credentials_service.build_link("tok", "reset") == "https://careers.acme.com/reset-password?token=tok"
        assert credentials_service.build_link("tok", "invite") == "https://careers.acme.com/reset-password?token=tok&invite=1"
        assert interviewer_link_service.link_url("tok") == "https://careers.acme.com/interviewer/tok"
        assert report_share_service.share_url("tok") == "https://careers.acme.com/report/shared/tok"
    with company_context("cmp_plain", {"name": "Plain"}):
        assert credentials_service.build_link("tok", "reset") == "https://app.hrbot.example/reset-password?token=tok"
        assert interviewer_link_service.link_url("tok") == "https://app.hrbot.example/interviewer/tok"
        assert report_share_service.share_url("tok") == "https://app.hrbot.example/report/shared/tok"


async def test_the_candidate_emails_carry_the_companys_domain(monkeypatch):
    from services.hr_module import email_service

    sent = []

    async def capture(**kwargs):
        sent.append(kwargs)
        return True

    async def no_override(key):
        return None

    monkeypatch.setattr(email_service, "send_email", capture)
    monkeypatch.setattr(email_service, "get_template_override", no_override)
    with company_context("cmp_acme", {"name": "Acme", "custom_domains": ["careers.acme.com"]}):
        await email_service.send_invite_email(
            to_email="c@example.com", candidate_name="C", job_title="Dev", company_name="Acme", secure_token="tok_1",
        )
        await email_service.send_assessment_invitation_email(
            to_email="c@example.com", candidate_name="C", job_title="Dev", secure_token="tok_2",
        )
        await email_service.send_reminder_email(
            to_email="c@example.com", candidate_name="C", job_title="Dev", secure_token="tok_3",
        )
    invite, assessment, reminder = sent
    assert "https://careers.acme.com/interview/tok_1" in invite["text_body"] and 'href="https://careers.acme.com/interview/tok_1"' in invite["html_body"]
    assert "https://careers.acme.com/interview/tok_2" in assessment["text_body"]
    assert "Interview Link: https://careers.acme.com/interview/tok_3" in reminder["text_body"]
    assert "app.hrbot.example" not in "".join(m["text_body"] + m["html_body"] for m in sent)


def test_a_workflow_may_link_to_the_companys_own_domain_but_nobody_elses():
    from services.hr_module import workflow_engine

    with company_context("cmp_acme", {"name": "Acme", "custom_domains": ["careers.acme.com"]}):
        assert workflow_engine.trusted_link("https://careers.acme.com/offer/tok") == "https://careers.acme.com/offer/tok"
        assert workflow_engine.trusted_link("https://app.hrbot.example/offer/tok")
        assert workflow_engine.trusted_link("https://evil.example/offer/tok") is None
        assert workflow_engine.trusted_link("https://other-company.example.com/offer/tok") is None
    with company_context("cmp_plain", {"name": "Plain"}):
        assert workflow_engine.trusted_link("https://careers.acme.com/offer/tok") is None
