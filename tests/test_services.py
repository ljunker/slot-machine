from datetime import date, time

import pytest

from app.models.event_day import EventDay
from app.repositories.event_day_repository import EventDayRepository
from app.schemas.event import EventCreate
from app.schemas.event_day import EventDayCreate, EventDayUpdate
from app.schemas.room import RoomCreate
from app.schemas.slot import SlotCreate
from app.services.errors import DomainError
from app.services.event_service import EventService
from app.services.room_service import RoomService
from app.services.slot_service import SlotService


def test_event_day_repository_crud(db):
    event = EventService(db).create(
        EventCreate(
            name="Tagestest", start_date=date(2026, 10, 1), end_date=date(2026, 10, 2)
        )
    )
    repository = EventDayRepository(db)
    day = repository.create(
        EventDayCreate(
            event_id=event.id,
            date=date(2026, 10, 1),
            start_time=time(9),
            end_time=time(18),
        )
    )
    assert repository.get_by_id(day.id) is day
    assert repository.get_for_event(event.id) == [day]
    repository.update(day, EventDayUpdate(end_time=time(19)))
    assert day.end_time == time(19)
    repository.delete(day)
    assert db.query(EventDay).count() == 0


def test_move_resize_and_collision_rules(db):
    event = EventService(db).create(
        EventCreate(
            name="Konferenz", start_date=date(2026, 10, 1), end_date=date(2026, 10, 1)
        )
    )
    day = EventDay(
        event_id=event.id, date=date(2026, 10, 1), start_time=time(9), end_time=time(18)
    )
    db.add(day)
    db.commit()
    first_room = RoomService(db).create(RoomCreate(event_id=event.id, name="A"))
    second_room = RoomService(db).create(RoomCreate(event_id=event.id, name="B"))
    service = SlotService(db)
    first = service.create(
        SlotCreate(
            day_id=day.id,
            room_id=first_room.id,
            topic="Erster",
            start_time=time(10),
            end_time=time(11),
        )
    )
    touching = service.create(
        SlotCreate(
            day_id=day.id,
            room_id=first_room.id,
            topic="Zweiter",
            start_time=time(11),
            end_time=time(12),
        )
    )
    assert service.has_collision(first) is False
    service.resize(first.id, time(11, 30))
    assert service.has_collision(first) is True
    assert service.has_collision(touching) is True
    moved = service.move(first.id, second_room.id, time(12))
    assert (moved.start_time, moved.end_time, moved.room_id) == (
        time(12),
        time(13, 30),
        second_room.id,
    )
    assert service.has_collision(moved) is False
    with pytest.raises(DomainError):
        service.move(moved.id, second_room.id, time(17))
