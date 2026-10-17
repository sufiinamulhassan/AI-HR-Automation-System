from __future__ import annotations

import asyncio
import ipaddress
import json as _json
import socket
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import httpx

DEFAULT_TIMEOUT = 10.0
DEFAULT_MAX_BYTES = 1_000_000


class UnsafeTarget(Exception):
    pass


@dataclass
class SafeResponse:
    status_code: int
    headers: dict[str, str]
    content: bytes

    @property
    def text(self) -> str:
        return self.content.decode("utf-8", errors="replace")

    def json(self) -> Any:
        return _json.loads(self.content or b"null")


def is_public_ip(address: str) -> bool:
    try:
        ip = ipaddress.ip_address(address)
    except ValueError:
        return False
    ip = getattr(ip, "ipv4_mapped", None) or ip
    return ip.is_global and not (ip.is_multicast or ip.is_unspecified)


async def resolve_public(host: str, port: int) -> list[str]:
    if not host:
        raise UnsafeTarget("The address has no host name.")
    try:
        ipaddress.ip_address(host)
        candidates = [host]
    except ValueError:
        try:
            infos = await asyncio.get_running_loop().getaddrinfo(host, port, type=socket.SOCK_STREAM)
        except OSError:
            raise UnsafeTarget("The host name could not be found.")
        candidates = [info[4][0] for info in infos]
    if not candidates:
        raise UnsafeTarget("The host name could not be found.")
    if not all(is_public_ip(c) for c in candidates):
        raise UnsafeTarget("The address points to a private or reserved network.")
    return sorted(set(candidates), key=lambda a: (":" in a, a))


def pin_url(url: str, address: str) -> str:
    parts = urlsplit(url)
    host = f"[{address}]" if ":" in address else address
    netloc = f"{host}:{parts.port}" if parts.port else host
    return urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment))


async def safe_request(
    method: str,
    url: str,
    *,
    headers: dict[str, str] | None = None,
    content: bytes | None = None,
    data: dict | None = None,
    json: Any = None,
    params: dict | None = None,
    timeout: float = DEFAULT_TIMEOUT,
    max_bytes: int = DEFAULT_MAX_BYTES,
    allow_http: bool = False,
    allowed_ports: tuple[int, ...] | None = None,
    transport: httpx.AsyncBaseTransport | None = None,
) -> SafeResponse:
    parts = urlsplit(url)
    if parts.scheme not in ("https", "http") or (parts.scheme == "http" and not allow_http):
        raise UnsafeTarget("The address must start with https://.")
    if parts.username or parts.password:
        raise UnsafeTarget("The address must not contain a user name or password.")
    host = parts.hostname or ""
    port = parts.port or (443 if parts.scheme == "https" else 80)
    if allowed_ports is not None and port not in allowed_ports:
        raise UnsafeTarget("That port is not allowed.")

    address = (await resolve_public(host, port))[0]
    pinned = pin_url(url, address)
    sent_headers = {**(headers or {}), "Host": host if not parts.port else f"{host}:{parts.port}"}
    extensions = {"sni_hostname": host} if parts.scheme == "https" else {}

    async def _go() -> SafeResponse:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=False, transport=transport) as client:
            async with client.stream(
                method.upper(), pinned, headers=sent_headers, content=content, data=data, json=json,
                params=params, extensions=extensions,
            ) as response:
                body = bytearray()
                async for chunk in response.aiter_bytes():
                    body.extend(chunk)
                    if len(body) > max_bytes:
                        raise UnsafeTarget("The response was larger than allowed.")
                return SafeResponse(response.status_code, dict(response.headers), bytes(body))

    return await asyncio.wait_for(_go(), timeout=timeout + 2.0)
