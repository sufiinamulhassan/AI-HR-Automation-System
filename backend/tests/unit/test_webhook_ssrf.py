import socket

import pytest

from services.hr_module import webhook_service


def _resolves_to(monkeypatch, address):
    family = socket.AF_INET6 if ":" in address else socket.AF_INET
    monkeypatch.setattr(socket, "getaddrinfo", lambda host, port, *a, **k: [(family, 0, 0, "", (address, 0))])


@pytest.mark.parametrize("address", [
    "127.0.0.1", "10.1.2.3", "172.16.0.9", "192.168.1.1", "169.254.169.254", "0.0.0.0",
    "100.64.0.1",
    "192.0.2.10",
    "::1", "fe80::1", "fc00::1", "::ffff:127.0.0.1", "::ffff:10.0.0.5",
    "224.0.0.1",
])
def test_non_public_addresses_are_refused(monkeypatch, address):
    _resolves_to(monkeypatch, address)
    assert webhook_service.is_url_ssrf_safe("https://hooks.example.test/x") is False


@pytest.mark.parametrize("address", ["93.184.216.34", "8.8.8.8", "2606:4700:4700::1111"])
def test_public_addresses_are_allowed(monkeypatch, address):
    _resolves_to(monkeypatch, address)
    assert webhook_service.is_url_ssrf_safe("https://hooks.example.test/x") is True


def test_only_http_and_https(monkeypatch):
    _resolves_to(monkeypatch, "93.184.216.34")
    assert webhook_service.is_url_ssrf_safe("ftp://hooks.example.test/x") is False
    assert webhook_service.is_url_ssrf_safe("file:///etc/passwd") is False
