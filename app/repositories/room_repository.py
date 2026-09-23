from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.room import Room
from app.schemas.room import RoomCreate, RoomUpdate


class RoomRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_by_id(self, room_id: int) -> Room | None:
        return self.db.get(Room, room_id)

    def get_for_event(self, event_id: int) -> list[Room]:
        return list(
            self.db.scalars(
                select(Room)
                .where(Room.event_id == event_id)
                .order_by(Room.sort_order, Room.id)
            ).all()
        )

    def create(self, data: RoomCreate) -> Room:
        room = Room(**data.model_dump())
        self.db.add(room)
        self.db.flush()
        return room

    def update(
        self,
        room: Room,
        data: RoomUpdate,
    ) -> Room:
        for field, value in data.model_dump(exclude_unset=True).items():
            setattr(room, field, value)
        self.db.flush()
        return room

    def delete(self, room: Room) -> None:
        self.db.delete(room)
        self.db.flush()
