from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.models.event_day import EventDay
from app.schemas.public_schedule import PublicDaySchedule
from app.services.schedule_service import ScheduleService

router = APIRouter(prefix="/public", tags=["Public Program"])


@router.get("/events/{event_id}/days/{day_id}/schedule", response_model=PublicDaySchedule)
def get_public_schedule(event_id: int, day_id: int, db: Session = Depends(get_db)):
    day = db.get(EventDay, day_id)
    if day is None or day.event_id != event_id:
        raise HTTPException(status_code=404, detail="Veranstaltungstag nicht gefunden")
    return PublicDaySchedule.model_validate(ScheduleService(db).get_day_schedule(day_id))
