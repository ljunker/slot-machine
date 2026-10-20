import hashlib
import os
import secrets
import smtplib
import ssl
import time
from email.message import EmailMessage
from typing import Annotated, Literal

from argon2 import PasswordHasher
from argon2.exceptions import VerificationError, VerifyMismatchError
from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.models.auth import AuthSession, AuthThrottle, EventMembership, User
from app.models.event import Event

Role = Literal["admin", "editor"]
SESSION_SECONDS = 12 * 60 * 60
INVITATION_SECONDS = 48 * 60 * 60
RESET_SECONDS = 60 * 60
THROTTLE_SECONDS = 15 * 60
THROTTLE_LIMIT = 5
COOKIE_NAME = "event_session"
hasher = PasswordHasher()


def now() -> int:
    return int(time.time())


def digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def normalize_email(email: str) -> str:
    normalized = email.strip().casefold()
    if (
        len(normalized) > 320
        or normalized.count("@") != 1
        or any(char.isspace() for char in normalized)
        or not all(normalized.split("@"))
    ):
        raise HTTPException(status_code=422, detail="Ungültige E-Mail-Adresse")
    return normalized


def password_hash(password: str) -> str:
    if not 12 <= len(password) <= 1024:
        raise HTTPException(status_code=422, detail="Passwort muss 12 bis 1024 Zeichen haben")
    return hasher.hash(password)


def password_matches(stored: str, password: str) -> bool:
    if len(password) > 1024:
        return False
    try:
        return hasher.verify(stored, password)
    except (VerificationError, VerifyMismatchError):
        return False


def send_email(to: str, subject: str, body: str) -> None:
    host = os.environ.get("SMTP_HOST")
    sender = os.environ.get("SMTP_FROM")
    if not host or not sender:
        raise HTTPException(status_code=503, detail="E-Mail-Versand nicht konfiguriert")
    message = EmailMessage()
    message["From"] = sender
    message["To"] = to
    message["Subject"] = subject
    message.set_content(body)
    try:
        port = int(os.environ.get("SMTP_PORT", "587"))
        use_ssl = os.environ.get("SMTP_SSL", "false").lower() == "true"
        connection = (
            smtplib.SMTP_SSL(host, port, timeout=10, context=ssl.create_default_context())
            if use_ssl else smtplib.SMTP(host, port, timeout=10)
        )
        with connection as smtp:
            if not use_ssl and os.environ.get("SMTP_STARTTLS", "true").lower() == "true":
                smtp.starttls(context=ssl.create_default_context())
            username = os.environ.get("SMTP_USERNAME")
            if username:
                smtp.login(username, os.environ.get("SMTP_PASSWORD", ""))
            smtp.send_message(message)
    except (OSError, smtplib.SMTPException) as error:
        raise HTTPException(status_code=503, detail="E-Mail konnte nicht versendet werden") from error


def public_url(path: str) -> str:
    return os.environ.get("PUBLIC_BASE_URL", "http://127.0.0.1:5173").rstrip("/") + path


def create_session(db: Session, user: User) -> tuple[str, AuthSession]:
    token = secrets.token_urlsafe(32)
    session = AuthSession(
        user_id=user.id,
        token_hash=digest(token),
        csrf_token=secrets.token_hex(32),
        expires_at=now() + SESSION_SECONDS,
    )
    db.add(session)
    db.commit()
    return token, session


def set_session_cookie(response, token: str) -> None:
    secure_default = public_url("").startswith("https://")
    configured = os.environ.get("AUTH_COOKIE_SECURE", "auto").lower()
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=SESSION_SECONDS,
        httponly=True,
        secure=secure_default if configured == "auto" else configured == "true",
        samesite="lax",
        path="/",
    )


def session_for_request(request: Request, db: Session) -> tuple[User, AuthSession] | None:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        return None
    session = db.scalar(select(AuthSession).where(AuthSession.token_hash == digest(token)))
    if session is None or session.expires_at <= now():
        return None
    user = db.get(User, session.user_id)
    if user is None or not user.is_active:
        return None
    return user, session


def require_user(request: Request, db: Annotated[Session, Depends(get_db)]) -> User:
    authenticated = session_for_request(request, db)
    if authenticated is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Anmeldung erforderlich")
    user, session = authenticated
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        received = request.headers.get("X-CSRF-Token", "")
        if not secrets.compare_digest(received, session.csrf_token):
            raise HTTPException(status_code=403, detail="Ungültiger CSRF-Token")
    request.state.auth_session = session
    return user


def require_superadmin(user: Annotated[User, Depends(require_user)]) -> User:
    if not user.is_superadmin:
        raise HTTPException(status_code=403, detail="Superadmin-Recht erforderlich")
    return user


def authorize_event(db: Session, user: User, event_id: int, required: Role = "editor") -> None:
    if db.get(Event, event_id) is None:
        raise HTTPException(status_code=404, detail="Veranstaltung nicht gefunden")
    if user.is_superadmin:
        return
    membership = db.scalar(
        select(EventMembership).where(
            EventMembership.event_id == event_id,
            EventMembership.user_id == user.id,
        )
    )
    if membership is None:
        raise HTTPException(status_code=404, detail="Veranstaltung nicht gefunden")
    if required == "admin" and membership.role != "admin":
        raise HTTPException(status_code=403, detail="Veranstaltungsadmin-Recht erforderlich")


def authorize_object(db: Session, user: User, model, object_id: int, required: Role = "editor") -> int:
    event_id = db.scalar(select(model.event_id).where(model.id == object_id))
    if event_id is None:
        raise HTTPException(status_code=404, detail="Objekt nicht gefunden")
    authorize_event(db, user, event_id, required)
    return event_id


def user_info(db: Session, user: User, session: AuthSession) -> dict:
    roles = db.execute(
        select(EventMembership.event_id, EventMembership.role).where(EventMembership.user_id == user.id)
    ).all()
    return {
        "id": user.id,
        "email": user.email,
        "is_superadmin": user.is_superadmin,
        "event_roles": {str(event_id): role for event_id, role in roles},
        "csrf_token": session.csrf_token,
    }


def throttle_keys(kind: str, email: str) -> tuple[str, ...]:
    return (f"{kind}:email:{email}",)


def check_throttle(db: Session, keys: tuple[str, ...]) -> None:
    for key in keys:
        record = db.scalar(select(AuthThrottle).where(AuthThrottle.key == key))
        if record and record.count >= THROTTLE_LIMIT and now() - record.window_started < THROTTLE_SECONDS:
            raise HTTPException(status_code=429, detail="Zu viele Versuche. Später erneut versuchen")


def record_attempt(db: Session, keys: tuple[str, ...]) -> None:
    current = now()
    db.execute(delete(AuthThrottle).where(AuthThrottle.window_started < current - THROTTLE_SECONDS))
    for key in keys:
        record = db.scalar(select(AuthThrottle).where(AuthThrottle.key == key))
        if record is None:
            db.add(AuthThrottle(key=key, count=1, window_started=current))
        elif current - record.window_started >= THROTTLE_SECONDS:
            record.count = 1
            record.window_started = current
        else:
            record.count += 1
    db.commit()


def clear_attempt(db: Session, key: str) -> None:
    record = db.scalar(select(AuthThrottle).where(AuthThrottle.key == key))
    if record:
        db.delete(record)
    db.commit()


def active_superadmin_count(db: Session) -> int:
    return db.scalar(select(func.count()).select_from(User).where(User.is_active, User.is_superadmin)) or 0
