from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.event_day import EventDay
from app.models.slot import Slot
from app.schemas.slot import SlotCreate, SlotUpdate


class SlotRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_by_id(self, slot_id: int) -> Slot | None:
        statement = select(Slot).where(Slot.id == slot_id)

        return self.db.scalar(statement)

    def get_for_day(self, day_id: int) -> list[Slot]:
        statement = (
            select(Slot)
            .where(Slot.day_id == day_id)
            .order_by(Slot.start_time, Slot.room_id)
        )

        return list(self.db.scalars(statement).all())

    def get_unplanned_for_event(self, event_id: int) -> list[Slot]:
        statement = (
            select(Slot)
            .where(Slot.event_id == event_id, Slot.day_id.is_(None))
            .order_by(Slot.topic, Slot.id)
        )
        return list(self.db.scalars(statement).all())

    def get_for_room(
        self,
        day_id: int,
        room_id: int,
    ) -> list[Slot]:
        statement = (
            select(Slot)
            .where(Slot.day_id == day_id, Slot.room_id == room_id)
            .order_by(Slot.start_time)
        )

        return list(self.db.scalars(statement).all())

    def create(self, data: SlotCreate) -> Slot:
        values = data.model_dump(exclude={"speaker_ids"})
        if values["event_id"] is None and values["day_id"] is not None:
            day = self.db.get(EventDay, values["day_id"])
            values["event_id"] = day.event_id if day else None
        slot = Slot(**values)

        self.db.add(slot)
        self.db.flush()

        return slot

    def update(
        self,
        slot: Slot,
        data: SlotUpdate,
    ) -> Slot:
        update_data = data.model_dump(exclude_unset=True, exclude={"speaker_ids"})

        for field, value in update_data.items():
            setattr(slot, field, value)

        self.db.flush()

        return slot

    def delete(self, slot: Slot) -> None:
        self.db.delete(slot)
        self.db.flush()
