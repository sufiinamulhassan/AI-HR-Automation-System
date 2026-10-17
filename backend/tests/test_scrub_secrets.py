import pytest

from config.settings import settings
from shared.scrub import scrub_secrets

pytestmark = pytest.mark.anyio


async def test_empty_input_comes_back_as_none():
    assert scrub_secrets(None) is None
    assert scrub_secrets("") is None


async def test_a_configured_secret_is_masked_wherever_it_appears(monkeypatch):
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "openai-key-abcdef123456")
    monkeypatch.setattr(settings, "EMAIL_PASSWORD", "hunter2-password")
    out = scrub_secrets("auth failed for openai-key-abcdef123456 (smtp password hunter2-password)")
    assert "openai-key-abcdef123456" not in out and "hunter2-password" not in out
    assert out.count("***") == 2


async def test_a_secret_that_contains_another_is_masked_whole(monkeypatch):
    monkeypatch.setattr(settings, "SECRET_KEY", "shared-prefix-and-a-long-tail-0001")
    monkeypatch.setattr(settings, "CRON_SECRET", "shared-prefix")
    assert scrub_secrets("value shared-prefix-and-a-long-tail-0001 end") == "value *** end"


async def test_very_short_values_are_not_treated_as_secrets(monkeypatch):
    monkeypatch.setattr(settings, "INDEED_API_KEY", "abc")
    assert scrub_secrets("the abc of it") == "the abc of it"


async def test_extra_secrets_can_be_passed_in():
    assert scrub_secrets("signed with whsec-12345678 ok", extra=("whsec-12345678", "")) == "signed with *** ok"


async def test_url_credentials_query_and_fragment_are_dropped():
    out = scrub_secrets("GET https://user:pw@api.example.com/v1/jobs?api_key=SECRET&page=2#frag failed, see http://x.test/a?b=c")
    assert out == "GET https://api.example.com/v1/jobs failed, see http://x.test/a"


async def test_authorization_values_and_key_shapes_are_masked():
    out = scrub_secrets("header Bearer abcdefghijklmnop1234 and sk-ant-api03-abcdefghijkl and xoxb-1234567890-abc")
    assert "abcdefghijklmnop1234" not in out and "sk-ant" not in out and "xoxb-" not in out


async def test_the_result_is_cut_to_the_limit():
    assert len(scrub_secrets("x" * 1000)) == 300
    assert len(scrub_secrets("x" * 1000, limit=50)) == 50
    assert len(scrub_secrets("x" * 1000, limit=None)) == 1000


async def test_ordinary_text_passes_through():
    assert scrub_secrets("The endpoint did not answer in time") == "The endpoint did not answer in time"
