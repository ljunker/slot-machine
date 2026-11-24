from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models.auth import AuthToken, EventMembership
from app.models.category import Category, slot_categories
from app.models.duty import Duty
from app.models.event_day import EventDay
from app.models.helper import duty_users
from app.models.program_design import InfoBlock, PartnerLogo
from app.models.room import Room
from app.models.slot import Slot
from app.models.speaker import Speaker, slot_speakers
from app.repositories.event_day_repository import EventDayRepository
from app.repositories.event_repository import EventRepository
from app.schemas.event import EventCreate, EventUpdate
from app.services.errors import Conflict, NotFound
from app.services.event_branding import clean_design, remove_logo_file
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
            EventCreate(**clean_design({**data.model_dump(), "name": name(data.name)}))
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
        clean_design(changes)
        event = self.repository.update(event, EventUpdate(**changes))
        self.db.commit()
        return event

    def delete(self, event_id: int) -> None:
        event = self.get(event_id)
        images = [event.logo_filename, event.header_graphic_filename, event.footer_graphic_filename]
        images += list(self.db.scalars(
            select(PartnerLogo.image_filename).where(PartnerLogo.event_id == event_id)
        ).all())
        slot_ids = select(Slot.id).where(Slot.event_id == event_id)
        photos = list(self.db.scalars(
            select(Speaker.photo_filename).where(Speaker.event_id == event_id)
        ).all())
        duty_ids = select(Duty.id).where(Duty.event_id == event_id)
        self.db.execute(delete(duty_users).where(duty_users.c.duty_id.in_(duty_ids)))
        self.db.execute(delete(Duty).where(Duty.event_id == event_id))
        self.db.execute(delete(slot_speakers).where(slot_speakers.c.slot_id.in_(slot_ids)))
        self.db.execute(delete(slot_categories).where(slot_categories.c.slot_id.in_(slot_ids)))
        self.db.execute(delete(Slot).where(Slot.event_id == event_id))
        self.db.execute(delete(Speaker).where(Speaker.event_id == event_id))
        self.db.execute(delete(Category).where(Category.event_id == event_id))
        self.db.execute(delete(EventDay).where(EventDay.event_id == event_id))
        self.db.execute(delete(Room).where(Room.event_id == event_id))
        self.db.execute(delete(PartnerLogo).where(PartnerLogo.event_id == event_id))
        self.db.execute(delete(InfoBlock).where(InfoBlock.event_id == event_id))
        self.db.execute(delete(AuthToken).where(AuthToken.event_id == event_id))
        self.db.execute(delete(EventMembership).where(EventMembership.event_id == event_id))
        self.repository.delete(event)
        self.db.commit()
        for photo in photos:
            SpeakerService._remove_file(photo)
        for image in images:
            remove_logo_file(image)
