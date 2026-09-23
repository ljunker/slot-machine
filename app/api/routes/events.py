from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.schemas.event import EventCreate, EventResponse, EventUpdate
from app.services.event_service import EventService

router = APIRouter(
    prefix="/events",
    tags=["Events"],
)


@router.get("", response_model=list[EventResponse])
def get_events(db: Session = Depends(get_db)):
    return EventService(db).get_all()


@router.post("", response_model=EventResponse, status_code=status.HTTP_201_CREATED)
def create_event(data: EventCreate, db: Session = Depends(get_db)):
    return EventService(db).create(data)


@router.get("/{event_id}", response_model=EventResponse)
def get_event(event_id: int, db: Session = Depends(get_db)):
    return EventService(db).get(event_id)


@router.patch("/{event_id}", response_model=EventResponse)
def update_event(event_id: int, data: EventUpdate, db: Session = Depends(get_db)):
    return EventService(db).update(event_id, data)


@router.delete("/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_event(event_id: int, db: Session = Depends(get_db)):
    EventService(db).delete(event_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
