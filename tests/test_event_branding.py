from io import BytesIO

import pytest
from PIL import Image
from pypdf import PdfReader
from sqlalchemy import create_engine, inspect, text

from app.db.migrate_event_branding import migrate_event_branding
from app.services.event_branding import MAX_LOGO_BYTES


def create_event(client, name="Konferenz", accent_color=None):
    response = client.post(
        "/api/events",
        json={
            "name": name,
            "start_date": "2026-10-01",
            "end_date": "2026-10-01",
            "accent_color": accent_color,
        },
    )
    assert response.status_code == 201
    return response.json()


def image_bytes(format):
    output = BytesIO()
    Image.new("RGB", (80, 40), "#aabbcc").save(output, format=format)
    return output.getvalue()


def test_color_validation_and_reset(client):
    created = create_event(client)
    assert created["accent_color"] is None
    assert created["logo_url"] is None
    event_id = created["id"]
    response = client.patch(f"/api/events/{event_id}", json={"accent_color": "#ab12ef"})
    assert response.status_code == 200
    assert response.json()["accent_color"] == "#AB12EF"
    assert client.get(f"/api/events/{event_id}").json()["accent_color"] == "#AB12EF"
    assert client.get("/api/events").json()[0]["accent_color"] == "#AB12EF"
    for value in ("red", "#123", "#1234567", "#12GG34", " #123456"):
        assert client.patch(f"/api/events/{event_id}", json={"accent_color": value}).status_code == 400
        assert client.post(
            "/api/events",
            json={"name": "Ungültig", "start_date": "2026-10-01", "end_date": "2026-10-01", "accent_color": value},
        ).status_code == 400
    assert client.patch(f"/api/events/{event_id}", json={"accent_color": None}).json()["accent_color"] is None


def test_logo_upload_replace_remove_and_event_delete(client, monkeypatch, tmp_path):
    monkeypatch.setenv("EVENT_LOGO_DIR", str(tmp_path))
    created = create_event(client)
    event_id = created["id"]
    url = f"/api/events/{event_id}/logo"
    assert client.get(url).status_code == 404
    assert client.post(url, files={"logo": ("bad.png", b"not an image", "image/png")}).status_code == 400
    assert client.post(url, files={"logo": ("big.png", b"x" * (MAX_LOGO_BYTES + 1), "image/png")}).status_code == 400

    previous = None
    for format, mime in (("PNG", "image/png"), ("JPEG", "image/jpeg"), ("WEBP", "image/webp")):
        content = image_bytes(format)
        response = client.post(url, files={"logo": ("logo.bin", content, "application/octet-stream")})
        assert response.status_code == 200
        assert response.json()["logo_url"] == url
        downloaded = client.get(url)
        assert downloaded.content == content
        assert downloaded.headers["content-type"] == mime
        assert downloaded.headers["cache-control"] == "no-store"
        files = list(tmp_path.iterdir())
        assert len(files) == 1
        if previous:
            assert not previous.exists()
        previous = files[0]

    assert client.delete(url).json()["logo_url"] is None
    assert not previous.exists()
    assert client.get(url).status_code == 404

    client.post(url, files={"logo": ("logo.png", image_bytes("PNG"), "image/png")})
    assert list(tmp_path.iterdir())
    assert client.delete(f"/api/events/{event_id}").status_code == 204
    assert list(tmp_path.iterdir()) == []


def test_branding_migration_preserves_legacy_events():
    engine = create_engine("sqlite://")
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE events (id INTEGER PRIMARY KEY, name VARCHAR(255), start_date DATE, end_date DATE)"))
        connection.execute(text("INSERT INTO events VALUES (1, 'Alt', '2026-10-01', '2026-10-01')"))
    migrate_event_branding(engine)
    migrate_event_branding(engine)
    with engine.connect() as connection:
        assert {column["name"] for column in inspect(connection).get_columns("events")} >= {"accent_color", "logo_filename"}
        assert connection.execute(text("SELECT name, accent_color, logo_filename FROM events WHERE id = 1")).one() == ("Alt", None, None)
    engine.dispose()


@pytest.mark.parametrize("format", ["PNG", "JPEG", "WEBP"])
def test_branded_pdf_with_long_name_and_logo(client, monkeypatch, tmp_path, format):
    monkeypatch.setenv("EVENT_LOGO_DIR", str(tmp_path))
    created = create_event(client, name="Langes Programm " * 30, accent_color="#5A32C8")
    event_id = created["id"]
    client.post(
        f"/api/events/{event_id}/days",
        json={"event_id": event_id, "date": "2026-10-01", "start_time": "09:00", "end_time": "18:00"},
    )
    plain = PdfReader(BytesIO(client.get(f"/api/events/{event_id}/program.pdf").content))
    assert len(plain.pages) == 1
    assert "Langes Programm" in plain.pages[0].extract_text()
    assert not plain.pages[0].images

    client.post(f"/api/events/{event_id}/logo", files={"logo": ("logo.bin", image_bytes(format), "application/octet-stream")})
    branded = PdfReader(BytesIO(client.get(f"/api/events/{event_id}/program.pdf").content))
    assert len(branded.pages) == 1
    assert len(branded.pages[0].images) == 1
    assert "Programm - 01.10.2026" in branded.pages[0].extract_text()
