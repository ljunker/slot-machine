from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.event import Event
from app.schemas.event import EventCreate, EventUpdate


class EventRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_all(self) -> list[Event]:
        return list(
            self.db.scalars(select(Event).order_by(Event.start_date, Event.id)).all()
        )

    def get_by_id(self, event_id: int) -> Event | None:
        return self.db.get(Event, event_id)

    def create(self, data: EventCreate) -> Event:
        event = Event(**data.model_dump())
        self.db.add(event)
        self.db.flush()
        return event

    def update(
        self,
        event: Event,
        data: EventUpdate,
    ) -> Event:
        for field, value in data.model_dump(exclude_unset=True).items():
            setattr(event, field, value)
        self.db.flush()
        return event

    def delete(self, event: Event) -> None:
        self.db.delete(event)
        self.db.flush()
