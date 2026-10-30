import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import select
from test_auth import create_event, create_user, login_as

from app.main import app
from app.models.auth import AuthSession, AuthThrottle, AuthToken, User
from app.services.auth import (
    COOKIE_NAME,
    THROTTLE_SECONDS,
    digest,
    now,
    password_hash,
    password_matches,
)

OLD_PASSWORD = "Testpassword123!"
NEW_PASSWORD = "Changedpassword123!"
PASSWORD_CHANGE = {"current_password": OLD_PASSWORD, "new_password": NEW_PASSWORD}


@pytest.mark.parametrize("role", ["helper", "editor", "admin", "superadmin"])
def test_each_role_can_change_own_name_and_password(client, db, role):
    person = client if role == "superadmin" else login_as(
        create_user(db, f"{role}@example.invalid", create_event(client), role).email
    )
    before = person.get("/api/auth/me").json()
    assert person.patch("/api/auth/me", json={"name": "  Ada\n Müller  "}).json()["name"] == "Ada Müller"
    assert person.post("/api/auth/password-change", json=PASSWORD_CHANGE).status_code == 204
    login = person.post("/api/auth/login", json={"email": before["email"], "password": NEW_PASSWORD})
    assert login.status_code == 200
    after = login.json()
    assert after["name"] == "Ada Müller"
    for field in ["id", "email", "is_superadmin", "event_roles"]:
        assert after[field] == before[field]


def test_password_change_revokes_all_own_sessions_and_reset_links_only(client, db):
    before = client.get("/api/auth/me").json()
    other_session = login_as(before["email"])
    foreign_user = User(name="Andere Person", email="other@example.invalid", password_hash=password_hash(OLD_PASSWORD))
    db.add(foreign_user)
    db.commit()
    foreign_session = login_as(foreign_user.email)
    foreign_hash = foreign_user.password_hash
    tokens = []
    for raw, kind, user_id, email in [
        ("own-reset-1", "reset", before["id"], before["email"]),
        ("own-reset-2", "reset", before["id"], before["email"]),
        ("own-invitation", "invite", before["id"], before["email"]),
        ("foreign-reset", "reset", foreign_user.id, foreign_user.email),
    ]:
        token = AuthToken(token_hash=digest(raw), kind=kind, user_id=user_id, email=email, expires_at=now() + 3600)
        db.add(token)
        tokens.append(token)
    db.commit()

    response = client.post("/api/auth/password-change", json=PASSWORD_CHANGE)
    assert response.status_code == 204
    assert response.content == b""
    assert "Max-Age=0" in response.headers["set-cookie"]
    assert COOKIE_NAME not in client.cookies
    assert client.get("/api/auth/me").status_code == 401
    assert other_session.get("/api/auth/me").status_code == 401
    assert foreign_session.get("/api/auth/me").status_code == 200
    assert not db.scalars(select(AuthSession).where(AuthSession.user_id == before["id"])).all()
    for token in tokens:
        db.refresh(token)
    assert all(token.consumed_at is not None for token in tokens[:2])
    assert all(token.consumed_at is None for token in tokens[2:])
    for raw in ["own-reset-1", "own-reset-2"]:
        assert client.post("/api/auth/password-reset/confirm", json={"token": raw, "password": OLD_PASSWORD}).status_code == 404
    assert client.post("/api/auth/login", json={"email": before["email"], "password": OLD_PASSWORD}).status_code == 401
    assert client.post("/api/auth/login", json={"email": before["email"], "password": NEW_PASSWORD}).status_code == 200
    db.refresh(foreign_user)
    assert foreign_user.password_hash == foreign_hash
    assert password_matches(db.get(User, before["id"]).password_hash, NEW_PASSWORD)


def test_password_change_requires_session_and_csrf(client, db):
    assert TestClient(app).post("/api/auth/password-change", json=PASSWORD_CHANGE).status_code == 401
    person = login_as("test@example.invalid")
    person.headers.pop("X-CSRF-Token")
    assert person.post("/api/auth/password-change", json=PASSWORD_CHANGE).status_code == 403
    person.headers["X-CSRF-Token"] = "wrong"
    assert person.post("/api/auth/password-change", json=PASSWORD_CHANGE).status_code == 403
    assert client.get("/api/auth/me").status_code == 200
    assert password_matches(db.scalar(select(User)).password_hash, OLD_PASSWORD)


@pytest.mark.parametrize("extra", [{"user_id": 999}, {"email": "other@example.invalid"}, {"is_superadmin": True}, {"name": "Andere Person"}])
def test_password_change_rejects_extra_fields(client, db, extra):
    assert client.post("/api/auth/password-change", json={**PASSWORD_CHANGE, **extra}).status_code == 422
    assert client.get("/api/auth/me").status_code == 200
    assert password_matches(db.scalar(select(User)).password_hash, OLD_PASSWORD)


@pytest.mark.parametrize("password", ["", "a" * 11, "a" * 1025])
def test_invalid_new_password_preserves_credentials_session_and_reset_link(client, db, password):
    user = db.scalar(select(User))
    token = AuthToken(token_hash=digest("reset"), kind="reset", user_id=user.id, email=user.email, expires_at=now() + 3600)
    db.add(token)
    db.commit()
    assert client.post("/api/auth/password-change", json={**PASSWORD_CHANGE, "new_password": password}).status_code == 422
    assert client.get("/api/auth/me").status_code == 200
    db.refresh(user)
    db.refresh(token)
    assert password_matches(user.password_hash, OLD_PASSWORD)
    assert token.consumed_at is None


@pytest.mark.parametrize("length", [12, 1024])
def test_password_change_accepts_password_length_boundaries(client, length):
    password = "a" * length
    assert client.post("/api/auth/password-change", json={**PASSWORD_CHANGE, "new_password": password}).status_code == 204
    assert client.post("/api/auth/login", json={"email": "test@example.invalid", "password": password}).status_code == 200


def test_wrong_current_password_is_throttled_across_sessions_and_expires(client, db, monkeypatch):
    second = login_as("test@example.invalid")
    started = now()
    monkeypatch.setattr("app.services.auth.now", lambda: started)
    for index in range(5):
        person = client if index % 2 == 0 else second
        response = person.post("/api/auth/password-change", json={**PASSWORD_CHANGE, "current_password": "wrong"})
        assert response.status_code == 400
        assert response.json()["detail"] == "Aktuelles Passwort ist falsch"
    assert client.post("/api/auth/password-change", json=PASSWORD_CHANGE).status_code == 429
    assert client.get("/api/auth/me").status_code == 200
    assert password_matches(db.scalar(select(User)).password_hash, OLD_PASSWORD)
    independent_login = login_as("test@example.invalid")
    assert independent_login.get("/api/auth/me").status_code == 200
    monkeypatch.setattr("app.services.auth.now", lambda: started + THROTTLE_SECONDS)
    assert second.post("/api/auth/password-change", json=PASSWORD_CHANGE).status_code == 204
    assert not db.scalars(select(AuthThrottle).where(AuthThrottle.key.like("password-change:%"))).all()


def test_password_change_rolls_back_all_changes_if_commit_fails(client, db, monkeypatch):
    user = db.scalar(select(User))
    original_hash = user.password_hash
    token = AuthToken(token_hash=digest("reset"), kind="reset", user_id=user.id, email=user.email, expires_at=now() + 3600)
    db.add(token)
    db.commit()

    def fail_commit():
        raise HTTPException(status_code=503, detail="Speichern fehlgeschlagen")

    with monkeypatch.context() as patch:
        patch.setattr(db, "commit", fail_commit)
        assert client.post("/api/auth/password-change", json=PASSWORD_CHANGE).status_code == 503
    db.rollback()
    db.refresh(user)
    db.refresh(token)
    assert user.password_hash == original_hash
    assert token.consumed_at is None
    assert client.get("/api/auth/me").status_code == 200
