import ast
from pathlib import Path

import pytest

from shared.utils import EM_DASH, strip_em_dashes

pytestmark = pytest.mark.anyio

BACKEND = Path(__file__).resolve().parent.parent
SKIPPED_DIRS = {"venv", "tests", "__pycache__", "node_modules", ".pytest_cache"}


def _docstring_nodes(tree: ast.AST) -> set[int]:
    ids: set[int] = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            body = node.body
            if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant) \
                    and isinstance(body[0].value.value, str):
                ids.add(id(body[0].value))
    return ids


def _violations() -> list[str]:
    found: list[str] = []
    for path in sorted(BACKEND.rglob("*.py")):
        if SKIPPED_DIRS & set(path.relative_to(BACKEND).parts):
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        docstrings = _docstring_nodes(tree)
        for node in ast.walk(tree):
            if (
                isinstance(node, ast.Constant)
                and isinstance(node.value, str)
                and EM_DASH in node.value
                and id(node) not in docstrings
            ):
                line = next(l.strip() for l in node.value.splitlines() if EM_DASH in l)
                found.append(f"{path.relative_to(BACKEND).as_posix()}:{node.lineno}: {line[:100]}")
    return found


async def test_no_string_in_the_backend_contains_an_em_dash():
    found = _violations()
    assert not found, "em dash in string literals (rewrite the sentence):\n" + "\n".join(found)


@pytest.mark.parametrize("text,expected", [
    (f"A {EM_DASH} B", "A, B"),
    (f"2020{EM_DASH}2024", "2020-2024"),
    (EM_DASH, "-"),
    (f"first\n{EM_DASH} second", "first\n- second"),
    (f"ends {EM_DASH}\nnext", "ends,\nnext"),
    ("a, b", "a, b"),
    ("nothing to change", "nothing to change"),
])
async def test_strip_em_dashes(text, expected):
    assert strip_em_dashes(text) == expected


async def test_strip_em_dashes_leaves_non_strings_alone():
    assert strip_em_dashes(None) is None
    assert strip_em_dashes(3) == 3


async def test_llm_replies_are_scrubbed(monkeypatch):
    import config.llm as llm

    async def fake_anthropic(**kwargs):
        return f'{{"summary": "Strong candidate {EM_DASH} clear thinker"}}'

    monkeypatch.setattr(llm, "_ask_anthropic", fake_anthropic)
    out = await llm.ask_llm("hi", model="claude-sonnet-5", json_mode=True)
    assert EM_DASH not in out
    assert out == '{"summary": "Strong candidate, clear thinker"}'


async def test_outgoing_email_is_scrubbed(monkeypatch):
    import aiosmtplib

    import services.hr_module.email_service as email_service
    from config.settings import settings

    captured = {}

    async def fake_send(msg, **kwargs):
        captured["msg"] = msg

    monkeypatch.setattr(settings, "AWS_SES_ENABLED", False)
    monkeypatch.setattr(settings, "EMAIL_HOST", "smtp.test.invalid")
    monkeypatch.setattr(aiosmtplib, "send", fake_send)

    ok = await email_service.send_email(
        to="a@example.com", subject=f"Hello {EM_DASH} there",
        html_body=f"<p>x {EM_DASH} y</p>", text_body=f"x {EM_DASH} y",
    )
    assert ok is True
    msg = captured["msg"]
    assert msg["Subject"] == "Hello, there"
    bodies = [part.get_payload(decode=True).decode("utf-8") for part in msg.walk() if not part.is_multipart()]
    assert bodies and all(EM_DASH not in body for body in bodies)
    assert any("x, y" in body for body in bodies)
