"""
Deterministic integrity scoring shared by the interview and coding assessment.

Lives in its own module rather than inside `interview_engine` so the coding
assessment can score its own sessions without importing the interview feature —
a dependency that would point the wrong way.

The two features keep **separate flag arrays** on the candidate document
(`integrity_flags` for the interview, `coding_integrity_flags` for the coding
assessment). They must never be merged: a candidate's coding tab-switches would
otherwise silently lower their interview integrity score, and neither the score
function nor the report has any way to tell the two sources apart.
"""

_INTEGRITY_WEIGHTS = {
    "tab_switch": -10,
    "window_blur": -8,
    "page_unload_attempt": -20,
    "connection_lost": -5,
    "connection_restored": 0,
    "no_face_detected": -12,
    "multiple_faces_detected": -15,
    "face_detected": 0,
    "gaze_off_screen": -6,
    "gaze_on_screen": 0,
    "terminated_tab_switches": -40,

    "paste_blocked": -8,
    "drop_blocked": -8,
    "paste_burst": -15,
    "low_typing_ratio": -20,
    "time_expired": 0,

    "fullscreen_exit": -12,
    "fullscreen_restored": 0,
    "multiple_displays_detected": -2,
    "screen_share_detected": -25,
}
_INTEGRITY_UNKNOWN_WEIGHT = -3


def compute_integrity_score(flags: list[str]) -> int:
    """Deterministic, event-type-weighted integrity score in [0, 100].

    Each flag entry is a string like "tab_switch@2026-01-01T00:00:00" — the
    event name is everything before the first "@". No LLM call.
    """
    score = 100
    for flag in flags or []:
        event = flag.split("@", 1)[0]
        score += _INTEGRITY_WEIGHTS.get(event, _INTEGRITY_UNKNOWN_WEIGHT)
    return max(0, min(100, score))


def compute_typing_ratio(keystrokes: int, code: str, template_length: int = 0) -> float:
    """Ratio of real keystrokes to characters the candidate actually authored.

    The editor is pre-seeded with the language template, so those characters
    were never typed — not subtracting them would make every honest submission
    look pasted.

    Genuine typing lands at or above ~1.0 (backspaces and retyping push it
    higher). Well below 1.0 means text arrived in the editor without
    corresponding keystrokes.

    NOTE: `keystrokes` is self-reported by the browser and can be forged by a
    determined candidate. This raises the bar against casual cheating; it is
    evidence, not proof, and must be presented to recruiters as such.
    """
    authored = max(len(code or "") - max(template_length, 0), 0)
    if authored <= 0:
        return 1.0
    return round(max(keystrokes, 0) / authored, 3)
