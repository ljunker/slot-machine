from sqlalchemy import create_engine, inspect, text

from app.db.migrate_slot_changes import migrate_slot_changes


def make_program(client):
    event = client.post(
        "/api/events",
        json={"name": "Tagung", "start_date": "2026-10-01", "end_date": "2026-10-01"},
    ).json()
    day = client.post(
        f"/api/events/{event['id']}/days",
        json={
            "event_id": event["id"],
            "date": "2026-10-01",
            "start_time": "09:00",
            "end_time": "18:00",
        },
    ).json()
    rooms = [
        client.post("/api/rooms", json={"event_id": event["id"], "name": name}).json()
        for name in ("A", "B")
    ]
    return day, rooms


def make_slot(client, day, room, topic="Vortrag"):
    return client.post(
        "/api/slots",
        json={
            "day_id": day["id"],
            "room_id": room["id"],
            "topic": topic,
            "start_time": "10:00",
            "end_time": "11:00",
        },
    ).json()


def test_changes_noop_priority_expiry_and_reactivation(client, monkeypatch):
    now = [1_800_000_000]
    monkeypatch.setattr("app.services.slot_service.epoch_time", lambda: now[0])
    monkeypatch.setattr("app.models.slot.epoch_time", lambda: now[0])
    day, (first, second) = make_program(client)
    slot = make_slot(client, day, first)
    path = f"/api/slots/{slot['id']}"
    assert slot["change_notice"] is None and slot["is_cancelled"] is False
    assert (
        client.patch(
            path, json={"topic": "  Vortrag  ", "room_id": first["id"]}
        ).json()["change_notice"]
        is None
    )

    moved = client.patch(
        path, json={"room_id": second["id"], "start_time": "12:00", "end_time": "13:00"}
    ).json()
    assert moved["change_notice"] == {
        "type": "rescheduled",
        "expires_at": now[0] + 86400,
        "previous_start_time": "10:00:00",
        "previous_end_time": "11:00:00",
        "previous_room_name": "A",
    }
    now[0] += 10
    repeated = client.patch(path, json={"room_id": second["id"], "start_time": "12:00", "end_time": "13:00"}).json()
    assert repeated["change_notice"]["expires_at"] == 1_800_000_000 + 86400
    renamed = client.patch(path, json={"topic": "Neuer Vortrag"}).json()
    assert renamed["change_notice"]["type"] == "rescheduled"
    assert renamed["change_notice"]["expires_at"] == 1_800_000_000 + 86400
    now[0] += 86400 - 10
    notice = client.get(f"/api/schedule/days/{day['id']}").json()["rooms"][1]["slots"][
        0
    ]["change_notice"]
    assert notice["type"] == "updated"
    now[0] += 10
    assert (
        client.get(f"/api/schedule/days/{day['id']}").json()["rooms"][1]["slots"][0][
            "change_notice"
        ]
        is None
    )

    assert client.patch(path, json={"is_cancelled": None}).status_code == 400
    cancelled = client.patch(path, json={"is_cancelled": True}).json()
    assert cancelled["change_notice"]["type"] == "cancelled"
    now[0] += 86401
    assert (
        client.get(f"/api/schedule/days/{day['id']}").json()["rooms"][1]["slots"][0][
            "change_notice"
        ]["type"]
        == "cancelled"
    )
    restored = client.patch(path, json={"is_cancelled": False}).json()
    assert restored["change_notice"]["type"] == "updated"


def test_cancelled_slots_stay_visible_without_conflicts(client):
    day, (first, second) = make_program(client)
    a = make_slot(client, day, first, "A")
    b = make_slot(client, day, first, "B")
    speaker = client.post(
        f"/api/events/{first['event_id']}/speakers", json={"name": "Ada"}
    ).json()
    c = make_slot(client, day, second, "C")
    for slot in (a, c):
        assert (
            client.patch(
                f"/api/slots/{slot['id']}", json={"speaker_ids": [speaker["id"]]}
            ).status_code
            == 200
        )
    before = client.get(f"/api/schedule/days/{day['id']}").json()
    assert before["collisions"] and before["speaker_conflicts"]
    client.patch(f"/api/slots/{a['id']}", json={"is_cancelled": True})
    after = client.get(f"/api/schedule/days/{day['id']}").json()
    assert {slot["id"] for room in after["rooms"] for slot in room["slots"]} == {
        a["id"],
        b["id"],
        c["id"],
    }
    assert after["collisions"] == [] and after["speaker_conflicts"] == []


def test_resize_and_immediate_reactivation(client):
    day, (first, _) = make_program(client)
    slot = make_slot(client, day, first)
    path = f"/api/slots/{slot['id']}"
    resized = client.patch(path, json={"end_time": "11:30"}).json()
    assert resized["change_notice"]["type"] == "rescheduled"
    assert resized["change_notice"]["previous_end_time"] == "11:00:00"
    client.patch(path, json={"is_cancelled": True})
    restored = client.patch(path, json={"is_cancelled": False}).json()
    assert restored["change_notice"]["type"] == "updated"
    assert restored["change_notice"]["previous_room_name"] is None


def test_legacy_slot_migration_is_repeatable(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'legacy.db'}")
    with engine.begin() as connection:
        connection.execute(
            text(
                "CREATE TABLE slots (id INTEGER PRIMARY KEY, day_id INTEGER NOT NULL, room_id INTEGER NOT NULL, topic VARCHAR(255) NOT NULL, description TEXT, start_time TIME NOT NULL, end_time TIME NOT NULL)"
            )
        )
        connection.execute(
            text(
                "INSERT INTO slots (id, day_id, room_id, topic, start_time, end_time) VALUES (1, 1, 1, 'Alt', '10:00:00', '11:00:00')"
            )
        )
    migrate_slot_changes(engine)
    migrate_slot_changes(engine)
    with engine.connect() as connection:
        assert (
            connection.scalar(text("SELECT is_cancelled FROM slots WHERE id = 1")) == 0
        )
        assert len(inspect(connection).get_columns("slots")) == 13
    engine.dispose()
