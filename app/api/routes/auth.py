import logging
import secrets
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.models.auth import AuthSession, AuthThrottle, AuthToken, EventMembership, User
from app.models.event import Event
from app.services.auth import (
    COOKIE_NAME,
    INVITATION_SECONDS,
    RESET_SECONDS,
    check_throttle,
    clear_attempt,
    create_session,
    digest,
    normalize_email,
    now,
    password_hash,
    password_matches,
    public_url,
    record_attempt,
    require_user,
    send_email,
    session_for_request,
    set_session_cookie,
    throttle_keys,
    user_info,
)
from app.services.mail_templates import (
    event_invitation_mail,
    password_reset_mail,
    superadmin_invitation_mail,
)

router = APIRouter(prefix="/auth", tags=["Auth"])
logger = logging.getLogger(__name__)


class LoginInput(BaseModel):
    email: str
    password: str


class EmailInput(BaseModel):
    email: str


class ResetInput(BaseModel):
    token: str
    password: str


class PasswordChangeInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    current_password: str
    new_password: str


class AcceptInput(BaseModel):
    token: str
    password: str | None = None


def token_record(db: Session, raw: str, kind: Literal["invite", "reset"]) -> AuthToken:
    if len(raw) > 256:
        raise HTTPException(status_code=404, detail="Link ungültig oder abgelaufen")
    record = db.scalar(
        select(AuthToken).where(AuthToken.token_hash == digest(raw), AuthToken.kind == kind)
    )
    if record is None or record.consumed_at is not None or record.expires_at <= now():
        raise HTTPException(status_code=404, detail="Link ungültig oder abgelaufen")
    return record


def issue_invitation(
    db: Session, email: str, *, event_id: int | None = None,
    role: Literal["admin", "editor", "helper"] | None = None, is_superadmin: bool = False,
) -> None:
    normalized = normalize_email(email)
    event = db.get(Event, event_id) if event_id is not None else None
    if event_id is not None and event is None:
        raise HTTPException(status_code=404, detail="Veranstaltung nicht gefunden")
    current = now()
    pending = db.scalars(
        select(AuthToken).where(
            AuthToken.kind == "invite",
            AuthToken.email == normalized,
            AuthToken.event_id == event_id,
            AuthToken.consumed_at.is_(None),
        )
    ).all()
    for old in pending:
        old.consumed_at = current
    raw = secrets.token_urlsafe(32)
    db.add(AuthToken(
        token_hash=digest(raw), kind="invite", email=normalized,
        event_id=event_id, role=role, is_superadmin=is_superadmin,
        expires_at=current + INVITATION_SECONDS,
    ))
    link = public_url("/einladung/" + raw)
    subject, body = (
        event_invitation_mail(event.name, role, link)
        if event is not None else superadmin_invitation_mail(link)
    )
    try:
        send_email(normalized, subject, body)
        db.commit()
    except Exception:
        db.rollback()
        raise


@router.post("/login")
def login(data: LoginInput, response: Response, db: Session = Depends(get_db)):
    email = normalize_email(data.email)
    keys = throttle_keys("login", email)
    check_throttle(db, keys)
    user = db.scalar(select(User).where(User.email == email))
    if user is None or not user.is_active or not password_matches(user.password_hash, data.password):
        record_attempt(db, keys)
        raise HTTPException(status_code=401, detail="E-Mail oder Passwort falsch")
    clear_attempt(db, keys[0])
    raw, session = create_session(db, user)
    set_session_cookie(response, raw)
    return user_info(db, user, session)


@router.get("/me")
def me(request: Request, user: User = Depends(require_user), db: Session = Depends(get_db)):
    return user_info(db, user, request.state.auth_session)


class ProfileInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str


@router.patch("/me")
def update_me(data: ProfileInput, request: Request, user: User = Depends(require_user), db: Session = Depends(get_db)):
    display = " ".join(data.name.split())
    if not 1 <= len(display) <= 255:
        raise HTTPException(status_code=422, detail="Name muss 1 bis 255 Zeichen haben")
    user.name = display
    db.commit()
    return user_info(db, user, request.state.auth_session)


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response, user: User = Depends(require_user), db: Session = Depends(get_db)):
    db.delete(request.state.auth_session)
    db.commit()
    response.status_code = 204
    response.delete_cookie(COOKIE_NAME, path="/")
    return response


@router.post("/password-change", status_code=204)
def change_password(
    data: PasswordChangeInput, response: Response,
    user: User = Depends(require_user), db: Session = Depends(get_db),
):
    keys = throttle_keys("password-change", user.email)
    check_throttle(db, keys)
    if not password_matches(user.password_hash, data.current_password):
        record_attempt(db, keys)
        raise HTTPException(status_code=400, detail="Aktuelles Passwort ist falsch")
    user.password_hash = password_hash(data.new_password)
    db.execute(update(AuthToken).where(
        AuthToken.kind == "reset", AuthToken.user_id == user.id, AuthToken.consumed_at.is_(None),
    ).values(consumed_at=now()))
    db.execute(delete(AuthSession).where(AuthSession.user_id == user.id))
    db.execute(delete(AuthThrottle).where(AuthThrottle.key.in_(keys)))
    db.commit()
    response.status_code = 204
    response.delete_cookie(COOKIE_NAME, path="/")
    return response


@router.get("/invitations/{token}")
def invitation_info(token: str, db: Session = Depends(get_db)):
    invitation = token_record(db, token, "invite")
    return {
        "email": invitation.email,
        "existing_account": db.scalar(select(User.id).where(User.email == invitation.email)) is not None,
        "event_name": db.get(Event, invitation.event_id).name if invitation.event_id else None,
        "role": "superadmin" if invitation.is_superadmin else invitation.role,
    }


@router.post("/invitations/accept")
def accept_invitation(data: AcceptInput, request: Request, response: Response, db: Session = Depends(get_db)):
    invitation = token_record(db, data.token, "invite")
    if invitation.event_id is not None and db.get(Event, invitation.event_id) is None:
        raise HTTPException(status_code=404, detail="Veranstaltung nicht gefunden")
    user = db.scalar(select(User).where(User.email == invitation.email))
    authenticated = session_for_request(request, db)
    if user is not None:
        if authenticated is None or authenticated[0].id != user.id:
            raise HTTPException(status_code=401, detail="Mit eingeladenem Konto anmelden")
        if not secrets.compare_digest(request.headers.get("X-CSRF-Token", ""), authenticated[1].csrf_token):
            raise HTTPException(status_code=403, detail="Ungültiger CSRF-Token")
        session = authenticated[1]
    else:
        if data.password is None:
            raise HTTPException(status_code=422, detail="Passwort erforderlich")
        user = User(email=invitation.email, password_hash=password_hash(data.password))
        db.add(user)
        db.flush()
        session = None
    if invitation.event_id is not None:
        membership = db.scalar(select(EventMembership).where(
            EventMembership.event_id == invitation.event_id,
            EventMembership.user_id == user.id,
        ))
        if membership is not None:
            raise HTTPException(status_code=409, detail="Benutzer gehört bereits zum Team")
        db.add(EventMembership(event_id=invitation.event_id, user_id=user.id, role=invitation.role))
    if invitation.is_superadmin:
        user.is_superadmin = True
    invitation.consumed_at = now()
    db.commit()
    if session is None:
        raw, session = create_session(db, user)
        set_session_cookie(response, raw)
    return user_info(db, user, session)


@router.post("/password-reset/request", status_code=204)
def request_reset(data: EmailInput, db: Session = Depends(get_db)):
    email = normalize_email(data.email)
    keys = throttle_keys("reset", email)
    check_throttle(db, keys)
    record_attempt(db, keys)
    user = db.scalar(select(User).where(User.email == email, User.is_active))
    if user:
        raw = secrets.token_urlsafe(32)
        db.add(AuthToken(
            token_hash=digest(raw), kind="reset", email=email, user_id=user.id,
            expires_at=now() + RESET_SECONDS,
        ))
        try:
            subject, body = password_reset_mail(email, public_url("/passwort-zuruecksetzen/" + raw))
            send_email(email, subject, body)
            db.commit()
        except HTTPException:
            db.rollback()
            logger.exception("Passwort-Reset-E-Mail konnte nicht versendet werden")
    return Response(status_code=204)


@router.post("/password-reset/confirm", status_code=204)
def confirm_reset(data: ResetInput, db: Session = Depends(get_db)):
    record = token_record(db, data.token, "reset")
    user = db.get(User, record.user_id)
    if user is None or not user.is_active:
        raise HTTPException(status_code=404, detail="Link ungültig oder abgelaufen")
    user.password_hash = password_hash(data.password)
    db.execute(update(AuthToken).where(
        AuthToken.kind == "reset", AuthToken.user_id == user.id, AuthToken.consumed_at.is_(None),
    ).values(consumed_at=now()))
    db.execute(delete(AuthSession).where(AuthSession.user_id == user.id))
    db.commit()
    return Response(status_code=204)
