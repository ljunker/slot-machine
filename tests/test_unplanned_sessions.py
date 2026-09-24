from io import BytesIO

from pypdf import PdfReader
from sqlalchemy import create_engine, text
from sqlalchemy import event as sqlalchemy_event

from app.db.migrate_slot_changes import migrate_slot_changes
from app.db.migrate_unplanned_sessions import migrate_unplanned_sessions


def event(client, name="Konferenz"):
    return client.post("/api/events", json={
        "name": name, "start_date": "2026-10-01", "end_date": "2026-10-02"
    }).json()


def day(client, event_id):
    return client.post(f"/api/events/{event_id}/days", json={
        "event_id": event_id, "date": "2026-10-01",
        "start_time": "09:00", "end_time": "18:00",
    }).json()


def room(client, event_id):
    return client.post("/api/rooms", json={"event_id": event_id, "name": "Saal"}).json()


def test_unplanned_lifecycle_and_public_schedule(client):
    own = event(client)
    event_day = day(client, own["id"])
    event_room = room(client, own["id"])
    speaker = client.post(f"/api/events/{own['id']}/speakers", json={"name": "Ada"}).json()
    created = client.post("/api/slots", json={
        "event_id": own["id"], "topic": "Vortrag", "speaker_ids": [speaker["id"]],
        "description": "Inhalt",
    })
    assert created.status_code == 201
    session = created.json()
    slot_id = session["id"]
    assert all(session[field] is None for field in ("day_id", "room_id", "start_time", "end_time"))
    assert session["change_notice"] is None
    assert [item["id"] for item in client.get(f"/api/events/{own['id']}/unplanned-sessions").json()] == [slot_id]
    assert client.get(f"/api/schedule/days/{event_day['id']}").json()["rooms"][0]["slots"] == []
    pdf = PdfReader(BytesIO(client.get(f"/api/events/{own['id']}/program.pdf").content))
    assert "Vortrag" not in pdf.pages[0].extract_text()
    speaker_sessions = client.get(f"/api/speakers/{speaker['id']}").json()["sessions"]
    assert speaker_sessions[0]["day_id"] is None

    planned = client.patch(f"/api/slots/{slot_id}", json={
        "day_id": event_day["id"], "room_id": event_room["id"],
        "start_time": "10:00", "end_time": "11:00",
    })
    assert planned.status_code == 200
    assert planned.json()["id"] == slot_id
    assert planned.json()["change_notice"] is None
    assert client.get(f"/api/events/{own['id']}/unplanned-sessions").json() == []
    assert client.get(f"/api/schedule/days/{event_day['id']}").json()["rooms"][0]["slots"][0]["id"] == slot_id

    unplanned = client.patch(f"/api/slots/{slot_id}", json={
        "day_id": None, "room_id": None, "start_time": None, "end_time": None,
    })
    assert unplanned.status_code == 200
    assert unplanned.json()["change_notice"] is None
    assert unplanned.json()["speaker_ids"] == [speaker["id"]]
    assert unplanned.json()["description"] == "Inhalt"
    assert client.get(f"/api/schedule/days/{event_day['id']}").json()["rooms"][0]["slots"] == []


def test_partial_and_foreign_planning_rejected(client):
    own = event(client)
    own_day = day(client, own["id"])
    own_room = room(client, own["id"])
    other = event(client, "Andere")
    other_day = day(client, other["id"])
    other_room = room(client, other["id"])
    session = client.post("/api/slots", json={"event_id": own["id"], "topic": "Offen"}).json()
    url = f"/api/slots/{session['id']}"
    assert client.patch(url, json={"room_id": own_room["id"]}).status_code == 400
    assert client.post("/api/slots", json={
        "event_id": own["id"], "topic": "Teilweise", "room_id": own_room["id"],
    }).status_code == 400
    assert client.patch(url, json={
        "day_id": own_day["id"], "room_id": other_room["id"],
        "start_time": "10:00", "end_time": "11:00",
    }).status_code == 400
    assert client.patch(url, json={
        "day_id": other_day["id"], "room_id": own_room["id"],
        "start_time": "10:00", "end_time": "11:00",
    }).status_code == 400
    assert client.patch(url, json={
        "day_id": own_day["id"], "room_id": own_room["id"],
        "start_time": "18:00", "end_time": "19:00",
    }).status_code == 400
    assert client.get(f"/api/events/{own['id']}/unplanned-sessions").json()[0]["id"] == session["id"]
    assert client.get("/api/events/999999/unplanned-sessions").status_code == 404
    assert client.post("/api/slots", json={"topic": "Ohne Event"}).status_code == 400


def test_parent_delete_preserves_sessions_and_event_delete_removes_them(client):
    own = event(client)
    event_day = day(client, own["id"])
    event_room = room(client, own["id"])
    speaker = client.post(f"/api/events/{own['id']}/speakers", json={"name": "Ada"}).json()
    planned = client.post("/api/slots", json={
        "day_id": event_day["id"], "room_id": event_room["id"], "topic": "Vortrag",
        "start_time": "10:00", "end_time": "11:00", "speaker_ids": [speaker["id"]],
    }).json()
    assert client.delete(f"/api/rooms/{event_room['id']}").status_code == 204
    backlog = client.get(f"/api/events/{own['id']}/unplanned-sessions").json()
    assert backlog[0]["id"] == planned["id"]
    assert backlog[0]["speaker_ids"] == [speaker["id"]]
    replacement = room(client, own["id"])
    assert client.patch(f"/api/slots/{planned['id']}", json={
        "day_id": event_day["id"], "room_id": replacement["id"],
        "start_time": "10:00", "end_time": "11:00",
    }).status_code == 200
    assert client.delete(f"/api/days/{event_day['id']}").status_code == 204
    assert client.get(f"/api/events/{own['id']}/unplanned-sessions").json()[0]["id"] == planned["id"]
    assert client.delete(f"/api/events/{own['id']}").status_code == 204
    assert client.get(f"/api/events/{own['id']}/unplanned-sessions").status_code == 404


def test_existing_sqlite_database_migrates_without_losing_links(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'existing.db'}")
    @sqlalchemy_event.listens_for(engine, "connect")
    def enable_foreign_keys(dbapi_connection, connection_record):
        dbapi_connection.execute("PRAGMA foreign_keys=ON")

    with engine.begin() as connection:
        for statement in (
            "CREATE TABLE events (id INTEGER PRIMARY KEY, name VARCHAR(255) NOT NULL, start_date DATE NOT NULL, end_date DATE NOT NULL)",
            "CREATE TABLE event_days (id INTEGER PRIMARY KEY, event_id INTEGER NOT NULL REFERENCES events(id), date DATE NOT NULL, start_time TIME NOT NULL, end_time TIME NOT NULL)",
            "CREATE TABLE rooms (id INTEGER PRIMARY KEY, event_id INTEGER NOT NULL REFERENCES events(id), name VARCHAR(255) NOT NULL, sort_order INTEGER NOT NULL)",
            "CREATE TABLE speakers (id INTEGER PRIMARY KEY, event_id INTEGER NOT NULL REFERENCES events(id), name VARCHAR(255) NOT NULL, normalized_name TEXT NOT NULL)",
            "CREATE TABLE slots (id INTEGER PRIMARY KEY, day_id INTEGER NOT NULL REFERENCES event_days(id), room_id INTEGER NOT NULL REFERENCES rooms(id), topic VARCHAR(255) NOT NULL, description TEXT, start_time TIME NOT NULL, end_time TIME NOT NULL)",
            "CREATE TABLE slot_speakers (slot_id INTEGER NOT NULL REFERENCES slots(id), speaker_id INTEGER NOT NULL REFERENCES speakers(id), PRIMARY KEY (slot_id, speaker_id))",
            "INSERT INTO events VALUES (1, 'Test', '2026-10-01', '2026-10-01')",
            "INSERT INTO event_days VALUES (2, 1, '2026-10-01', '09:00', '18:00')",
            "INSERT INTO rooms VALUES (3, 1, 'Saal', 0)",
            "INSERT INTO speakers VALUES (4, 1, 'Ada', 'ada')",
            "INSERT INTO slots (id, day_id, room_id, topic, start_time, end_time) VALUES (5, 2, 3, 'Alt', '10:00', '11:00')",
            "INSERT INTO slot_speakers VALUES (5, 4)",
        ):
            connection.execute(text(statement))
    migrate_slot_changes(engine)
    migrate_unplanned_sessions(engine)
    migrate_unplanned_sessions(engine)
    with engine.connect() as connection:
        assert connection.execute(text("SELECT id, event_id, day_id, room_id, topic, start_time, end_time FROM slots")).one() == (5, 1, 2, 3, "Alt", "10:00", "11:00")
        assert connection.execute(text("SELECT slot_id, speaker_id FROM slot_speakers")).one() == (5, 4)
        assert connection.exec_driver_sql("PRAGMA foreign_key_check").all() == []
        connection.execute(text("UPDATE slots SET day_id=NULL, room_id=NULL, start_time=NULL, end_time=NULL WHERE id=5"))
        assert connection.execute(text("SELECT id FROM slots WHERE day_id IS NULL")).scalar_one() == 5
    engine.dispose()
