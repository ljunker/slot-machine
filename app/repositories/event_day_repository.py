from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.event_day import EventDay
from app.schemas.event_day import EventDayCreate, EventDayUpdate


class EventDayRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_by_id(self, day_id: int) -> EventDay | None:
        return self.db.get(EventDay, day_id)

    def get_for_event(self, event_id: int) -> list[EventDay]:
        return list(
            self.db.scalars(
                select(EventDay)
                .where(EventDay.event_id == event_id)
                .order_by(EventDay.date, EventDay.id)
            ).all()
        )

    def create(self, data: EventDayCreate) -> EventDay:
        day = EventDay(**data.model_dump())
        self.db.add(day)
        self.db.flush()
        return day

    def update(self, day: EventDay, data: EventDayUpdate) -> EventDay:
        for field, value in data.model_dump(exclude_unset=True).items():
            setattr(day, field, value)
        self.db.flush()
        return day

    def delete(self, day: EventDay) -> None:
        self.db.delete(day)
        self.db.flush()
