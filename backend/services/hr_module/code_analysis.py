"""
Static analysis of coding-assessment submissions — hr_module (MVP2 §2.10).

Closes the two named gaps that survived every prior pass on §2.10:
"plagiarism/complexity analysis".

SECURITY-CRITICAL, same posture as coding_service.py: nothing in this module
ever executes, compiles, imports, or `ast.parse`s candidate-submitted code.
Everything here is pure text processing — tokenisation, normalisation, and set
comparison. No subprocess, no exec/eval, no network calls, no LLM. That makes
it safe to run on every submission inline, and it is why the metrics below are
deliberately heuristic rather than AST-exact: one text-based implementation
covers all eight languages Judge0 accepts instead of eight parsers, and being
approximate is disclosed to the reader rather than hidden behind a number.

Two independent outputs:

  analyze_complexity()  — deterministic size/shape metrics for one submission
                          (cyclomatic estimate, nesting depth, comment ratio).
                          Distinct from the LLM's `efficiency_score`: this is
                          reproducible and cites no opinion.

  check_plagiarism()    — winnowing-style k-gram fingerprint comparison of one
                          submission against every OTHER candidate's submission
                          for the same question. Identifier names and literals
                          are normalised away first, so renaming variables or
                          reformatting does not defeat it.
"""
import hashlib
import logging
import re

from config.settings import settings

logger = logging.getLogger(__name__)


_LINE_COMMENT_PREFIXES = {
    "python": ("#",),
    "ruby": ("#",),
    "javascript": ("//",),
    "typescript": ("//",),
    "java": ("//",),
    "c": ("//",),
    "cpp": ("//",),
    "go": ("//",),
}
_DEFAULT_LINE_COMMENT_PREFIXES = ("//", "#")

_STRING_PLACEHOLDER = '"S"'
_TRIPLE_QUOTES = ('"""', "'''")


def _strip_comments_and_strings(code: str, language: str) -> str:
    """Remove comments and replace string literals with a single placeholder.

    String contents are replaced rather than deleted so a line of code still
    reads as a line of code — deleting them would collapse `print("x")` to
    `print()` and shift the token stream.

    Deliberately a single left-to-right scan rather than a series of regex
    substitutions. Regexes cannot do this correctly because comments and
    strings are mutually exclusive contexts that can each contain the other's
    delimiters, and applying them in either fixed order gets one case wrong:

      - strings first  → an apostrophe in a comment (`# don't recurse`) opens a
        "string" that runs to the next quote ANYWHERE later in the file,
        deleting everything between. This is not hypothetical: it silently
        reduced ordinary submissions to zero lines of code and an empty
        plagiarism fingerprint, and an empty fingerprint compared against
        another empty one scores a perfect match.
      - comments first → a `#` or `//` inside a string literal
        (`print("http://x")`) truncates the line.

    A scanner that knows which context it is in handles both. Unterminated
    quotes are bounded at the newline, so a stray apostrophe can damage at most
    its own line instead of the rest of the file.
    """
    py_like = language in ("python", "ruby")
    prefixes = _LINE_COMMENT_PREFIXES.get(language, _DEFAULT_LINE_COMMENT_PREFIXES)

    out: list[str] = []
    i, n = 0, len(code)

    while i < n:
        if py_like and code.startswith(_TRIPLE_QUOTES, i):
            quote = code[i:i + 3]
            end = code.find(quote, i + 3)
            i = n if end == -1 else end + 3
            continue

        if code.startswith("/*", i):
            end = code.find("*/", i + 2)
            i = n if end == -1 else end + 2
            continue

        if any(code.startswith(prefix, i) for prefix in prefixes):
            newline = code.find("\n", i)
            i = n if newline == -1 else newline
            continue

        char = code[i]
        if char in ('"', "'"):
            j = i + 1
            while j < n and code[j] != char and code[j] != "\n":
                j += 2 if code[j] == "\\" else 1
            out.append(_STRING_PLACEHOLDER)
            i = j + 1 if j < n and code[j] == char else j
            continue

        out.append(char)
        i += 1

    return "".join(out)


_DECISION_RE = re.compile(
    r"\b(if|elif|elsif|for|while|case|when|catch|except|rescue)\b"
    r"|\belse\s+if\b|&&|\|\||\?\s*[^:]*:",
)
_BOOL_WORD_RE = re.compile(r"\b(and|or)\b")
_FUNCTION_RE = re.compile(
    r"\bdef\s+\w+|\bfunction\s*\w*\s*\(|\bfunc\s+\w+|"
    r"\b(?:public|private|protected|static|final)\s+[\w<>\[\],\s]+?\s+\w+\s*\([^;]*\)\s*\{|"
    r"=>\s*\{|\bfn\s+\w+",
)


def _max_nesting_depth(code: str, language: str) -> int:
    """Brace depth for C-family languages, indentation depth for Python/Ruby."""
    if language in ("python", "ruby"):
        depth = 0
        for line in code.split("\n"):
            stripped = line.strip()
            if not stripped:
                continue
            indent = len(line) - len(line.lstrip(" \t"))
            level = line[:indent].count("\t") + (indent - line[:indent].count("\t")) // 4
            depth = max(depth, level)
        return depth

    depth = current = 0
    for ch in code:
        if ch == "{":
            current += 1
            depth = max(depth, current)
        elif ch == "}":
            current = max(0, current - 1)
    return depth


def analyze_complexity(code: str, language: str) -> dict:
    """Deterministic static metrics for one submission. Never raises.

    Returns a dict with:
      lines_total / lines_of_code / comment_lines / comment_ratio
      cyclomatic_complexity   estimated independent paths (decisions + 1)
      max_nesting_depth       deepest block nesting
      function_count          declared functions/methods detected
      longest_line            characters in the longest line
      complexity_band         'low' | 'moderate' | 'high' | 'very_high'

    `complexity_band` exists so the admin UI has something to sort and colour
    by without every reviewer inventing their own cutoffs. The band is
    advisory: high complexity on a genuinely hard problem is not a defect, so
    nothing in the platform gates a decision on it.
    """
    try:
        raw_lines = code.split("\n")
        stripped = _strip_comments_and_strings(code, language)
        code_lines = [ln for ln in stripped.split("\n") if ln.strip()]

        prefixes = _LINE_COMMENT_PREFIXES.get(language, _DEFAULT_LINE_COMMENT_PREFIXES)
        comment_lines = sum(
            1 for ln in raw_lines if ln.strip().startswith(prefixes) or ln.strip().startswith(("/*", "*", '"""'))
        )

        decisions = len(_DECISION_RE.findall(stripped))
        if language in ("python", "ruby"):
            decisions += len(_BOOL_WORD_RE.findall(stripped))

        cyclomatic = decisions + 1
        nesting = _max_nesting_depth(stripped, language)
        functions = len(_FUNCTION_RE.findall(stripped))
        loc = len(code_lines)

        if cyclomatic <= 10 and nesting <= 3:
            band = "low"
        elif cyclomatic <= 20 and nesting <= 5:
            band = "moderate"
        elif cyclomatic <= 50:
            band = "high"
        else:
            band = "very_high"

        return {
            "lines_total": len(raw_lines),
            "lines_of_code": loc,
            "comment_lines": comment_lines,
            "comment_ratio": round(comment_lines / len(raw_lines), 3) if raw_lines else 0.0,
            "cyclomatic_complexity": cyclomatic,
            "max_nesting_depth": nesting,
            "function_count": functions,
            "longest_line": max((len(ln) for ln in raw_lines), default=0),
            "complexity_band": band,
            "method": "heuristic_token_scan",
        }
    except Exception as exc:  # pragma: no cover — metrics must never fail a submission
        logger.warning("Complexity analysis failed (language=%s): %s", language, exc)
        return {}


_KEYWORDS = {
    "if", "else", "elif", "elsif", "for", "while", "do", "switch", "case", "when",
    "break", "continue", "return", "def", "function", "func", "fn", "lambda",
    "class", "struct", "interface", "enum", "new", "delete", "try", "catch",
    "except", "finally", "rescue", "raise", "throw", "throws", "import", "from",
    "package", "public", "private", "protected", "static", "final", "const",
    "let", "var", "int", "float", "double", "char", "bool", "boolean", "string",
    "void", "long", "short", "unsigned", "auto", "true", "false", "null", "nil",
    "none", "self", "this", "and", "or", "not", "in", "is", "as", "with", "yield",
    "async", "await", "print", "println", "printf", "cout", "cin", "range", "len",
    "append", "push", "map", "filter", "reduce", "sort", "sorted",
}

_TOKEN_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*|\d+\.?\d*|[^\sA-Za-z0-9_]")


def normalize_tokens(code: str, language: str) -> list[str]:
    """Comments/strings removed, identifiers → 'V', numbers → 'N', keywords kept.

    The result is a shape-of-the-program token stream: two submissions that
    differ only in naming, spacing, or literal values normalise to the same
    list.
    """
    stripped = _strip_comments_and_strings(code, language)
    tokens: list[str] = []
    for tok in _TOKEN_RE.findall(stripped):
        first = tok[0]
        if first.isdigit():
            tokens.append("N")
        elif first.isalpha() or first == "_":
            tokens.append(tok if tok.lower() in _KEYWORDS else "V")
        else:
            tokens.append(tok)
    return tokens


def fingerprint(code: str, language: str, k: int | None = None) -> set[str]:
    """k-gram fingerprint set of the normalised token stream.

    Overlapping k-grams (rather than whole-file hashing) are what let this
    detect a partially-copied submission, not only a wholesale duplicate.
    Each k-gram is hashed to keep the stored/compared set small.
    """
    k = k or settings.PLAGIARISM_KGRAM_SIZE
    tokens = normalize_tokens(code, language)
    if len(tokens) < k:
        if not tokens:
            return set()
        return {hashlib.sha1(" ".join(tokens).encode()).hexdigest()[:16]}
    return {
        hashlib.sha1(" ".join(tokens[i:i + k]).encode()).hexdigest()[:16]
        for i in range(len(tokens) - k + 1)
    }


def similarity(a: set[str], b: set[str]) -> float:
    """Jaccard similarity — |A n B| / |A u B|, 0.0 to 1.0.

    Answers "how much of the combined work is shared", which is the right
    question for whole-file duplication and is deliberately unforgiving of
    length differences. It is NOT sufficient on its own — see containment().
    """
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def containment(a: set[str], b: set[str]) -> float:
    """Containment (overlap coefficient) — |A n B| / min(|A|, |B|), 0.0 to 1.0.

    Answers "is one submission wholly inside the other", which Jaccard cannot:
    padding a verbatim copy with unrelated filler inflates the union and drags
    Jaccard down. Measured on a real copy plus 25 throwaway helper functions,
    Jaccard falls to 0.74 — under the 0.80 flag threshold — while containment
    stays at 1.00. Copy-then-pad is the obvious evasion once a candidate knows
    a similarity check exists, so both metrics are computed and the flag fires
    on whichever is higher.
    """
    if not a or not b:
        return 0.0
    return len(a & b) / min(len(a), len(b))


async def check_plagiarism(
    db,
    *,
    question_id: str,
    candidate_id: str,
    code: str,
    language: str,
) -> dict:
    """Compare this submission against other candidates' submissions to the same question.

    Only cross-candidate comparisons count: a candidate resubmitting their own
    near-identical attempt is normal behaviour, not plagiarism, and flagging it
    would make the signal useless.

    Returns (always a dict, never raises):
      checked_against    how many other submissions were compared
      max_similarity     highest similarity found, 0.0–1.0
      flagged            max_similarity >= threshold
      threshold          the configured cutoff, echoed for the UI
      matches            up to 5 highest matches, each with submission_id,
                         candidate_id, similarity, identical_normalized
      truncated          True if the comparison pool was capped

    ADMIN-ONLY DATA: every match names another candidate. routes/coding.py
    strips this key before any candidate-facing response.
    """
    result: dict = {
        "checked_against": 0,
        "max_similarity": 0.0,
        "max_containment": 0.0,
        "flagged": False,
        "threshold": settings.PLAGIARISM_SIMILARITY_THRESHOLD,
        "comparable": False,
        "matches": [],
        "truncated": False,
    }
    if db is None:
        return result

    try:
        mine = fingerprint(code, language)
        if not mine:
            return result

        comparable = len(mine) >= settings.PLAGIARISM_MIN_KGRAMS
        result["comparable"] = comparable

        limit = settings.PLAGIARISM_MAX_COMPARISONS
        cursor = (
            db.coding_submissions
            .find(
                {"question_id": question_id, "candidate_id": {"$ne": candidate_id}},
                {"_id": 0, "submission_id": 1, "candidate_id": 1, "code": 1, "language": 1},
            )
            .sort("submitted_at", -1)
            .limit(limit + 1)
        )
        others = await cursor.to_list(length=limit + 1)
        if len(others) > limit:
            result["truncated"] = True
            others = others[:limit]
            logger.info(
                "Plagiarism check capped at %d prior submissions for question=%s", limit, question_id,
            )

        matches: list[dict] = []
        for other in others:
            other_code = other.get("code") or ""
            if not other_code:
                continue
            theirs = fingerprint(other_code, other.get("language") or language)
            jaccard = similarity(mine, theirs)
            overlap = containment(mine, theirs)
            if jaccard <= 0 and overlap <= 0:
                continue
            matches.append({
                "submission_id": other.get("submission_id"),
                "candidate_id": other.get("candidate_id"),
                "similarity": round(jaccard, 4),
                "containment": round(overlap, 4),
                "score": round(max(jaccard, overlap), 4),
                "identical_normalized": jaccard >= 0.999,
                "one_sided": overlap - jaccard >= 0.2,
            })

        result["checked_against"] = len(others)
        if matches:
            matches.sort(key=lambda m: m["score"], reverse=True)
            top = matches[0]
            result["matches"] = matches[:5]
            result["max_similarity"] = top["similarity"]
            result["max_containment"] = top["containment"]
            result["flagged"] = (
                comparable and top["score"] >= settings.PLAGIARISM_SIMILARITY_THRESHOLD
            )
        return result
    except Exception as exc:  # pragma: no cover — never fail a valid submission
        logger.warning("Plagiarism check failed for question=%s: %s", question_id, exc)
        return result


__all__ = [
    "analyze_complexity",
    "check_plagiarism",
    "containment",
    "fingerprint",
    "normalize_tokens",
    "similarity",
]
