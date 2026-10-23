import csv
from datetime import time
from io import BytesIO, StringIO
from zipfile import ZIP_DEFLATED, ZipFile

import pytest
from pypdf import PdfReader
from sqlalchemy import create_engine, text
from sqlalchemy import event as sqlalchemy_event
from sqlalchemy.exc import IntegrityError

from app.db.migrate_shared_sessions import migrate_shared_sessions
from app.db.migrate_unplanned_sessions import migrate_unplanned_sessions
from app.services import program_pdf
from app.services.slot_service import SlotService


@pytest.fixture
def program(client):
    event = client.post("/api/events", json={
        "name": "Gemeinsames Programm", "start_date": "2026-10-01", "end_date": "2026-10-02",
    }).json()["id"]
    day = client.post(f"/api/events/{event}/days", json={
        "event_id": event, "date": "2026-10-01", "start_time": "09:00", "end_time": "18:00",
    }).json()["id"]
    rooms = [client.post("/api/rooms", json={"event_id": event, "name": name}).json()["id"]
             for name in ("Saal A", "Saal B")]
    return event, day, rooms


def shared(client, event, day, **changes):
    response = client.post("/api/slots", json={
        "event_id": event, "day_id": day, "scope": "all_rooms", "topic": "Mittagspause",
        "start_time": "12:00", "end_time": "13:00", **changes,
    })
    assert response.status_code == 201, response.text
    return response.json()


def test_shared_lifecycle_and_stable_public_link(client, program):
    event, day, rooms = program
    speaker = client.post(f"/api/events/{event}/speakers", json={"name": "Ada"}).json()["id"]
    category = client.post(f"/api/events/{event}/categories", json={"name": "Pause", "color": "#123ABC"}).json()["id"]
    slot = shared(client, event, day, speaker_ids=[speaker], category_ids=[category], description="Gemeinsam essen")
    url = f"/api/slots/{slot['id']}"
    public_url = f"/api/events/{event}/sessions/{slot['id']}"
    schedule = client.get(f"/api/schedule/days/{day}").json()
    assert [item["id"] for item in schedule["shared_slots"]] == [slot["id"]]
    assert all(not room["slots"] for room in schedule["rooms"])
    public = client.get(f"/api/public/events/{event}/days/{day}/schedule").json()["shared_slots"][0]
    assert public["scope"] == "all_rooms" and public["room_id"] is None
    assert "speaker_ids" not in public
    assert client.get(public_url).json()["room_name"] == "Alle Räume"
    assert client.get(f"/api/speakers/{speaker}").json()["sessions"][0]["room_name"] == "Alle Räume"

    changed = client.patch(url, json={"scope": "room", "room_id": rooms[0]}).json()
    assert changed["change_notice"]["type"] == "rescheduled"
    assert changed["change_notice"]["previous_room_name"] == "Alle Räume"
    assert client.get(public_url).json()["room_name"] == "Saal A"
    changed = client.patch(url, json={"scope": "all_rooms", "room_id": None}).json()
    assert changed["change_notice"]["previous_room_name"] == "Saal A"
    assert client.get(public_url).json()["id"] == slot["id"]
    assert client.patch(url, json={"is_cancelled": True}).json()["change_notice"]["type"] == "cancelled"
    assert client.patch(url, json={"is_cancelled": False}).json()["change_notice"]["type"] == "updated"
    unplanned = client.patch(url, json={"day_id": None, "start_time": None, "end_time": None}).json()
    assert unplanned["scope"] == "all_rooms" and unplanned["change_notice"] is None
    assert unplanned["speaker_ids"] == [speaker] and unplanned["category_ids"] == [category]
    assert client.get(public_url).status_code == 404
    assert client.patch(url, json={"day_id": day, "start_time": "14:00", "end_time": "15:00"}).status_code == 200
    assert client.get(public_url).json()["id"] == slot["id"]


@pytest.mark.parametrize("changes", [
    {"start_time": None}, {"day_id": None}, {"start_time": "08:00"},
    {"end_time": "19:00"}, {"end_time": "11:00"}, {"scope": "room"}, {"scope": None},
])
def test_invalid_shared_planning_does_not_change_session(client, program, changes):
    event, day, _ = program
    slot = shared(client, event, day)
    assert client.patch(f"/api/slots/{slot['id']}", json=changes).status_code == 400
    assert client.get(f"/api/events/{event}/sessions/{slot['id']}").json()["scope"] == "all_rooms"


def test_room_and_event_validation_and_unplanned_scope(client, program):
    event, day, rooms = program
    slot = shared(client, event, day)
    url = f"/api/slots/{slot['id']}"
    assert client.patch(url, json={"room_id": rooms[0]}).status_code == 400
    assert client.patch(url, json={"scope": "room", "room_id": 999999}).status_code == 404
    other = client.post("/api/events", json={"name": "Andere", "start_date": "2026-10-01", "end_date": "2026-10-02"}).json()["id"]
    foreign_day = client.post(f"/api/events/{other}/days", json={"event_id": other, "date": "2026-10-01", "start_time": "09:00", "end_time": "18:00"}).json()["id"]
    foreign_room = client.post("/api/rooms", json={"event_id": other, "name": "Fremd"}).json()["id"]
    assert client.patch(url, json={"day_id": foreign_day}).status_code == 400
    assert client.patch(url, json={"scope": "room", "room_id": foreign_room}).status_code == 400
    unplanned = shared(client, event, None, start_time=None, end_time=None)
    assert unplanned["scope"] == "all_rooms"
    assert client.patch(f"/api/slots/{unplanned['id']}", json={"scope": "room"}).status_code == 200


def test_collisions_speakers_boundaries_and_cancellation(client, program, db):
    event, day, rooms = program
    speaker = client.post(f"/api/events/{event}/speakers", json={"name": "Ada"}).json()["id"]
    first = shared(client, event, day, speaker_ids=[speaker])
    second = shared(client, event, day, start_time="12:30", end_time="13:30", speaker_ids=[speaker])
    room_slot = client.post("/api/slots", json={"day_id": day, "room_id": rooms[1], "topic": "Vortrag", "start_time": "12:15", "end_time": "12:45", "speaker_ids": [speaker]}).json()
    boundary = shared(client, event, day, start_time="13:30", end_time="14:00")
    service = SlotService(db)
    assert service.has_collision(service.get(first["id"]))
    assert service.has_collision(service.get(room_slot["id"]))
    assert not service.has_collision(service.get(boundary["id"]))
    schedule = client.get(f"/api/schedule/days/{day}").json()
    expected = {frozenset(pair) for pair in [(first["id"], second["id"]), (first["id"], room_slot["id"]), (second["id"], room_slot["id"])]}
    for key in ("collisions", "speaker_conflicts"):
        assert {frozenset((p["first_slot_id"], p["second_slot_id"])) for p in schedule[key]} == expected
        assert len(schedule[key]) == 3
    assert boundary["id"] not in {p["first_slot_id"] for p in schedule["collisions"]}
    client.patch(f"/api/slots/{second['id']}", json={"is_cancelled": True})
    schedule = client.get(f"/api/schedule/days/{day}").json()
    assert len(schedule["collisions"]) == len(schedule["speaker_conflicts"]) == 1
    moved = service.move(first["id"], rooms[0], time(15))
    assert moved.scope == "all_rooms" and moved.room_id is None
    assert not service.has_collision(moved)


def test_rooms_dynamic_and_delete_day_preserves_scope(client, program):
    event, day, rooms = program
    slot = shared(client, event, day)
    rooms.append(client.post("/api/rooms", json={"event_id": event, "name": "Neu"}).json()["id"])
    client.patch(f"/api/events/{event}/rooms/order", json={"room_ids": rooms[::-1]})
    for room in rooms:
        assert client.delete(f"/api/rooms/{room}").status_code == 204
    schedule = client.get(f"/api/schedule/days/{day}").json()
    assert schedule["rooms"] == [] and schedule["shared_slots"][0]["id"] == slot["id"]
    assert client.get(f"/api/events/{event}/sessions/{slot['id']}").status_code == 200
    assert client.delete(f"/api/days/{day}").status_code == 204
    backlog = client.get(f"/api/events/{event}/unplanned-sessions").json()
    assert backlog[0]["scope"] == "all_rooms" and backlog[0]["day_id"] is None
    assert client.delete(f"/api/events/{event}").status_code == 204


def test_shared_session_duties_follow_times_and_keep_conflicts(client, program):
    event, day, _ = program
    slot = shared(client, event, day)
    helper = client.post(f"/api/events/{event}/helpers", json={"name": "Bo"}).json()["id"]
    duty = client.post(f"/api/events/{event}/duties", json={"kind": "session", "slot_id": slot["id"], "helper_ids": [helper]}).json()
    general = client.post(f"/api/events/{event}/duties", json={"kind": "general", "title": "Buffet", "day_id": day, "start_time": "12:00", "end_time": "14:00", "helper_ids": [helper]}).json()
    plan = client.get(f"/api/events/{event}/helper-plan").json()
    assert len(plan["conflicts"]) == 1
    assert duty["room_id"] is None and duty["status"] == "active"
    order = client.patch(f"/api/events/{event}/duties/order", json={"day_id": day, "room_id": None, "duty_ids": [general["id"], duty["id"]]})
    assert order.status_code == 200
    client.patch(f"/api/slots/{slot['id']}", json={"start_time": "14:00", "end_time": "15:00"})
    plan = client.get(f"/api/events/{event}/helper-plan").json()
    assert not plan["conflicts"]
    assert next(d for d in plan["duties"] if d["id"] == duty["id"])["start_time"] == "14:00:00"
    client.patch(f"/api/slots/{slot['id']}", json={"is_cancelled": True})
    assert client.get(f"/api/duties/{duty['id']}").json()["status"] == "cancelled"


def test_shared_pdf_spans_and_falls_back_without_hiding_sessions(client, program, monkeypatch):
    event, day, rooms = program
    shared(client, event, day)
    calls = []
    original = program_pdf._draw_slot
    def record(pdf, slot, x, y, width, height):
        calls.append((slot.topic, width))
        original(pdf, slot, x, y, width, height)
    monkeypatch.setattr(program_pdf, "_draw_slot", record)
    response = client.get(f"/api/events/{event}/program.pdf")
    content = PdfReader(BytesIO(response.content)).pages[0].extract_text()
    assert content.count("Mittagspause") == 1 and "Alle Räume" in content
    assert calls[0][1] > 700
    client.post("/api/slots", json={"day_id": day, "room_id": rooms[0], "topic": "Parallel", "start_time": "12:30", "end_time": "13:30"})
    calls.clear()
    content = PdfReader(BytesIO(client.get(f"/api/events/{event}/program.pdf").content)).pages[0].extract_text()
    assert content.count("Mittagspause") == 2 and "Parallel" in content
    assert all(width < 400 for _, width in calls)
    for room in rooms:
        client.delete(f"/api/rooms/{room}")
    content = PdfReader(BytesIO(client.get(f"/api/events/{event}/program.pdf").content)).pages[0].extract_text()
    assert "Alle Räume" in content and "Mittagspause" in content and "Parallel" not in content


@pytest.mark.parametrize("version", ["1", "2", "3", "4"])
def test_backup_versions_restore_scope_and_content(client, program, version):
    event, day, rooms = program
    slot = shared(client, event, day, **({"scope": "room", "room_id": rooms[0]} if version != "4" else {}))
    archive = client.get(f"/api/backups/events/{event}").content
    output = BytesIO()
    with ZipFile(BytesIO(archive)) as source, ZipFile(output, "w", ZIP_DEFLATED) as target:
        for filename in source.namelist():
            if version in {"1", "2"} and filename in {"categories.csv", "slot_categories.csv"}:
                continue
            content = source.read(filename)
            if filename == "manifest.csv":
                content = content.replace(b"4,", version.encode() + b",", 1)
            if (filename == "slots.csv" and version != "4") or (filename == "duties.csv" and version == "1"):
                rows = list(csv.reader(StringIO(content.decode())))
                index = rows[0].index("scope" if filename == "slots.csv" else "sort_order")
                csv_output = StringIO(newline="")
                csv.writer(csv_output).writerows([cell for i, cell in enumerate(row) if i != index] for row in rows)
                content = csv_output.getvalue().encode()
            target.writestr(filename, content)
    restored = client.post("/api/backups/restore", data={"target_event_id": str(event)}, files={"backup": ("backup.zip", output.getvalue(), "application/zip")})
    assert restored.status_code == 200, restored.text
    restored_slot = client.get(f"/api/events/{event}/sessions/{slot['id']}").json()
    assert restored_slot["scope"] == ("all_rooms" if version == "4" else "room")
    assert restored_slot["topic"] == "Mittagspause"


@pytest.fixture
def legacy_engine(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'old.db'}")
    @sqlalchemy_event.listens_for(engine, "connect")
    def foreign_keys(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")
    with engine.begin() as connection:
        for statement in (
            "CREATE TABLE events (id INTEGER PRIMARY KEY)",
            "CREATE TABLE event_days (id INTEGER PRIMARY KEY, event_id INTEGER REFERENCES events(id))",
            "CREATE TABLE rooms (id INTEGER PRIMARY KEY, event_id INTEGER REFERENCES events(id))",
            "CREATE TABLE slots (id INTEGER PRIMARY KEY, event_id INTEGER NOT NULL REFERENCES events(id), day_id INTEGER REFERENCES event_days(id), room_id INTEGER REFERENCES rooms(id), topic VARCHAR(255) NOT NULL, description TEXT, start_time TIME, end_time TIME, is_cancelled BOOLEAN NOT NULL DEFAULT FALSE, schedule_changed_at BIGINT, content_changed_at BIGINT, previous_start_time TIME, previous_end_time TIME, previous_room_name VARCHAR(255), CONSTRAINT slot_planning_complete CHECK ((day_id IS NULL AND room_id IS NULL AND start_time IS NULL AND end_time IS NULL) OR (day_id IS NOT NULL AND room_id IS NOT NULL AND start_time IS NOT NULL AND end_time IS NOT NULL)))",
            "CREATE TABLE slot_speakers (slot_id INTEGER REFERENCES slots(id), speaker_id INTEGER)",
            "CREATE TABLE slot_categories (slot_id INTEGER REFERENCES slots(id), category_id INTEGER)",
            "CREATE TABLE duties (id INTEGER PRIMARY KEY, slot_id INTEGER REFERENCES slots(id))",
            "INSERT INTO events VALUES (1)", "INSERT INTO event_days VALUES (2, 1)", "INSERT INTO rooms VALUES (3, 1)",
            "INSERT INTO slots (id, event_id, day_id, room_id, topic, start_time, end_time) VALUES (5, 1, 2, 3, 'Alt', '10:00', '11:00')",
            "INSERT INTO slot_speakers VALUES (5, 6)", "INSERT INTO slot_categories VALUES (5, 7)", "INSERT INTO duties VALUES (8, 5)",
        ):
            connection.execute(text(statement))
    yield engine
    engine.dispose()


def test_sqlite_migration_is_idempotent_and_preserves_links(legacy_engine):
    engine = legacy_engine
    migrate_unplanned_sessions(engine)
    migrate_shared_sessions(engine)
    migrate_shared_sessions(engine)
    with engine.begin() as connection:
        assert connection.execute(text("SELECT id, scope, room_id, topic FROM slots")).one() == (5, "room", 3, "Alt")
        assert connection.execute(text("SELECT * FROM slot_speakers")).one() == (5, 6)
        assert connection.execute(text("SELECT * FROM slot_categories")).one() == (5, 7)
        assert connection.execute(text("SELECT * FROM duties")).one() == (8, 5)
        assert connection.exec_driver_sql("PRAGMA foreign_key_check").all() == []
        connection.execute(text("UPDATE slots SET scope='all_rooms', room_id=NULL WHERE id=5"))
        with pytest.raises(IntegrityError):
            connection.execute(text("UPDATE slots SET room_id=3 WHERE id=5"))


def test_sqlite_migration_rolls_back_ddl_and_can_be_retried(legacy_engine):
    def fail_rename(connection, cursor, statement, parameters, context, executemany):
        if statement.startswith("ALTER TABLE slots_shared_new"):
            raise RuntimeError("Migration unterbrochen")
    sqlalchemy_event.listen(legacy_engine, "before_cursor_execute", fail_rename)
    try:
        with pytest.raises(RuntimeError, match="Migration unterbrochen"):
            migrate_shared_sessions(legacy_engine)
    finally:
        sqlalchemy_event.remove(legacy_engine, "before_cursor_execute", fail_rename)
    with legacy_engine.connect() as connection:
        assert "scope" not in {row[1] for row in connection.exec_driver_sql("PRAGMA table_info(slots)")}
        assert connection.exec_driver_sql("SELECT name FROM sqlite_master WHERE name='slots_shared_new'").all() == []
        assert connection.exec_driver_sql("SELECT id, topic FROM slots").one() == (5, "Alt")
        assert connection.exec_driver_sql("SELECT * FROM duties").one() == (8, 5)
        assert connection.exec_driver_sql("PRAGMA foreign_keys").scalar() == 1
        assert connection.exec_driver_sql("PRAGMA foreign_key_check").all() == []
    migrate_shared_sessions(legacy_engine)
    with legacy_engine.connect() as connection:
        assert connection.exec_driver_sql("SELECT scope FROM slots").scalar_one() == "room"


@pytest.mark.parametrize("changes", [{"scope": "unknown"}, {"room_id": "3"}, {"start_time": r"\N"}])
def test_invalid_shared_backup_does_not_replace_event(client, program, changes):
    event, day, _ = program
    slot = shared(client, event, day)
    before = client.get(f"/api/events/{event}/sessions/{slot['id']}").json()
    backup = client.get(f"/api/backups/events/{event}").content
    output = BytesIO()
    with ZipFile(BytesIO(backup)) as source, ZipFile(output, "w", ZIP_DEFLATED) as target:
        for filename in source.namelist():
            content = source.read(filename)
            if filename == "slots.csv":
                reader = csv.DictReader(StringIO(content.decode()))
                rows = [{**row, **changes} for row in reader]
                csv_output = StringIO(newline="")
                writer = csv.DictWriter(csv_output, fieldnames=reader.fieldnames)
                writer.writeheader()
                writer.writerows(rows)
                content = csv_output.getvalue().encode()
            target.writestr(filename, content)
    for endpoint in ("preview", "restore"):
        response = client.post(f"/api/backups/{endpoint}", data={"target_event_id": str(event)}, files={"backup": ("backup.zip", output.getvalue(), "application/zip")})
        assert response.status_code == 400, response.text
    assert client.get(f"/api/events/{event}/sessions/{slot['id']}").json() == before
