from datetime import date, datetime, time

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.slot import Slot
from app.models.speaker import Speaker
from app.repositories.event_day_repository import EventDayRepository
from app.repositories.room_repository import RoomRepository
from app.repositories.slot_repository import SlotRepository
from app.schemas.slot import SlotCreate, SlotUpdate
from app.services.errors import DomainError, NotFound
from app.services.validation import name, required_patch, time_range


class SlotService:
    def __init__(self, db: Session):
        self.db = db
        self.repository = SlotRepository(db)
        self.days = EventDayRepository(db)
        self.rooms = RoomRepository(db)

    def get(self, slot_id: int) -> Slot:
        slot = self.repository.get_by_id(slot_id)
        if slot is None:
            raise NotFound("Slot nicht gefunden")
        return slot

    def _validate(self, day_id: int, room_id: int, start: time, end: time) -> None:
        day = self.days.get_by_id(day_id)
        room = self.rooms.get_by_id(room_id)
        if day is None:
            raise NotFound("Veranstaltungstag nicht gefunden")
        if room is None:
            raise NotFound("Raum nicht gefunden")
        if day.event_id != room.event_id:
            raise DomainError("Raum und Tag gehören zu verschiedenen Veranstaltungen")
        time_range(start, end)
        if start < day.start_time or end > day.end_time:
            raise DomainError("Slot liegt außerhalb der Tageszeiten")

    def create(self, data: SlotCreate) -> Slot:
        self._validate(data.day_id, data.room_id, data.start_time, data.end_time)
        event_id = self.days.get_by_id(data.day_id).event_id
        speakers = self._speakers(event_id, data.speaker_ids)
        slot = self.repository.create(
            data.model_copy(update={"topic": name(data.topic)})
        )
        slot.speakers = speakers
        self.db.commit()
        return slot

    def update(
        self,
        slot_id: int,
        data: SlotUpdate,
    ) -> Slot:
        slot = self.get(slot_id)
        changes = data.model_dump(exclude_unset=True)
        required_patch(changes, {"topic", "room_id", "start_time", "end_time"})
        room_id = changes.get("room_id", slot.room_id)
        start = changes.get("start_time", slot.start_time)
        end = changes.get("end_time", slot.end_time)
        self._validate(slot.day_id, room_id, start, end)
        speakers = None
        if "speaker_ids" in changes:
            speakers = self._speakers(
                self.days.get_by_id(slot.day_id).event_id, changes["speaker_ids"]
            )
        if "topic" in changes:
            changes["topic"] = name(changes["topic"])
        slot = self.repository.update(slot, SlotUpdate(**changes))
        if speakers is not None:
            slot.speakers = speakers
        self.db.commit()
        return slot

    def _speakers(self, event_id: int, speaker_ids: list[int] | None) -> list[Speaker]:
        if speaker_ids is None:
            raise DomainError("Rednerliste darf nicht null sein")
        if len(speaker_ids) != len(set(speaker_ids)):
            raise DomainError("Redner dürfen nur einmal zugeordnet werden")
        if not speaker_ids:
            return []
        speakers = list(
            self.db.scalars(select(Speaker).where(Speaker.id.in_(speaker_ids))).all()
        )
        if len(speakers) != len(speaker_ids) or any(
            speaker.event_id != event_id for speaker in speakers
        ):
            raise DomainError("Redner gehören nicht zur Veranstaltung")
        by_id = {speaker.id: speaker for speaker in speakers}
        return [by_id[speaker_id] for speaker_id in speaker_ids]

    def delete(self, slot_id: int) -> None:
        self.repository.delete(self.get(slot_id))
        self.db.commit()

    def move(
        self,
        slot_id: int,
        room_id: int,
        start_time: time,
    ) -> Slot:
        slot = self.get(slot_id)
        duration = datetime.combine(date.min, slot.end_time) - datetime.combine(
            date.min, slot.start_time
        )
        end = datetime.combine(date.min, start_time) + duration
        if end.date() != date.min:
            raise DomainError("Slot liegt außerhalb des Tages")
        return self.update(
            slot_id,
            SlotUpdate(room_id=room_id, start_time=start_time, end_time=end.time()),
        )

    def resize(
        self,
        slot_id: int,
        end_time: time,
    ) -> Slot:
        return self.update(slot_id, SlotUpdate(end_time=end_time))

    def has_collision(
        self,
        slot: Slot,
    ) -> bool:
        return any(
            other.id != slot.id
            and slot.start_time < other.end_time
            and other.start_time < slot.end_time
            for other in self.repository.get_for_room(slot.day_id, slot.room_id)
        )
