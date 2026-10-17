from __future__ import annotations

from services.hr_module import email_layout

_COLOR, _ON_COLOR, _LOGO = "{{brand_color}}", "{{brand_on_color}}", "{{brand_logo_html}}"
_SIGN = email_layout.signoff("{{email_from_name}}")


def _shell(heading: str, body: str) -> str:
    return email_layout.shell(
        heading, body, color=_COLOR, on_color=_ON_COLOR, logo=_LOGO, footer_name="{{email_from_name}}",
    )


def _button(url_token: str, label: str) -> str:
    return email_layout.button("{{" + url_token + "}}", label, color=_COLOR, on_color=_ON_COLOR)


def _details(rows: list[tuple[str, str]]) -> str:
    return email_layout.details(rows, color=_COLOR)


def _tips(title: str, items: list[str]) -> str:
    return email_layout.tips(title, items)


def _p(text: str) -> str:
    return email_layout.paragraph(text)


PREVIEW_VALUES: dict[str, str] = {
    "candidate_name": "Priya Sharma",
    "job_title": "Senior Backend Engineer",
    "company_name": "Acme Corp",
    "email_from_name": "Acme Corp",
    "interview_url": "https://app.example.com/interview/sample-link",
    "interview_duration_minutes": "20",
    "invite_expiry_days": "7",
    "assessment_url": "https://app.example.com/coding/sample-link",
    "salary": "$120,000 a year",
    "joining_date": "1 December 2026",
    "benefits": "Health insurance and 24 days of leave",
    "accept_url": "https://app.example.com/offer/sample-link",
    "kind": "reminder",
    "platform": "Google Meet",
    "when": "Tuesday 3 November 2026, 10:00 UTC",
    "duration_minutes": "45",
    "join_url": "https://meet.example.com/abc-defg-hij",
    "notes": "Please join two minutes early.",
    "lead": "Your interview has been scheduled.",
    "location": "Acme Corp Head Office, 12 High Street, Lahore",
    "map_url": "https://www.google.com/maps/search/?api=1&query=Acme%20Corp%20Head%20Office%2C%2012%20High%20Street%2C%20Lahore",
    "brand_color": "#4778f3",
    "brand_on_color": "#111827",
    "brand_logo_html": '<span style="color:#111827;font-size:19px;font-weight:700;">Acme Corp</span>',
}


SAMPLES: dict[str, dict[str, str]] = {
    "send_invite_email": {
        "subject": "Interview invitation: {{job_title}}",
        "html": _shell(
            "Interview Invitation",
            _p("Dear <strong>{{candidate_name}}</strong>,")
            + _p(
                "Thank you for your interest in {{email_from_name}}. We reviewed your profile and are pleased to "
                "tell you that you have been shortlisted for the <strong>{{job_title}}</strong> role."
            )
            + _p(
                "Your personalised interview is ready. It takes about <strong>{{interview_duration_minutes}} minutes</strong> "
                "and you can start whenever you are ready."
            )
            + _button("interview_url", "Begin your interview &rarr;")
            + _tips("Before you start", [
                "This link is unique to you, so please do not share it",
                "The interview is timed once you start",
                "Choose a quiet place with a stable internet connection",
                "The link expires in {{invite_expiry_days}} days",
            ])
            + _SIGN,
        ),
        "text": (
            "Dear {{candidate_name}},\n\n"
            "Thank you for your interest in {{email_from_name}}. We reviewed your profile and are pleased to tell you "
            "that you have been shortlisted for the {{job_title}} role.\n\n"
            "Your personalised interview is ready. It takes about {{interview_duration_minutes}} minutes and you can "
            "start whenever you are ready:\n\n  {{interview_url}}\n\n"
            "Before you start:\n"
            "  - This link is unique to you, so please do not share it\n"
            "  - The interview is timed once you start\n"
            "  - Choose a quiet place with a stable internet connection\n"
            "  - The link expires in {{invite_expiry_days}} days\n\n"
            "Best regards,\n{{email_from_name}}"
        ),
    },
    "send_interview_status_email": {
        "subject": "We received your interview for {{job_title}}",
        "html": _shell(
            "Thank You",
            _p("Dear <strong>{{candidate_name}}</strong>,")
            + _p(
                "Thank you for completing your interview for the <strong>{{job_title}}</strong> role, and for the "
                "time and care you put into it. We have received your responses."
            )
            + _p("Our team will now go through everything and be in touch about the next steps. There is nothing more you need to do for now.")
            + _p("If you have any questions in the meantime, just reply to this email.")
            + _SIGN,
        ),
        "text": (
            "Dear {{candidate_name}},\n\n"
            "Thank you for completing your interview for the {{job_title}} role, and for the time and care you put "
            "into it. We have received your responses.\n\n"
            "Our team will now go through everything and be in touch about the next steps. There is nothing more you "
            "need to do for now.\n\n"
            "If you have any questions in the meantime, just reply to this email.\n\n"
            "Best regards,\n{{email_from_name}}"
        ),
    },
    "send_assessment_invitation_email": {
        "subject": "Next step: your assessment for {{job_title}}",
        "html": _shell(
            "Your Assessment",
            _p("Dear <strong>{{candidate_name}}</strong>,")
            + _p(
                "Thank you for your interest in the <strong>{{job_title}}</strong> role. The next step is a short "
                "assessment, which you can complete online whenever suits you."
            )
            + _button("assessment_url", "Start the assessment &rarr;")
            + _tips("Good to know", [
                "The link is unique to you, so please do not share it",
                "Work on your own and in one sitting if you can",
                "The link expires in {{invite_expiry_days}} days",
            ])
            + _SIGN,
        ),
        "text": (
            "Dear {{candidate_name}},\n\n"
            "Thank you for your interest in the {{job_title}} role. The next step is a short assessment, which you "
            "can complete online whenever suits you:\n\n  {{assessment_url}}\n\n"
            "Good to know:\n"
            "  - The link is unique to you, so please do not share it\n"
            "  - Work on your own and in one sitting if you can\n"
            "  - The link expires in {{invite_expiry_days}} days\n\n"
            "Best regards,\n{{email_from_name}}"
        ),
    },
    "send_offer_letter_email": {
        "subject": "Your offer from {{email_from_name}}: {{job_title}}",
        "html": _shell(
            "Your Offer",
            _p("Dear <strong>{{candidate_name}}</strong>,")
            + _p(
                "Congratulations! We are delighted to offer you the <strong>{{job_title}}</strong> position at "
                "{{email_from_name}}. Here are the main terms:"
            )
            + _details([
                ("Position", "{{job_title}}"),
                ("Salary", "{{salary}}"),
                ("Joining date", "{{joining_date}}"),
                ("Benefits", "{{benefits}}"),
            ])
            + _p("Please use the button below to read the full offer and let us know your decision.")
            + _button("accept_url", "Review your offer &rarr;")
            + _p("If you have any questions, reply to this email and we will be happy to help.")
            + _SIGN,
        ),
        "text": (
            "Dear {{candidate_name}},\n\n"
            "Congratulations! We are delighted to offer you the {{job_title}} position at {{email_from_name}}. "
            "Here are the main terms:\n\n"
            "  Position:     {{job_title}}\n"
            "  Salary:       {{salary}}\n"
            "  Joining date: {{joining_date}}\n"
            "  Benefits:     {{benefits}}\n\n"
            "Please use this link to read the full offer and let us know your decision:\n\n  {{accept_url}}\n\n"
            "If you have any questions, reply to this email and we will be happy to help.\n\n"
            "Best regards,\n{{email_from_name}}"
        ),
    },
    "send_rejection_email": {
        "subject": "Your application for {{job_title}}",
        "html": _shell(
            "Your Application",
            _p("Dear <strong>{{candidate_name}}</strong>,")
            + _p(
                "Thank you for your interest in the <strong>{{job_title}}</strong> role at {{email_from_name}} and for "
                "the time you gave to our process."
            )
            + _p("After careful consideration we have decided not to move forward with your application for this position.")
            + _p("We appreciate your interest and encourage you to look at our future openings. We wish you every success in your search.")
            + _SIGN,
        ),
        "text": (
            "Dear {{candidate_name}},\n\n"
            "Thank you for your interest in the {{job_title}} role at {{email_from_name}} and for the time you gave "
            "to our process.\n\n"
            "After careful consideration we have decided not to move forward with your application for this "
            "position.\n\n"
            "We appreciate your interest and encourage you to look at our future openings. We wish you every success "
            "in your search.\n\n"
            "Best regards,\n{{email_from_name}}"
        ),
    },
    "send_reminder_email": {
        "subject": "Reminder: your interview for {{job_title}}",
        "html": _shell(
            "A Quick Reminder",
            _p("Dear <strong>{{candidate_name}}</strong>,")
            + _p(
                "This is a friendly reminder that your interview for the <strong>{{job_title}}</strong> role is still "
                "waiting for you. You can start whenever you are ready."
            )
            + _button("interview_url", "Continue to your interview &rarr;")
            + _p("If something is in the way or you have a question, just reply to this email and we will help.")
            + _SIGN,
        ),
        "text": (
            "Dear {{candidate_name}},\n\n"
            "This is a friendly reminder that your interview for the {{job_title}} role is still waiting for you. "
            "You can start whenever you are ready:\n\n  {{interview_url}}\n\n"
            "If something is in the way or you have a question, just reply to this email and we will help.\n\n"
            "Best regards,\n{{email_from_name}}"
        ),
    },
    "send_external_interview_email": {
        "subject": "Interview for {{job_title}}: {{when}}",
        "html": _shell(
            "Interview Details",
            _p("Dear <strong>{{candidate_name}}</strong>,")
            + _p("{{lead}}")
            + _details([
                ("Role", "{{job_title}}"),
                ("Platform", "{{platform}}"),
                ("When", "{{when}}"),
                ("Duration", "{{duration_minutes}} minutes"),
            ])
            + _button("join_url", "Join the interview &rarr;")
            + _p("{{notes}}")
            + _p("Please join a few minutes early to check your connection. If the time does not work for you, reply to this email.")
            + _SIGN,
        ),
        "text": (
            "Dear {{candidate_name}},\n\n"
            "{{lead}}\n\n"
            "  Role:      {{job_title}}\n"
            "  Platform:  {{platform}}\n"
            "  When:      {{when}}\n"
            "  Duration:  {{duration_minutes}} minutes\n"
            "  Join link: {{join_url}}\n\n"
            "{{notes}}\n\n"
            "Please join a few minutes early to check your connection. If the time does not work for you, reply to "
            "this email.\n\n"
            "Best regards,\n{{email_from_name}}"
        ),
    },
    "send_physical_interview_email": {
        "subject": "Your in-person interview for {{job_title}}: {{when}}",
        "html": _shell(
            "In-person Interview",
            _p("Dear <strong>{{candidate_name}}</strong>,")
            + _p("{{lead}}")
            + _details([
                ("Role", "{{job_title}}"),
                ("Type", "In-person interview"),
                ("When", "{{when}}"),
                ("Duration", "{{duration_minutes}} minutes"),
                ("Location", "{{location}}"),
            ])
            + _button("map_url", "Get directions &rarr;")
            + _p("{{notes}}")
            + _p("Please arrive a few minutes early so we can start on time. If the time does not work for you, reply to this email.")
            + _SIGN,
        ),
        "text": (
            "Dear {{candidate_name}},\n\n"
            "{{lead}}\n\n"
            "  Role:      {{job_title}}\n"
            "  Type:      In-person interview\n"
            "  When:      {{when}}\n"
            "  Duration:  {{duration_minutes}} minutes\n"
            "  Location:  {{location}}\n"
            "  Directions: {{map_url}}\n\n"
            "{{notes}}\n\n"
            "Please arrive a few minutes early so we can start on time. If the time does not work for you, reply to "
            "this email.\n\n"
            "Best regards,\n{{email_from_name}}"
        ),
    },
}
