from typing import Literal


def _invitation_body(introduction: str, link: str) -> str:
    return "\n\n".join((
        "Hallo,",
        introduction,
        f"Nimm die Einladung über diesen Link an:\n{link}",
        (
            "Wenn du bereits ein Konto hast, melde dich mit deiner E-Mail-Adresse an. "
            "Andernfalls kannst du beim Öffnen des Links ein Passwort festlegen. "
            "Der Link gilt 48 Stunden und kann nur einmal verwendet werden."
        ),
        (
            "Falls du keine Einladung erwartet hast, kannst du diese E-Mail ignorieren. "
            "Ohne Annahme erhältst du keinen Zugang."
        ),
        "Viele Grüße\ndein Team der Programmplanung",
    ))


def event_invitation_mail(event_name: str, role: Literal["admin", "editor"], link: str) -> tuple[str, str]:
    name = " ".join(event_name.split())
    short_name = name if len(name) <= 100 else name[:99].rstrip() + "…"
    role_name = {"admin": "Veranstaltungsadmin", "editor": "Veranstaltungsbearbeiter"}[role]
    subject = f"Einladung zur Programmplanung: {short_name}"
    body = _invitation_body(
        f"Du wurdest für die Veranstaltung „{name}“ mit der Rolle „{role_name}“ "
        "zur Programmplanung eingeladen.",
        link,
    )
    return subject, body


def superadmin_invitation_mail(link: str) -> tuple[str, str]:
    subject = "Einladung als Superadmin zur Programmplanung"
    body = _invitation_body(
        "Du wurdest als Superadmin zur Programmplanung eingeladen. "
        "Mit dieser Rolle kannst du alle Veranstaltungen und Benutzer verwalten.",
        link,
    )
    return subject, body


def password_reset_mail(email: str, link: str) -> tuple[str, str]:
    subject = "Passwort für die Programmplanung zurücksetzen"
    body = "\n\n".join((
        "Hallo,",
        f"Für dein Konto {email} wurde ein neues Passwort angefordert.",
        f"Über diesen Link kannst du es zurücksetzen:\n{link}",
        "Der Link gilt eine Stunde und kann nur einmal verwendet werden.",
        (
            "Falls du kein neues Passwort angefordert hast, ignoriere diese E-Mail. "
            "Dein bisheriges Passwort bleibt unverändert."
        ),
        "Viele Grüße\ndein Team der Programmplanung",
    ))
    return subject, body
