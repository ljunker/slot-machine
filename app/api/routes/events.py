from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.schemas.event import EventCreate, EventResponse, EventUpdate
from app.schemas.slot import SlotResponse
from app.services.event_service import EventService
from app.services.program_pdf import build_program_pdf
from app.services.slot_service import SlotService

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


@router.get("/{event_id}/unplanned-sessions", response_model=list[SlotResponse])
def get_unplanned_sessions(event_id: int, db: Session = Depends(get_db)):
    return SlotService(db).get_unplanned_for_event(event_id)


@router.get("/{event_id}/program.pdf")
def get_program_pdf(event_id: int, db: Session = Depends(get_db)):
    data = build_program_pdf(db, event_id)
    return Response(
        content=data,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="programm-{event_id}.pdf"',
            "Cache-Control": "no-store",
        },
    )


@router.patch("/{event_id}", response_model=EventResponse)
def update_event(event_id: int, data: EventUpdate, db: Session = Depends(get_db)):
    return EventService(db).update(event_id, data)


@router.delete("/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_event(event_id: int, db: Session = Depends(get_db)):
    EventService(db).delete(event_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
