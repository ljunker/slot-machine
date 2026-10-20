from app.services.mail_templates import (
    event_invitation_mail,
    password_reset_mail,
    superadmin_invitation_mail,
)


def test_event_invitation_names_event_role_and_next_step():
    subject, body = event_invitation_mail(
        "Konferenz\n2026", "admin", "https://programm.example.org/einladung/abc"
    )

    assert subject == "Einladung zur Programmplanung: Konferenz 2026"
    assert "Veranstaltung „Konferenz 2026“" in body
    assert "Rolle „Veranstaltungsadmin“" in body
    assert "https://programm.example.org/einladung/abc" in body
    assert "melde dich mit deiner E-Mail-Adresse an" in body
    assert "ein Passwort festlegen" in body
    assert "Der Link gilt 48 Stunden und kann nur einmal verwendet werden." in body
    assert "Ohne Annahme erhältst du keinen Zugang." in body


def test_long_event_name_is_shortened_only_in_subject():
    name = "Langes Programm " + "A" * 120
    subject, body = event_invitation_mail(name, "editor", "https://programm.example.org/einladung/abc")

    assert subject.endswith("…")
    assert len(subject) <= len("Einladung zur Programmplanung: ") + 100
    assert name in body
    assert "Rolle „Veranstaltungsbearbeiter“" in body


def test_superadmin_and_reset_mail_explain_scope_and_expiry():
    subject, body = superadmin_invitation_mail("https://programm.example.org/einladung/abc")
    assert subject == "Einladung als Superadmin zur Programmplanung"
    assert "alle Veranstaltungen und Benutzer verwalten" in body
    assert "48 Stunden" in body

    subject, body = password_reset_mail("user@example.org", "https://programm.example.org/passwort-zuruecksetzen/abc")
    assert subject == "Passwort für die Programmplanung zurücksetzen"
    assert "Für dein Konto user@example.org wurde ein neues Passwort angefordert." in body
    assert "https://programm.example.org/passwort-zuruecksetzen/abc" in body
    assert "Der Link gilt eine Stunde und kann nur einmal verwendet werden." in body
    assert "Dein bisheriges Passwort bleibt unverändert." in body
