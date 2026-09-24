from sqlalchemy.orm import Session

from app.repositories.event_day_repository import EventDayRepository
from app.repositories.event_repository import EventRepository
from app.repositories.slot_repository import SlotRepository
from app.schemas.event_day import EventDayCreate, EventDayUpdate
from app.services.errors import Conflict, DomainError, NotFound
from app.services.validation import required_patch, time_range


class EventDayService:
    def __init__(self, db: Session):
        self.db = db
        self.repository = EventDayRepository(db)
        self.events = EventRepository(db)
        self.slots = SlotRepository(db)

    def get(self, day_id: int):
        day = self.repository.get_by_id(day_id)
        if day is None:
            raise NotFound("Veranstaltungstag nicht gefunden")
        return day

    def get_for_event(self, event_id: int):
        if self.events.get_by_id(event_id) is None:
            raise NotFound("Veranstaltung nicht gefunden")
        return self.repository.get_for_event(event_id)

    def create(self, data: EventDayCreate):
        event = self.events.get_by_id(data.event_id)
        if event is None:
            raise NotFound("Veranstaltung nicht gefunden")
        time_range(data.start_time, data.end_time)
        if not event.start_date <= data.date <= event.end_date:
            raise DomainError("Tag liegt außerhalb der Veranstaltung")
        if any(
            day.date == data.date
            for day in self.repository.get_for_event(data.event_id)
        ):
            raise Conflict("Veranstaltungstag existiert bereits")
        day = self.repository.create(data)
        self.db.commit()
        return day

    def update(self, day_id: int, data: EventDayUpdate):
        day = self.get(day_id)
        changes = data.model_dump(exclude_unset=True)
        required_patch(changes, {"date", "start_time", "end_time"})
        event = self.events.get_by_id(day.event_id)
        date = changes.get("date", day.date)
        start = changes.get("start_time", day.start_time)
        end = changes.get("end_time", day.end_time)
        time_range(start, end)
        if not event.start_date <= date <= event.end_date:
            raise DomainError("Tag liegt außerhalb der Veranstaltung")
        if any(
            other.id != day_id and other.date == date
            for other in self.repository.get_for_event(day.event_id)
        ):
            raise Conflict("Veranstaltungstag existiert bereits")
        if any(
            slot.start_time < start or slot.end_time > end
            for slot in self.slots.get_for_day(day_id)
        ):
            raise Conflict("Vorhandene Slots liegen außerhalb der neuen Tageszeiten")
        day = self.repository.update(day, EventDayUpdate(**changes))
        self.db.commit()
        return day

    def delete(self, day_id: int) -> None:
        day = self.get(day_id)
        for slot in self.slots.get_for_day(day_id):
            slot.day_id = None
            slot.room_id = None
            slot.start_time = None
            slot.end_time = None
            slot.is_cancelled = False
            slot.schedule_changed_at = None
            slot.content_changed_at = None
            slot.previous_start_time = None
            slot.previous_end_time = None
            slot.previous_room_name = None
        self.db.flush()
        self.repository.delete(day)
        self.db.commit()
