from fastapi.testclient import TestClient

from app.main import app
from tests.conftest import make_account


def post(client, url, **body):
    response = client.post(url, json=body)
    assert response.status_code == 201, response.text
    return response.json()


def festival(client):
    event = post(
        client, "/api/events", name="ECTA Round Dance Festival", start_date="2027-05-21", end_date="2027-05-23",
        program_eyebrow="PROGRAMM", program_subtitle="21.–23.05.2027 · HAMBURG", website_url="https://rdf2027.ecta.de/",
    )
    event_id = event["id"]
    saturday = post(client, f"/api/events/{event_id}/days", event_id=event_id, date="2027-05-22",
                    start_time="11:00", end_time="21:00")
    friday = post(client, f"/api/events/{event_id}/days", event_id=event_id, date="2027-05-21",
                  start_time="14:00", end_time="22:00")
    saal_b = post(client, "/api/rooms", event_id=event_id, name="Saal B · Ph V–VI")
    saal_a = post(client, "/api/rooms", event_id=event_id, name="Saal A · Ph III–IV")
    ordered = client.patch(f"/api/events/{event_id}/rooms/order", json={"room_ids": [saal_a["id"], saal_b["id"]]})
    assert ordered.status_code == 200, ordered.text
    teach = post(client, f"/api/events/{event_id}/categories", name="Teach", color="#167B7B")
    zoe = post(client, f"/api/events/{event_id}/speakers", name="Zoë Beispiel", bio="Deutschland · Butterflies\nMehr")
    anna = post(client, f"/api/events/{event_id}/speakers", name="anna Muster", website="https://example.org")
    post(client, f"/api/events/{event_id}/speakers", name="Nicht eingeplant")
    post(client, f"/api/events/{event_id}/info-blocks", title="Phasen", body="Phase II bis VI")
    post(client, f"/api/events/{event_id}/partner-logos", name="Butterflies", subtitle="Round Dance Club")

    def slot(**body):
        return post(client, "/api/slots", event_id=event_id, **body)

    teach_b = slot(day_id=friday["id"], room_id=saal_b["id"], topic="Teach Rumba", start_time="15:00",
                   end_time="16:15", speaker_ids=[zoe["id"]], category_ids=[teach["id"]])
    teach_a = slot(day_id=friday["id"], room_id=saal_a["id"], topic="Teach Waltz", description="Waltz",
                   start_time="15:00", end_time="16:15", speaker_ids=[anna["id"]])
    welcome = slot(day_id=friday["id"], scope="all_rooms", topic="Einlass", description="Foyer",
                   start_time="14:00", end_time="15:00")
    cancelled = slot(day_id=saturday["id"], room_id=saal_a["id"], topic="Review", start_time="11:00", end_time="12:00")
    client.patch(f"/api/slots/{cancelled['id']}", json={"is_cancelled": True})
    slot(topic="Noch offen", speaker_ids=[])
    return {
        "event": event, "friday": friday, "saal_a": saal_a, "saal_b": saal_b, "teach": teach,
        "zoe": zoe, "anna": anna, "teach_a": teach_a, "teach_b": teach_b, "welcome": welcome, "cancelled": cancelled,
    }


def test_program_export_contains_the_planned_program(client):
    data = festival(client)
    event_id = data["event"]["id"]

    response = client.get(f"/api/events/{event_id}/program.json")
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/json"
    assert response.headers["content-disposition"] == f'attachment; filename="programm-{event_id}.json"'
    assert response.headers["cache-control"] == "no-store"
    program = response.json()

    assert program["format"] == "slot-machine-programm"
    assert program["version"] == 1
    assert program["exported_at"]
    assert program["event"] == {
        "id": event_id, "name": "ECTA Round Dance Festival", "start_date": "2027-05-21", "end_date": "2027-05-23",
        "eyebrow": "PROGRAMM", "subtitle": "21.–23.05.2027 · HAMBURG", "website_url": "https://rdf2027.ecta.de/",
    }
    assert [room["name"] for room in program["rooms"]] == ["Saal A · Ph III–IV", "Saal B · Ph V–VI"]
    assert program["categories"] == [{"id": data["teach"]["id"], "name": "Teach", "color": "#167B7B"}]
    assert program["speakers"] == [
        {"id": data["anna"]["id"], "name": "anna Muster", "bio": None, "website": "https://example.org"},
        {"id": data["zoe"]["id"], "name": "Zoë Beispiel", "bio": "Deutschland · Butterflies\nMehr", "website": None},
    ]
    assert program["info_blocks"] == [{"title": "Phasen", "body": "Phase II bis VI"}]
    assert program["partners"] == [{"name": "Butterflies", "subtitle": "Round Dance Club", "url": None}]

    friday, saturday = program["days"]
    assert (friday["date"], friday["weekday"], friday["start_time"], friday["end_time"]) == (
        "2027-05-21", "Freitag", "14:00", "22:00"
    )
    assert saturday["weekday"] == "Samstag"
    assert [slot["id"] for slot in friday["slots"]] == [
        data["welcome"]["id"], data["teach_a"]["id"], data["teach_b"]["id"]
    ]
    assert friday["slots"][0] == {
        "id": data["welcome"]["id"], "start_time": "14:00", "end_time": "15:00", "scope": "all_rooms",
        "room_id": None, "topic": "Einlass", "description": "Foyer", "speaker_ids": [], "category_ids": [],
        "is_cancelled": False,
    }
    assert friday["slots"][2]["speaker_ids"] == [data["zoe"]["id"]]
    assert friday["slots"][2]["category_ids"] == [data["teach"]["id"]]
    assert saturday["slots"] == [{
        "id": data["cancelled"]["id"], "start_time": "11:00", "end_time": "12:00", "scope": "room",
        "room_id": data["saal_a"]["id"], "topic": "Review", "description": None, "speaker_ids": [],
        "category_ids": [], "is_cancelled": True,
    }]
    topics = [slot["topic"] for day in program["days"] for slot in day["slots"]]
    assert "Noch offen" not in topics


def test_program_export_without_days_is_empty(client):
    event = post(client, "/api/events", name="Leer", start_date="2027-01-01", end_date="2027-01-01")
    program = client.get(f"/api/events/{event['id']}/program.json").json()
    assert program["days"] == [] and program["rooms"] == [] and program["speakers"] == []
    assert program["event"]["subtitle"] is None


def test_program_export_is_only_for_the_planning_team(client, db):
    event = post(client, "/api/events", name="Fest", start_date="2027-01-01", end_date="2027-01-01")
    other = post(client, "/api/events", name="Anderes", start_date="2027-01-01", end_date="2027-01-01")
    url = f"/api/events/{event['id']}/program.json"

    assert TestClient(app).get(url).status_code == 401
    assert client.get("/api/events/999999/program.json").status_code == 404

    helper = make_account(db, event["id"], "Hilfe", "helper")
    person = TestClient(app)
    login = person.post("/api/auth/login", json={"email": helper["email"], "password": "Testpassword123!"})
    assert login.status_code == 200
    assert person.get(url).status_code == 200
    assert person.get(f"/api/events/{other['id']}/program.json").status_code == 404
