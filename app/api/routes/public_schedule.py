from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.models.event_day import EventDay
from app.models.slot import Slot
from app.models.speaker import Speaker, slot_speakers
from app.schemas.public_schedule import PublicDaySchedule
from app.schemas.slot import PublicSpeaker
from app.services.errors import NotFound
from app.services.public_meta import meta_html, page_meta, public_base_url
from app.services.schedule_service import ScheduleService
from app.services.speaker_service import PHOTO_MIME, photo_directory

router = APIRouter(prefix="/public", tags=["Public Program"])


@router.get("/events/{event_id}/days/{day_id}/schedule", response_model=PublicDaySchedule)
def get_public_schedule(event_id: int, day_id: int, db: Session = Depends(get_db)):
    day = db.get(EventDay, day_id)
    if day is None or day.event_id != event_id:
        raise HTTPException(status_code=404, detail="Veranstaltungstag nicht gefunden")
    schedule = PublicDaySchedule.model_validate(ScheduleService(db).get_day_schedule(day_id))
    profiles = {
        speaker.id: PublicSpeaker.model_validate(speaker)
        for speaker in db.scalars(select(Speaker).where(Speaker.event_id == event_id))
    }
    for slot in [*(slot for room in schedule.rooms for slot in room.slots), *schedule.shared_slots]:
        slot.speakers = [profiles.get(speaker.id, speaker) for speaker in slot.speakers]
    return schedule


@router.get("/speakers/{speaker_id}/photo")
def get_public_speaker_photo(speaker_id: int, db: Session = Depends(get_db)):
    """Foto eines Redners, der in mindestens einer eingeplanten Session auftritt."""
    speaker = db.get(Speaker, speaker_id)
    planned = speaker is not None and db.scalar(
        select(Slot.id)
        .join(slot_speakers, slot_speakers.c.slot_id == Slot.id)
        .where(slot_speakers.c.speaker_id == speaker_id, Slot.day_id.is_not(None))
        .limit(1)
    )
    if not planned or not speaker.photo_filename:
        raise NotFound("Foto nicht gefunden")
    path = photo_directory() / speaker.photo_filename
    if not path.is_file():
        raise NotFound("Foto nicht gefunden")
    return FileResponse(path, media_type=PHOTO_MIME[path.suffix.lstrip(".")], headers={"Cache-Control": "public, max-age=300"})


@router.get("/meta/{path:path}", response_class=HTMLResponse)
def get_page_meta(path: str, request: Request, db: Session = Depends(get_db)):
    """HTML-Kopfzeilen (Titel, Open Graph) für eine Seite; nginx bindet sie per SSI in index.html ein."""
    base = public_base_url(request)
    page = "/" + path.lstrip("/")
    return HTMLResponse(meta_html(page_meta(db, page), base, base + page), headers={"Cache-Control": "no-store"})
