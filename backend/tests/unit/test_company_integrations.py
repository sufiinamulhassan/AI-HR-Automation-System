import base64
import json

import httpx
import pytest

from config.settings import settings
from config.tenancy import DEFAULT_COMPANY_ID, company_context
from services.hr_module import hrms_service, meeting_service, webhook_service
from services.hr_module import integrations_settings_service as svc
from services.hr_module.integrations_settings_service import IntegrationSettingsError
from shared import safe_http, secrets

pytestmark = pytest.mark.anyio

OTHER = "cmp_other_company"
PUBLIC_IP = "93.184.216.34"


@pytest.fixture(autouse=True)
def no_environment(monkeypatch):
    for name in (
        "HRMS_WEBHOOK_URL", "HRMS_AUTH_HEADER", "HRMS_AUTH_TOKEN", "ZOOM_ACCOUNT_ID", "ZOOM_CLIENT_ID",
        "ZOOM_CLIENT_SECRET", "MS_TEAMS_TENANT_ID", "MS_TEAMS_CLIENT_ID", "MS_TEAMS_CLIENT_SECRET",
        "MS_TEAMS_ORGANIZER_USER_ID", "MEETING_PROVIDER",
    ):
        monkeypatch.setattr(settings, name, "")
    monkeypatch.setattr(settings, "HRMS_AUTO_PUSH_ON_HIRE", False)


class Saved:

    def __init__(self, monkeypatch):
        self.rows: dict[str, dict] = {}
        monkeypatch.setattr(svc, "_load_stored", self.load)

    async def load(self, name):
        return dict(self.rows.get(name) or {})

    def put(self, name, **fields):
        stored = {}
        fields_spec, secret = svc.SPECS[name]
        for key, value in fields.items():
            stored[key] = secrets.encrypt(value) if key == secret else value
        self.rows[name] = stored


@pytest.fixture
def saved(monkeypatch):
    return Saved(monkeypatch)


@pytest.fixture
def public_dns(monkeypatch):
    async def resolve(host, port):
        return [PUBLIC_IP]

    monkeypatch.setattr(safe_http, "resolve_public", resolve)
    monkeypatch.setattr(svc, "resolve_public", resolve)
    monkeypatch.setattr(hrms_service, "resolve_public", resolve)
    return resolve


ZOOM = dict(account_id="acct_123", client_id="zoom_client", client_secret="zoom-secret-value")
TEAMS = dict(tenant_id="contoso.onmicrosoft.com", client_id="11111111-2222-3333-4444-555555555555",
             client_secret="teams-secret-value", organizer="boss@contoso.com")
HRMS = dict(url="https://hrms.example.com/hooks/hires", auth_header="Authorization", auth_token="Bearer abc.def",
            auto_push_on_hire=True)


async def test_the_environment_is_used_by_the_default_company_only(saved, monkeypatch):
    monkeypatch.setattr(settings, "ZOOM_ACCOUNT_ID", "env_acct")
    monkeypatch.setattr(settings, "ZOOM_CLIENT_ID", "env_client")
    monkeypatch.setattr(settings, "ZOOM_CLIENT_SECRET", "env_secret")
    monkeypatch.setattr(settings, "HRMS_WEBHOOK_URL", "https://env-hrms.example.com/x")
    monkeypatch.setattr(settings, "HRMS_AUTO_PUSH_ON_HIRE", True)
    with company_context(DEFAULT_COMPANY_ID, {}):
        assert (await svc.runtime_config("zoom"))["account_id"] == "env_acct"
        assert await svc.source("zoom") == "platform"
        assert (await svc.runtime_config("hrms"))["url"] == "https://env-hrms.example.com/x"
        assert await svc.hrms_auto_push() is True
        assert meeting_service.configured_providers() == ["zoom"] and hrms_service.is_configured() is True
    with company_context(OTHER, {}):
        assert await svc.runtime_config("zoom") is None and await svc.runtime_config("hrms") is None
        assert await svc.source("zoom") is None
        assert await svc.hrms_auto_push() is False
        assert meeting_service.configured_providers() == [] and hrms_service.is_configured() is False
        assert await meeting_service.available_providers() == [] and await hrms_service.is_configured_for_company() is False


async def test_a_companys_own_settings_come_first_and_never_leak_to_another(saved, monkeypatch):
    monkeypatch.setattr(settings, "ZOOM_ACCOUNT_ID", "env_acct")
    monkeypatch.setattr(settings, "ZOOM_CLIENT_ID", "env_client")
    monkeypatch.setattr(settings, "ZOOM_CLIENT_SECRET", "env_secret")
    saved.put("zoom", **ZOOM)
    with company_context(DEFAULT_COMPANY_ID, {}):
        config = await svc.runtime_config("zoom")
        assert config == ZOOM and await svc.source("zoom") == "company"
    with company_context(OTHER, {}):
        assert svc.environment_config("zoom") is None


async def test_an_incomplete_own_configuration_does_not_borrow_the_environments(saved, monkeypatch):
    monkeypatch.setattr(settings, "ZOOM_ACCOUNT_ID", "env_acct")
    monkeypatch.setattr(settings, "ZOOM_CLIENT_ID", "env_client")
    monkeypatch.setattr(settings, "ZOOM_CLIENT_SECRET", "env_secret")
    saved.put("zoom", account_id="acct_123", client_id="zoom_client")
    with company_context(OTHER, {}):
        assert await svc.runtime_config("zoom") is None
    with company_context(DEFAULT_COMPANY_ID, {}):
        assert (await svc.runtime_config("zoom"))["account_id"] == "env_acct"


async def test_partial_environment_values_do_not_count_as_configured(saved, monkeypatch):
    monkeypatch.setattr(settings, "MS_TEAMS_TENANT_ID", "tid")
    monkeypatch.setattr(settings, "MS_TEAMS_CLIENT_ID", "cid")
    monkeypatch.setattr(settings, "MS_TEAMS_CLIENT_SECRET", "secret")
    with company_context(DEFAULT_COMPANY_ID, {}):
        assert meeting_service.configured_providers() == []
        monkeypatch.setattr(settings, "MS_TEAMS_ORGANIZER_USER_ID", "organiser@example.com")
        assert meeting_service.configured_providers() == ["teams"]


async def test_a_view_masks_the_secret_and_says_where_the_configuration_comes_from(saved):
    saved.put("hrms", **HRMS)
    saved.put("teams", **TEAMS)
    with company_context(OTHER, {}):
        hrms, teams, zoom = await svc.get_view("hrms"), await svc.get_view("teams"), await svc.get_view("zoom")
    assert hrms == {
        "name": "hrms", "url": HRMS["url"], "auth_header": "Authorization", "auto_push_on_hire": True,
        "has_auth_token": True, "configured": True, "source": "company", "updated_at": None, "updated_by": None,
    }
    assert teams["has_client_secret"] is True and teams["organizer"] == "boss@contoso.com" and teams["source"] == "company"
    assert zoom["configured"] is False and zoom["has_client_secret"] is False and zoom["source"] is None
    shown = json.dumps([hrms, teams, zoom])
    for secret in ("Bearer abc.def", "teams-secret-value", secrets.PREFIX):
        assert secret not in shown


async def test_the_environments_values_are_never_shown(saved, monkeypatch):
    monkeypatch.setattr(settings, "HRMS_WEBHOOK_URL", "https://env-hrms.example.com/x")
    monkeypatch.setattr(settings, "HRMS_AUTH_HEADER", "Authorization")
    monkeypatch.setattr(settings, "HRMS_AUTH_TOKEN", "Bearer env-token")
    with company_context(DEFAULT_COMPANY_ID, {}):
        view = await svc.get_view("hrms")
    assert view["configured"] is True and view["source"] == "platform"
    assert view["url"] == "" and view["has_auth_token"] is False
    assert "env-hrms" not in json.dumps(view) and "env-token" not in json.dumps(view)


async def merged(name, existing, changes):
    return await svc.merge_changes(name, existing, changes)


async def test_a_secret_is_encrypted_and_kept_unless_replaced_or_cleared(public_dns):
    first = await merged("hrms", {}, HRMS)
    assert secrets.decrypt(first["auth_token"]) == "Bearer abc.def" and "abc.def" not in first["auth_token"]
    kept = await merged("hrms", first, {"url": "https://hrms.example.com/other"})
    assert kept["auth_token"] == first["auth_token"] and kept["url"] == "https://hrms.example.com/other"
    kept = await merged("hrms", first, {"auth_token": ""})
    assert kept["auth_token"] == first["auth_token"]
    replaced = await merged("hrms", first, {"auth_token": "Bearer new"})
    assert secrets.decrypt(replaced["auth_token"]) == "Bearer new"
    cleared = await merged("hrms", first, {"clear_secret": True})
    assert cleared["auth_token"] == ""
    assert (await merged("hrms", first, {"auto_push_on_hire": False}))["auto_push_on_hire"] is False


async def test_a_blank_plain_field_clears_it(public_dns):
    first = await merged("teams", {}, TEAMS)
    assert (await merged("teams", first, {"organizer": ""}))["organizer"] == ""


@pytest.mark.parametrize("url", [
    "http://hrms.example.com/hook", "ftp://hrms.example.com/hook", "javascript:alert(1)", "//hrms.example.com/x",
    "hrms.example.com/x", "https://", "https://user:pw@hrms.example.com/x", "https://hrms.example.com/x y",
    "https://hrms.example.com/x\r\nHost: evil", "https://" + "a" * 2100 + ".example.com",
])
async def test_an_hrms_address_must_be_a_plain_https_address(public_dns, url):
    with pytest.raises(IntegrationSettingsError):
        await merged("hrms", {}, {"url": url})


@pytest.mark.parametrize("url", [
    "https://127.0.0.1/hook", "https://10.0.0.5/hook", "https://169.254.169.254/latest/meta-data", "https://[::1]/hook",
    "https://192.168.1.1:8443/hook",
])
async def test_an_hrms_address_inside_the_network_is_refused(url):
    with pytest.raises(IntegrationSettingsError, match="public website"):
        await merged("hrms", {}, {"url": url})


async def test_a_public_address_literal_is_accepted():
    out = await merged("hrms", {}, {"url": f"https://{PUBLIC_IP}/hook"})
    assert out["url"] == f"https://{PUBLIC_IP}/hook"


@pytest.mark.parametrize("name,changes", [
    ("hrms", {"auth_header": "Host"}), ("hrms", {"auth_header": "Content-Length"}),
    ("hrms", {"auth_header": "X-Token\r\nX-Evil: 1"}), ("hrms", {"auth_header": "bad header"}), ("hrms", {"auth_header": "9bad"}),
    ("hrms", {"auth_token": "Bearer a\r\nX-Evil: 1"}), ("hrms", {"auth_token": "x" * 2049}),
    ("zoom", {"account_id": "acct/../x"}), ("zoom", {"client_id": "a b"}), ("zoom", {"client_secret": "s\nx"}),
    ("teams", {"tenant_id": "../../evil"}), ("teams", {"tenant_id": "a b"}), ("teams", {"client_id": "x"}),
    ("teams", {"organizer": "a/b"}), ("teams", {"organizer": "u?x=1"}), ("teams", {"organizer": "a b@c.com"}),
    ("teams", {"client_secret": "s\r\nx"}),
])
async def test_values_that_could_change_a_request_are_refused(public_dns, name, changes):
    with pytest.raises(IntegrationSettingsError):
        await merged(name, {}, changes)


async def test_an_unknown_integration_does_not_exist(saved):
    with pytest.raises(IntegrationSettingsError):
        await merged("slack", {}, {})
    assert await svc.runtime_config("slack") is None


async def test_saving_answers_with_the_masked_view_and_an_audit_summary_without_values(monkeypatch, public_dns):
    class Collection:
        doc: dict = {}

        async def find_one(self, flt, projection=None):
            return self.doc

        async def update_one(self, flt, update, upsert=False):
            for path, value in update["$set"].items():
                head, _, tail = path.partition(".")
                self.doc.setdefault(head, {})[tail] = value

    collection = Collection()
    from types import SimpleNamespace

    from services.hr_module import company_settings_service

    monkeypatch.setattr(svc, "get_db", lambda: SimpleNamespace(company_settings=collection))

    async def ensure_profile():
        return {}

    monkeypatch.setattr(company_settings_service, "get_company_settings", ensure_profile)
    with company_context(OTHER, {}):
        view, summary = await svc.save("zoom", dict(ZOOM), updated_by="boss@acme.test")
    assert view["configured"] is True and view["has_client_secret"] is True and "client_secret" not in view
    assert summary == {"integration": "zoom", "fields": ["account_id", "client_id"], "secret_changed": True, "configured": True}
    assert "zoom-secret-value" not in json.dumps([view, summary])
    assert collection.doc["integrations"]["zoom"]["updated_by"] == "boss@acme.test"
    assert secrets.decrypt(collection.doc["integrations"]["zoom"]["client_secret"]) == "zoom-secret-value"


def zoom_handler(seen):
    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.host == "zoom.us":
            return httpx.Response(200, json={"access_token": "zoom-token"})
        return httpx.Response(201, json={"id": 77, "join_url": "https://zoom.us/j/77", "start_url": "https://zoom.us/s/77", "password": "pw"})
    return handler


async def test_a_zoom_meeting_is_booked_on_the_companys_own_account(saved, monkeypatch):
    seen: list[httpx.Request] = []
    monkeypatch.setattr(meeting_service, "_TRANSPORT", httpx.MockTransport(zoom_handler(seen)))
    saved.put("zoom", **ZOOM)
    with company_context(OTHER, {}):
        meeting = await meeting_service.create_meeting(topic="Interview", start_iso="2026-11-03T10:00:00Z")
    assert meeting["provider"] == "zoom" and meeting["join_url"] == "https://zoom.us/j/77"
    token_request, meeting_request = seen
    assert token_request.url.params["account_id"] == "acct_123"
    expected = base64.b64encode(b"zoom_client:zoom-secret-value").decode()
    assert token_request.headers["authorization"] == f"Basic {expected}"
    assert meeting_request.headers["authorization"] == "Bearer zoom-token"


async def test_a_teams_meeting_is_booked_for_the_companys_own_organizer(saved, monkeypatch):
    seen: list[httpx.Request] = []

    def handler(request):
        seen.append(request)
        if request.url.host == "login.microsoftonline.com":
            return httpx.Response(200, json={"access_token": "graph-token"})
        return httpx.Response(201, json={"id": "m1", "joinWebUrl": "https://teams.microsoft.com/l/meetup-join/x"})

    monkeypatch.setattr(meeting_service, "_TRANSPORT", httpx.MockTransport(handler))
    saved.put("teams", **TEAMS)
    with company_context(OTHER, {}):
        meeting = await meeting_service.create_meeting(topic="Interview", start_iso="2026-11-03T10:00:00Z", provider="teams")
    assert meeting["provider"] == "teams" and meeting["join_url"].startswith("https://teams.microsoft.com/")
    token_request, meeting_request = seen
    assert token_request.url.path == "/contoso.onmicrosoft.com/oauth2/v2.0/token"
    assert b"client_secret=teams-secret-value" in token_request.content
    assert meeting_request.url.path == "/v1.0/users/boss@contoso.com/onlineMeetings"


async def test_another_company_cannot_book_on_an_account_it_does_not_have(saved, monkeypatch):
    for name, value in (("ZOOM_ACCOUNT_ID", "a"), ("ZOOM_CLIENT_ID", "b"), ("ZOOM_CLIENT_SECRET", "c")):
        monkeypatch.setattr(settings, name, value)
    called: list = []
    monkeypatch.setattr(meeting_service, "_TRANSPORT", httpx.MockTransport(lambda r: called.append(r) or httpx.Response(500)))
    with company_context(OTHER, {}):
        with pytest.raises(meeting_service.MeetingServiceError, match="(?i)no video-meeting provider is configured"):
            await meeting_service.create_meeting(topic="Interview", start_iso="2026-11-03T10:00:00Z")
        with pytest.raises(meeting_service.MeetingServiceError, match="(?i)no video-meeting provider is configured"):
            await meeting_service.create_meeting(topic="Interview", start_iso="2026-11-03T10:00:00Z", provider="zoom")
    assert called == []


async def test_the_default_company_still_books_on_the_environments_account(saved, monkeypatch):
    seen: list[httpx.Request] = []
    for name, value in (("ZOOM_ACCOUNT_ID", "env_acct"), ("ZOOM_CLIENT_ID", "env_client"), ("ZOOM_CLIENT_SECRET", "env_secret")):
        monkeypatch.setattr(settings, name, value)
    monkeypatch.setattr(meeting_service, "_TRANSPORT", httpx.MockTransport(zoom_handler(seen)))
    with company_context(DEFAULT_COMPANY_ID, {}):
        meeting = await meeting_service.create_meeting(topic="Interview", start_iso="2026-11-03T10:00:00Z")
    assert meeting["meeting_id"] == "77" and seen[0].url.params["account_id"] == "env_acct"


async def test_two_providers_need_an_explicit_choice(saved, monkeypatch):
    saved.put("zoom", **ZOOM)
    saved.put("teams", **TEAMS)
    with company_context(OTHER, {}):
        assert await meeting_service.available_providers() == ["zoom", "teams"]
        with pytest.raises(meeting_service.MeetingServiceError, match="MEETING_PROVIDER"):
            await meeting_service.create_meeting(topic="Interview", start_iso="2026-11-03T10:00:00Z")
    monkeypatch.setattr(settings, "MEETING_PROVIDER", "teams")
    with company_context(OTHER, {}):
        assert meeting_service.default_provider() == ""
    with company_context(DEFAULT_COMPANY_ID, {}):
        assert meeting_service.default_provider() == "teams"


@pytest.fixture
def hrms_world(saved, public_dns, monkeypatch):
    world = type("World", (), {})()
    world.requests, world.logged, world.answer = [], [], (200, {"ok": True})

    def handler(request: httpx.Request) -> httpx.Response:
        world.requests.append(request)
        status, body = world.answer
        return httpx.Response(status, json=body)

    async def record(candidate_id):
        return {"candidate_id": candidate_id, "full_name": "Hired Person", "salary": "120000"}

    async def log(candidate_id, result):
        world.logged.append(result)

    monkeypatch.setattr(hrms_service, "_TRANSPORT", httpx.MockTransport(handler))
    monkeypatch.setattr(hrms_service, "build_employee_record", record)
    monkeypatch.setattr(hrms_service, "_log_sync", log)
    saved.put("hrms", **HRMS)
    return world


async def test_a_hire_is_pushed_to_the_companys_own_hrms_with_its_own_credentials(hrms_world):
    with company_context(OTHER, {}):
        result = await hrms_service.push_to_hrms("cand-1")
    assert result == {"status": "sent", "detail": "", "http_status": 200}
    (request,) = hrms_world.requests
    assert str(request.url) == f"https://{PUBLIC_IP}/hooks/hires" and request.headers["host"] == "hrms.example.com"
    assert request.headers["authorization"] == "Bearer abc.def" and request.method == "POST"
    assert json.loads(request.content)["full_name"] == "Hired Person"
    assert hrms_world.logged == [result]


async def test_a_rejection_is_reported_as_failed_with_the_hrms_words_trimmed(hrms_world):
    hrms_world.answer = (422, {"error": "x" * 500})
    with company_context(OTHER, {}):
        result = await hrms_service.push_to_hrms("cand-1")
    assert result["status"] == "failed" and result["http_status"] == 422 and len(result["detail"]) == 300


async def test_an_address_that_became_private_is_blocked_and_logged(hrms_world, monkeypatch):
    async def private(host, port):
        raise safe_http.UnsafeTarget("The address points to a private or reserved network.")

    monkeypatch.setattr(hrms_service, "resolve_public", private)
    monkeypatch.setattr(safe_http, "resolve_public", private)
    with company_context(OTHER, {}):
        result = await hrms_service.push_to_hrms("cand-1")
    assert result["status"] == "blocked" and result["http_status"] is None and hrms_world.requests == []
    assert hrms_world.logged == [result]


async def test_the_address_is_judged_again_at_connect_time(hrms_world, monkeypatch):
    async def private(host, port):
        raise safe_http.UnsafeTarget("The address points to a private or reserved network.")

    monkeypatch.setattr(safe_http, "resolve_public", private)
    with company_context(OTHER, {}):
        result = await hrms_service.push_to_hrms("cand-1")
    assert result["status"] == "blocked" and hrms_world.requests == []


async def test_a_plain_http_hrms_address_is_blocked(saved, hrms_world):
    saved.rows["hrms"]["url"] = "http://hrms.example.com/hook"
    with company_context(OTHER, {}):
        result = await hrms_service.push_to_hrms("cand-1")
    assert result["status"] == "blocked" and hrms_world.requests == []


async def test_the_environments_http_metadata_address_is_blocked_for_the_default_company(saved, public_dns, monkeypatch):
    monkeypatch.setattr(settings, "HRMS_WEBHOOK_URL", "http://169.254.169.254/latest/meta-data/")
    with company_context(DEFAULT_COMPANY_ID, {}):
        result = await hrms_service.push_to_hrms("cand-1")
    assert result["status"] == "blocked"


async def test_a_company_without_an_hrms_gets_not_configured_and_nothing_is_logged(saved, hrms_world, monkeypatch):
    monkeypatch.setattr(settings, "HRMS_WEBHOOK_URL", "https://env-hrms.example.com/x")
    saved.rows.clear()
    with company_context(OTHER, {}):
        result = await hrms_service.push_to_hrms("cand-1")
    assert result["status"] == "not_configured" and hrms_world.requests == [] and hrms_world.logged == []


async def test_an_unreachable_hrms_is_a_failed_result_not_an_exception(saved, public_dns, monkeypatch):
    def refuse(request):
        raise httpx.ConnectError("connection refused")

    async def record(candidate_id):
        return {"candidate_id": candidate_id}

    async def log(candidate_id, result):
        pass

    monkeypatch.setattr(hrms_service, "_TRANSPORT", httpx.MockTransport(refuse))
    monkeypatch.setattr(hrms_service, "build_employee_record", record)
    monkeypatch.setattr(hrms_service, "_log_sync", log)
    saved.put("hrms", **HRMS)
    with company_context(OTHER, {}):
        result = await hrms_service.push_to_hrms("cand-1")
    assert result["status"] == "failed" and "ConnectError" in result["detail"]


async def test_a_webhook_delivery_is_pinned_to_the_address_that_was_checked(public_dns, monkeypatch):
    seen: list[httpx.Request] = []

    def handler(request):
        seen.append(request)
        return httpx.Response(204)

    monkeypatch.setattr(webhook_service, "_TRANSPORT", httpx.MockTransport(handler))
    status, error = await webhook_service._post_once("https://hooks.example.com/in?x=1", b'{"a":1}', {"X-Webhook-Event": "ping"}, 5.0)
    assert (status, error) == (204, None)
    (request,) = seen
    assert str(request.url) == f"https://{PUBLIC_IP}/in?x=1" and request.headers["host"] == "hooks.example.com"
    assert request.headers["x-webhook-event"] == "ping" and request.content == b'{"a":1}'


@pytest.mark.parametrize("url", [
    "https://127.0.0.1/in", "https://10.1.2.3/in", "https://169.254.169.254/latest", "https://[::1]/in", "ftp://hooks.example.com/in",
    "https://user:pw@hooks.example.com/in",
])
async def test_a_webhook_to_a_private_or_odd_address_is_refused_with_the_usual_error(url):
    status, error = await webhook_service._post_once(url, b"{}", {}, 2.0)
    assert status is None and error == webhook_service.UNSAFE_TARGET_ERROR and "public address" in error


async def test_a_webhook_to_a_name_that_now_points_inside_is_refused(monkeypatch):
    async def private(host, port):
        raise safe_http.UnsafeTarget("The address points to a private or reserved network.")

    monkeypatch.setattr(safe_http, "resolve_public", private)
    called: list = []
    monkeypatch.setattr(webhook_service, "_TRANSPORT", httpx.MockTransport(lambda r: called.append(r) or httpx.Response(200)))
    assert await webhook_service._post_once("https://rebind.example.com/in", b"{}", {}, 2.0) == (None, webhook_service.UNSAFE_TARGET_ERROR)
    assert called == []


async def test_a_redirect_is_the_answer_not_followed_and_a_slow_target_times_out(public_dns, monkeypatch):
    calls: list = []

    def redirect(request):
        calls.append(str(request.url))
        return httpx.Response(302, headers={"location": "http://169.254.169.254/"})

    monkeypatch.setattr(webhook_service, "_TRANSPORT", httpx.MockTransport(redirect))
    assert await webhook_service._post_once("https://hooks.example.com/in", b"{}", {}, 2.0) == (302, None)
    assert len(calls) == 1

    import asyncio

    async def slow(request):
        await asyncio.sleep(5)
        return httpx.Response(200)

    monkeypatch.setattr(webhook_service, "_TRANSPORT", httpx.MockTransport(slow))
    status, error = await webhook_service._post_once("https://hooks.example.com/in", b"{}", {}, 0.2)
    assert status is None and "in time" in error


async def test_plain_http_webhooks_still_work_as_the_routes_have_always_accepted(public_dns, monkeypatch):
    monkeypatch.setattr(webhook_service, "_TRANSPORT", httpx.MockTransport(lambda r: httpx.Response(200)))
    assert await webhook_service._post_once("http://hooks.example.com/in", b"{}", {}, 2.0) == (200, None)
    monkeypatch.setattr(webhook_service, "_ALLOW_HTTP", False)
    status, error = await webhook_service._post_once("http://hooks.example.com/in", b"{}", {}, 2.0)
    assert status is None and error == webhook_service.UNSAFE_TARGET_ERROR


async def test_a_hire_is_pushed_by_itself_only_when_the_companys_own_setting_says_so(saved, monkeypatch):
    monkeypatch.setattr(settings, "HRMS_AUTO_PUSH_ON_HIRE", True)
    saved.put("hrms", **{**HRMS, "auto_push_on_hire": False})
    with company_context(OTHER, {}):
        assert await hrms_service.auto_push_enabled() is False
    saved.put("hrms", **{**HRMS, "auto_push_on_hire": True})
    with company_context(OTHER, {}):
        assert await hrms_service.auto_push_enabled() is True
    saved.put("hrms", url="")
    with company_context(OTHER, {}):
        assert await hrms_service.auto_push_enabled() is False
