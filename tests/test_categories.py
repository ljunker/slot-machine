from io import BytesIO
from zipfile import ZIP_DEFLATED, ZipFile

from fastapi.testclient import TestClient
from pypdf import PdfReader

from app.main import app
from app.models.auth import EventMembership, User
from app.services.auth import password_hash


def event(client, name="Konferenz"):
    response = client.post("/api/events", json={
        "name": name, "start_date": "2099-06-01", "end_date": "2099-06-02"
    })
    assert response.status_code == 201
    return response.json()["id"]


def category(client, event_id, name, color="#AB12CD"):
    response = client.post(f"/api/events/{event_id}/categories", json={
        "name": name, "color": color
    })
    assert response.status_code == 201, response.text
    return response.json()


def test_category_rights_names_and_delete_links(client, db):
    own, foreign = event(client), event(client, "Andere")
    first = category(client, own, " Musik ", "#ab12cd")
    second = category(client, own, "Tanz")
    outsider = category(client, foreign, "Fremd")
    assert first["name"] == "Musik" and first["color"] == "#AB12CD"
    assert client.post(f"/api/events/{own}/categories", json={
        "name": "mUSIK", "color": "#123456"
    }).status_code == 409
    assert client.patch(f"/api/categories/{second['id']}", json={
        "name": "MUSIK"
    }).status_code == 409
    assert client.post(f"/api/events/{own}/categories", json={
        "name": "Falsch", "color": "red"
    }).status_code == 400
    assert client.patch(f"/api/categories/{first['id']}", json={"color": None}).status_code == 400
    assert client.patch(f"/api/categories/{first['id']}", json={
        "name": "Geändert", "color": "invalid"
    }).status_code == 400
    assert client.get(f"/api/events/{own}/categories").json()[0]["name"] == "Musik"

    slot = client.post("/api/slots", json={
        "event_id": own, "topic": "Ungeplant", "category_ids": [first["id"], second["id"]]
    })
    assert slot.status_code == 201, slot.text
    slot_id = slot.json()["id"]
    assert {item["name"] for item in slot.json()["categories"]} == {"Musik", "Tanz"}
    for ids in ([first["id"], first["id"]], [first["id"], outsider["id"]]):
        assert client.patch(f"/api/slots/{slot_id}", json={"category_ids": ids}).status_code == 400
    assert client.patch(f"/api/slots/{slot_id}", json={"category_ids": None}).status_code == 400
    assert client.post("/api/slots", json={
        "event_id": own, "topic": "Falsch", "category_ids": [outsider["id"]]
    }).status_code == 400

    person = User(email="editor@example.invalid", password_hash=password_hash("Testpassword123!"))
    db.add(person)
    db.flush()
    db.add(EventMembership(event_id=own, user_id=person.id, role="editor"))
    db.commit()
    editor = TestClient(app)
    login = editor.post("/api/auth/login", json={
        "email": person.email, "password": "Testpassword123!"
    })
    editor.headers.update({"X-CSRF-Token": login.json()["csrf_token"]})
    assert len(editor.get(f"/api/events/{own}/categories").json()) == 2
    assert editor.get(f"/api/events/{foreign}/categories").status_code == 404
    assert editor.post(f"/api/events/{own}/categories", json={
        "name": "Nein", "color": "#123456"
    }).status_code == 403
    assert editor.patch(f"/api/categories/{first['id']}", json={"name": "Nein"}).status_code == 403
    assert editor.delete(f"/api/categories/{first['id']}").status_code == 403
    assert client.delete(f"/api/categories/{first['id']}").status_code == 204
    remaining = client.get(f"/api/events/{own}/unplanned-sessions").json()[0]
    assert remaining["category_ids"] == [second["id"]]


def test_categories_in_public_pdf_and_backup(client):
    source = event(client)
    day = client.post(f"/api/events/{source}/days", json={
        "event_id": source, "date": "2099-06-01", "start_time": "09:00", "end_time": "18:00"
    }).json()["id"]
    room = client.post("/api/rooms", json={"event_id": source, "name": "Saal"}).json()["id"]
    cats = [category(client, source, f"Kategorie {index:02d}") for index in range(26)]
    planned = client.post("/api/slots", json={
        "event_id": source, "day_id": day, "room_id": room, "topic": "Vortrag",
        "start_time": "10:00", "end_time": "11:00",
        "category_ids": [item["id"] for item in cats]
    }).json()
    client.post("/api/slots", json={
        "event_id": source, "topic": "Später", "category_ids": [cats[0]["id"]]
    })
    assert len(client.get(f"/api/public/events/{source}/days/{day}/schedule").json()["rooms"][0]["slots"][0]["categories"]) == 26
    assert len(client.get(f"/api/events/{source}/sessions/{planned['id']}").json()["categories"]) == 26
    pdf = PdfReader(BytesIO(client.get(f"/api/events/{source}/program.pdf").content))
    assert len(pdf.pages) == 1
    assert "Kategorien" in pdf.pages[0].extract_text()
    assert "Kategorie 00" in pdf.pages[0].extract_text()
    assert "Kategorie 25" in pdf.pages[0].extract_text()

    backup = client.get(f"/api/backups/events/{source}").content
    with ZipFile(BytesIO(backup)) as archive:
        assert archive.read("manifest.csv").splitlines()[1].startswith(b"3,")
        assert len(archive.read("slot_categories.csv").splitlines()) == 28
    invalid = BytesIO()
    with ZipFile(BytesIO(backup)) as original, ZipFile(invalid, "w", ZIP_DEFLATED) as output:
        for filename in original.namelist():
            content = original.read(filename)
            if filename == "slot_categories.csv":
                lines = content.splitlines(keepends=True)
                first_id = lines[1].split(b",")[0]
                lines[1] = first_id + b",999999\r\n"
                content = b"".join(lines)
            output.writestr(filename, content)
    assert client.post("/api/backups/preview", files={
        "backup": ("backup.zip", invalid.getvalue(), "application/zip")
    }).status_code == 400
    restored = client.post("/api/backups/restore", files={
        "backup": ("backup.zip", backup, "application/zip")
    })
    assert restored.status_code == 200, restored.text
    target = restored.json()["event_id"]
    assert len(client.get(f"/api/events/{target}/categories").json()) == 26
    restored_slot = client.get(f"/api/public/events/{target}/days/" +
        str(client.get(f"/api/events/{target}/days").json()[0]["id"]) + "/schedule").json()["rooms"][0]["slots"][0]
    assert {item["name"] for item in restored_slot["categories"]} == {
        item["name"] for item in cats
    }

    legacy = BytesIO()
    with ZipFile(BytesIO(backup)) as original, ZipFile(legacy, "w", ZIP_DEFLATED) as output:
        for filename in original.namelist():
            if filename in {"categories.csv", "slot_categories.csv"}:
                continue
            content = original.read(filename)
            if filename == "manifest.csv":
                content = content.replace(b"3,", b"2,", 1)
            output.writestr(filename, content)
    older = client.post("/api/backups/restore", files={
        "backup": ("backup.zip", legacy.getvalue(), "application/zip")
    })
    assert older.status_code == 200, older.text
    assert client.get(f"/api/events/{older.json()['event_id']}/categories").json() == []
