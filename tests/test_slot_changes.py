from io import BytesIO

from pypdf import PdfReader
from sqlalchemy import create_engine, inspect, text

from app.db.migrate_slot_changes import migrate_slot_changes
from app.models.slot import Slot


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


def test_clear_single_rescheduled_notice_preserves_content_notice_and_can_recur(client, db):
    day, (first, second) = make_program(client)
    slot = make_slot(client, day, first, "Workshop")
    other = client.post(
        "/api/slots",
        json={"day_id": day["id"], "room_id": first["id"], "topic": "Pause", "start_time": "14:00", "end_time": "15:00"},
    ).json()
    path = f"/api/slots/{slot['id']}"
    client.patch(path, json={"room_id": second["id"], "start_time": "11:00", "end_time": "12:00"})
    client.patch(path, json={"topic": "Neuer Workshop"})
    client.patch(f"/api/slots/{other['id']}", json={"end_time": "15:30"})

    assert client.delete(f"{path}/rescheduled-notice").status_code == 204
    assert client.delete(f"{path}/rescheduled-notice").status_code == 204
    saved = db.get(Slot, slot["id"])
    assert saved.schedule_changed_at is None
    assert (saved.previous_room_name, saved.previous_start_time, saved.previous_end_time) == (None, None, None)

    schedule = client.get(f"/api/schedule/days/{day['id']}").json()
    notices = {item["id"]: item["change_notice"] for room in schedule["rooms"] for item in room["slots"]}
    assert notices[slot["id"]]["type"] == "updated"
    assert notices[other["id"]]["type"] == "rescheduled"
    public = client.get(f"/api/events/{first['event_id']}/sessions/{slot['id']}").json()
    assert public["change_notice"]["type"] == "updated"
    assert public["change_notice"]["previous_start_time"] is None
    pdf = PdfReader(BytesIO(client.get(f"/api/events/{first['event_id']}/program.pdf").content))
    pdf_text = pdf.pages[0].extract_text()
    assert "Geändert" in pdf_text
    assert "Vorher: 10:00-11:00, A" not in pdf_text
    assert "Vorher: 14:00-15:00, A" in pdf_text

    moved_again = client.patch(path, json={"start_time": "12:00", "end_time": "13:00"}).json()
    assert moved_again["change_notice"]["type"] == "rescheduled"
    assert moved_again["change_notice"]["previous_start_time"] == "11:00:00"
    assert client.delete("/api/slots/999999/rescheduled-notice").status_code == 404


def test_clear_event_rescheduled_notices_across_days_only_in_selected_event(client, db):
    first_day, (first_room, second_room) = make_program(client)
    event_id = first_room["event_id"]
    client.patch(f"/api/events/{event_id}", json={"end_date": "2026-10-02"})
    second_day = client.post(
        f"/api/events/{event_id}/days",
        json={"event_id": event_id, "date": "2026-10-02", "start_time": "09:00", "end_time": "18:00"},
    ).json()
    first = make_slot(client, first_day, first_room, "Erster")
    second = make_slot(client, second_day, first_room, "Zweiter")
    cancelled = make_slot(client, second_day, first_room, "Abgesagt")
    other_day, (other_room, other_second_room) = make_program(client)
    other = make_slot(client, other_day, other_room, "Andere Veranstaltung")
    for slot in (first, second, cancelled):
        client.patch(f"/api/slots/{slot['id']}", json={"room_id": second_room["id"]})
    client.patch(f"/api/slots/{first['id']}", json={"topic": "Geänderter Erster"})
    client.patch(f"/api/slots/{cancelled['id']}", json={"is_cancelled": True})
    client.patch(f"/api/slots/{other['id']}", json={"room_id": other_second_room["id"]})

    path = f"/api/events/{event_id}/rescheduled-notices"
    assert client.delete(path).status_code == 204
    assert client.delete(path).status_code == 204
    assert client.delete("/api/events/999999/rescheduled-notices").status_code == 404
    for slot in (first, second, cancelled):
        saved = db.get(Slot, slot["id"])
        assert saved.schedule_changed_at is None
        assert (saved.previous_room_name, saved.previous_start_time, saved.previous_end_time) == (None, None, None)
    assert db.get(Slot, other["id"]).schedule_changed_at is not None

    first_notice = client.get(f"/api/schedule/days/{first_day['id']}").json()["rooms"][1]["slots"][0]["change_notice"]
    second_notices = {
        slot["id"]: slot["change_notice"]
        for room in client.get(f"/api/schedule/days/{second_day['id']}").json()["rooms"]
        for slot in room["slots"]
    }
    assert first_notice["type"] == "updated"
    assert second_notices[second["id"]] is None
    assert second_notices[cancelled["id"]]["type"] == "cancelled"
    other_notice = client.get(f"/api/schedule/days/{other_day['id']}").json()["rooms"][1]["slots"][0]["change_notice"]
    assert other_notice["type"] == "rescheduled"
    pdf = PdfReader(BytesIO(client.get(f"/api/events/{event_id}/program.pdf").content))
    pdf_text = " ".join(page.extract_text() for page in pdf.pages)
    assert "Verschoben" not in pdf_text
    assert "Vorher:" not in pdf_text
    assert "Geändert" in pdf_text
    assert "Abgesagt" in pdf_text


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
