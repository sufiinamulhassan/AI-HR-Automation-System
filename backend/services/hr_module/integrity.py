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
    "phone_detected": -15,
    "identity_mismatch": -20,
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
    score = 100
    for flag in flags or []:
        event = flag.split("@", 1)[0]
        score += _INTEGRITY_WEIGHTS.get(event, _INTEGRITY_UNKNOWN_WEIGHT)
    return max(0, min(100, score))


def compute_typing_ratio(keystrokes: int, code: str, template_length: int = 0) -> float:
    authored = max(len(code or "") - max(template_length, 0), 0)
    if authored <= 0:
        return 1.0
    return round(max(keystrokes, 0) / authored, 3)
