from fastapi import APIRouter, Depends, File, Response, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.schemas.event import EventCreate, EventResponse, EventUpdate
from app.schemas.slot import PublicSessionResponse, SlotResponse
from app.services.errors import NotFound
from app.services.event_branding import (
    LOGO_MIME,
    MAX_LOGO_BYTES,
    EventBrandingService,
    logo_path,
)
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


@router.get("/{event_id}/sessions/{slot_id}", response_model=PublicSessionResponse)
def get_public_session(event_id: int, slot_id: int, db: Session = Depends(get_db)):
    return SlotService(db).get_public_session(event_id, slot_id)


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


@router.post("/{event_id}/logo", response_model=EventResponse)
async def upload_logo(
    event_id: int, logo: UploadFile = File(...), db: Session = Depends(get_db)
):
    content = await logo.read(MAX_LOGO_BYTES + 1)
    return EventBrandingService(db).upload_logo(event_id, content)


@router.get("/{event_id}/logo")
def get_logo(event_id: int, db: Session = Depends(get_db)):
    event = EventService(db).get(event_id)
    path = logo_path(event)
    if path is None or not path.is_file():
        raise NotFound("Logo nicht gefunden")
    return FileResponse(
        path, media_type=LOGO_MIME[path.suffix.lstrip(".")],
        headers={"Cache-Control": "no-store"},
    )


@router.delete("/{event_id}/logo", response_model=EventResponse)
def delete_logo(event_id: int, db: Session = Depends(get_db)):
    return EventBrandingService(db).delete_logo(event_id)


@router.patch("/{event_id}", response_model=EventResponse)
def update_event(event_id: int, data: EventUpdate, db: Session = Depends(get_db)):
    return EventService(db).update(event_id, data)


@router.delete("/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_event(event_id: int, db: Session = Depends(get_db)):
    EventService(db).delete(event_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
