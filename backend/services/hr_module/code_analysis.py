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
    except Exception as exc:
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
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def containment(a: set[str], b: set[str]) -> float:
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
    except Exception as exc:
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
