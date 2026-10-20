import re
from unittest.mock import MagicMock

from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.main import app
from app.models.auth import AuthToken, EventMembership, User
from app.services.auth import now, password_hash, send_email


def create_event(client, name="Konferenz"):
    return client.post("/api/events", json={
        "name": name, "start_date": "2099-06-01", "end_date": "2099-06-02",
    }).json()["id"]


def create_user(db, email, event_id, role):
    user = User(email=email, password_hash=password_hash("Testpassword123!"))
    db.add(user)
    db.flush()
    db.add(EventMembership(event_id=event_id, user_id=user.id, role=role))
    db.commit()
    return user


def login_as(email):
    client = TestClient(app)
    response = client.post("/api/auth/login", json={"email": email, "password": "Testpassword123!"})
    assert response.status_code == 200, response.text
    client.headers.update({"X-CSRF-Token": response.json()["csrf_token"]})
    return client


def test_strato_smtps_uses_ssl_from_connection_start(monkeypatch):
    monkeypatch.setenv("SMTP_HOST", "smtp.strato.de")
    monkeypatch.setenv("SMTP_PORT", "465")
    monkeypatch.setenv("SMTP_SSL", "true")
    monkeypatch.setenv("SMTP_STARTTLS", "true")
    monkeypatch.setenv("SMTP_FROM", "programm@example.org")
    monkeypatch.setenv("SMTP_USERNAME", "programm@example.org")
    monkeypatch.setenv("SMTP_PASSWORD", "postfach-passwort")
    connection = MagicMock()
    connection.__enter__.return_value = connection
    smtp_ssl = MagicMock(return_value=connection)
    monkeypatch.setattr("app.services.auth.smtplib.SMTP_SSL", smtp_ssl)
    monkeypatch.setattr("app.services.auth.smtplib.SMTP", lambda *_args, **_kwargs: None)

    send_email("gast@example.org", "Einladung", "Link")

    assert smtp_ssl.call_args.args == ("smtp.strato.de", 465)
    connection.starttls.assert_not_called()
    connection.login.assert_called_once_with("programm@example.org", "postfach-passwort")
    message = connection.send_message.call_args.args[0]
    assert message["From"] == "programm@example.org"
    assert message["To"] == "gast@example.org"


def test_anonymous_public_program_and_private_routes(client, db):
    event_id = create_event(client)
    day_id = client.post(f"/api/events/{event_id}/days", json={
        "event_id": event_id, "date": "2099-06-01", "start_time": "09:00", "end_time": "18:00",
    }).json()["id"]
    room_id = client.post("/api/rooms", json={"event_id": event_id, "name": "Saal"}).json()["id"]
    slot_id = client.post("/api/slots", json={
        "event_id": event_id, "day_id": day_id, "room_id": room_id,
        "topic": "Vortrag", "start_time": "10:00", "end_time": "11:00",
    }).json()["id"]
    client.post(f"/api/events/{event_id}/helpers", json={"name": "Privat"})
    guest = TestClient(app)
    for path in (
        "/api/events", f"/api/events/{event_id}/rooms", f"/api/schedule/days/{day_id}",
        f"/api/events/{event_id}/helpers", f"/api/backups/events/{event_id}",
        f"/api/events/{event_id}/members",
    ):
        assert guest.get(path).status_code == 401, path
    assert guest.post("/api/events", json={"name": "Fremd"}).status_code == 401
    assert guest.get(f"/api/events/{event_id}").status_code == 200
    assert guest.get(f"/api/events/{event_id}/days").status_code == 200
    assert guest.get(f"/api/events/{event_id}/sessions/{slot_id}").status_code == 200
    schedule = guest.get(f"/api/public/events/{event_id}/days/{day_id}/schedule")
    assert schedule.status_code == 200, schedule.text
    assert schedule.json()["rooms"][0]["slots"][0]["topic"] == "Vortrag"
    assert "collisions" not in schedule.json()
    assert "speaker_ids" not in schedule.text
    assert "Privat" not in schedule.text
    assert guest.get(f"/api/events/{event_id}/program.pdf").status_code == 200


def test_editor_admin_and_cross_event_access(client, db):
    own = create_event(client, "Eigen")
    foreign = create_event(client, "Fremd")
    day = client.post(f"/api/events/{own}/days", json={
        "event_id": own, "date": "2099-06-01", "start_time": "09:00", "end_time": "18:00",
    }).json()["id"]
    room = client.post("/api/rooms", json={"event_id": own, "name": "Saal"}).json()["id"]
    slot = client.post("/api/slots", json={"event_id": own, "topic": "Ungeplant"}).json()["id"]
    create_user(db, "editor@example.invalid", own, "editor")
    create_user(db, "admin@example.invalid", own, "admin")
    editor = login_as("editor@example.invalid")
    admin = login_as("admin@example.invalid")
    assert [item["id"] for item in editor.get("/api/events").json()] == [own]
    assert editor.get(f"/api/events/{foreign}/rooms").status_code == 404
    assert editor.get(f"/api/backups/events/{own}").status_code == 403
    assert editor.get(f"/api/events/{own}/members").status_code == 403
    assert editor.patch(f"/api/events/{own}", json={"name": "Nein"}).status_code == 403
    assert editor.post(f"/api/events/{own}/days", json={
        "event_id": own, "date": "2099-06-02", "start_time": "09:00", "end_time": "18:00",
    }).status_code == 403
    assert editor.patch(f"/api/days/{day}", json={"start_time": "08:00"}).status_code == 403
    assert editor.post("/api/rooms", json={"event_id": own, "name": "Noch einer"}).status_code == 403
    assert editor.patch(f"/api/rooms/{room}", json={"name": "Neu"}).status_code == 403
    assert editor.post("/api/events", json={"name": "Nein"}).status_code == 403
    assert editor.delete(f"/api/events/{own}").status_code == 403
    assert editor.patch(f"/api/slots/{slot}", json={"topic": "Bearbeitet"}).status_code == 200
    assert editor.post(f"/api/events/{own}/helpers", json={"name": "Helfer"}).status_code == 201
    assert editor.post("/api/slots", json={"event_id": foreign, "topic": "Fremd"}).status_code == 404
    assert admin.get(f"/api/backups/events/{own}").status_code == 200
    assert admin.patch(f"/api/events/{own}", json={"name": "Neu"}).status_code == 200
    assert admin.delete(f"/api/events/{own}").status_code == 403
    assert admin.post("/api/backups/preview", files={"backup": ("x.zip", b"invalid")}).status_code == 403


def test_invitation_acceptance_and_password_reset(client, db, monkeypatch):
    monkeypatch.setenv("PUBLIC_BASE_URL", "https://programm.example.org")
    monkeypatch.setenv("AUTH_COOKIE_SECURE", "false")
    event_id = create_event(client)
    sent = []
    monkeypatch.setattr("app.api.routes.auth.send_email", lambda to, subject, body: sent.append((to, subject, body)))
    invitation = client.post(f"/api/events/{event_id}/members/invitations", json={
        "email": "New@Example.invalid", "role": "editor",
    })
    assert invitation.status_code == 204, invitation.text
    assert sent[-1][1] == "Einladung zur Programmplanung: Konferenz"
    assert "Veranstaltung „Konferenz“" in sent[-1][2]
    assert "Rolle „Veranstaltungsbearbeiter“" in sent[-1][2]
    assert "https://programm.example.org/einladung/" in sent[-1][2]
    assert "48 Stunden" in sent[-1][2]
    token = re.search(r"/einladung/([^\s]+)", sent[-1][2]).group(1)
    guest = TestClient(app)
    assert guest.get(f"/api/auth/invitations/{token}").json()["existing_account"] is False
    accepted = guest.post("/api/auth/invitations/accept", json={
        "token": token, "password": "Anotherpassword123!",
    })
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["event_roles"][str(event_id)] == "editor"
    assert guest.post("/api/auth/invitations/accept", json={"token": token}).status_code == 404
    assert guest.get("/api/events").json()[0]["id"] == event_id
    reset = guest.post("/api/auth/password-reset/request", json={"email": "new@example.invalid"})
    assert reset.status_code == 204
    assert sent[-1][1] == "Passwort für die Programmplanung zurücksetzen"
    assert "Für dein Konto new@example.invalid" in sent[-1][2]
    assert "https://programm.example.org/passwort-zuruecksetzen/" in sent[-1][2]
    assert "Dein bisheriges Passwort bleibt unverändert." in sent[-1][2]
    reset_token = re.search(r"/passwort-zuruecksetzen/([^\s]+)", sent[-1][2]).group(1)
    assert guest.post("/api/auth/password-reset/confirm", json={
        "token": reset_token, "password": "Newpassword12345!",
    }).status_code == 204
    assert guest.get("/api/events").status_code == 401
    assert guest.post("/api/auth/password-reset/confirm", json={
        "token": reset_token, "password": "Newpassword12345!",
    }).status_code == 404


def test_superadmin_invitation_explains_access(client, monkeypatch):
    sent = []
    monkeypatch.setattr("app.api.routes.auth.send_email", lambda to, subject, body: sent.append((to, subject, body)))
    response = client.post("/api/users/superadmin-invitations", json={"email": "second@example.invalid"})

    assert response.status_code == 204
    assert sent[-1][1] == "Einladung als Superadmin zur Programmplanung"
    assert "alle Veranstaltungen und Benutzer verwalten" in sent[-1][2]
    assert "48 Stunden" in sent[-1][2]


def test_csrf_and_last_superadmin(client, db):
    event_id = create_event(client)
    no_csrf = TestClient(app)
    login = no_csrf.post("/api/auth/login", json={"email": "test@example.invalid", "password": "Testpassword123!"})
    assert login.status_code == 200
    assert no_csrf.post("/api/events", json={
        "name": "Nein", "start_date": "2099-06-01", "end_date": "2099-06-02",
    }).status_code == 403
    user_id = login.json()["id"]
    assert client.patch(f"/api/users/{user_id}", json={"is_superadmin": False}).status_code == 409
    assert client.patch(f"/api/users/{user_id}", json={"is_active": False}).status_code == 409
    assert client.get(f"/api/events/{event_id}").status_code == 200


def test_existing_account_multiple_events_and_role_changes(client, db, monkeypatch):
    first = create_event(client, "Erste")
    second = create_event(client, "Zweite")
    person = create_user(db, "person@example.invalid", first, "admin")
    person_client = login_as(person.email)
    sent = []
    monkeypatch.setattr("app.api.routes.auth.send_email", lambda to, subject, body: sent.append(body))
    assert client.post(f"/api/events/{second}/members/invitations", json={
        "email": person.email, "role": "editor",
    }).status_code == 204
    token = re.search(r"/einladung/([^\s]+)", sent[-1]).group(1)
    assert person_client.post("/api/auth/invitations/accept", json={"token": token}).status_code == 200
    assert [item["id"] for item in person_client.get("/api/events").json()] == [first, second]
    assert person_client.patch(f"/api/events/{second}", json={"name": "Nein"}).status_code == 403
    assert client.patch(f"/api/events/{second}/members/{person.id}", json={"role": "admin"}).status_code == 200
    assert person_client.patch(f"/api/events/{second}", json={"name": "Ja"}).status_code == 200
    assert client.delete(f"/api/events/{second}/members/{person.id}").status_code == 409
    assert client.patch(f"/api/events/{second}/members/{person.id}", json={"role": "editor"}).status_code == 409
    assert client.delete(f"/api/events/{first}").status_code == 204
    assert [item["id"] for item in person_client.get("/api/events").json()] == [second]


def test_restore_keeps_members_and_logout_revokes_session(client, db):
    event_id = create_event(client)
    create_user(db, "member@example.invalid", event_id, "admin")
    backup = client.get(f"/api/backups/events/{event_id}").content
    restored = client.post("/api/backups/restore", files={"backup": ("event.zip", backup)}, data={"target_event_id": str(event_id)})
    assert restored.status_code == 200, restored.text
    member = login_as("member@example.invalid")
    assert member.get(f"/api/backups/events/{event_id}").status_code == 200
    assert member.post("/api/auth/logout").status_code == 204
    assert member.get("/api/events").status_code == 401


def test_login_throttle_and_deactivation(client, db):
    event_id = create_event(client)
    person = create_user(db, "person@example.invalid", event_id, "editor")
    person_client = login_as(person.email)
    attacker = TestClient(app)
    for _ in range(5):
        assert attacker.post("/api/auth/login", json={
            "email": person.email, "password": "wrong",
        }).status_code == 401
    assert attacker.post("/api/auth/login", json={
        "email": person.email, "password": "wrong",
    }).status_code == 429
    assert client.patch(f"/api/users/{person.id}", json={"is_active": False}).status_code == 200
    assert person_client.get("/api/events").status_code == 401


def test_password_reset_response_does_not_reveal_accounts(client, monkeypatch):
    def fail_mail(*_args):
        raise HTTPException(status_code=503, detail="Mail nicht verfügbar")

    monkeypatch.setattr("app.api.routes.auth.send_email", fail_mail)
    guest = TestClient(app)
    assert guest.post("/api/auth/password-reset/request", json={"email": "unknown@example.invalid"}).status_code == 204
    assert guest.post("/api/auth/password-reset/request", json={"email": "test@example.invalid"}).status_code == 204


def test_expired_invitation_is_rejected(client, db, monkeypatch):
    event_id = create_event(client)
    sent = []
    monkeypatch.setattr("app.api.routes.auth.send_email", lambda to, subject, body: sent.append(body))
    assert client.post(f"/api/events/{event_id}/members/invitations", json={
        "email": "late@example.invalid", "role": "editor",
    }).status_code == 204
    token = re.search(r"/einladung/([^\s]+)", sent[-1]).group(1)
    record = db.query(AuthToken).filter_by(email="late@example.invalid").one()
    record.expires_at = now() - 1
    db.commit()
    guest = TestClient(app)
    assert guest.get(f"/api/auth/invitations/{token}").status_code == 404
    assert guest.post("/api/auth/invitations/accept", json={
        "token": token, "password": "Anotherpassword123!",
    }).status_code == 404
