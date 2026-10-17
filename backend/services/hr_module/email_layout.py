from __future__ import annotations

FONT = "'Segoe UI',Arial,Helvetica,sans-serif"
INK = "#0f172a"
TEXT = "#334155"
MUTED = "#64748b"
FAINT = "#94a3b8"
LINE = "#e3e7ee"
PANEL = "#f8fafc"
PAGE = "#eef1f5"

DEFAULT_FOOTER = "This is an automated message. If you have questions, please contact your recruiter directly."

_SHELL = """<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:__PAGE__;font-family:__FONT__;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:__PAGE__;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid __LINE__;">
        <tr><td style="background:__COLOR__;padding:18px 28px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td align="left" valign="middle">__LOGO__</td>
            <td align="right" valign="middle" style="color:__ON_COLOR__;font-family:__FONT__;font-size:17px;font-weight:700;letter-spacing:0.2px;">__HEADING__</td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:34px 36px 30px;font-family:__FONT__;">
__BODY__
        </td></tr>
        <tr><td style="background:__PANEL__;padding:18px 36px;border-top:1px solid __LINE__;">
          <p style="margin:0;color:__FAINT__;font-family:__FONT__;font-size:12px;line-height:1.7;text-align:center;">__FOOTER_NAME__<br>__FOOTER__</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""


def shell(
    heading: str, body: str, *, color: str, on_color: str, logo: str, footer_name: str, footer: str = DEFAULT_FOOTER,
) -> str:
    out = _SHELL
    for token, value in (
        ("__PAGE__", PAGE), ("__LINE__", LINE), ("__PANEL__", PANEL), ("__FAINT__", FAINT), ("__FONT__", FONT),
        ("__COLOR__", color), ("__ON_COLOR__", on_color), ("__LOGO__", logo), ("__HEADING__", heading),
        ("__BODY__", body), ("__FOOTER_NAME__", footer_name), ("__FOOTER__", footer),
    ):
        out = out.replace(token, value)
    return out


def paragraph(text: str) -> str:
    return f'<p style="color:{TEXT};font-size:15px;line-height:1.7;margin:0 0 14px;">{text}</p>'


def salutation(text: str) -> str:
    return f'<p style="color:{INK};font-size:16px;line-height:1.5;margin:0 0 14px;">{text}</p>'


def greeting(name: str) -> str:
    return salutation(f"Dear <strong>{name}</strong>,")


def small(text: str) -> str:
    return f'<p style="color:{MUTED};font-size:13px;line-height:1.6;margin:0 0 14px;">{text}</p>'


def button(url: str, label: str, *, color: str, on_color: str) -> str:
    return (
        '<div style="text-align:center;margin:30px 0;">'
        f'<a href="{url}" style="background:{color};color:{on_color};text-decoration:none;padding:14px 36px;'
        f'border-radius:8px;border:1px solid rgba(15,23,42,0.12);font-family:{FONT};font-size:16px;font-weight:700;'
        f'display:inline-block;">{label}</a></div>'
    )


def details(rows: list[tuple[str, str]], *, color: str) -> str:
    cells = "".join(
        f'<tr><td style="padding:5px 0;color:{MUTED};font-size:14px;width:120px;vertical-align:top;">{label}</td>'
        f'<td style="padding:5px 0;color:{INK};font-size:14px;font-weight:600;line-height:1.5;">{value}</td></tr>'
        for label, value in rows
    )
    return (
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{PANEL};'
        f'border-left:4px solid {color};border-radius:0 8px 8px 0;margin:18px 0;">'
        f'<tr><td style="padding:12px 20px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">{cells}</table></td></tr></table>'
    )


def tips(title: str, items: list[str]) -> str:
    lis = "".join(f"<li>{item}</li>" for item in items)
    return (
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fffbeb;'
        'border:1px solid #fcd34d;border-radius:8px;margin:6px 0 0;"><tr><td style="padding:14px 18px;">'
        f'<p style="margin:0 0 6px;color:#92400e;font-weight:700;font-size:13px;">{title}</p>'
        f'<ul style="margin:0;padding-left:18px;color:#92400e;font-size:13px;line-height:1.8;">{lis}</ul>'
        "</td></tr></table>"
    )


def note(title: str, text: str) -> str:
    return (
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{PANEL};'
        f'border:1px solid {LINE};border-radius:8px;margin:0 0 20px;"><tr><td style="padding:14px 18px;">'
        f'<p style="margin:0 0 6px;color:{INK};font-weight:700;font-size:13px;">{title}</p>'
        f'<p style="margin:0;color:{TEXT};font-size:14px;line-height:1.6;white-space:pre-wrap;">{text}</p>'
        "</td></tr></table>"
    )


def success(text: str) -> str:
    return (
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;'
        'border:1px solid #bbf7d0;border-radius:8px;margin:18px 0;"><tr><td style="padding:14px 20px;">'
        f'<p style="margin:0;color:#166534;font-size:15px;line-height:1.6;">&#10003;&nbsp; {text}</p>'
        "</td></tr></table>"
    )


def code_box(code: str) -> str:
    return (
        '<div style="text-align:center;margin:26px 0;">'
        f'<span style="display:inline-block;background:{PANEL};border:1px solid {LINE};border-radius:8px;'
        f'padding:14px 30px;font-size:30px;letter-spacing:8px;font-weight:700;color:{INK};">{code}</span></div>'
    )


def signoff(name: str) -> str:
    return (
        f'<p style="color:{MUTED};font-size:14px;line-height:1.6;margin:28px 0 0;">Best regards,<br>'
        f'<strong style="color:{INK};">{name}</strong></p>'
    )
