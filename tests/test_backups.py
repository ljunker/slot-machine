from io import BytesIO
from zipfile import ZIP_DEFLATED, ZipFile

import pytest
from conftest import legacy_archive, make_account
from PIL import Image
from sqlalchemy import select

from app.models.slot import Slot
from app.services.backup_service import restore_backup
from app.services.event_branding import logo_directory


def create_event(client, name="Konferenz"):
    response = client.post(
        "/api/events",
        json={
            "name": name,
            "start_date": "2026-10-01",
            "end_date": "2026-10-02",
            "accent_color": "#123ABC",
        },
    )
    assert response.status_code == 201
    return response.json()["id"]


def png_bytes():
    output = BytesIO()
    Image.new("RGB", (4, 4), "red").save(output, format="PNG")
    return output.getvalue()


def upload(client, content, target=None, endpoint="preview"):
    data = {} if target is None else {"target_event_id": str(target)}
    return client.post(
        f"/api/backups/{endpoint}",
        data=data,
        files={"backup": ("backup.zip", content, "application/zip")},
    )


def alter_archive(content, remove=None, replace=None, add=None):
    output = BytesIO()
    with (
        ZipFile(BytesIO(content)) as source,
        ZipFile(output, "w", ZIP_DEFLATED) as target,
    ):
        removed = {remove} if isinstance(remove, str) else set(remove or [])
        for item in source.infolist():
            if item.filename not in removed:
                target.writestr(
                    item.filename,
                    replace.get(item.filename, source.read(item.filename))
                    if replace
                    else source.read(item.filename),
                )
        if add:
            target.writestr(*add)
    return output.getvalue()


def test_roundtrip_replace_and_create(client, db, monkeypatch, tmp_path):
    monkeypatch.setenv("EVENT_LOGO_DIR", str(tmp_path / "logos"))
    monkeypatch.setenv("SPEAKER_UPLOAD_DIR", str(tmp_path / "photos"))
    event_id = create_event(client)
    other_id = create_event(client, "Andere")
    day = client.post(
        f"/api/events/{event_id}/days",
        json={
            "event_id": event_id,
            "date": "2026-10-01",
            "start_time": "09:00",
            "end_time": "18:00",
        },
    ).json()["id"]
    room = client.post(
        "/api/rooms", json={"event_id": event_id, "name": "Saal"}
    ).json()["id"]
    speaker = client.post(
        f"/api/events/{event_id}/speakers",
        json={
            "name": "Ada",
            "bio": "Zeile 1\nZeile 2, mit Komma",
            "website": "https://example.org",
        },
    ).json()["id"]
    helper_id = make_account(db, event_id, "Bo")["id"]
    slot = client.post(
        "/api/slots",
        json={
            "event_id": event_id,
            "day_id": day,
            "room_id": room,
            "topic": "Vortrag",
            "description": "Mehrzeilig\nmit, Komma",
            "start_time": "10:00",
            "end_time": "11:00",
            "speaker_ids": [speaker],
        },
    ).json()["id"]
    unplanned = client.post(
        "/api/slots",
        json={
            "event_id": event_id,
            "topic": "Später",
            "description": r"\N",
            "speaker_ids": [speaker],
        },
    ).json()["id"]
    duty = client.post(
        f"/api/events/{event_id}/duties",
        json={
            "kind": "session",
            "slot_id": slot,
            "user_ids": [helper_id],
            "title": "Technik",
        },
    )
    assert duty.status_code == 201
    assert (
        client.patch(f"/api/slots/{slot}", json={"is_cancelled": True}).status_code
        == 200
    )
    photo = png_bytes()
    assert (
        client.post(
            f"/api/events/{event_id}/logo",
            files={"logo": ("x.png", photo, "image/png")},
        ).status_code
        == 200
    )
    assert (
        client.post(
            f"/api/speakers/{speaker}/photo",
            files={"photo": ("x.png", photo, "image/png")},
        ).status_code
        == 200
    )
    saved_slot = db.get(Slot, slot)
    saved_slot.schedule_changed_at = 1790000000
    saved_slot.previous_room_name = "Alter Saal"
    saved_slot.previous_start_time = saved_slot.start_time
    saved_slot.previous_end_time = saved_slot.end_time
    db.commit()

    backup = client.get(f"/api/backups/events/{event_id}")
    assert backup.status_code == 200
    assert backup.headers["content-type"] == "application/zip"
    with ZipFile(BytesIO(backup.content)) as archive:
        assert {
            "manifest.csv",
            "events.csv",
            "slots.csv",
            "duty_assignments.csv",
            "media/logo.png",
            f"media/speakers/{speaker}.png",
        } <= set(archive.namelist())
        assert archive.read("media/logo.png") == photo
    preview = upload(client, backup.content, event_id).json()
    assert preview["counts"]["slots"] == 2
    assert preview["remapped_session_ids"] == 0

    assert (
        client.patch(f"/api/events/{event_id}", json={"name": "Kaputt"}).status_code
        == 200
    )
    assert client.delete(f"/api/slots/{unplanned}").status_code == 204
    result = upload(client, backup.content, event_id, "restore")
    assert result.status_code == 200, result.text
    assert result.json()["event_id"] == event_id
    assert client.get(f"/api/events/{event_id}").json()["name"] == "Konferenz"
    restored_slot = db.scalar(select(Slot).where(Slot.id == slot))
    assert restored_slot.description == "Mehrzeilig\nmit, Komma"
    assert restored_slot.schedule_changed_at == 1790000000
    assert restored_slot.previous_room_name == "Alter Saal"
    assert restored_slot.is_cancelled is True
    assert client.get(f"/api/events/{event_id}/sessions/{slot}").status_code == 200
    restored_unplanned = client.get(
        f"/api/events/{event_id}/unplanned-sessions"
    ).json()[0]
    assert restored_unplanned["topic"] == "Später"
    assert restored_unplanned["description"] == r"\N"
    assert client.get(f"/api/events/{event_id}/logo").content == photo
    assert client.get(f"/api/events/{other_id}").json()["name"] == "Andere"
    assert (
        len(
            client.get(f"/api/events/{event_id}/helper-plan").json()["duties"][0][
                "users"
            ]
        )
        == 1
    )

    assert client.delete(f"/api/events/{event_id}").status_code == 204
    created = upload(client, backup.content, endpoint="restore")
    assert created.status_code == 200, created.text
    new_id = created.json()["event_id"]
    assert new_id != event_id
    assert client.get(f"/api/events/{new_id}").json()["name"] == "Konferenz"
    assert client.get(f"/api/events/{new_id}/logo").content == photo
    assert client.get(f"/api/events/{other_id}").status_code == 200


def test_duty_order_roundtrip_and_legacy_backup(client):
    event_id = create_event(client)
    day = client.post(
        f"/api/events/{event_id}/days",
        json={
            "event_id": event_id,
            "date": "2026-10-01",
            "start_time": "09:00",
            "end_time": "18:00",
        },
    ).json()
    duty_ids = [
        client.post(
            f"/api/events/{event_id}/duties",
            json={
                "kind": "general",
                "title": title,
                "day_id": day["id"],
                "start_time": start,
                "end_time": "11:00",
            },
        ).json()["id"]
        for title, start in (
            ("Getränke", "10:00"),
            ("Parkeinweisung", "09:30"),
            ("Registration", "10:00"),
        )
    ]
    response = client.patch(
        f"/api/events/{event_id}/duties/order",
        json={
            "day_id": day["id"],
            "room_id": None,
            "duty_ids": [duty_ids[1], duty_ids[2], duty_ids[0]],
        },
    )
    assert response.status_code == 200, response.text
    backup = client.get(f"/api/backups/events/{event_id}").content
    restored = upload(client, backup, endpoint="restore")
    assert restored.status_code == 200, restored.text
    duties = client.get(
        f"/api/events/{restored.json()['event_id']}/helper-plan"
    ).json()["duties"]
    assert [item["title"] for item in sorted(duties, key=lambda item: item["sort_order"])] == [
        "Parkeinweisung", "Registration", "Getränke"
    ]

    legacy = legacy_archive(backup, "1")
    restored = upload(client, legacy, endpoint="restore")
    assert restored.status_code == 200, restored.text
    duties = client.get(
        f"/api/events/{restored.json()['event_id']}/helper-plan"
    ).json()["duties"]
    assert [item["title"] for item in sorted(duties, key=lambda item: item["sort_order"])] == [
        "Parkeinweisung", "Getränke", "Registration"
    ]


def test_invalid_archives_do_not_change_data(client, monkeypatch, tmp_path):
    monkeypatch.setenv("EVENT_LOGO_DIR", str(tmp_path / "logos"))
    event_id = create_event(client)
    image = png_bytes()
    client.post(
        f"/api/events/{event_id}/logo", files={"logo": ("x.png", image, "image/png")}
    )
    backup = client.get(f"/api/backups/events/{event_id}").content
    with ZipFile(BytesIO(backup)) as archive:
        manifest = archive.read("manifest.csv").replace(b"6,", b"99,", 1)
    invalid = [
        b"not a zip",
            alter_archive(backup, remove="manifest.csv"),
        alter_archive(backup, remove="media/logo.png"),
        alter_archive(backup, replace={"manifest.csv": manifest}),
        alter_archive(backup, add=("../evil", b"bad")),
        alter_archive(backup, replace={"events.csv": b"wrong\n"}),
    ]
    before = client.get(f"/api/events/{event_id}").json()
    files_before = set(logo_directory().iterdir())
    for content in invalid:
        assert upload(client, content, event_id).status_code == 400
        assert upload(client, content, event_id, "restore").status_code == 400
        assert client.get(f"/api/events/{event_id}").json() == before
        assert set(logo_directory().iterdir()) == files_before
        assert client.get(f"/api/events/{event_id}/logo").content == image


def test_missing_source_image_fails_export(client, monkeypatch, tmp_path):
    monkeypatch.setenv("EVENT_LOGO_DIR", str(tmp_path))
    event_id = create_event(client)
    client.post(
        f"/api/events/{event_id}/logo",
        files={"logo": ("x.png", png_bytes(), "image/png")},
    )
    next(tmp_path.iterdir()).unlink()
    assert client.get(f"/api/backups/events/{event_id}").status_code == 400


def test_restore_remaps_colliding_session_and_new_event_ids(client):
    original = create_event(client)
    day = client.post(
        f"/api/events/{original}/days",
        json={
            "event_id": original,
            "date": "2026-10-01",
            "start_time": "09:00",
            "end_time": "18:00",
        },
    ).json()["id"]
    room = client.post("/api/rooms", json={"event_id": original, "name": "A"}).json()[
        "id"
    ]
    slot = client.post(
        "/api/slots",
        json={
            "event_id": original,
            "day_id": day,
            "room_id": room,
            "topic": "Original",
            "start_time": "10:00",
            "end_time": "11:00",
        },
    ).json()["id"]
    backup = client.get(f"/api/backups/events/{original}").content
    assert client.delete(f"/api/slots/{slot}").status_code == 204
    other = create_event(client, "Andere")
    other_slot = client.post(
        "/api/slots", json={"event_id": other, "topic": "Fremd"}
    ).json()["id"]
    assert other_slot == slot
    preview = upload(client, backup, original).json()
    assert preview["remapped_session_ids"] == 1
    restored = upload(client, backup, original, "restore")
    assert restored.status_code == 200, restored.text
    assert (
        client.get(f"/api/events/{other}/unplanned-sessions").json()[0]["topic"]
        == "Fremd"
    )
    restored_day = client.get(f"/api/events/{original}/days").json()[0]["id"]
    restored_slots = client.get(f"/api/schedule/days/{restored_day}").json()["rooms"][
        0
    ]["slots"]
    assert restored_slots[0]["id"] != slot

    assert client.delete(f"/api/events/{original}").status_code == 204
    created = upload(client, backup, endpoint="restore")
    assert created.status_code == 200, created.text
    assert created.json()["event_id"] != original


def test_failed_database_commit_keeps_old_data_and_images(
    client, db, monkeypatch, tmp_path
):
    monkeypatch.setenv("EVENT_LOGO_DIR", str(tmp_path))
    event_id = create_event(client)
    image = png_bytes()
    client.post(
        f"/api/events/{event_id}/logo", files={"logo": ("x.png", image, "image/png")}
    )
    backup = client.get(f"/api/backups/events/{event_id}").content
    client.patch(f"/api/events/{event_id}", json={"name": "Aktuell"})
    files_before = set(tmp_path.iterdir())

    def fail_commit():
        raise RuntimeError("simulierter Datenbankfehler")

    monkeypatch.setattr(db, "commit", fail_commit)
    with pytest.raises(RuntimeError, match="simulierter Datenbankfehler"):
        restore_backup(db, backup, event_id)
    assert client.get(f"/api/events/{event_id}").json()["name"] == "Aktuell"
    assert client.get(f"/api/events/{event_id}/logo").content == image
    assert set(tmp_path.iterdir()) == files_before


def test_invalid_relationship_is_rejected(client):
    event_id = create_event(client)
    day = client.post(
        f"/api/events/{event_id}/days",
        json={
            "event_id": event_id,
            "date": "2026-10-01",
            "start_time": "09:00",
            "end_time": "18:00",
        },
    ).json()["id"]
    room = client.post("/api/rooms", json={"event_id": event_id, "name": "A"}).json()[
        "id"
    ]
    client.post(
        "/api/slots",
        json={
            "event_id": event_id,
            "day_id": day,
            "room_id": room,
            "topic": "Vortrag",
            "start_time": "10:00",
            "end_time": "11:00",
        },
    )
    backup = client.get(f"/api/backups/events/{event_id}").content
    with ZipFile(BytesIO(backup)) as archive:
        slots = archive.read("slots.csv").decode("utf-8")
    invalid = alter_archive(
        backup,
        replace={
            "slots.csv": slots.replace(f",{day},{room},", f",999999,{room},").encode(
                "utf-8"
            )
        },
    )
    assert upload(client, invalid, event_id, "restore").status_code == 400
    assert client.get(f"/api/events/{event_id}/days").json()[0]["id"] == day
