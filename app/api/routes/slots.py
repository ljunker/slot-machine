from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.models.auth import User
from app.models.event_day import EventDay
from app.models.slot import Slot
from app.schemas.slot import (
    SlotCreate,
    SlotResponse,
    SlotUpdate,
)
from app.services.auth import authorize_event, authorize_object, require_user
from app.services.slot_service import SlotService

router = APIRouter(
    prefix="/slots",
    tags=["Slots"],
    dependencies=[Depends(require_user)],
)


@router.post(
    "",
    response_model=SlotResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_slot(
    data: SlotCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
):
    event_id = data.event_id
    if event_id is None and data.day_id is not None:
        day = db.get(EventDay, data.day_id)
        event_id = day.event_id if day else None
    if event_id is not None:
        authorize_event(db, user, event_id)
    service = SlotService(db)

    return service.create(data)


@router.patch(
    "/{slot_id}",
    response_model=SlotResponse,
)
def update_slot(
    slot_id: int,
    data: SlotUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
):
    authorize_object(db, user, Slot, slot_id)
    service = SlotService(db)

    return service.update(slot_id, data)


@router.delete(
    "/{slot_id}/rescheduled-notice",
    status_code=status.HTTP_204_NO_CONTENT,
)
def clear_rescheduled_notice(
    slot_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
):
    authorize_object(db, user, Slot, slot_id)
    SlotService(db).clear_rescheduled_notice(slot_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete(
    "/{slot_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_slot(
    slot_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
):
    authorize_object(db, user, Slot, slot_id)
    service = SlotService(db)

    service.delete(slot_id)

    return Response(status_code=status.HTTP_204_NO_CONTENT)
