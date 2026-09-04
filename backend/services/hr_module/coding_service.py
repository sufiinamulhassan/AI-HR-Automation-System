"""AI Coding Assessment — hr_module (MVP2 §2.10).

SECURITY-CRITICAL: this backend NEVER executes candidate-submitted source code
itself (no subprocess/exec/eval/importlib on candidate code, ever). All code
execution is delegated over HTTP to a purpose-built sandboxed execution
service, selected by CODE_SANDBOX_PROVIDER:

  judge0 — Judge0 CE (https://judge0.com), self-hosted or RapidAPI-hosted.
  piston — engineer-man/piston (https://github.com/engineer-man/piston),
           open source and self-hostable, with no API key of its own.

If the selected engine's URL is blank the feature reports "not configured" —
it never falls back to running anything locally. Nor is an LLM ever used to
*predict* a program's output in place of running it: `score` must always come
from real stdout captured by a sandbox. `evaluate_output_correctness` below is
a second opinion ON that real output, never a substitute for it.

Both engines are normalised to Judge0's response shape (`run_on_piston`
translates), so everything downstream of `run_in_sandbox` — scoring,
telemetry, compile-error short-circuiting — is provider-agnostic.
"""
import json
import logging
import random
from datetime import datetime, timezone

import httpx

from config.database import get_db
from config.llm import ask_llm
from config.settings import (
    sandbox_not_configured_message,
    sandbox_provider,
    sandbox_url,
    settings,
)
from services.hr_module.prompt_config_service import get_prompt_override

logger = logging.getLogger(__name__)

_TIMEOUT = 20.0

LANGUAGE_IDS: dict[str, int] = {
    "python": 71,
    "javascript": 63,
    "java": 62,
    "c": 50,
    "cpp": 54,
    "typescript": 74,
    "go": 60,
    "ruby": 72,
    "rust": 73,
    "csharp": 51,
    "fsharp": 87,
    "kotlin": 78,
    "swift": 83,
    "scala": 81,
    "perl": 85,
    "php": 68,
    "haskell": 61,
    "r": 80,
    "dart": 90,
    "lua": 64,
    "elixir": 57,
    "erlang": 58,
    "clojure": 86,
    "groovy": 88,
    "pascal": 67,
    "bash": 46,
    "ocaml": 65,
    "octave": 66,
    "cobol": 77,
    "fortran": 59,
    "d": 56,
    "vbnet": 84,
    "sql": 82,
    "basic": 47,
    "assembly": 45,
    "prolog": 69,
    "lisp": 55,
}

PISTON_LANGUAGES: dict[str, str] = {
    "python": "python",
    "javascript": "javascript",
    "java": "java",
    "c": "c",
    "cpp": "c++",
    "typescript": "typescript",
    "go": "go",
    "ruby": "ruby",
    "rust": "rust",
    "csharp": "csharp",
    "fsharp": "fsharp.net",
    "kotlin": "kotlin",
    "swift": "swift",
    "scala": "scala",
    "perl": "perl",
    "php": "php",
    "haskell": "haskell",
    "r": "rscript",
    "dart": "dart",
    "lua": "lua",
    "elixir": "elixir",
    "erlang": "erlang",
    "clojure": "clojure",
    "groovy": "groovy",
    "pascal": "pascal",
    "bash": "bash",
    "ocaml": "ocaml",
    "octave": "octave",
    "cobol": "cobol",
    "fortran": "fortran",
    "d": "d",
    "vbnet": "basic.net",
    "sql": "sqlite3",
    "basic": "freebasic",
    "assembly": "nasm",
    "prolog": "prolog",
    "lisp": "lisp",
}


def supported_language(language: str) -> bool:
    """Whether the ACTIVE engine can run this language — the two engines cover
    the same set today, but callers must not assume that stays true."""
    return language in (PISTON_LANGUAGES if sandbox_provider() == "piston" else LANGUAGE_IDS)


def supported_languages() -> list[str]:
    """Every language the ACTIVE engine can run right now, sorted — lets the
    candidate-facing editor offer a language even when the question's own
    `language_templates` never authored a starter for it (demo feedback: the
    candidate should be able to pick any supported language, not only the
    2-4 an admin/AI happened to template)."""
    return sorted(PISTON_LANGUAGES if sandbox_provider() == "piston" else LANGUAGE_IDS)


_GENERATE_SYSTEM = (
    "You are a senior technical interviewer designing a coding assessment question "
    "for a job-role screening platform. Return ONLY valid JSON matching the requested "
    "schema — no markdown fences, no commentary, no extra keys."
)

_GENERATE_PROMPT = """Design one coding assessment question for a "{job_domain}" role at "{difficulty}" difficulty.
{topic_line}
Return JSON in exactly this shape:
{{
  "title": "<short question title>",
  "description": "<full problem description, including the input format and the expected output format>",
  "language_templates": {{
    "python": "<starter code for Python — read from stdin, print to stdout>",
    "javascript": "<starter code for JavaScript (Node.js) — read from stdin, print to stdout>"
  }},
  "test_cases": [
    {{"input": "<stdin for this case>", "expected_output": "<expected stdout>", "is_hidden": false, "is_edge_case": false}},
    {{"input": "<stdin for this case>", "expected_output": "<expected stdout>", "is_hidden": true, "is_edge_case": true}}
  ]
}}

Rules:
- "language_templates" must contain 2 to 4 entries. "python" and "javascript" are REQUIRED keys;
  you may optionally add more from: java, c, cpp, typescript, go, ruby.
- "test_cases" must contain 3 to 5 entries total, with at least one visible ("is_hidden": false)
  and at least one hidden ("is_hidden": true) case.
- At least one test case must be a boundary/edge case ("is_edge_case": true) — e.g. empty input,
  minimum/maximum size, duplicate values, or another input the naive approach is likely to mishandle.
- Every test case must be solvable purely via stdin/stdout, consistent with the starter templates.
- Keep the problem self-contained and unambiguous; do not reference external files or libraries
  beyond each language's standard library."""

_REQUIRED_LANGUAGES = {"python", "javascript"}
_MIN_LANGUAGE_TEMPLATES = 2
_MAX_LANGUAGE_TEMPLATES = 4
_MIN_TEST_CASES = 3
_MAX_TEST_CASES = 5


async def generate_question_with_ai(
    job_domain: str,
    difficulty: str = "medium",
    topic_hint: str | None = None,
    model: str | None = None,
) -> dict:
    """Ask the LLM (via config.llm.ask_llm — never a provider SDK directly) to
    draft a full coding question, then strictly validate the parsed JSON before
    handing it back to the caller.

    Returns a dict with keys: title, description, language_templates,
    test_cases (list of {input, expected_output, is_hidden, is_edge_case}),
    job_domain, difficulty — the same shape routes/coding.py's insert helper expects.

    Raises RuntimeError (never lets a malformed LLM response propagate as an
    unhandled crash) when the response isn't valid JSON, isn't a JSON object,
    or is missing/short on any required field. The route layer maps this to
    HTTPException(502, ...).
    """
    topic_line = f'Focus the question on this specific topic: "{topic_hint}".\n' if topic_hint else ""
    raw = await ask_llm(
        prompt=_GENERATE_PROMPT.format(job_domain=job_domain, difficulty=difficulty, topic_line=topic_line),
        system=_GENERATE_SYSTEM,
        model=model,
        max_tokens=1800,
        temperature=0.4,
        json_mode=True,
    )

    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, TypeError) as e:
        logger.warning("generate_question_with_ai: malformed JSON from LLM (job_domain=%s): %s", job_domain, e)
        raise RuntimeError("AI question generation returned malformed output — please retry")

    if not isinstance(parsed, dict):
        raise RuntimeError("AI question generation returned an unexpected response shape")

    title = parsed.get("title")
    description = parsed.get("description")
    language_templates = parsed.get("language_templates")
    test_cases = parsed.get("test_cases")

    if not isinstance(title, str) or not title.strip():
        raise RuntimeError("AI question generation did not return a usable title")
    if not isinstance(description, str) or not description.strip():
        raise RuntimeError("AI question generation did not return a usable description")
    if not isinstance(language_templates, dict) or not (
        _MIN_LANGUAGE_TEMPLATES <= len(language_templates) <= _MAX_LANGUAGE_TEMPLATES
    ):
        raise RuntimeError(
            f"AI question generation must return {_MIN_LANGUAGE_TEMPLATES}-{_MAX_LANGUAGE_TEMPLATES} language templates"
        )
    if not _REQUIRED_LANGUAGES.issubset({str(k).lower() for k in language_templates.keys()}):
        raise RuntimeError("AI question generation must include at least python and javascript templates")
    if not all(isinstance(v, str) and v.strip() for v in language_templates.values()):
        raise RuntimeError("AI question generation returned an empty starter template")

    if not isinstance(test_cases, list) or not (_MIN_TEST_CASES <= len(test_cases) <= _MAX_TEST_CASES):
        raise RuntimeError(
            f"AI question generation must return {_MIN_TEST_CASES}-{_MAX_TEST_CASES} test cases"
        )

    clean_cases: list[dict] = []
    for tc in test_cases:
        if not isinstance(tc, dict) or "input" not in tc or "expected_output" not in tc:
            raise RuntimeError("AI question generation returned a malformed test case")
        clean_cases.append({
            "input": str(tc.get("input", "")),
            "expected_output": str(tc.get("expected_output", "")),
            "is_hidden": bool(tc.get("is_hidden", False)),
            "is_edge_case": bool(tc.get("is_edge_case", False)),
        })

    return {
        "title": title.strip(),
        "description": description.strip(),
        "language_templates": {str(k): str(v) for k, v in language_templates.items()},
        "test_cases": clean_cases,
        "job_domain": job_domain,
        "difficulty": difficulty,
    }


async def auto_assign_coding_question(
    db, job_domain: str | None, difficulty: str | None = None,
) -> dict | None:
    """Randomly pick one matching coding question instead of an admin having to
    hand-pick the same `question_id` for every candidate on a role (demo
    feedback: avoid handing every candidate on the same role an identical
    question). Same domain-match-then-fallback shape as
    scenario_service.pick_scenario_for_job.

    Purely additive — the existing manual `PATCH /coding/assign/{candidate_id}`
    path in routes/coding.py is untouched; this is a standalone helper a caller
    can invoke instead of (never automatically instead of) that endpoint.

    Returns the matching question doc, or None if nothing matches.
    """
    query: dict = {}
    if difficulty:
        query["difficulty"] = difficulty
    if job_domain:
        query["job_domain"] = job_domain
        matches = [doc async for doc in db.coding_questions.find(query, {"_id": 0})]
        if matches:
            return random.choice(matches)
        query.pop("job_domain", None)

    matches = [doc async for doc in db.coding_questions.find(query, {"_id": 0})]
    return random.choice(matches) if matches else None


async def run_on_judge0(source_code: str, language_id: int, stdin: str) -> dict:
    """Submit one (source, stdin) pair to Judge0 and return its parsed JSON
    response (stdout/stderr/status/etc — see Judge0 submissions API docs).

    Raises RuntimeError if Judge0 is not configured (blank JUDGE0_API_URL) —
    routes/coding.py translates that into HTTPException(503, ...). Never
    executes the source code itself; this is purely an HTTP call to the
    external sandboxed execution service.
    """
    if not settings.JUDGE0_API_URL:
        raise RuntimeError("Judge0 is not configured — set JUDGE0_API_URL in settings")

    headers = {"Content-Type": "application/json"}
    if settings.JUDGE0_API_HOST:
        headers["X-RapidAPI-Host"] = settings.JUDGE0_API_HOST
        if settings.JUDGE0_API_KEY:
            headers["X-RapidAPI-Key"] = settings.JUDGE0_API_KEY

    url = f"{settings.JUDGE0_API_URL}/submissions?wait=true&base64_encoded=false"
    payload = {
        "source_code": source_code,
        "language_id": language_id,
        "stdin": stdin,
    }

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.post(url, json=payload, headers=headers)
        resp.raise_for_status()
        return resp.json()


def _compare_output(actual: str | None, expected: str) -> bool:
    return (actual or "").strip() == (expected or "").strip()


_STATUS_TIME_LIMIT_EXCEEDED = 5
_STATUS_COMPILATION_ERROR = 6
_STATUS_ACCEPTED = 3
_STATUS_RUNTIME_ERROR = 11

_PISTON_RUN_TIMEOUT_MS = 5000
_PISTON_COMPILE_TIMEOUT_MS = 10000

_PISTON_TIMEOUT_SIGNALS = {"SIGKILL", "SIGXCPU", "SIGTERM"}


def _piston_status(compile_failed: bool, run_stage: dict) -> dict:
    """Synthesise a Judge0-style `status` from Piston's stage results.

    Judge0 reports a single status id per submission; Piston reports two
    process stages and leaves the interpretation to the caller. This is that
    interpretation — and it matters beyond cosmetics: `_run_test_cases`
    short-circuits the remaining cases on id 6, and the run summary keys
    `timed_out` off id 5.
    """
    if compile_failed:
        return {"id": _STATUS_COMPILATION_ERROR, "description": "Compilation Error"}
    if run_stage.get("signal") in _PISTON_TIMEOUT_SIGNALS:
        return {"id": _STATUS_TIME_LIMIT_EXCEEDED, "description": "Time Limit Exceeded"}
    if run_stage.get("code") == 0:
        return {"id": _STATUS_ACCEPTED, "description": "Accepted"}
    return {
        "id": _STATUS_RUNTIME_ERROR,
        "description": f"Runtime Error (exit {run_stage.get('code')})",
    }


async def run_on_piston(source_code: str, language: str, stdin: str) -> dict:
    """Execute one (source, stdin) pair on Piston and return it in JUDGE0'S
    response shape, so `_telemetry` and every downstream consumer stay
    provider-agnostic.

    Raises RuntimeError if Piston is not configured (blank PISTON_API_URL) —
    routes/coding.py translates that into HTTPException(503, ...), the same
    path the Judge0 branch takes. Never executes the source code itself; this
    is purely an HTTP call to the external sandboxed execution service.

    Two facts Judge0 reports and Piston does not: wall time and peak memory.
    They come back as None rather than 0 — `_telemetry` already treats None as
    "not measured", and a fabricated 0 ms would read as a real measurement.
    """
    if not settings.PISTON_API_URL:
        raise RuntimeError("Piston is not configured — set PISTON_API_URL in settings")

    piston_language = PISTON_LANGUAGES.get(language)
    if not piston_language:
        raise ValueError(f"Unsupported language: {language}")

    headers = {"Content-Type": "application/json"}
    if settings.PISTON_API_KEY:
        headers["Authorization"] = f"Bearer {settings.PISTON_API_KEY}"

    url = f"{settings.PISTON_API_URL.rstrip('/')}/execute"
    payload = {
        "language": piston_language,
        "version": "*",
        "files": [{"content": source_code}],
        "stdin": stdin,
        "run_timeout": _PISTON_RUN_TIMEOUT_MS,
        "compile_timeout": _PISTON_COMPILE_TIMEOUT_MS,
    }

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.post(url, json=payload, headers=headers)
        resp.raise_for_status()
        body = resp.json()

    run_stage = body.get("run") or {}
    compile_stage = body.get("compile") or {}
    compile_code = compile_stage.get("code")
    compile_failed = compile_code not in (0, None)

    return {
        "stdout": run_stage.get("stdout") or "",
        "stderr": run_stage.get("stderr") or "",
        "compile_output": (compile_stage.get("stderr") or compile_stage.get("output") or "")
        if compile_failed else "",
        "exit_code": run_stage.get("code"),
        "time": None,
        "memory": None,
        "status": _piston_status(compile_failed, run_stage),
    }


async def run_in_sandbox(source_code: str, language: str, stdin: str) -> dict:
    """Execute one (source, stdin) pair on whichever engine is configured.

    The single entry point every caller should use — it takes a language NAME
    rather than a Judge0 numeric id, because that id is a Judge0 implementation
    detail no caller should have to know. Returns Judge0's response shape from
    both branches.

    Raises ValueError for a language the active engine cannot run (routes map
    that to 400) and RuntimeError when the engine is unconfigured (503).
    """
    if sandbox_provider() == "piston":
        return await run_on_piston(source_code, language, stdin)

    language_id = LANGUAGE_IDS.get(language)
    if not language_id:
        raise ValueError(f"Unsupported language: {language}")
    return await run_on_judge0(source_code, language_id, stdin)


def _clip(text) -> str | None:
    """Bound a sandbox-provided string before it is persisted."""
    if not text:
        return None
    text = str(text)
    limit = settings.CODE_MAX_STDERR_CHARS
    return text if len(text) <= limit else text[:limit] + "… [truncated]"


def _telemetry(resp: dict) -> dict:
    """Pull the execution facts out of a sandbox response.

    All of this was already on the wire and was being thrown away — only
    `stdout` was read. Without it a compile error is indistinguishable from a
    wrong answer, which is how a Java or Go submission that never built ends up
    looking exactly like a candidate who cannot code.
    """
    status = resp.get("status")
    status = status if isinstance(status, dict) else {}

    try:
        raw_time = resp.get("time")
        time_ms = round(float(raw_time) * 1000, 2) if raw_time is not None else None
    except (TypeError, ValueError):
        time_ms = None

    raw_memory = resp.get("memory")
    memory_kb = int(raw_memory) if isinstance(raw_memory, (int, float)) else None

    return {
        "status": status.get("description"),
        "status_id": status.get("id"),
        "time_ms": time_ms,
        "memory_kb": memory_kb,
        "stderr": _clip(resp.get("stderr")),
        "compile_output": _clip(resp.get("compile_output")),
        "exit_code": resp.get("exit_code"),
    }


def _blank_row(tc: dict, idx: int) -> dict:
    """Every result row carries the same keys whether it ran, was skipped, or
    errored — so consumers never have to branch on key presence."""
    return {
        "test_case_index": idx,
        "is_hidden": bool(tc.get("is_hidden", False)),
        "is_edge_case": bool(tc.get("is_edge_case", False)),
        "expected_output": tc.get("expected_output", ""),
        "actual_output": "",
        "passed": False,
        "execution_error": False,
        "skipped": False,
        "status": None,
        "status_id": None,
        "time_ms": None,
        "memory_kb": None,
        "stderr": None,
        "compile_output": None,
        "exit_code": None,
    }


async def _execute_case(code: str, language: str, tc: dict, idx: int) -> dict:
    """Run one test case. Never raises.

    An infrastructure failure is recorded as `execution_error` rather than a
    silent wrong answer, so the caller can tell "our sandbox broke" apart from
    "their code was wrong" — the two must never score the same.
    """
    row = _blank_row(tc, idx)
    try:
        resp = await run_in_sandbox(code, language, tc.get("input", ""))
    except Exception as exc:
        logger.warning("Sandbox execution failed for case idx=%s: %s", idx, exc)
        row["execution_error"] = True
        row["status"] = "Execution Error"
        return row

    row.update(_telemetry(resp))
    actual = resp.get("stdout")
    row["actual_output"] = actual or ""
    row["passed"] = _compare_output(actual, row["expected_output"])
    return row


async def _run_test_cases(
    code: str, language: str, test_cases: list[dict],
) -> tuple[list[dict], dict]:
    """Execute every test case, short-circuiting on a compile error.

    If the code did not compile, every remaining case fails identically for the
    same reason — so they are marked skipped rather than burning one sandbox
    call each to re-learn the same fact. Previously a non-compiling Java
    submission spent N calls to report N blank failures.
    """
    results: list[dict] = []
    compile_message: str | None = None

    for idx, tc in enumerate(test_cases):
        row = await _execute_case(code, language, tc, idx)
        results.append(row)

        if row.get("status_id") == _STATUS_COMPILATION_ERROR:
            compile_message = row.get("compile_output") or row.get("stderr")
            for skip_idx, skip_tc in enumerate(test_cases[idx + 1:], start=idx + 1):
                skipped = _blank_row(skip_tc, skip_idx)
                skipped["skipped"] = True
                skipped["status"] = "Skipped — compilation failed"
                results.append(skipped)
            break

    times = [r["time_ms"] for r in results if r["time_ms"] is not None]
    memories = [r["memory_kb"] for r in results if r["memory_kb"] is not None]
    execution = {
        "compile_error": compile_message is not None,
        "compile_message": compile_message,
        "timed_out": any(r.get("status_id") == _STATUS_TIME_LIMIT_EXCEEDED for r in results),
        "errored_cases": sum(1 for r in results if r["execution_error"]),
        "skipped_cases": sum(1 for r in results if r["skipped"]),
        "max_time_ms": max(times) if times else None,
        "max_memory_kb": max(memories) if memories else None,
    }
    return results, execution


def _score_results(results: list[dict]) -> tuple[int, float | None]:
    """Return (passed_count, score). Score is None when nothing executed.

    A total sandbox outage must not be recorded as 0/N. That number would flow
    into the candidate's hiring report via _attach_coding_scores and read as
    "wrote code that fails every test" — a fabricated fact about a person.
    None is absent, and every consumer already renders an absent dimension as
    "—" rather than zero.
    """
    total = len(results)
    passed = sum(1 for r in results if r["passed"])
    if total and all(r["execution_error"] for r in results):
        return passed, None
    return passed, (round(100 * passed / total, 2) if total else 0.0)


_QUALITY_SYSTEM = (
    "You are a senior engineer reviewing a candidate's coding-assessment submission. "
    "Judge the code as written — readability, structure, and approach — not merely "
    "whether it passes tests. Be specific and evidence-based; cite the code."
)

_QUALITY_PROMPT = """Problem:
{question_title}
{question_description}

Language: {language}

Candidate's submission:
```{language}
{code}
```

Automated test results: {passed}/{total} test cases passed.

Assess the submission. Test correctness is already measured above — your job is
everything that pass/fail cannot see: how readable the code is, how well it is
structured, whether the algorithmic approach is sound and appropriately
efficient, and whether it uses the language idiomatically.

Also estimate the submission's asymptotic time and space complexity (e.g.
"O(n)", "O(n log n)", "O(1)") as the candidate's actual algorithm would run —
not a static-shape metric, an honest Big-O read of what the code does.

Write `feedback_for_recruiter` for a non-author reviewer deciding on this
candidate, and `feedback_for_candidate` as constructive, specific guidance."""

_QUALITY_SCHEMA = {
    "type": "object",
    "properties": {
        "readability_score": {"type": "integer"},
        "structure_score": {"type": "integer"},
        "efficiency_score": {"type": "integer"},
        "idiomatic_score": {"type": "integer"},
        "problem_solving_score": {"type": "integer"},
        "overall_quality_score": {"type": "integer"},
        "strengths": {"type": "array", "items": {"type": "string"}},
        "concerns": {"type": "array", "items": {"type": "string"}},
        "approach_summary": {"type": "string"},
        "estimated_time_complexity": {"type": "string"},
        "estimated_space_complexity": {"type": "string"},
        "feedback_for_recruiter": {"type": "string"},
        "feedback_for_candidate": {"type": "string"},
    },
    "required": [
        "readability_score", "structure_score", "efficiency_score",
        "idiomatic_score", "problem_solving_score", "overall_quality_score",
        "strengths", "concerns", "approach_summary",
        "estimated_time_complexity", "estimated_space_complexity",
        "feedback_for_recruiter", "feedback_for_candidate",
    ],
    "additionalProperties": False,
}


async def evaluate_code_quality(
    *,
    question: dict,
    language: str,
    code: str,
    passed: int,
    total: int,
    model: str | None = None,
) -> dict | None:
    """AI review of code quality, approach and feedback — the axis Judge0 cannot see.

    Judge0 answers "does it pass?"; two submissions with identical pass rates can
    differ enormously in quality, and the pass-rate score alone treats them as
    equal. Returns None when unavailable (no key, provider error, unparseable
    output) so a submission is never blocked by the reviewer being down.
    """
    from config.llm import provider_for_model

    chosen_model = model or settings.CODE_EVAL_MODEL
    provider = provider_for_model(chosen_model)
    required_key = settings.ANTHROPIC_API_KEY if provider == "anthropic" else settings.OPENAI_API_KEY
    if not required_key:
        logger.info(
            "Skipping AI code-quality review — no API key for provider=%s (model=%s)",
            provider, chosen_model,
        )
        return None

    format_kwargs = dict(
        question_title=question.get("title", ""),
        question_description=(question.get("description") or "")[:3000],
        language=language,
        code=code[:12000],
        passed=passed,
        total=total,
    )

    system = _QUALITY_SYSTEM
    prompt = _QUALITY_PROMPT.format(**format_kwargs)
    override = await get_prompt_override("code_evaluation")
    if override and override.get("system_prompt") and override.get("user_prompt_template"):
        try:
            prompt = override["user_prompt_template"].format(**format_kwargs)
            system = override["system_prompt"]
        except (KeyError, IndexError) as exc:
            logger.warning(
                "code_evaluation prompt override has a placeholder mismatch, "
                "falling back to default: %s", exc,
            )

    raw = await ask_llm(
        prompt=prompt,
        system=system,
        model=model or settings.CODE_EVAL_MODEL,
        max_tokens=4000,
        json_mode=True,
        json_schema=_QUALITY_SCHEMA,
    )

    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        logger.warning("Code-quality review returned unparseable output for question=%s", question.get("question_id"))
        return None
    if not isinstance(parsed, dict) or "overall_quality_score" not in parsed:
        return None
    return parsed


_MODIFY_PROBE_SYSTEM = (
    "You are a senior engineer verifying a candidate genuinely understands the code "
    "they submitted, as a check against a solution that was pasted in from an external "
    "source rather than written and understood by the candidate. Return ONLY valid "
    "JSON, no markdown fences, no commentary."
)

_MODIFY_PROBE_PROMPT = """Problem:
{question_title}
{question_description}

Language: {language}

Candidate's submission:
```{language}
{code}
```

Pose ONE small, concrete modification to THIS EXACT solution — e.g. handle a new edge
case, change a constraint, or support a slightly different input — that the candidate
should implement live to prove they understand their own code. Keep the ask small
enough to attempt in a few minutes and require understanding the existing approach
rather than a rewrite from scratch.

Return JSON:
{{
  "modification_prompt": "<the specific modification to ask the candidate to make>",
  "what_it_tests": "<one sentence on what genuine understanding this modification would reveal>"
}}"""


async def generate_live_modification_probe(
    *,
    question: dict,
    language: str,
    code: str,
    model: str | None = None,
) -> dict | None:
    """AI-assistance mitigation, styled on `evaluate_code_quality`'s LLM call: ask the
    candidate to make a small, concrete live modification to their already-submitted
    solution. Returns None when unavailable (no key, provider error, unparseable
    output) — never blocks anything else on this being down, same posture as
    `evaluate_code_quality`.
    """
    from config.llm import provider_for_model

    chosen_model = model or settings.CODE_EVAL_MODEL
    provider = provider_for_model(chosen_model)
    required_key = settings.ANTHROPIC_API_KEY if provider == "anthropic" else settings.OPENAI_API_KEY
    if not required_key:
        logger.info(
            "Skipping live-modification probe — no API key for provider=%s (model=%s)",
            provider, chosen_model,
        )
        return None

    raw = await ask_llm(
        prompt=_MODIFY_PROBE_PROMPT.format(
            question_title=question.get("title", ""),
            question_description=(question.get("description") or "")[:3000],
            language=language,
            code=code[:12000],
        ),
        system=_MODIFY_PROBE_SYSTEM,
        model=chosen_model,
        max_tokens=500,
        json_mode=True,
    )

    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        logger.warning(
            "Live-modification probe returned unparseable output for question=%s",
            question.get("question_id"),
        )
        return None
    if not isinstance(parsed, dict) or not parsed.get("modification_prompt"):
        return None

    what_it_tests = parsed.get("what_it_tests")
    return {
        "modification_prompt": parsed["modification_prompt"],
        "what_it_tests": what_it_tests if isinstance(what_it_tests, str) else None,
    }


_CORRECTNESS_SYSTEM = (
    "You are verifying whether a candidate's program output actually solves the stated "
    "problem, as a second opinion alongside Judge0's exact-string test comparison. You "
    "are given the real stdout Judge0 captured for each case. Credit output that is "
    "correct in substance but failed exact-match on formatting, whitespace or float "
    "precision, and flag cases that passed only by coincidence or by hardcoding the "
    "visible expected outputs rather than genuinely solving the problem. Return ONLY "
    "valid JSON, no markdown fences, no commentary."
)

_CORRECTNESS_PROMPT = """Problem:
{question_title}
{question_description}

Language: {language}

Candidate's submission:
```{language}
{code}
```

Judge0 execution results ({passed}/{total} exact-match passed):
{case_lines}

Return JSON in exactly this shape:
{{
  "verdict": "correct" | "partially_correct" | "incorrect" | "suspicious_hardcoding",
  "confidence": <integer 0-100>,
  "notes": "<one or two sentences citing specific cases>"
}}"""

_CORRECTNESS_VERDICTS = {"correct", "partially_correct", "incorrect", "suspicious_hardcoding"}


async def evaluate_output_correctness(
    *,
    question: dict,
    language: str,
    code: str,
    results: list[dict],
    model: str | None = None,
) -> dict | None:
    """OpenAI second opinion on whether the code's actual Judge0 output correctly
    solves the problem — complementary to `_compare_output`'s exact-string match,
    which cannot distinguish "correct but differently formatted" from "wrong", nor
    "genuinely solved" from "hardcoded to pass the visible cases".

    Deliberately pinned to settings.CODE_CORRECTNESS_MODEL (OpenAI), a separate
    axis from CODE_EVAL_MODEL's Claude-based quality review. Returns None when
    unavailable (no key, provider error, unparseable output) so a submission is
    never blocked by this check being down.
    """
    if not settings.OPENAI_API_KEY:
        logger.info("Skipping AI output-correctness review — OPENAI_API_KEY not set")
        return None

    case_lines = "\n".join(
        f"- Case {r['test_case_index']}: expected `{r.get('expected_output', '')}` · "
        f"actual `{r.get('actual_output', '')}` · {'PASS' if r.get('passed') else 'FAIL'}"
        for r in results
    ) or "(no test cases)"

    raw = await ask_llm(
        prompt=_CORRECTNESS_PROMPT.format(
            question_title=question.get("title", ""),
            question_description=(question.get("description") or "")[:3000],
            language=language,
            code=code[:12000],
            passed=sum(1 for r in results if r.get("passed")),
            total=len(results),
            case_lines=case_lines,
        ),
        system=_CORRECTNESS_SYSTEM,
        model=model or settings.CODE_CORRECTNESS_MODEL,
        max_tokens=600,
        json_mode=True,
    )

    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        logger.warning(
            "AI output-correctness review returned unparseable output for question=%s",
            question.get("question_id"),
        )
        return None
    if not isinstance(parsed, dict) or parsed.get("verdict") not in _CORRECTNESS_VERDICTS:
        return None
    return parsed


async def evaluate_submission(
    question_id: str,
    candidate_id: str,
    language: str,
    code: str,
    keystrokes: int | None = None,
) -> dict:
    """Run `code` against every test case of `question_id` in the configured
    sandbox, score it, persist a coding_submissions doc, and return it.

    The stored document keeps FULL results — including actual/expected output
    for hidden test cases — so the admin-facing submission view can show
    complete detail. Redaction of hidden-test content for candidate-facing
    responses is the CALLER's responsibility (routes/coding.py strips
    actual_output/expected_output from is_hidden=true entries before returning
    anything to the candidate); it must never happen at storage time.

    `keystrokes` (self-reported by the editor) is optional: older clients that
    never send it simply skip the typing-ratio check rather than being flagged
    on a false signal.
    """
    import uuid

    if not sandbox_url():
        raise RuntimeError(sandbox_not_configured_message())

    db = get_db()
    if db is None:
        raise RuntimeError("Database unavailable")

    question = await db.coding_questions.find_one({"question_id": question_id})
    if not question:
        raise ValueError("Coding question not found")

    if not supported_language(language):
        raise ValueError(f"Unsupported language: {language}")

    test_cases = question.get("test_cases", [])

    results, execution = await _run_test_cases(code, language, test_cases)
    passed_count, score = _score_results(results)

    total = len(test_cases)
    now = datetime.now(timezone.utc).isoformat()

    quality = None
    try:
        quality = await evaluate_code_quality(
            question=question, language=language, code=code,
            passed=passed_count, total=total,
        )
    except Exception as exc:
        logger.warning("AI code-quality review failed for question=%s: %s", question_id, exc)

    correctness = None
    try:
        correctness = await evaluate_output_correctness(
            question=question, language=language, code=code, results=results,
        )
    except Exception as exc:
        logger.warning("AI output-correctness review failed for question=%s: %s", question_id, exc)

    from services.hr_module.code_analysis import analyze_complexity, check_plagiarism

    complexity = analyze_complexity(code, language)
    plagiarism = await check_plagiarism(
        db, question_id=question_id, candidate_id=candidate_id, code=code, language=language,
    )

    from services.hr_module.integrity import compute_integrity_score, compute_typing_ratio

    typing_ratio = None
    cand_doc = await db.candidates.find_one(
        {"candidate_id": candidate_id}, {"_id": 0, "coding_integrity_flags": 1},
    ) or {}
    coding_integrity_flags = list(cand_doc.get("coding_integrity_flags") or [])
    if keystrokes is not None:
        template_length = len((question.get("language_templates") or {}).get(language, ""))
        typing_ratio = compute_typing_ratio(keystrokes, code, template_length)
        if typing_ratio < settings.CODE_TYPING_RATIO_FLAG_THRESHOLD:
            flag = f"low_typing_ratio@{now}"
            coding_integrity_flags.append(flag)
            await db.candidates.update_one(
                {"candidate_id": candidate_id},
                {"$push": {"coding_integrity_flags": flag}},
            )
    coding_integrity_score = compute_integrity_score(coding_integrity_flags)

    doc = {
        "submission_id": str(uuid.uuid4()),
        "question_id": question_id,
        "candidate_id": candidate_id,
        "language": language,
        "code": code,
        "status": "completed" if score is not None else "execution_error",
        "results": results,
        "score": score,
        "execution": execution,
        "quality": quality,
        "quality_score": (quality or {}).get("overall_quality_score"),
        "ai_correctness": correctness,
        "complexity": complexity,
        "plagiarism": plagiarism,
        "plagiarism_flagged": bool(plagiarism.get("flagged")),
        "typing_ratio": typing_ratio,
        "coding_integrity_score": coding_integrity_score,
        "submitted_at": now,
        "evaluated_at": now,
    }
    await db.coding_submissions.insert_one(doc)
    doc.pop("_id", None)
    return doc
