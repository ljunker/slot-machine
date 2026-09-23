from datetime import date, time

from sqlalchemy import select

from app.models.event import Event
from app.models.event_day import EventDay
from app.models.room import Room
from app.models.slot import Slot
from app.repositories.event_repository import EventRepository
from app.repositories.room_repository import RoomRepository
from app.repositories.slot_repository import SlotRepository
from app.schemas.event import EventCreate, EventUpdate
from app.schemas.room import RoomCreate, RoomUpdate
from app.schemas.slot import SlotCreate, SlotUpdate


def create_event(client, name="Konferenz"):
    response = client.post(
        "/api/events",
        json={"name": name, "start_date": "2026-10-01", "end_date": "2026-10-02"},
    )
    assert response.status_code == 201
    return response.json()


def create_day(client, event_id, date="2026-10-01"):
    response = client.post(
        f"/api/events/{event_id}/days",
        json={
            "event_id": event_id,
            "date": date,
            "start_time": "09:00",
            "end_time": "18:00",
        },
    )
    assert response.status_code == 201
    return response.json()


def create_room(client, event_id, name="Saal"):
    response = client.post("/api/rooms", json={"event_id": event_id, "name": name})
    assert response.status_code == 201
    return response.json()


def create_slot(client, day_id, room_id, start="10:00", end="11:00"):
    response = client.post(
        "/api/slots",
        json={
            "day_id": day_id,
            "room_id": room_id,
            "topic": "Vortrag",
            "start_time": start,
            "end_time": end,
        },
    )
    assert response.status_code == 201
    return response.json()


def test_repository_crud(db):
    events = EventRepository(db)
    rooms = RoomRepository(db)
    slots = SlotRepository(db)
    event = events.create(
        EventCreate(
            name="Test", start_date=date(2026, 10, 1), end_date=date(2026, 10, 1)
        )
    )
    day = EventDay(
        event_id=event.id, date=date(2026, 10, 1), start_time=time(9), end_time=time(18)
    )
    db.add(day)
    db.flush()
    room = rooms.create(RoomCreate(event_id=event.id, name="A"))
    slot = slots.create(
        SlotCreate(
            day_id=day.id,
            room_id=room.id,
            topic="T",
            start_time=time(10),
            end_time=time(11),
        )
    )
    assert events.get_by_id(event.id) is event
    assert rooms.get_for_event(event.id) == [room]
    assert slots.get_for_room(day.id, room.id) == [slot]
    events.update(event, EventUpdate(name="Neu"))
    rooms.update(room, RoomUpdate(name="B"))
    slots.update(slot, SlotUpdate(topic="U"))
    assert (event.name, room.name, slot.topic) == ("Neu", "B", "U")
    slots.delete(slot)
    rooms.delete(room)
    db.delete(day)
    events.delete(event)
    assert db.scalars(select(Event)).all() == []


def test_full_crud_and_cascade(client, db):
    event = create_event(client)
    assert client.get("/api/events").json()[0]["id"] == event["id"]
    assert client.get(f"/api/events/{event['id']}").status_code == 200
    day = create_day(client, event["id"])
    room = create_room(client, event["id"])
    slot = create_slot(client, day["id"], room["id"])
    assert (
        client.patch(f"/api/events/{event['id']}", json={"name": "Neu"}).json()["name"]
        == "Neu"
    )
    assert (
        client.patch(f"/api/days/{day['id']}", json={"end_time": "19:00"}).status_code
        == 200
    )
    assert (
        client.patch(
            f"/api/rooms/{room['id']}", json={"name": "Neuer Raum"}
        ).status_code
        == 200
    )
    assert (
        client.patch(f"/api/slots/{slot['id']}", json={"speaker": "Alex"}).json()[
            "speaker"
        ]
        == "Alex"
    )
    assert client.delete(f"/api/events/{event['id']}").status_code == 204
    assert db.scalars(select(Event)).all() == []
    assert db.scalars(select(EventDay)).all() == []
    assert db.scalars(select(Room)).all() == []
    assert db.scalars(select(Slot)).all() == []


def test_day_and_room_delete_cascade(client, db):
    event = create_event(client)
    day = create_day(client, event["id"])
    room = create_room(client, event["id"])
    create_slot(client, day["id"], room["id"])
    assert client.delete(f"/api/rooms/{room['id']}").status_code == 204
    assert db.scalars(select(Slot)).all() == []
    room = create_room(client, event["id"])
    create_slot(client, day["id"], room["id"])
    assert client.delete(f"/api/days/{day['id']}").status_code == 204
    assert db.scalars(select(Slot)).all() == []


def test_schedule_collisions_and_empty_rooms(client):
    event = create_event(client)
    day = create_day(client, event["id"])
    room = create_room(client, event["id"], "A")
    empty = create_room(client, event["id"], "B")
    first = create_slot(client, day["id"], room["id"], "10:00", "11:00")
    touching = create_slot(client, day["id"], room["id"], "11:00", "12:00")
    overlapping = create_slot(client, day["id"], room["id"], "10:30", "11:30")
    schedule = client.get(f"/api/schedule/days/{day['id']}").json()
    assert [r["id"] for r in schedule["rooms"]] == [room["id"], empty["id"]]
    assert schedule["rooms"][1]["slots"] == []
    pairs = [
        {pair["first_slot_id"], pair["second_slot_id"]}
        for pair in schedule["collisions"]
    ]
    assert pairs == [
        {first["id"], overlapping["id"]},
        {touching["id"], overlapping["id"]},
    ]


def test_reorder_move_resize_and_boundaries(client):
    event = create_event(client)
    day = create_day(client, event["id"])
    first = create_room(client, event["id"], "A")
    second = create_room(client, event["id"], "B")
    slot = create_slot(client, day["id"], first["id"])
    assert (
        client.patch(
            f"/api/events/{event['id']}/rooms/order",
            json={"room_ids": [second["id"], first["id"]]},
        ).status_code
        == 200
    )
    assert [r["id"] for r in client.get(f"/api/events/{event['id']}/rooms").json()] == [
        second["id"],
        first["id"],
    ]
    assert (
        client.patch(
            f"/api/events/{event['id']}/rooms/order",
            json={"room_ids": [first["id"], first["id"]]},
        ).status_code
        == 400
    )
    moved = client.patch(
        f"/api/slots/{slot['id']}",
        json={"room_id": second["id"], "start_time": "12:00", "end_time": "13:00"},
    )
    assert moved.status_code == 200 and moved.json()["room_id"] == second["id"]
    assert (
        client.patch(f"/api/slots/{slot['id']}", json={"end_time": "14:00"}).json()[
            "end_time"
        ]
        == "14:00:00"
    )
    assert (
        client.patch(f"/api/slots/{slot['id']}", json={"end_time": "19:00"}).status_code
        == 400
    )
    assert (
        client.patch(f"/api/days/{day['id']}", json={"end_time": "13:00"}).status_code
        == 409
    )
    assert (
        client.patch(
            f"/api/events/{event['id']}", json={"start_date": "2026-10-02"}
        ).status_code
        == 409
    )
    assert client.get(f"/api/events/{event['id']}").json()["start_date"] == "2026-10-01"
    assert (
        client.get(f"/api/events/{event['id']}/days").json()[0]["end_time"]
        == "18:00:00"
    )
    assert (
        client.get(f"/api/schedule/days/{day['id']}").json()["rooms"][0]["slots"][0][
            "end_time"
        ]
        == "14:00:00"
    )


def test_invalid_relationships_and_null_patch(client):
    event = create_event(client)
    day = create_day(client, event["id"])
    other = create_event(client, "Andere")
    room = create_room(client, other["id"])
    result = client.post(
        "/api/slots",
        json={
            "day_id": day["id"],
            "room_id": room["id"],
            "topic": "Falsch",
            "start_time": "10:00",
            "end_time": "11:00",
        },
    )
    assert result.status_code == 400
    own_room = create_room(client, event["id"])
    slot = create_slot(client, day["id"], own_room["id"])
    assert (
        client.patch(f"/api/slots/{slot['id']}", json={"topic": None}).status_code
        == 400
    )
    assert (
        client.patch(f"/api/rooms/{own_room['id']}", json={"name": None}).status_code
        == 400
    )
    assert (
        client.patch(f"/api/days/{day['id']}", json={"date": None}).status_code == 400
    )
    assert (
        client.patch(f"/api/events/{event['id']}", json={"name": None}).status_code
        == 400
    )
    assert (
        client.post(
            "/api/slots",
            json={
                "day_id": day["id"],
                "room_id": own_room["id"],
                "topic": "Ungültig",
                "start_time": "08:00",
                "end_time": "09:00",
            },
        ).status_code
        == 400
    )
    assert client.get("/api/schedule/days/999999").status_code == 404
    assert (
        client.patch("/api/slots/999999", json={"topic": "Nichts"}).status_code == 404
    )


def test_event_day_validation_and_duplicate(client):
    invalid = client.post(
        "/api/events",
        json={"name": "Falsch", "start_date": "2026-10-02", "end_date": "2026-10-01"},
    )
    assert invalid.status_code == 400
    event = create_event(client)
    create_day(client, event["id"])
    duplicate = client.post(
        f"/api/events/{event['id']}/days",
        json={
            "event_id": event["id"],
            "date": "2026-10-01",
            "start_time": "09:00",
            "end_time": "18:00",
        },
    )
    assert duplicate.status_code == 409
    outside = client.post(
        f"/api/events/{event['id']}/days",
        json={
            "event_id": event["id"],
            "date": "2026-10-03",
            "start_time": "09:00",
            "end_time": "18:00",
        },
    )
    assert outside.status_code == 400
    reversed_time = client.post(
        f"/api/events/{event['id']}/days",
        json={
            "event_id": event["id"],
            "date": "2026-10-02",
            "start_time": "18:00",
            "end_time": "09:00",
        },
    )
    assert reversed_time.status_code == 400
