from types import SimpleNamespace

from config.settings import settings
from shared.rate_limit import client_ip


def _request(host="10.0.0.1", **headers):
    return SimpleNamespace(client=SimpleNamespace(host=host), headers=headers)


def test_without_a_trusted_header_the_socket_address_is_used(monkeypatch):
    monkeypatch.delenv("VERCEL", raising=False)
    monkeypatch.setattr(settings, "CLIENT_IP_HEADER", "")
    assert client_ip(_request(**{"x-forwarded-for": "6.6.6.6", "x-vercel-forwarded-for": "7.7.7.7"})) == "10.0.0.1"


def test_on_vercel_the_platform_header_is_the_client(monkeypatch):
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.setattr(settings, "CLIENT_IP_HEADER", "")
    assert client_ip(_request(**{"x-vercel-forwarded-for": "203.0.113.9, 10.1.1.1"})) == "203.0.113.9"
    assert client_ip(_request()) == "10.0.0.1"


def test_a_configured_header_wins(monkeypatch):
    monkeypatch.delenv("VERCEL", raising=False)
    monkeypatch.setattr(settings, "CLIENT_IP_HEADER", "X-Real-IP")
    assert client_ip(_request(**{"x-real-ip": "198.51.100.4"})) == "198.51.100.4"


def test_no_client_at_all_is_unknown(monkeypatch):
    monkeypatch.delenv("VERCEL", raising=False)
    monkeypatch.setattr(settings, "CLIENT_IP_HEADER", "")
    assert client_ip(SimpleNamespace(client=None, headers={})) == "unknown"
