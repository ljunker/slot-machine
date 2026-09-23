from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models.room import Room
from app.models.slot import Slot
from app.models.speaker import slot_speakers
from app.repositories.event_repository import EventRepository
from app.repositories.room_repository import RoomRepository
from app.schemas.room import RoomCreate, RoomUpdate
from app.services.errors import DomainError, NotFound
from app.services.validation import name, required_patch


class RoomService:
    def __init__(self, db: Session):
        self.db = db
        self.repository = RoomRepository(db)
        self.events = EventRepository(db)

    def get(self, room_id: int) -> Room:
        room = self.repository.get_by_id(room_id)
        if room is None:
            raise NotFound("Raum nicht gefunden")
        return room

    def get_for_event(self, event_id: int) -> list[Room]:
        if self.events.get_by_id(event_id) is None:
            raise NotFound("Veranstaltung nicht gefunden")
        return self.repository.get_for_event(event_id)

    def create(self, data: RoomCreate) -> Room:
        rooms = self.get_for_event(data.event_id)
        room = self.repository.create(data.model_copy(update={"name": name(data.name)}))
        room.sort_order = max((item.sort_order for item in rooms), default=-1) + 1
        self.db.commit()
        return room

    def update(
        self,
        room_id: int,
        data: RoomUpdate,
    ) -> Room:
        room = self.get(room_id)
        changes = data.model_dump(exclude_unset=True)
        required_patch(changes, {"name"})
        if "name" in changes:
            changes["name"] = name(changes["name"])
        room = self.repository.update(room, RoomUpdate(**changes))
        self.db.commit()
        return room

    def delete(self, room_id: int) -> None:
        room = self.get(room_id)
        event_id = room.event_id
        self.db.execute(delete(slot_speakers).where(
            slot_speakers.c.slot_id.in_(select(Slot.id).where(Slot.room_id == room_id))
        ))
        self.db.execute(delete(Slot).where(Slot.room_id == room_id))
        self.repository.delete(room)
        for index, remaining in enumerate(self.repository.get_for_event(event_id)):
            remaining.sort_order = index
        self.db.commit()

    def reorder(
        self,
        event_id: int,
        room_ids: list[int],
    ) -> list[Room]:
        rooms = self.get_for_event(event_id)
        if len(room_ids) != len(rooms) or set(room_ids) != {room.id for room in rooms}:
            raise DomainError(
                "Raumliste muss alle Räume der Veranstaltung genau einmal enthalten"
            )
        by_id = {room.id: room for room in rooms}
        for index, room_id in enumerate(room_ids):
            by_id[room_id].sort_order = index
        self.db.commit()
        return [by_id[room_id] for room_id in room_ids]
