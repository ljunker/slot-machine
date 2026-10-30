from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from app.api.routes.auth import issue_invitation
from app.db.database import get_db
from app.models.auth import AuthSession, EventMembership, User
from app.models.duty import Duty
from app.models.helper import duty_users
from app.services.auth import (
    active_superadmin_count,
    authorize_event,
    normalize_email,
    require_superadmin,
    require_user,
)

router = APIRouter(tags=["Users"], dependencies=[Depends(require_user)])


class InvitationInput(BaseModel):
    email: str
    role: Literal["admin", "editor", "helper"]


class EmailInput(BaseModel):
    email: str


class RoleInput(BaseModel):
    role: Literal["admin", "editor", "helper"]


class UserUpdate(BaseModel):
    is_active: bool | None = None
    is_superadmin: bool | None = None


def member_data(db: Session, membership: EventMembership) -> dict:
    user = db.get(User, membership.user_id)
    return {"user_id": user.id, "email": user.email, "name": user.name, "role": membership.role, "is_active": user.is_active}


def get_membership(db: Session, event_id: int, user_id: int) -> EventMembership:
    membership = db.scalar(select(EventMembership).where(
        EventMembership.event_id == event_id, EventMembership.user_id == user_id,
    ))
    if membership is None:
        raise HTTPException(status_code=404, detail="Teammitglied nicht gefunden")
    return membership


def keep_last_admin(db: Session, membership: EventMembership) -> None:
    if membership.role != "admin":
        return
    count = db.scalar(select(func.count()).select_from(EventMembership).where(
        EventMembership.event_id == membership.event_id,
        EventMembership.role == "admin",
    ))
    if count <= 1:
        raise HTTPException(status_code=409, detail="Letzter Veranstaltungsadmin kann nicht entfernt werden")


@router.get("/events/{event_id}/members")
def list_members(event_id: int, db: Session = Depends(get_db), user: User = Depends(require_user)):
    authorize_event(db, user, event_id, "admin")
    memberships = db.scalars(select(EventMembership).where(EventMembership.event_id == event_id)).all()
    return [member_data(db, membership) for membership in memberships]


@router.post("/events/{event_id}/members/invitations", status_code=204)
def invite_member(event_id: int, data: InvitationInput, db: Session = Depends(get_db), user: User = Depends(require_user)):
    authorize_event(db, user, event_id, "admin")
    email = normalize_email(data.email)
    existing = db.scalar(select(User).where(User.email == email))
    if existing and db.scalar(select(EventMembership.id).where(
        EventMembership.event_id == event_id, EventMembership.user_id == existing.id,
    )):
        raise HTTPException(status_code=409, detail="Benutzer gehört bereits zum Team")
    issue_invitation(db, email, event_id=event_id, role=data.role)
    return Response(status_code=204)


@router.patch("/events/{event_id}/members/{user_id}")
def update_member(event_id: int, user_id: int, data: RoleInput, db: Session = Depends(get_db), user: User = Depends(require_user)):
    authorize_event(db, user, event_id, "admin")
    membership = get_membership(db, event_id, user_id)
    if membership.role == "admin" and data.role != "admin":
        keep_last_admin(db, membership)
    membership.role = data.role
    db.commit()
    return member_data(db, membership)


@router.delete("/events/{event_id}/members/{user_id}", status_code=204)
def remove_member(event_id: int, user_id: int, db: Session = Depends(get_db), user: User = Depends(require_user)):
    authorize_event(db, user, event_id, "admin")
    membership = get_membership(db, event_id, user_id)
    keep_last_admin(db, membership)
    # Mitgliedschaft und Belegungen werden in derselben Transaktion entfernt.
    identifiers = db.scalars(select(Duty.id).where(Duty.event_id == event_id).order_by(Duty.id)).all()
    for duty_id in identifiers:
        db.execute(update(Duty).where(Duty.id == duty_id).values(capacity=Duty.capacity))
    duty_ids = select(Duty.id).where(Duty.event_id == event_id)
    db.execute(delete(duty_users).where(duty_users.c.user_id == user_id, duty_users.c.duty_id.in_(duty_ids)))
    db.delete(membership)
    db.commit()
    return Response(status_code=204)


@router.get("/users")
def list_users(db: Session = Depends(get_db), user: User = Depends(require_superadmin)):
    return [
        {"id": item.id, "email": item.email, "is_active": item.is_active, "is_superadmin": item.is_superadmin}
        for item in db.scalars(select(User).order_by(User.email)).all()
    ]


@router.post("/users/superadmin-invitations", status_code=204)
def invite_superadmin(data: EmailInput, db: Session = Depends(get_db), user: User = Depends(require_superadmin)):
    email = normalize_email(data.email)
    existing = db.scalar(select(User).where(User.email == email))
    if existing and existing.is_superadmin:
        raise HTTPException(status_code=409, detail="Benutzer ist bereits Superadmin")
    issue_invitation(db, email, is_superadmin=True)
    return Response(status_code=204)


@router.patch("/users/{user_id}")
def update_user(user_id: int, data: UserUpdate, db: Session = Depends(get_db), current: User = Depends(require_superadmin)):
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="Benutzer nicht gefunden")
    next_active = target.is_active if data.is_active is None else data.is_active
    next_superadmin = target.is_superadmin if data.is_superadmin is None else data.is_superadmin
    if target.is_active and target.is_superadmin and not (next_active and next_superadmin) and active_superadmin_count(db) <= 1:
        raise HTTPException(status_code=409, detail="Letzter aktiver Superadmin kann nicht entfernt werden")
    target.is_active = next_active
    target.is_superadmin = next_superadmin
    if not next_active:
        db.execute(delete(AuthSession).where(AuthSession.user_id == user_id))
    db.commit()
    return {"id": target.id, "email": target.email, "is_active": target.is_active, "is_superadmin": target.is_superadmin}
