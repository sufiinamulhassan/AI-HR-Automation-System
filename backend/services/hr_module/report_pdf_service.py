from __future__ import annotations

import io
import logging
import re
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timezone
from functools import lru_cache, partial
from xml.sax.saxutils import escape

from services.hr_module.branding_service import DEFAULT_ACCENT_COLOR, DEFAULT_PRIMARY_COLOR

logger = logging.getLogger(__name__)

SCORECARD_SOURCE = "interviewer_scorecard"
NOT_APPLICABLE = "Not applicable"

_DIMENSION_LABELS = {
    "technical": "Technical",
    "communication": "Communication",
    "problem_solving": "Problem solving",
    "cultural_fit": "Cultural fit",
    "confidence": "Confidence",
}
_ROLE_LABELS = {"hr": "HR", "engineer": "Engineer", "hiring_manager": "Hiring manager", "other": "Interviewer"}
_RECOMMENDATION_LABELS = {"strong_hire": "Strong hire", "hire": "Hire", "hold": "Hold", "no_hire": "No hire"}

PAGE_MARGIN = 42
FOOTER_ZONE = 58
FIRST_HEADER_ZONE = 104
LATER_HEADER_ZONE = 56

MAX_TRANSCRIPT_CHARS = 2500
MAX_RATIONALE_CHARS = 700
MAX_NOTE_CHARS = 600
MAX_LIST_ITEMS = 6
MAX_LIST_ITEM_CHARS = 280
MAX_LOG_ROWS = 60

_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
_GOOD, _MID, _LOW = "#15803d", "#b45309", "#b91c1c"
_INK, _GREY, _LINE, _PANEL = "#1f2937", "#6b7280", "#e5e7eb", "#f9fafb"
_RECOMMENDATION_COLORS = {
    "strong_hire": _GOOD, "hire": _GOOD, "maybe": _MID, "hold": _MID, "reject": _LOW, "no_hire": _LOW,
}


@dataclass(frozen=True)
class Letterhead:
    company_name: str = ""
    logo: bytes | None = None
    header_text: str = ""
    footer_text: str = ""
    primary: str = DEFAULT_PRIMARY_COLOR
    accent: str = DEFAULT_ACCENT_COLOR


def _hex(value, default: str) -> str:
    return value if isinstance(value, str) and _HEX.match(value) else default


def _luminance(color: str) -> float:
    red, green, blue = (int(color[i:i + 2], 16) / 255 for i in (1, 3, 5))
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue


def _tidy_lines(value) -> str:
    lines = (" ".join(_printable(line).split()) for line in str(value or "").splitlines())
    return "\n".join(line for line in lines if line)


def letterhead_from_branding(branding: dict | None, *, company_name: str | None, logo: bytes | None) -> Letterhead:
    branding = branding or {}
    template = branding.get("letterhead_template") or {}
    accent = _hex(branding.get("accent_color"), DEFAULT_ACCENT_COLOR)
    if _luminance(accent) > 0.6:
        accent = DEFAULT_ACCENT_COLOR
    return Letterhead(
        company_name=_printable((company_name or "").strip()),
        logo=logo or None,
        header_text=_tidy_lines(template.get("header_text") or branding.get("letterhead_header_text")),
        footer_text=_tidy_lines(template.get("footer_text") or branding.get("letterhead_footer_text")),
        primary=_hex(branding.get("primary_color"), DEFAULT_PRIMARY_COLOR),
        accent=accent,
    )


def score_text(value, suffix: str = "/100") -> str:
    return NOT_APPLICABLE if value is None else f"{value}{suffix}"


def _encodable(char: str) -> bool:
    try:
        char.encode("cp1252")
    except UnicodeEncodeError:
        return False
    return True


def _printable(text: str) -> str:
    return "".join(char if _encodable(char) else "?" for char in text)


def _para_text(value) -> str:
    text = _printable("" if value is None else str(value))
    return escape(text).replace("\r\n", "\n").replace("\n", "<br/>")


def _message_text(value, limit: int) -> str:
    text = _clip(value, limit)
    letters = [char for char in text if char.isalpha()]
    foreign = [char for char in letters if not _encodable(char)]
    if letters and len(foreign) / len(letters) > 0.3:
        script = unicodedata.name(foreign[0], "").split(" ")[0].title() or "another"
        return f"[This message is written in a script this PDF cannot show ({script}). Read it in the app.]"
    return _para_text(text)


def _clip(value, limit: int) -> str:
    text = "" if value is None else str(value).strip()
    return text if len(text) <= limit else text[: limit - 3].rstrip() + "..."


def _is_number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _band(score) -> str:
    return _GOOD if score >= 70 else _MID if score >= 40 else _LOW


def _parse_time(value) -> datetime | None:
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, str) and value.strip():
        try:
            parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        except ValueError:
            return None
    else:
        return None
    return (parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)).astimezone(timezone.utc)


def _when(value) -> str | None:
    parsed = _parse_time(value)
    if parsed is not None:
        return parsed.strftime("%d %b %Y, %H:%M UTC")
    return str(value) if value else None


def _duration(started, ended) -> str | None:
    begin, end = _parse_time(started), _parse_time(ended)
    if begin is None or end is None or end <= begin:
        return None
    minutes = round((end - begin).total_seconds() / 60)
    return f"{minutes} min" if minutes < 120 else f"{minutes // 60} h {minutes % 60} min"


def _words(name) -> str:
    return str(name or "").replace("_", " ").strip().capitalize()


@lru_cache(maxsize=1)
def _drawing_classes():
    from reportlab.lib.colors import HexColor
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.utils import ImageReader, simpleSplit
    from reportlab.pdfgen import canvas
    from reportlab.platypus import Flowable

    class ScoreBar(Flowable):

        def __init__(self, value, width, height=7):
            super().__init__()
            self.value, self.width, self.height = value, width, height

        def wrap(self, avail_width, avail_height):
            return self.width, self.height

        def draw(self):
            self.canv.setFillColor(HexColor(_LINE))
            self.canv.roundRect(0, 0, self.width, self.height, 3, stroke=0, fill=1)
            share = max(0.0, min(float(self.value), 100.0)) / 100
            if share > 0:
                self.canv.setFillColor(HexColor(_band(self.value)))
                self.canv.roundRect(0, 0, max(self.width * share, 3), self.height, 3, stroke=0, fill=1)

    class LetterheadCanvas(canvas.Canvas):

        def __init__(self, *args, letterhead: Letterhead, subject: str, **kwargs):
            super().__init__(*args, **kwargs)
            self._letterhead, self._subject, self._saved = letterhead, subject, []
            self._logo = None
            if letterhead.logo:
                try:
                    self._logo = ImageReader(io.BytesIO(letterhead.logo))
                except Exception as exc:
                    logger.warning("report pdf: logo could not be placed, rendering without it | error=%s", exc)

        def showPage(self):
            self._saved.append(dict(self.__dict__))
            self._startPage()

        def save(self):
            total = len(self._saved)
            for state in self._saved:
                self.__dict__.update(state)
                self._decorate(self._pageNumber, total)
                super().showPage()
            super().save()

        def _decorate(self, number: int, total: int):
            width, height = letter
            lh = self._letterhead
            self.saveState()
            self.setFillColor(HexColor(lh.primary))
            self.rect(0, height - (8 if number == 1 else 4), width, 8 if number == 1 else 4, stroke=0, fill=1)
            if number == 1:
                self._first_header(width, height)
            else:
                self._later_header(width, height)
            self._footer(width, number, total)
            self.restoreState()

        def _first_header(self, width, height):
            lh, left, right = self._letterhead, PAGE_MARGIN, width - PAGE_MARGIN
            text_x = left
            if self._logo is not None:
                logo_w, logo_h = self._logo.getSize()
                scale = min(150 / logo_w, 50 / logo_h)
                draw_w, draw_h = logo_w * scale, logo_h * scale
                self.drawImage(self._logo, left, height - 22 - draw_h, draw_w, draw_h, mask="auto")
                text_x = left + draw_w + 14
            self.setFillColor(HexColor(lh.accent))
            self.setFont("Helvetica-Bold", 15)
            self.drawString(text_x, height - 44, lh.company_name or "Interview report")
            if lh.header_text:
                self.setFillColor(HexColor(_GREY))
                self.setFont("Helvetica", 8)
                lines = simpleSplit(lh.header_text, "Helvetica", 8, 230)[:5]
                for index, line in enumerate(lines):
                    self.drawRightString(right, height - 32 - index * 10, line)
            self.setStrokeColor(HexColor(_LINE))
            self.setLineWidth(0.8)
            self.line(left, height - 90, right, height - 90)

        def _later_header(self, width, height):
            lh, left, right = self._letterhead, PAGE_MARGIN, width - PAGE_MARGIN
            self.setFillColor(HexColor(lh.accent))
            self.setFont("Helvetica-Bold", 9)
            self.drawString(left, height - 30, lh.company_name or "Interview report")
            self.setFillColor(HexColor(_GREY))
            self.setFont("Helvetica", 8.5)
            self.drawRightString(right, height - 30, self._subject)
            self.setStrokeColor(HexColor(_LINE))
            self.setLineWidth(0.8)
            self.line(left, height - 40, right, height - 40)

        def _footer(self, width, number, total):
            lh, left, right = self._letterhead, PAGE_MARGIN, width - PAGE_MARGIN
            self.setStrokeColor(HexColor(_LINE))
            self.setLineWidth(0.8)
            self.line(left, 50, right, 50)
            if lh.footer_text:
                self.setFillColor(HexColor(_GREY))
                self.setFont("Helvetica", 7.5)
                for index, line in enumerate(simpleSplit(lh.footer_text, "Helvetica", 7.5, width - 2 * PAGE_MARGIN)[:2]):
                    self.drawCentredString(width / 2, 40 - index * 9, line)
            self.setFillColor(HexColor(_GREY))
            self.setFont("Helvetica", 7)
            self.drawString(left, 16, "Confidential. For authorised hiring staff only.")
            self.drawRightString(right, 16, f"Page {number} of {total}")

    return ScoreBar, LetterheadCanvas


def _styles(accent: str) -> dict:
    from reportlab.lib import colors
    from reportlab.lib.styles import ParagraphStyle

    ink = colors.HexColor(accent)
    body = ParagraphStyle("body", fontName="Helvetica", fontSize=9.5, leading=13.5, textColor=colors.HexColor(_INK))
    cell = ParagraphStyle("cell", parent=body, fontSize=8.4, leading=11)
    return {
        "body": body,
        "cell": cell,
        "cell_bold": ParagraphStyle("cellBold", parent=cell, fontName="Helvetica-Bold"),
        "head": ParagraphStyle("head", parent=cell, fontName="Helvetica-Bold", textColor=colors.white),
        "label": ParagraphStyle("label", parent=cell, fontSize=7, leading=9, fontName="Helvetica-Bold", textColor=colors.HexColor(_GREY)),
        "tile": ParagraphStyle("tile", parent=body, fontName="Helvetica-Bold", fontSize=20, leading=24),
        "title": ParagraphStyle("title", parent=body, fontName="Helvetica-Bold", fontSize=20, leading=24, textColor=ink),
        "subtitle": ParagraphStyle("subtitle", parent=body, fontSize=10, leading=13, textColor=colors.HexColor(_GREY)),
        "heading": ParagraphStyle("heading", parent=body, fontName="Helvetica-Bold", fontSize=11.5, leading=14, textColor=ink, spaceBefore=4, spaceAfter=3),
        "bullet": ParagraphStyle("bullet", parent=body, fontSize=9, leading=12.5, leftIndent=10, firstLineIndent=-10, spaceAfter=3),
        "summary": ParagraphStyle(
            "summary", parent=body, backColor=colors.HexColor(_PANEL), borderColor=colors.HexColor(_LINE), borderWidth=0.6,
            borderPadding=(8, 9, 8, 9), leftIndent=9, rightIndent=9, spaceBefore=8, spaceAfter=8,
        ),
        "notice": ParagraphStyle(
            "notice", parent=body, textColor=colors.HexColor(_LOW), backColor=colors.HexColor("#fef2f2"),
            borderPadding=(6, 8, 6, 8), leftIndent=8, rightIndent=8, spaceAfter=8,
        ),
    }


def _table_style(accent: str, *, header: bool = True, zebra: bool = True, valign: str = "MIDDLE") -> list:
    from reportlab.lib import colors

    commands = [
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor(_LINE)),
        ("VALIGN", (0, 0), (-1, -1), valign),
        ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]
    if header:
        commands += [("BACKGROUND", (0, 0), (-1, 0), colors.HexColor(accent))]
    if zebra:
        commands += [("ROWBACKGROUNDS", (0, 1 if header else 0), (-1, -1), [colors.white, colors.HexColor(_PANEL)])]
    return commands


def _section(title: str, st: dict) -> list:
    from reportlab.lib import colors
    from reportlab.platypus import CondPageBreak, HRFlowable, Paragraph, Spacer

    return [
        CondPageBreak(110), Spacer(1, 10), Paragraph(_para_text(title), st["heading"]),
        HRFlowable(width="100%", thickness=0.8, color=colors.HexColor(_LINE), spaceAfter=6),
    ]


def _info_grid(candidate: dict, report: dict, job: dict, from_scorecards: bool, generated_at: datetime, st: dict) -> list:
    from reportlab.lib import colors
    from reportlab.platypus import Paragraph, Table, TableStyle

    ended = candidate.get("interview_ended_at") or (candidate.get("external_review") or {}).get("interviewed_at")
    pairs = [
        ("EMAIL", candidate.get("email")),
        ("POSITION", job.get("title")),
        ("INTERVIEW", "Interviewer scorecards" if from_scorecards else "AI interview"),
        ("INTERVIEWED", _when(ended)),
        ("DURATION", None if from_scorecards else _duration(candidate.get("interview_started_at"), candidate.get("interview_ended_at"))),
        ("GENERATED", _when(generated_at)),
    ]
    pairs = [(label, value) for label, value in pairs if value]
    if len(pairs) % 2:
        pairs.append(("", ""))
    rows = []
    for i in range(0, len(pairs), 2):
        (l1, v1), (l2, v2) = pairs[i], pairs[i + 1]
        rows.append([
            Paragraph(l1, st["label"]), Paragraph(_para_text(v1), st["cell"]),
            Paragraph(l2, st["label"]), Paragraph(_para_text(v2), st["cell"]),
        ])
    table = Table(rows, colWidths=[78, 186, 78, 186], style=TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor(_LINE)),
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(_PANEL)),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
    ]))
    return [table]


def _tiles(candidate: dict, report: dict, from_scorecards: bool, st: dict) -> list:
    from reportlab.lib import colors
    from reportlab.platypus import Paragraph, Table, TableStyle

    breakdown = report.get("score_breakdown") or {}
    final = report.get("final_score", breakdown.get("final_score"))
    tiles: list[tuple[str, str]] = []
    if report.get("evaluation_status") == "insufficient_transcript":
        tiles.append(("FINAL SCORE", f'<font size="13" color="{_GREY}">Not scored</font>'))
    elif _is_number(final):
        tiles.append(("FINAL SCORE", f'<font color="{_band(final)}">{final}</font><font size="9" color="{_GREY}"> /100</font>'))
    recommendation = str(report.get("recommendation") or "")
    if recommendation:
        color = _RECOMMENDATION_COLORS.get(recommendation, _GREY)
        tiles.append(("RECOMMENDATION", f'<font size="14" color="{color}">{_para_text(recommendation.replace("_", " ").upper())}</font>'))
    integrity = report.get("integrity_score")
    if not from_scorecards and _is_number(integrity):
        tiles.append(("INTEGRITY", f'<font color="{_band(integrity)}">{integrity}</font><font size="9" color="{_GREY}"> /100</font>'))
    match = candidate.get("match_score")
    if _is_number(match):
        tiles.append(("MATCH SCORE", f'<font color="{_band(match * 100)}">{round(match * 100)}</font><font size="9" color="{_GREY}"> %</font>'))
    if not tiles:
        return []

    gap = 8
    width = (528 - gap * (len(tiles) - 1)) / len(tiles)
    cells, widths, commands = [], [], [("VALIGN", (0, 0), (-1, -1), "MIDDLE")]
    for index, (label, value) in enumerate(tiles):
        column = index * 2
        cells.append([Paragraph(label, st["label"]), Paragraph(value, st["tile"])])
        widths.append(width)
        commands += [
            ("BOX", (column, 0), (column, 0), 0.6, colors.HexColor(_LINE)),
            ("BACKGROUND", (column, 0), (column, 0), colors.HexColor(_PANEL)),
            ("TOPPADDING", (column, 0), (column, 0), 8), ("BOTTOMPADDING", (column, 0), (column, 0), 8),
            ("LEFTPADDING", (column, 0), (column, 0), 10),
        ]
        if index < len(tiles) - 1:
            cells.append("")
            widths.append(gap)
    return [Table([cells], colWidths=widths, style=TableStyle(commands))]


def _scores_table(report: dict, from_scorecards: bool, st: dict, accent: str) -> list:
    from reportlab.platypus import Paragraph, Table, TableStyle

    bar_class = _drawing_classes()[0]
    rows = [[Paragraph("Dimension", st["head"]), Paragraph("Score", st["head"]), Paragraph("", st["head"])]]

    def add(label: str, value) -> None:
        rows.append([
            Paragraph(_para_text(label), st["cell"]),
            Paragraph(score_text(value), st["cell_bold"]),
            bar_class(value, 250) if _is_number(value) else "",
        ])

    add("Interviewer overall" if from_scorecards else "AI overall" if report.get("score_breakdown") else "Overall", report.get("overall_score"))
    add("Technical", report.get("technical_score"))
    add("Communication", report.get("communication_score"))
    add("Problem Solving", report.get("problem_solving_score"))
    add("Cultural Fit", report.get("cultural_fit_score"))
    add("Confidence", report.get("confidence_score"))
    if not from_scorecards:
        add("Integrity", report.get("integrity_score"))
    if report.get("coding_score") is not None:
        add("Coding (tests passed)", report["coding_score"])
    if report.get("coding_quality_score") is not None:
        add("Coding (AI quality)", report["coding_quality_score"])
    for dim, val in (report.get("scenario_scores") or {}).items():
        add(str(dim).replace("_", " ").title(), val)
    return _section("Scores", st) + [
        Table(rows, colWidths=[140, 110, 278], repeatRows=1, style=TableStyle(_table_style(accent)))
    ]


def _breakdown(report: dict, from_scorecards: bool, st: dict, accent: str) -> list:
    from reportlab.lib import colors
    from reportlab.platypus import CondPageBreak, Paragraph, Spacer, Table, TableStyle

    breakdown = report.get("score_breakdown") or {}
    dimensions =[d for d in breakdown.get("dimensions") or [] if isinstance(d, dict)]
    if not dimensions:
        return []
    rows = [[Paragraph(h, st["head"]) for h in ("Dimension", "Score", "Weight", "Adds", "Evidence")]]
    total = 0.0
    for dim in dimensions:
        score = dim.get("score") if _is_number(dim.get("score")) else 0
        weight = dim.get("weight") if _is_number(dim.get("weight")) else 0
        share = weight * 100 if weight <= 1 else weight
        contribution = score * (weight if weight <= 1 else weight / 100)
        total += contribution
        rows.append([
            Paragraph(_para_text(_words(dim.get("name"))), st["cell_bold"]),
            Paragraph(f"{score}/100", st["cell"]),
            Paragraph(f"{round(share)}%", st["cell"]),
            Paragraph(f"{contribution:.1f}", st["cell"]),
            Paragraph(_para_text(_clip(dim.get("rationale"), MAX_RATIONALE_CHARS) or "-"), st["cell"]),
        ])
    summary_rows = [("Weighted score", f"{total:.1f}", "The dimension scores above, by their weights.")]
    multiplier = breakdown.get("integrity_multiplier")
    if not from_scorecards and _is_number(multiplier):
        note = "Integrity lowers the score; a clean session leaves it unchanged."
        summary_rows.append(("Integrity multiplier", f"x{multiplier}", note))
    final = report.get("final_score", breakdown.get("final_score"))
    if _is_number(final):
        summary_rows.append(("Final score", f"{final}/100", "Weighted score x integrity multiplier, rounded."
                             if not from_scorecards else "The weighted score, rounded."))
    commands = _table_style(accent, valign="TOP")
    for label, value, note in summary_rows:
        rows.append([Paragraph(label, st["cell_bold"]), "", "", Paragraph(value, st["cell_bold"]), Paragraph(note, st["cell"])])
        row = len(rows) - 1
        commands += [("SPAN", (0, row), (2, row)), ("BACKGROUND", (0, row), (-1, row), colors.HexColor("#f3f4f6"))]
    out = _section("Score breakdown", st) + [
        Table(rows, colWidths=[86, 48, 46, 46, 302], repeatRows=1, style=TableStyle(commands)),
    ]

    deductions = [d for d in breakdown.get("integrity_deductions") or [] if isinstance(d, dict)]
    if not from_scorecards and deductions:
        deductions.sort(key=lambda d: str(d.get("timestamp") or ""))
        ledger = [[Paragraph(h, st["head"]) for h in ("Integrity event", "When", "Points")]]
        for item in deductions[:MAX_LOG_ROWS]:
            ledger.append([
                Paragraph(_para_text(_words(item.get("event"))), st["cell"]),
                Paragraph(_para_text(_when(item.get("timestamp")) or "-"), st["cell"]),
                Paragraph(_para_text(item.get("points")), st["cell"]),
            ])
        out += [CondPageBreak(100), Spacer(1, 10), Paragraph("Integrity deductions", st["cell_bold"]), Spacer(1, 4),
                Table(ledger, colWidths=[250, 200, 78], repeatRows=1, style=TableStyle(_table_style(accent)))]
    return out


def _bullet_list(items: list, st: dict, color: str) -> list:
    from reportlab.platypus import Paragraph

    return [
        Paragraph(f'<font color="{color}">&bull;</font>&nbsp;&nbsp;{_para_text(_clip(item, MAX_LIST_ITEM_CHARS))}', st["bullet"])
        for item in items[:MAX_LIST_ITEMS]
    ]


def _strengths_and_areas(report: dict, st: dict) -> list:
    from reportlab.lib import colors
    from reportlab.platypus import Paragraph, Table, TableStyle

    strengths = [s for s in report.get("strengths") or [] if s]
    areas = [a for a in report.get("areas_for_improvement") or [] if a]
    if not strengths and not areas:
        return []
    both = bool(strengths and areas)
    columns = []
    for name, items, color in (("Strengths", strengths, _GOOD), ("Areas for Improvement", areas, _MID)):
        if items:
            heading = [Paragraph(f'<font color="{color}"><b>{name}</b></font>', st["body"])] if both else []
            columns.append(heading + _bullet_list(items, st, color))
    title = "Strengths and areas to improve" if both else "Strengths" if strengths else "Areas for improvement"
    each = 528 / len(columns)
    table = Table([columns], colWidths=[each] * len(columns), style=TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor(_LINE)),
        ("LINEAFTER", (0, 0), (-2, -1), 0.6, colors.HexColor(_LINE)),
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(_PANEL)),
        ("LEFTPADDING", (0, 0), (-1, -1), 10), ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return _section(title, st) + [table]


def _scorecard_sections(report: dict, st: dict, accent: str) -> list:
    from reportlab.platypus import Paragraph, Table, TableStyle

    out: list = []
    interviewers = report.get("interviewers") or []
    if interviewers:
        out += _section("Interviewers", st)
        for person in interviewers:
            role = _ROLE_LABELS.get(person.get("role"), "Interviewer")
            rec = _RECOMMENDATION_LABELS.get(person.get("recommendation"), "No recommendation")
            overall = score_text(person.get("overall"), "/5")
            out.append(Paragraph(
                f"&bull;&nbsp;&nbsp;{_para_text(person.get('name'))} ({_para_text(role)}): {_para_text(rec)}, overall {_para_text(overall)}",
                st["bullet"],
            ))

    rows = [[Paragraph(h, st["head"]) for h in ("Question", "Area", "Interviewer", "Rating", "Notes")]]
    for question in report.get("questions") or []:
        for entry in question.get("entries") or []:
            rating = entry.get("rating")
            rows.append([
                Paragraph(_para_text(_clip(question.get("text"), MAX_NOTE_CHARS)), st["cell"]),
                Paragraph(_para_text(_DIMENSION_LABELS.get(question.get("dimension"), question.get("dimension"))), st["cell"]),
                Paragraph(_para_text(f"{entry.get('by')} ({_ROLE_LABELS.get(entry.get('role'), 'Interviewer')})"), st["cell"]),
                Paragraph("Not asked" if rating is None else f"{rating}/5", st["cell"]),
                Paragraph(_para_text(_clip(entry.get("notes"), MAX_NOTE_CHARS) or "-"), st["cell"]),
            ])
    if len(rows) > 1:
        out += _section("Questions", st) + [
            Table(rows, colWidths=[120, 55, 70, 42, 241], repeatRows=1, style=TableStyle(_table_style(accent, valign="TOP")))
        ]
    return out


def _integrity_section(candidate: dict, report: dict, st: dict, accent: str) -> list:
    from reportlab.platypus import CondPageBreak, Paragraph, Spacer, Table, TableStyle

    out = _section("Integrity Assessment", st) + [
        Paragraph(_para_text(report.get("integrity_assessment") or "No integrity flags to report."), st["body"]),
    ]
    flags = [str(f) for f in candidate.get("integrity_flags") or [] if f]
    if flags:
        rows = [[Paragraph(h, st["head"]) for h in ("Proctoring event", "When")]]
        for flag in flags[:MAX_LOG_ROWS]:
            event, _, stamp = flag.partition("@")
            rows.append([Paragraph(_para_text(_words(event)), st["cell"]), Paragraph(_para_text(_when(stamp) or "-"), st["cell"])])
        if len(flags) > MAX_LOG_ROWS:
            rows.append([Paragraph(f"{len(flags) - MAX_LOG_ROWS} more events not shown", st["cell"]), ""])
        out += [CondPageBreak(100), Spacer(1, 8), Paragraph("Proctoring log", st["cell_bold"]), Spacer(1, 4),
                Table(rows, colWidths=[300, 228], repeatRows=1, style=TableStyle(_table_style(accent)))]
    return out


def _turns(transcript) -> list[tuple[str, str]]:
    turns: list[tuple[str, str]] = []
    for entry in transcript or []:
        if not isinstance(entry, dict):
            continue
        question, answer = entry.get("question"), entry.get("answer")
        if question or answer:
            if question:
                turns.append(("Interviewer", str(question)))
            turns.append(("Candidate", str(answer) if answer else "(no answer)"))
            continue
        content = entry.get("content")
        if content:
            role = str(entry.get("role") or "unknown").lower()
            speaker = "Interviewer" if role in ("assistant", "interviewer", "ai", "system") else (
                "Candidate" if role in ("user", "candidate") else role.capitalize())
            turns.append((speaker, str(content)))
    return turns


def _transcript_section(candidate: dict, st: dict, accent: str) -> list:
    from reportlab.platypus import PageBreak, Paragraph, Table, TableStyle

    turns = _turns(candidate.get("transcript"))
    if not turns:
        return []
    rows = [[Paragraph(h, st["head"]) for h in ("#", "Speaker", "Message")]]
    for number, (speaker, text) in enumerate(turns, 1):
        color = _GREY if speaker == "Interviewer" else accent
        rows.append([
            Paragraph(str(number), st["cell"]),
            Paragraph(f'<font color="{color}"><b>{_para_text(speaker)}</b></font>', st["cell"]),
            Paragraph(_message_text(text, MAX_TRANSCRIPT_CHARS), st["cell"]),
        ])
    return [PageBreak()] + _section("Interview transcript", st) + [
        Paragraph(f"{len(turns)} message{'s' if len(turns) != 1 else ''}", st["subtitle"]),
        Table(rows, colWidths=[26, 62, 440], repeatRows=1, splitInRow=1, style=TableStyle(_table_style(accent, valign="TOP"))),
    ]


def _story(candidate: dict, report: dict, job: dict, from_scorecards: bool, generated_at: datetime, st: dict, accent: str) -> list:
    from reportlab.platypus import Paragraph, Spacer

    story: list = [Paragraph(f"Interview Report: {_para_text(candidate.get('name', ''))}", st["title"])]
    if job.get("title"):
        story.append(Paragraph(_para_text(job["title"]), st["subtitle"]))
    story += [Spacer(1, 10)] + _info_grid(candidate, report, job, from_scorecards, generated_at, st) + [Spacer(1, 10)]
    story += _tiles(candidate, report, from_scorecards, st)

    if report.get("report_status") == "failed":
        story.append(Paragraph(
            f"Report generation failed: {_para_text(report.get('report_error') or 'No error details were recorded.')}", st["notice"],
        ))
    if from_scorecards:
        label = _RECOMMENDATION_LABELS.get(report.get("interviewer_recommendation"))
        if label:
            story.append(Paragraph(f"Interviewer recommendation: {_para_text(label)}", st["body"]))
        if report.get("interview_platform"):
            story.append(Paragraph(f"Interview held on {_para_text(report['interview_platform'])}", st["body"]))

    if report.get("summary"):
        story += _section("Summary", st) + [Paragraph(_para_text(report["summary"]), st["summary"])]
    story += _scores_table(report, from_scorecards, st, accent)
    story += _breakdown(report, from_scorecards, st, accent)
    story += _strengths_and_areas(report, st)
    if from_scorecards:
        story += _scorecard_sections(report, st, accent)
        if report.get("integrity_assessment"):
            story += _integrity_section(candidate, report, st, accent)
    else:
        story += _integrity_section(candidate, report, st, accent)
        story += _transcript_section(candidate, st, accent)
    return story


def build_report_pdf(
    candidate: dict, *, job: dict | None = None, letterhead: Letterhead | None = None, generated_at: datetime | None = None,
) -> bytes:
    from reportlab.lib.pagesizes import letter
    from reportlab.platypus import BaseDocTemplate, Frame, PageTemplate

    report = candidate["report"]
    job = job or {}
    letterhead = letterhead or Letterhead()
    generated_at = generated_at or datetime.now(timezone.utc)
    from_scorecards = report.get("source") == SCORECARD_SOURCE
    subject = f"Interview Report: {candidate.get('name', '')}"

    story = _story(candidate, report, job, from_scorecards, generated_at, _styles(letterhead.accent), letterhead.accent)

    width, height = letter
    frame_width = width - 2 * PAGE_MARGIN
    flat = {"leftPadding": 0, "rightPadding": 0, "topPadding": 0, "bottomPadding": 0}
    buf = io.BytesIO()
    doc = BaseDocTemplate(
        buf, pagesize=letter, title=subject, author=letterhead.company_name or "", subject="Interview report",
        leftMargin=PAGE_MARGIN, rightMargin=PAGE_MARGIN, topMargin=FIRST_HEADER_ZONE, bottomMargin=FOOTER_ZONE,
    )
    doc.addPageTemplates([
        PageTemplate(id="first", autoNextPageTemplate="later", frames=[
            Frame(PAGE_MARGIN, FOOTER_ZONE, frame_width, height - FOOTER_ZONE - FIRST_HEADER_ZONE, id="first", **flat)]),
        PageTemplate(id="later", frames=[
            Frame(PAGE_MARGIN, FOOTER_ZONE, frame_width, height - FOOTER_ZONE - LATER_HEADER_ZONE, id="later", **flat)]),
    ])
    canvas_class = _drawing_classes()[1]
    doc.build(story, canvasmaker=partial(canvas_class, letterhead=letterhead, subject=_printable(subject)))
    return buf.getvalue()
