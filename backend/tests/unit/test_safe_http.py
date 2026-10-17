import asyncio
import socket

import httpx
import pytest

from shared.safe_http import UnsafeTarget, is_public_ip, pin_url, safe_request

pytestmark = pytest.mark.anyio


def _resolve(monkeypatch, *addresses):
    async def fake_getaddrinfo(self, host, port, **kw):
        return [(socket.AF_INET6 if ":" in a else socket.AF_INET, socket.SOCK_STREAM, 6, "", (a, port)) for a in addresses]

    monkeypatch.setattr(asyncio.get_running_loop().__class__, "getaddrinfo", fake_getaddrinfo)


def _ok(request):
    return httpx.Response(200)


@pytest.mark.parametrize("address,public", [
    ("93.184.216.34", True), ("8.8.8.8", True), ("2606:4700:4700::1111", True),
    ("127.0.0.1", False), ("10.0.0.1", False), ("169.254.169.254", False), ("100.64.0.1", False),
    ("192.168.1.1", False), ("::1", False), ("::ffff:10.0.0.5", False), ("0.0.0.0", False), ("not-an-ip", False),
])
def test_which_addresses_count_as_public(address, public):
    assert is_public_ip(address) is public


def test_pin_url_swaps_only_the_host():
    assert pin_url("https://hooks.example.com/a/b?x=1", "93.184.216.34") == "https://93.184.216.34/a/b?x=1"
    assert pin_url("https://hooks.example.com:8443/p", "2606:4700::1") == "https://[2606:4700::1]:8443/p"


async def test_it_connects_to_the_validated_address_with_the_original_name(monkeypatch):
    _resolve(monkeypatch, "93.184.216.34")
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["host"] = request.headers["host"]
        seen["sni"] = request.extensions.get("sni_hostname")
        return httpx.Response(200, json={"ok": True})

    resp = await safe_request("POST", "https://hooks.example.com/x", json={"a": 1}, transport=httpx.MockTransport(handler))
    assert resp.status_code == 200 and resp.json() == {"ok": True}
    assert seen == {"url": "https://93.184.216.34/x", "host": "hooks.example.com", "sni": "hooks.example.com"}


async def test_one_private_address_among_public_ones_refuses_the_target(monkeypatch):
    _resolve(monkeypatch, "93.184.216.34", "10.0.0.7")
    with pytest.raises(UnsafeTarget):
        await safe_request("GET", "https://hooks.example.com/x", transport=httpx.MockTransport(_ok))


@pytest.mark.parametrize("url", [
    "http://hooks.example.com/x",
    "ftp://hooks.example.com/x",
    "https://user:pw@hooks.example.com/x",
    "https://127.0.0.1/x", "https://[::1]/x", "https://169.254.169.254/latest/meta-data",
])
async def test_refused_targets(monkeypatch, url):
    _resolve(monkeypatch, "93.184.216.34")
    with pytest.raises(UnsafeTarget):
        await safe_request("GET", url, transport=httpx.MockTransport(_ok))


async def test_a_port_outside_the_allowed_list_is_refused(monkeypatch):
    _resolve(monkeypatch, "93.184.216.34")
    with pytest.raises(UnsafeTarget):
        await safe_request("GET", "https://hooks.example.com:6379/x", allowed_ports=(443, 8443),
                           transport=httpx.MockTransport(_ok))


async def test_a_redirect_is_returned_not_followed(monkeypatch):
    _resolve(monkeypatch, "93.184.216.34")
    calls = []

    def handler(request):
        calls.append(str(request.url))
        return httpx.Response(302, headers={"location": "http://169.254.169.254/"})

    resp = await safe_request("GET", "https://hooks.example.com/x", transport=httpx.MockTransport(handler))
    assert resp.status_code == 302 and len(calls) == 1


async def test_an_oversized_response_is_cut_off(monkeypatch):
    _resolve(monkeypatch, "93.184.216.34")
    big = httpx.MockTransport(lambda r: httpx.Response(200, content=b"x" * 5000))
    with pytest.raises(UnsafeTarget):
        await safe_request("GET", "https://hooks.example.com/x", max_bytes=1000, transport=big)


async def test_an_unresolvable_name_is_refused_politely(monkeypatch):
    async def boom(self, host, port, **kw):
        raise OSError("no such host")

    monkeypatch.setattr(asyncio.get_running_loop().__class__, "getaddrinfo", boom)
    with pytest.raises(UnsafeTarget):
        await safe_request("GET", "https://nope.invalid/x", transport=httpx.MockTransport(_ok))
