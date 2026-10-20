from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.models.auth import User
from app.models.event_day import EventDay
from app.schemas.event_day import EventDayCreate, EventDayResponse, EventDayUpdate
from app.services.auth import authorize_event, authorize_object, require_user
from app.services.errors import DomainError
from app.services.event_day_service import EventDayService

router = APIRouter(tags=["Event Days"], dependencies=[Depends(require_user)])
public_router = APIRouter(tags=["Public Program"])


@public_router.get("/events/{event_id}/days", response_model=list[EventDayResponse])
def get_days(event_id: int, db: Session = Depends(get_db)):
    return EventDayService(db).get_for_event(event_id)


@router.post(
    "/events/{event_id}/days",
    response_model=EventDayResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_day(event_id: int, data: EventDayCreate, db: Session = Depends(get_db), user: User = Depends(require_user)):
    authorize_event(db, user, event_id, "admin")
    if data.event_id != event_id:
        raise DomainError("Event-ID in Pfad und Daten stimmen nicht überein")
    return EventDayService(db).create(data)


@router.patch("/days/{day_id}", response_model=EventDayResponse)
def update_day(day_id: int, data: EventDayUpdate, db: Session = Depends(get_db), user: User = Depends(require_user)):
    authorize_object(db, user, EventDay, day_id, "admin")
    return EventDayService(db).update(day_id, data)


@router.delete("/days/{day_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_day(day_id: int, db: Session = Depends(get_db), user: User = Depends(require_user)):
    authorize_object(db, user, EventDay, day_id, "admin")
    EventDayService(db).delete(day_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
