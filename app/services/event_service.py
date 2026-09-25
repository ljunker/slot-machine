from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models.duty import Duty
from app.models.event_day import EventDay
from app.models.helper import Helper, duty_helpers
from app.models.room import Room
from app.models.slot import Slot
from app.models.speaker import Speaker, slot_speakers
from app.repositories.event_day_repository import EventDayRepository
from app.repositories.event_repository import EventRepository
from app.schemas.event import EventCreate, EventUpdate
from app.services.errors import Conflict, NotFound
from app.services.speaker_service import SpeakerService
from app.services.validation import date_range, name, required_patch


class EventService:
    def __init__(self, db: Session):
        self.db = db
        self.repository = EventRepository(db)
        self.day_repository = EventDayRepository(db)

    def get_all(self):
        return self.repository.get_all()

    def get(self, event_id: int):
        event = self.repository.get_by_id(event_id)
        if event is None:
            raise NotFound("Veranstaltung nicht gefunden")
        return event

    def create(self, data: EventCreate):
        date_range(data.start_date, data.end_date)
        event = self.repository.create(
            data.model_copy(update={"name": name(data.name)})
        )
        self.db.commit()
        return event

    def update(self, event_id: int, data: EventUpdate):
        event = self.get(event_id)
        changes = data.model_dump(exclude_unset=True)
        required_patch(changes, {"name", "start_date", "end_date"})
        start = changes.get("start_date", event.start_date)
        end = changes.get("end_date", event.end_date)
        date_range(start, end)
        if any(
            not start <= day.date <= end
            for day in self.day_repository.get_for_event(event_id)
        ):
            raise Conflict(
                "Vorhandene Tage liegen außerhalb des neuen Veranstaltungszeitraums"
            )
        if "name" in changes:
            changes["name"] = name(changes["name"])
        event = self.repository.update(event, EventUpdate(**changes))
        self.db.commit()
        return event

    def delete(self, event_id: int) -> None:
        event = self.get(event_id)
        slot_ids = select(Slot.id).where(Slot.event_id == event_id)
        photos = list(self.db.scalars(
            select(Speaker.photo_filename).where(Speaker.event_id == event_id)
        ).all())
        duty_ids = select(Duty.id).where(Duty.event_id == event_id)
        self.db.execute(delete(duty_helpers).where(duty_helpers.c.duty_id.in_(duty_ids)))
        self.db.execute(delete(Duty).where(Duty.event_id == event_id))
        self.db.execute(delete(Helper).where(Helper.event_id == event_id))
        self.db.execute(delete(slot_speakers).where(slot_speakers.c.slot_id.in_(slot_ids)))
        self.db.execute(delete(Slot).where(Slot.event_id == event_id))
        self.db.execute(delete(Speaker).where(Speaker.event_id == event_id))
        self.db.execute(delete(EventDay).where(EventDay.event_id == event_id))
        self.db.execute(delete(Room).where(Room.event_id == event_id))
        self.repository.delete(event)
        self.db.commit()
        for photo in photos:
            SpeakerService._remove_file(photo)
