"""
Static code analysis — MVP2 §2.10's last two named gaps
("plagiarism/complexity analysis").

Pure text processing, so these are unit tests with no DB, no network and no
LLM. The plagiarism assertions are the important ones: the whole point of
normalising identifiers away is that a renamed/reformatted copy still scores
high while an independent solution to the same problem scores low. If those
two ever converge the detector is worthless, so both sides are asserted
against the configured threshold rather than against a bare number.
"""
import pytest

from config.settings import settings
from services.hr_module.code_analysis import (
    analyze_complexity,
    containment,
    fingerprint,
    normalize_tokens,
    similarity,
)

PY_ORIGINAL = '''
import sys

def solve(numbers):
    # add up the even ones
    total = 0
    for n in numbers:
        if n % 2 == 0:
            total += n
    return total

print(solve([int(x) for x in sys.stdin.read().split()]))
'''

PY_RENAMED_COPY = '''
import sys
def compute(values):
    """Sum even values."""
    acc = 0
    for v in values:
        if v % 2 == 0:
            acc += v
    return acc
print(compute([int(y) for y in sys.stdin.read().split()]))
'''

PY_INDEPENDENT = '''
import sys
data = sys.stdin.read().split()
evens = filter(lambda t: int(t) % 2 == 0, data)
print(sum(map(int, evens)))
'''

JS_NESTED = '''
function solve(rows) {
  let total = 0;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i] > 0) {
      for (let j = 0; j < rows[i]; j++) {
        if (j % 3 === 0 || j % 5 === 0) {
          total += j;
        }
      }
    }
  }
  return total;
}
'''


def test_complexity_reports_expected_metrics():
    m = analyze_complexity(PY_ORIGINAL, "python")
    assert m["cyclomatic_complexity"] >= 3
    assert m["max_nesting_depth"] >= 2
    assert m["function_count"] >= 1
    assert m["lines_of_code"] > 0
    assert m["complexity_band"] == "low"
    assert m["method"] == "heuristic_token_scan"


def test_complexity_excludes_comments_from_code_lines():
    """A comment-heavy file must not read as more code than it is."""
    commented = "# c\n" * 20 + "x = 1\n"
    m = analyze_complexity(commented, "python")
    assert m["comment_lines"] >= 20
    assert m["lines_of_code"] == 1


def test_complexity_handles_brace_languages():
    m = analyze_complexity(JS_NESTED, "javascript")
    assert m["max_nesting_depth"] >= 4
    assert m["cyclomatic_complexity"] >= 5


def test_complexity_never_raises_on_garbage():
    for junk in ("", "\x00\x01", "}{)(", "λ→∀"):
        assert isinstance(analyze_complexity(junk, "python"), dict)


_APOSTROPHE_IN_COMMENT = """# don't use recursion, iterate instead
def solve(nums):
    total = 0
    for n in nums:
        if n % 2 == 0:
            total += n
    return total
print('done')
"""


def test_apostrophe_in_a_comment_does_not_swallow_the_program():
    m = analyze_complexity(_APOSTROPHE_IN_COMMENT, "python")
    assert m["lines_of_code"] >= 6, "an apostrophe in a comment erased the program"
    assert m["cyclomatic_complexity"] >= 3
    assert m["function_count"] >= 1


def test_apostrophes_do_not_make_unrelated_programs_look_identical():
    """The dangerous consequence of the bug above: both programs normalised to
    nothing, and nothing matches nothing perfectly — a false accusation."""
    other = """# it's a completely different approach
import sys
print(sum(int(t) for t in sys.stdin.read().split() if int(t) % 3 == 1))
"""
    score = similarity(
        fingerprint(_APOSTROPHE_IN_COMMENT, "python"), fingerprint(other, "python"),
    )
    assert score < settings.PLAGIARISM_SIMILARITY_THRESHOLD, (
        f"two unrelated programs scored {score:.3f} — the comment scanner is erasing code"
    )


def test_comment_markers_inside_a_string_are_not_treated_as_comments():
    """The other half of the contract — fixing the above must not break this."""
    from services.hr_module.code_analysis import _strip_comments_and_strings

    assert "y = 2" in _strip_comments_and_strings('x = "# not a comment"\ny = 2', "python")
    assert "let b" in _strip_comments_and_strings('let a = "http://x"; let b = 1', "javascript")


def test_line_comments_are_still_stripped():
    from services.hr_module.code_analysis import _strip_comments_and_strings

    assert "secret" not in _strip_comments_and_strings("x = 1  # secret note", "python")
    assert "secret" not in _strip_comments_and_strings("let x = 1; // secret", "javascript")
    assert "secret" not in _strip_comments_and_strings("a; /* secret\nmore */ b;", "javascript")
    assert "secret" not in _strip_comments_and_strings('def f():\n    """secret"""\n', "python")


def test_an_unterminated_quote_damages_only_its_own_line():
    from services.hr_module.code_analysis import _strip_comments_and_strings

    out = _strip_comments_and_strings("a = 'oops\nb = 2\nc = 3\n", "python")
    assert "b = 2" in out and "c = 3" in out


def test_escaped_quotes_inside_strings_are_handled():
    from services.hr_module.code_analysis import _strip_comments_and_strings

    assert "y = 2" in _strip_comments_and_strings(r'x = "he said \"hi\""; y = 2', "python")


def test_complexity_bands_escalate():
    simple = analyze_complexity("x = 1\n", "python")
    gnarly = analyze_complexity("\n".join(f"if x == {i}: pass" for i in range(60)), "python")
    assert simple["complexity_band"] == "low"
    assert gnarly["complexity_band"] in ("high", "very_high")


def test_identifier_renaming_does_not_defeat_the_fingerprint():
    """The single most common way a copied submission is disguised."""
    score = similarity(fingerprint(PY_ORIGINAL, "python"), fingerprint(PY_RENAMED_COPY, "python"))
    assert score >= settings.PLAGIARISM_SIMILARITY_THRESHOLD, (
        f"renamed copy scored only {score:.3f}, below the "
        f"{settings.PLAGIARISM_SIMILARITY_THRESHOLD} flag threshold"
    )


def test_independent_solution_scores_below_the_threshold():
    """The other half of the contract — no use catching copies if honest
    submissions to the same short problem also trip the flag."""
    score = similarity(fingerprint(PY_ORIGINAL, "python"), fingerprint(PY_INDEPENDENT, "python"))
    assert score < settings.PLAGIARISM_SIMILARITY_THRESHOLD, (
        f"an independent solution scored {score:.3f} — false positives make the signal useless"
    )


def test_identical_code_scores_one():
    """Reformatted and re-commented, but the same program — must still be 1.0.
    (Comparing a fingerprint to itself would be a tautology, so this compares
    two genuinely different texts.)"""
    reformatted = PY_ORIGINAL.replace("    ", "\t").replace("# add up the even ones", "# sum evens")
    assert similarity(fingerprint(PY_ORIGINAL, "python"), fingerprint(reformatted, "python")) == 1.0


def test_padding_a_verbatim_copy_evades_jaccard_but_not_containment():
    padding = "\n".join(f"def helper_{i}(a, b):\n    return a + b * {i}\n" for i in range(25))
    padded = PY_ORIGINAL + padding

    mine, theirs = fingerprint(PY_ORIGINAL, "python"), fingerprint(padded, "python")
    jaccard, overlap = similarity(mine, theirs), containment(mine, theirs)

    assert jaccard < settings.PLAGIARISM_SIMILARITY_THRESHOLD, (
        "this test is meant to demonstrate Jaccard being evaded; it no longer is"
    )
    assert overlap >= settings.PLAGIARISM_SIMILARITY_THRESHOLD, (
        f"containment {overlap:.3f} did not catch a verbatim copy plus filler"
    )
    assert max(jaccard, overlap) >= settings.PLAGIARISM_SIMILARITY_THRESHOLD


def test_containment_does_not_fire_on_independent_solutions():
    mine, theirs = fingerprint(PY_ORIGINAL, "python"), fingerprint(PY_INDEPENDENT, "python")
    assert containment(mine, theirs) < settings.PLAGIARISM_SIMILARITY_THRESHOLD


def test_containment_handles_empty_sets():
    assert containment(set(), fingerprint(PY_ORIGINAL, "python")) == 0.0
    assert containment(fingerprint(PY_ORIGINAL, "python"), set()) == 0.0


def test_very_short_submissions_fall_below_the_comparability_floor():
    """Two independent one-liners normalise to nearly the same token stream by
    construction, so no similarity number is meaningful there. Such
    submissions are still compared and reported, but must never be flagged."""
    a = fingerprint("n = int(input())\nprint(n * 2)\n", "python")
    b = fingerprint("x = int(input())\nprint(x + 5)\n", "python")

    assert len(a) < settings.PLAGIARISM_MIN_KGRAMS
    assert len(b) < settings.PLAGIARISM_MIN_KGRAMS
    assert similarity(a, b) > 0.4

    assert len(fingerprint(PY_ORIGINAL, "python")) >= settings.PLAGIARISM_MIN_KGRAMS


def test_normalisation_keeps_keywords_and_masks_names_and_numbers():
    tokens = normalize_tokens("def foo(bar):\n    return bar + 42\n", "python")
    assert "def" in tokens and "return" in tokens
    assert "foo" not in tokens and "bar" not in tokens
    assert "V" in tokens and "N" in tokens


def test_comments_and_string_contents_do_not_affect_the_fingerprint():
    a = 'x = "hello"  # one comment\n'
    b = 'x = "totally different string"  # a completely different comment\n'
    assert similarity(fingerprint(a, "python"), fingerprint(b, "python")) == 1.0


def test_short_submissions_still_compare():
    """Below the k-gram window the shingle set would be empty, which would
    match nothing — the whole-stream fallback keeps short answers comparable."""
    a, b = fingerprint("x=1", "python"), fingerprint("y=2", "python")
    assert a and b
    assert similarity(a, b) == 1.0
    assert similarity(a, fingerprint("", "python")) == 0.0


def test_empty_code_yields_no_fingerprint():
    assert fingerprint("", "python") == set()
    assert similarity(set(), fingerprint(PY_ORIGINAL, "python")) == 0.0
