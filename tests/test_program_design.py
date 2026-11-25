from io import BytesIO

from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import create_engine, inspect, text

from app.db.migrate_event_branding import migrate_event_branding
from app.db.migrate_program_design import PROGRAM_DESIGN_COLUMNS, migrate_program_design
from app.main import app
from tests.conftest import make_account

FLYER = {
    "background_color": "#faf7f0",
    "text_color": "#1d488b",
    "accent_color": "#167b7b",
    "header_background_color": "#faf7f0",
    "card_color": "#ffffff",
    "program_eyebrow": "  PROGRAMM ",
    "program_subtitle": "21.–23.05.2027 ·   HAMBURG",
    "website_url": "https://rdf2027.ecta.de/",
}


def create_event(client, **design):
    response = client.post(
        "/api/events",
        json={"name": "Round Dance Festival", "start_date": "2027-05-21", "end_date": "2027-05-23", **design},
    )
    assert response.status_code == 201, response.text
    return response.json()


def image_bytes(format="PNG", size=(60, 30)):
    output = BytesIO()
    Image.new("RGB", size, "#1d488b").save(output, format=format)
    return output.getvalue()


def login(email):
    person = TestClient(app)
    response = person.post("/api/auth/login", json={"email": email, "password": "Testpassword123!"})
    assert response.status_code == 200, response.text
    person.headers.update({"X-CSRF-Token": response.json()["csrf_token"]})
    return person


def test_design_fields_are_normalized_and_default_to_null(client):
    plain = create_event(client)
    for field in ("background_color", "text_color", "header_background_color", "card_color",
                  "program_eyebrow", "program_subtitle", "website_url",
                  "header_graphic_url", "footer_graphic_url"):
        assert plain[field] is None, field
    assert plain["partner_logos"] == [] and plain["info_blocks"] == []

    event = create_event(client, **FLYER)
    assert event["background_color"] == "#FAF7F0"
    assert event["text_color"] == "#1D488B"
    assert event["accent_color"] == "#167B7B"
    assert event["program_eyebrow"] == "PROGRAMM"
    assert event["program_subtitle"] == "21.–23.05.2027 · HAMBURG"
    assert event["website_url"] == "https://rdf2027.ecta.de/"

    patched = client.patch(f"/api/events/{event['id']}", json={"program_eyebrow": "   ", "card_color": None})
    assert patched.status_code == 200
    assert patched.json()["program_eyebrow"] is None
    assert patched.json()["card_color"] is None
    assert patched.json()["text_color"] == "#1D488B"


def test_design_field_validation(client):
    event = create_event(client)
    invalid = [
        {"background_color": "creme"},
        {"text_color": "#12345"},
        {"header_background_color": "#GGGGGG"},
        {"program_eyebrow": "x" * 61},
        {"program_subtitle": "x" * 161},
        {"website_url": "rdf2027.ecta.de"},
        {"website_url": "javascript:alert(1)"},
        {"website_url": "https://" + "a" * 250 + ".de"},
    ]
    for body in invalid:
        assert client.patch(f"/api/events/{event['id']}", json=body).status_code == 400, body
        assert client.post("/api/events", json={
            "name": "X", "start_date": "2027-05-21", "end_date": "2027-05-21", **body,
        }).status_code == 400, body


def test_graphics_upload_public_read_replace_and_delete(client, monkeypatch, tmp_path):
    monkeypatch.setenv("EVENT_LOGO_DIR", str(tmp_path))
    event = create_event(client)
    guest = TestClient(app)
    for slot in ("header", "footer"):
        url = f"/api/events/{event['id']}/graphics/{slot}"
        assert guest.get(url).status_code == 404
        assert client.post(url, files={"image": ("x.png", b"kein Bild", "image/png")}).status_code == 400
        first = client.post(url, files={"image": ("a.png", image_bytes("PNG"), "image/png")})
        assert first.status_code == 200
        assert first.json()[f"{slot}_graphic_url"] == url
        second = image_bytes("WEBP")
        assert client.post(url, files={"image": ("b.webp", second, "image/webp")}).status_code == 200
        downloaded = guest.get(url)
        assert downloaded.status_code == 200 and downloaded.content == second
        assert downloaded.headers["content-type"] == "image/webp"
    assert len(list(tmp_path.iterdir())) == 2
    assert client.get(f"/api/events/{event['id']}/graphics/sidebar").status_code == 422
    assert client.delete(f"/api/events/{event['id']}/graphics/header").json()["header_graphic_url"] is None
    assert len(list(tmp_path.iterdir())) == 1


def test_partner_logos_crud_order_images_and_public_event(client, monkeypatch, tmp_path):
    monkeypatch.setenv("EVENT_LOGO_DIR", str(tmp_path))
    event = create_event(client)
    base = f"/api/events/{event['id']}/partner-logos"
    assert client.post(base, json={"name": "  "}).status_code == 400
    assert client.post(base, json={"name": "X", "url": "ftp://example.org"}).status_code == 400
    ecta = client.post(base, json={
        "name": "European Callers and Teachers Association", "subtitle": "ROUND DANCE COUNCIL",
        "url": "https://ecta.de",
    }).json()
    butterflies = client.post(base, json={"name": "Butterflies", "subtitle": "Round Dance Club Hamburg e. V."}).json()
    assert (ecta["sort_order"], butterflies["sort_order"]) == (0, 1)

    image = client.post(f"{base}/{butterflies['id']}/image", files={"image": ("b.png", image_bytes(), "image/png")})
    assert image.status_code == 200
    assert image.json()["image_url"] == f"{base}/{butterflies['id']}/image"
    assert TestClient(app).get(image.json()["image_url"]).status_code == 200

    assert client.put(f"{base}/order", json={"ids": [ecta["id"]]}).status_code == 400
    assert client.put(f"{base}/order", json={"ids": [butterflies["id"], butterflies["id"]]}).status_code == 400
    assert client.put(f"{base}/order", json={"ids": [butterflies["id"], ecta["id"]]}).status_code == 204
    public = TestClient(app).get(f"/api/events/{event['id']}").json()
    assert [item["name"] for item in public["partner_logos"]] == ["Butterflies", "European Callers and Teachers Association"]

    patched = client.patch(f"{base}/{ecta['id']}", json={"subtitle": None, "url": ""})
    assert patched.json()["subtitle"] is None and patched.json()["url"] is None
    assert client.patch(f"{base}/{ecta['id']}", json={"name": None}).status_code == 400

    other = create_event(client)
    assert client.patch(f"/api/events/{other['id']}/partner-logos/{ecta['id']}", json={"name": "X"}).status_code == 404

    assert client.delete(f"{base}/{butterflies['id']}").status_code == 204
    assert list(tmp_path.iterdir()) == []
    assert [item["id"] for item in client.get(f"/api/events/{event['id']}").json()["partner_logos"]] == [ecta["id"]]


def test_info_blocks_crud_and_order(client):
    event = create_event(client)
    base = f"/api/events/{event['id']}/info-blocks"
    first = client.post(base, json={"title": "Phasen", "body": "Teaches von Phase II bis VI\r\nSaal A III–IV  \n"}).json()
    assert first["body"] == "Teaches von Phase II bis VI\nSaal A III–IV"
    second = client.post(base, json={"title": "Sprache", "body": "Cues auf Englisch"}).json()
    assert client.post(base, json={"title": "Lang", "body": "x" * 4001}).status_code == 400
    assert client.post(base, json={"title": " "}).status_code == 400
    assert client.put(f"{base}/order", json={"ids": [second["id"], first["id"]]}).status_code == 204
    titles = [block["title"] for block in client.get(f"/api/events/{event['id']}").json()["info_blocks"]]
    assert titles == ["Sprache", "Phasen"]
    assert client.patch(f"{base}/{first['id']}", json={"title": "Tanzphasen"}).json()["title"] == "Tanzphasen"
    assert client.delete(f"{base}/{second['id']}").status_code == 204
    assert len(client.get(f"/api/events/{event['id']}").json()["info_blocks"]) == 1


def test_only_event_admins_change_design(client, db):
    event = create_event(client)
    block = client.post(f"/api/events/{event['id']}/info-blocks", json={"title": "Info"}).json()
    partner = client.post(f"/api/events/{event['id']}/partner-logos", json={"name": "Partner"}).json()
    writes = [
        ("PATCH", f"/api/events/{event['id']}", {"text_color": "#000000"}),
        ("POST", f"/api/events/{event['id']}/info-blocks", {"title": "Neu"}),
        ("PATCH", f"/api/events/{event['id']}/info-blocks/{block['id']}", {"title": "Neu"}),
        ("DELETE", f"/api/events/{event['id']}/info-blocks/{block['id']}", None),
        ("PUT", f"/api/events/{event['id']}/info-blocks/order", {"ids": [block["id"]]}),
        ("POST", f"/api/events/{event['id']}/partner-logos", {"name": "Neu"}),
        ("PATCH", f"/api/events/{event['id']}/partner-logos/{partner['id']}", {"name": "Neu"}),
        ("DELETE", f"/api/events/{event['id']}/partner-logos/{partner['id']}", None),
        ("DELETE", f"/api/events/{event['id']}/graphics/header", None),
    ]
    for role in ("helper", "editor"):
        person = login(make_account(db, event["id"], role.title(), role)["email"])
        for method, path, body in writes:
            response = person.request(method, path, json=body)
            assert response.status_code == 403, (role, method, path)
        upload = person.post(f"/api/events/{event['id']}/graphics/footer", files={"image": ("a.png", image_bytes(), "image/png")})
        assert upload.status_code == 403
    guest = TestClient(app)
    assert guest.post(f"/api/events/{event['id']}/info-blocks", json={"title": "X"}).status_code == 401
    admin = login(make_account(db, event["id"], "Admin", "admin")["email"])
    assert admin.patch(f"/api/events/{event['id']}", json={"text_color": "#000000"}).status_code == 200


def test_event_delete_removes_all_design_files(client, monkeypatch, tmp_path):
    monkeypatch.setenv("EVENT_LOGO_DIR", str(tmp_path))
    event = create_event(client)
    client.post(f"/api/events/{event['id']}/logo", files={"logo": ("l.png", image_bytes(), "image/png")})
    client.post(f"/api/events/{event['id']}/graphics/header", files={"image": ("h.png", image_bytes(), "image/png")})
    client.post(f"/api/events/{event['id']}/graphics/footer", files={"image": ("f.png", image_bytes(), "image/png")})
    partner = client.post(f"/api/events/{event['id']}/partner-logos", json={"name": "P"}).json()
    client.post(f"/api/events/{event['id']}/partner-logos/{partner['id']}/image",
                files={"image": ("p.png", image_bytes(), "image/png")})
    client.post(f"/api/events/{event['id']}/info-blocks", json={"title": "Info"})
    assert len(list(tmp_path.iterdir())) == 4
    assert client.delete(f"/api/events/{event['id']}").status_code == 204
    assert list(tmp_path.iterdir()) == []


def test_program_design_migration_preserves_legacy_events():
    engine = create_engine("sqlite://")
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE events (id INTEGER PRIMARY KEY, name VARCHAR(255), start_date DATE, end_date DATE)"))
        connection.execute(text("INSERT INTO events VALUES (1, 'Alt', '2026-10-01', '2026-10-01')"))
    migrate_event_branding(engine)
    migrate_program_design(engine)
    migrate_program_design(engine)
    with engine.connect() as connection:
        columns = {column["name"] for column in inspect(connection).get_columns("events")}
        assert columns >= set(PROGRAM_DESIGN_COLUMNS)
        row = connection.execute(text("SELECT name, text_color, program_eyebrow FROM events WHERE id = 1")).one()
        assert row == ("Alt", None, None)
    engine.dispose()


def build_flyer_event(client, tmp_path, monkeypatch, info_body="Cues auf Englisch"):
    monkeypatch.setenv("EVENT_LOGO_DIR", str(tmp_path))
    event = create_event(client, **FLYER)
    event_id = event["id"]
    for day in ("2027-05-21", "2027-05-22"):
        client.post(f"/api/events/{event_id}/days",
                    json={"event_id": event_id, "date": day, "start_time": "09:00", "end_time": "18:00"})
    room = client.post("/api/rooms", json={"event_id": event_id, "name": "Saal A"}).json()
    day_id = client.get(f"/api/events/{event_id}/days").json()[0]["id"]
    client.post("/api/slots", json={"event_id": event_id, "day_id": day_id, "room_id": room["id"],
                                    "topic": "Welcome Dance", "start_time": "10:00", "end_time": "11:00"})
    for slot, size in (("header", (300, 80)), ("footer", (600, 90))):
        client.post(f"/api/events/{event_id}/graphics/{slot}", files={"image": ("g.png", image_bytes(size=size), "image/png")})
    partner = client.post(f"/api/events/{event_id}/partner-logos", json={"name": "Butterflies"}).json()
    client.post(f"/api/events/{event_id}/partner-logos/{partner['id']}/image", files={"image": ("p.png", image_bytes(), "image/png")})
    client.post(f"/api/events/{event_id}/partner-logos", json={"name": "ECTA"})
    client.post(f"/api/events/{event_id}/info-blocks", json={"title": "Sprache", "body": info_body})
    client.post(f"/api/events/{event_id}/info-blocks", json={"title": "Tanzfläche", "body": "Parkett <bitte> & saubere Schuhe"})
    return event_id


def test_pdf_uses_design_and_adds_info_page(client, monkeypatch, tmp_path):
    from pypdf import PdfReader

    event_id = build_flyer_event(client, tmp_path, monkeypatch)
    reader = PdfReader(BytesIO(client.get(f"/api/events/{event_id}/program.pdf").content))
    assert len(reader.pages) == 3
    day = reader.pages[0].extract_text()
    for expected in ("PROGRAMM", "Round Dance Festival", "21.–23.05.2027 · HAMBURG · Programm - 21.05.2027",
                 "Welcome Dance", "rdf2027.ecta.de", "Butterflies", "ECTA", "Seite 1/3"):
        assert expected in day, expected
    assert len(reader.pages[0].images) == 2  # Kopfgrafik und Partnerlogo
    info = reader.pages[2].extract_text()
    for expected in ("Sprache", "Cues auf Englisch", "Tanzfläche", "Parkett <bitte> & saubere Schuhe", "Seite 3/3"):
        assert expected in info, expected
    assert len(reader.pages[2].images) == 3  # Kopfgrafik, Fußgrafik, Partnerlogo


def test_pdf_info_blocks_continue_on_further_pages(client, monkeypatch, tmp_path):
    from pypdf import PdfReader

    event_id = build_flyer_event(client, tmp_path, monkeypatch, info_body="\n".join(["Lange Zeile mit Hinweisen"] * 120))
    reader = PdfReader(BytesIO(client.get(f"/api/events/{event_id}/program.pdf").content))
    assert len(reader.pages) >= 4
    last = len(reader.pages)
    assert f"Seite {last}/{last}" in reader.pages[-1].extract_text()
    assert "Tanzfläche" in "".join(page.extract_text() for page in reader.pages[2:])


def test_pdf_without_design_keeps_layout(client):
    from pypdf import PdfReader

    event = create_event(client)
    client.post(f"/api/events/{event['id']}/days",
                json={"event_id": event["id"], "date": "2027-05-21", "start_time": "09:00", "end_time": "18:00"})
    reader = PdfReader(BytesIO(client.get(f"/api/events/{event['id']}/program.pdf").content))
    assert len(reader.pages) == 1
    assert "Programm - 21.05.2027" in reader.pages[0].extract_text()


def test_backup_roundtrip_keeps_design_and_legacy_versions_import(client, monkeypatch, tmp_path):
    from zipfile import ZipFile

    from tests.conftest import legacy_archive

    event_id = build_flyer_event(client, tmp_path, monkeypatch)
    original = client.get(f"/api/events/{event_id}").json()
    backup = client.get(f"/api/backups/events/{event_id}").content
    with ZipFile(BytesIO(backup)) as archive:
        names = set(archive.namelist())
        assert archive.read("manifest.csv").splitlines()[1].startswith(b"8,")
    assert {"partner_logos.csv", "info_blocks.csv", "media/header.png", "media/footer.png"} <= names
    assert any(name.startswith("media/partners/") for name in names)

    def restore(content, target=None):
        data = {} if target is None else {"target_event_id": str(target)}
        response = client.post("/api/backups/restore", data=data,
                               files={"backup": ("b.zip", content, "application/zip")})
        assert response.status_code == 200, response.text
        return client.get(f"/api/events/{response.json()['event_id']}").json()

    copy = restore(backup)
    assert copy["id"] != event_id
    for key in ("background_color", "text_color", "accent_color", "program_eyebrow", "program_subtitle", "website_url"):
        assert copy[key] == original[key], key
    assert copy["header_graphic_url"] and copy["footer_graphic_url"]
    assert [(p["name"], bool(p["image_url"])) for p in copy["partner_logos"]] == [("Butterflies", True), ("ECTA", False)]
    assert [b["title"] for b in copy["info_blocks"]] == ["Sprache", "Tanzfläche"]
    assert client.get(copy["footer_graphic_url"]).status_code == 200
    assert client.get(copy["partner_logos"][0]["image_url"]).status_code == 200

    # Ersetzen mit einem Backup ohne Gestaltung (Format 6) entfernt Gestaltung und Dateien.
    files_before = len(list(tmp_path.iterdir()))
    plain = restore(legacy_archive(backup, "6"), copy["id"])
    assert plain["text_color"] is None and plain["partner_logos"] == [] and plain["info_blocks"] == []
    assert plain["header_graphic_url"] is None
    assert len(list(tmp_path.iterdir())) == files_before - 3


def test_backup_rejects_invalid_design_rows(client, monkeypatch, tmp_path):
    from zipfile import ZipFile

    event_id = build_flyer_event(client, tmp_path, monkeypatch)
    backup = client.get(f"/api/backups/events/{event_id}").content

    def replaced(name, old, new):
        output = BytesIO()
        with ZipFile(BytesIO(backup)) as source, ZipFile(output, "w") as target:
            for item in source.namelist():
                data = source.read(item)
                target.writestr(item, data.replace(old, new) if item == name else data)
        return output.getvalue()

    for content in (
        replaced("events.csv", b"#1D488B", b"navy"),
        replaced("events.csv", b"https://rdf2027.ecta.de/", b"javascript:x"),
        replaced("info_blocks.csv", b"Sprache", b" "),
        replaced("partner_logos.csv", b"Butterflies", b""),
    ):
        response = client.post("/api/backups/preview", files={"backup": ("b.zip", content, "application/zip")})
        assert response.status_code == 400, response.text
