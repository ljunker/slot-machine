from io import BytesIO

from PIL import Image
from sqlalchemy import create_engine, select, text

from app.db.base import Base
from app.db.migrate_speakers import migrate_legacy_speakers
from app.models.speaker import Speaker, slot_speakers


def setup_event(client, name="Konferenz"):
    event = client.post(
        "/api/events",
        json={
            "name": name,
            "start_date": "2026-10-01",
            "end_date": "2026-10-02",
        },
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
    return event, day, rooms


def create_speaker(client, event_id, name):
    response = client.post(f"/api/events/{event_id}/speakers", json={"name": name})
    assert response.status_code == 201
    return response.json()


def create_slot(client, day_id, room_id, topic, start, end, speaker_ids):
    response = client.post(
        "/api/slots",
        json={
            "day_id": day_id,
            "room_id": room_id,
            "topic": topic,
            "start_time": start,
            "end_time": end,
            "speaker_ids": speaker_ids,
        },
    )
    assert response.status_code == 201
    return response.json()


def test_profiles_assignments_sessions_and_delete(client):
    event, day, rooms = setup_event(client)
    ada = create_speaker(client, event["id"], " Ada ")
    ben = create_speaker(client, event["id"], "Ben")
    assert ada["name"] == "Ada"
    assert (
        client.post(
            f"/api/events/{event['id']}/speakers", json={"name": "ADA"}
        ).status_code
        == 409
    )
    assert (
        client.patch(
            f"/api/speakers/{ben['id']}",
            json={
                "bio": "  Forscher  ",
                "website": "https://example.org",
            },
        ).json()["bio"]
        == "Forscher"
    )
    assert (
        client.patch(
            f"/api/speakers/{ben['id']}",
            json={
                "name": "Neuer Name",
                "website": "javascript:alert(1)",
            },
        ).status_code
        == 400
    )
    assert client.get(f"/api/speakers/{ben['id']}").json()["name"] == "Ben"
    slot = create_slot(
        client,
        day["id"],
        rooms[0]["id"],
        "Gemeinsam",
        "10:00",
        "11:00",
        [ada["id"], ben["id"]],
    )
    assert {speaker["name"] for speaker in slot["speakers"]} == {"Ada", "Ben"}
    assert client.get(f"/api/speakers/{ada['id']}").json()["sessions"] == [
        {
            "id": slot["id"],
            "day_id": day["id"],
            "date": "2026-10-01",
            "room_id": rooms[0]["id"],
            "room_name": "A",
            "topic": "Gemeinsam",
            "start_time": "10:00:00",
            "end_time": "11:00:00",
        }
    ]
    assert (
        client.patch(f"/api/slots/{slot['id']}", json={"topic": "Anders"}).json()[
            "speaker_ids"
        ]
        == slot["speaker_ids"]
    )
    assert (
        client.patch(
            f"/api/slots/{slot['id']}", json={"speaker_ids": [ada["id"], ada["id"]]}
        ).status_code
        == 400
    )
    other, _, _ = setup_event(client, "Andere")
    foreign = create_speaker(client, other["id"], "Fremd")
    assert (
        client.patch(
            f"/api/slots/{slot['id']}", json={"speaker_ids": [foreign["id"]]}
        ).status_code
        == 400
    )
    assert (
        client.patch(
            f"/api/slots/{slot['id']}", json={"speaker_ids": [999999]}
        ).status_code
        == 400
    )
    assert (
        client.patch(f"/api/slots/{slot['id']}", json={"speaker_ids": None}).status_code
        == 400
    )
    assert (
        client.post(
            "/api/slots",
            json={
                "day_id": day["id"],
                "room_id": rooms[0]["id"],
                "topic": "Alt",
                "start_time": "12:00",
                "end_time": "13:00",
                "speaker": "Ada",
            },
        ).status_code
        == 422
    )
    assert client.delete(f"/api/speakers/{ada['id']}").status_code == 204
    remaining = client.get(f"/api/schedule/days/{day['id']}").json()["rooms"][0][
        "slots"
    ][0]
    assert remaining["speakers"] == [{"id": ben["id"], "name": "Ben"}]
    assert (
        client.patch(f"/api/slots/{slot['id']}", json={"speaker_ids": []}).json()[
            "speakers"
        ]
        == []
    )


def test_photo_validation_and_lifecycle(client, monkeypatch, tmp_path):
    monkeypatch.setenv("SPEAKER_UPLOAD_DIR", str(tmp_path))
    event, _, _ = setup_event(client)
    speaker = create_speaker(client, event["id"], "Ada")
    image = Image.new("RGB", (2, 2), "red")
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    photo = buffer.getvalue()
    result = client.post(
        f"/api/speakers/{speaker['id']}/photo",
        files={"photo": ("photo.png", photo, "image/png")},
    )
    assert result.status_code == 200
    assert result.json()["photo_url"] == f"/api/speakers/{speaker['id']}/photo"
    assert client.get(result.json()["photo_url"]).content == photo
    assert (
        client.post(
            f"/api/speakers/{speaker['id']}/photo",
            files={"photo": ("again.png", photo, "image/png")},
        ).status_code
        == 200
    )
    assert len(list(tmp_path.iterdir())) == 1
    assert (
        client.post(
            f"/api/speakers/{speaker['id']}/photo",
            files={"photo": ("bad.png", b"not an image", "image/png")},
        ).status_code
        == 400
    )
    assert (
        client.post(
            f"/api/speakers/{speaker['id']}/photo",
            files={"photo": ("large.png", b"x" * (5 * 1024 * 1024 + 1), "image/png")},
        ).status_code
        == 400
    )
    assert client.get(result.json()["photo_url"]).content == photo
    assert (
        client.delete(f"/api/speakers/{speaker['id']}/photo").json()["photo_url"]
        is None
    )
    assert client.get(f"/api/speakers/{speaker['id']}/photo").status_code == 404
    assert list(tmp_path.iterdir()) == []


def test_delete_day_room_event_cleans_links_and_photos(
    client, db, monkeypatch, tmp_path
):
    monkeypatch.setenv("SPEAKER_UPLOAD_DIR", str(tmp_path))
    event, day, rooms = setup_event(client)
    speaker = create_speaker(client, event["id"], "Ada")
    create_slot(
        client, day["id"], rooms[0]["id"], "Eins", "10:00", "11:00", [speaker["id"]]
    )
    assert client.delete(f"/api/rooms/{rooms[0]['id']}").status_code == 204
    assert len(db.execute(select(slot_speakers)).all()) == 1
    create_slot(
        client, day["id"], rooms[1]["id"], "Zwei", "10:00", "11:00", [speaker["id"]]
    )
    assert client.delete(f"/api/days/{day['id']}").status_code == 204
    assert len(db.execute(select(slot_speakers)).all()) == 2
    image = Image.new("RGB", (2, 2), "red")
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    assert (
        client.post(
            f"/api/speakers/{speaker['id']}/photo",
            files={"photo": ("photo.png", buffer.getvalue(), "image/png")},
        ).status_code
        == 200
    )
    assert len(list(tmp_path.iterdir())) == 1
    assert client.delete(f"/api/events/{event['id']}").status_code == 204
    assert db.scalars(select(Speaker)).all() == []
    assert list(tmp_path.iterdir()) == []


def test_speaker_conflicts_update_and_room_collisions(client):
    event, day, rooms = setup_event(client)
    ada = create_speaker(client, event["id"], "Ada")
    ben = create_speaker(client, event["id"], "Ben")
    first = create_slot(
        client,
        day["id"],
        rooms[0]["id"],
        "Erster",
        "10:00",
        "11:00",
        [ada["id"], ben["id"]],
    )
    second = create_slot(
        client,
        day["id"],
        rooms[1]["id"],
        "Zweiter",
        "10:30",
        "11:30",
        [ada["id"], ben["id"]],
    )
    schedule = client.get(f"/api/schedule/days/{day['id']}").json()
    assert schedule["speaker_conflicts"] == [
        {
            "first_slot_id": first["id"],
            "second_slot_id": second["id"],
            "speaker_ids": sorted([ada["id"], ben["id"]]),
        }
    ]
    assert schedule["collisions"] == []
    assert (
        client.patch(
            f"/api/slots/{second['id']}",
            json={"start_time": "11:00", "end_time": "12:00"},
        ).status_code
        == 200
    )
    assert (
        client.get(f"/api/schedule/days/{day['id']}").json()["speaker_conflicts"] == []
    )
    assert (
        client.patch(
            f"/api/slots/{second['id']}",
            json={
                "room_id": rooms[0]["id"],
                "start_time": "10:30",
                "end_time": "11:30",
            },
        ).status_code
        == 200
    )
    schedule = client.get(f"/api/schedule/days/{day['id']}").json()
    assert schedule["speaker_conflicts"] == []
    assert schedule["collisions"] == [
        {"first_slot_id": first["id"], "second_slot_id": second["id"]}
    ]


def test_legacy_migration_runs_once(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'legacy.db'}")
    Base.metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(text("ALTER TABLE slots ADD COLUMN speaker VARCHAR(255)"))
        connection.execute(
            text(
                "INSERT INTO events (id, name, start_date, end_date) VALUES (1, 'Test', '2026-10-01', '2026-10-02')"
            )
        )
        connection.execute(
            text(
                "INSERT INTO event_days (id, event_id, date, start_time, end_time) VALUES (1, 1, '2026-10-01', '09:00', '18:00')"
            )
        )
        connection.execute(
            text(
                "INSERT INTO rooms (id, event_id, name, sort_order) VALUES (1, 1, 'A', 0)"
            )
        )
        connection.execute(
            text(
                "INSERT INTO slots (id, event_id, day_id, room_id, topic, description, start_time, end_time, speaker) VALUES (1, 1, 1, 1, 'Eins', NULL, '10:00', '11:00', ' Ada '), (2, 1, 1, 1, 'Zwei', NULL, '11:00', '12:00', 'ada')"
            )
        )
    migrate_legacy_speakers(engine)
    migrate_legacy_speakers(engine)
    with engine.connect() as connection:
        assert connection.scalar(select(Speaker.name)) == "Ada"
        assert len(connection.execute(select(slot_speakers)).all()) == 2
    engine.dispose()
