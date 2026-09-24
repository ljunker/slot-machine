from datetime import time
from io import BytesIO

from pypdf import PdfReader

from app.schemas.slot import SlotResponse
from app.services.program_pdf import _slot_lanes


def event(client):
    response = client.post(
        "/api/events",
        json={
            "name": "Bühnen-Tag",
            "start_date": "2026-10-01",
            "end_date": "2026-10-02",
        },
    )
    assert response.status_code == 201
    return response.json()


def day(client, event_id, date):
    response = client.post(
        f"/api/events/{event_id}/days",
        json={
            "event_id": event_id,
            "date": date,
            "start_time": "09:00",
            "end_time": "18:00",
        },
    )
    assert response.status_code == 201
    return response.json()


def room(client, event_id, name):
    response = client.post("/api/rooms", json={"event_id": event_id, "name": name})
    assert response.status_code == 201
    return response.json()


def slot(client, day_id, room_id, topic, start, end, speaker_ids=None):
    response = client.post(
        "/api/slots",
        json={
            "day_id": day_id,
            "room_id": room_id,
            "topic": topic,
            "start_time": start,
            "end_time": end,
            "speaker_ids": speaker_ids or [],
        },
    )
    assert response.status_code == 201
    return response.json()


def test_pdf_errors_and_download_headers(client):
    assert client.get("/api/events/999999/program.pdf").status_code == 404
    created = event(client)
    assert client.get(f"/api/events/{created['id']}/program.pdf").status_code == 409
    day(client, created["id"], "2026-10-01")

    response = client.get(f"/api/events/{created['id']}/program.pdf")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert (
        response.headers["content-disposition"]
        == f'attachment; filename="programm-{created["id"]}.pdf"'
    )
    assert response.headers["cache-control"] == "no-store"
    assert response.content.startswith(b"%PDF-")
    assert len(PdfReader(BytesIO(response.content)).pages) == 1


def test_pdf_days_rooms_speakers_and_fresh_data(client):
    created = event(client)
    second = day(client, created["id"], "2026-10-02")
    first = day(client, created["id"], "2026-10-01")
    small = room(client, created["id"], "Kleiner Saal")
    large = room(client, created["id"], "Großer Saal")
    response = client.patch(
        f"/api/events/{created['id']}/rooms/order",
        json={"room_ids": [large["id"], small["id"]]},
    )
    assert response.status_code == 200
    speaker = client.post(
        f"/api/events/{created['id']}/speakers", json={"name": "Jörg Müller"}
    ).json()
    first_slot = slot(
        client, first["id"], large["id"], "Eröffnung", "10:00", "11:00", [speaker["id"]]
    )
    slot(client, first["id"], small["id"], "Parallelvortrag", "10:30", "11:30")
    slot(client, second["id"], large["id"], "Abschluss", "16:00", "17:00")

    url = f"/api/events/{created['id']}/program.pdf"
    first_pdf = PdfReader(BytesIO(client.get(url).content))
    assert len(first_pdf.pages) == 2
    first_text = first_pdf.pages[0].extract_text()
    second_text = first_pdf.pages[1].extract_text()
    assert "Bühnen-Tag" in first_text
    assert "01.10.2026" in first_text
    assert first_text.index("Großer Saal") < first_text.index("Kleiner Saal")
    assert "Eröffnung" in first_text
    assert "Jörg Müller" in first_text
    assert "Abschluss" not in first_text
    assert "02.10.2026" in second_text
    assert "Abschluss" in second_text

    response = client.patch(
        f"/api/slots/{first_slot['id']}", json={"topic": "Neuer Titel"}
    )
    assert response.status_code == 200
    updated = PdfReader(BytesIO(client.get(url).content)).pages[0].extract_text()
    assert "Neuer Titel" in updated
    assert "Geändert" in updated
    assert "Eröffnung" not in updated


def test_overlapping_slots_use_distinct_lanes():
    def item(identifier, start, end):
        return SlotResponse(
            id=identifier,
            day_id=1,
            room_id=1,
            topic=str(identifier),
            speaker_ids=[],
            speakers=[],
            start_time=time.fromisoformat(start),
            end_time=time.fromisoformat(end),
        )

    layout = _slot_lanes(
        [
            item(1, "10:00", "11:00"),
            item(2, "10:30", "11:30"),
            item(3, "11:30", "12:00"),
        ]
    )
    assert [(entry.id, lane, lanes) for entry, lane, lanes in layout] == [
        (1, 0, 2),
        (2, 1, 2),
        (3, 0, 1),
    ]


def test_pdf_shows_speaker_names_in_short_slots(client):
    created = event(client)
    selected_day = day(client, created["id"], "2026-10-01")
    selected_room = room(client, created["id"], "Saal")
    speaker = client.post(
        f"/api/events/{created['id']}/speakers", json={"name": "Jörg Müller"}
    ).json()
    second_speaker = client.post(
        f"/api/events/{created['id']}/speakers", json={"name": "Ada Lovelace"}
    ).json()
    slot(
        client,
        selected_day["id"],
        selected_room["id"],
        "Halbstündiger Vortrag",
        "10:00",
        "10:30",
        [speaker["id"], second_speaker["id"]],
    )
    slot(
        client,
        selected_day["id"],
        selected_room["id"],
        "Kurzvortrag",
        "11:00",
        "11:15",
        [speaker["id"]],
    )

    response = client.get(f"/api/events/{created['id']}/program.pdf")
    text = PdfReader(BytesIO(response.content)).pages[0].extract_text()
    assert text.count("Jörg Müller") == 2
    assert "Ada Lovelace" in text
    assert "Halbstündiger Vortrag" in text
    assert "Kurzvortrag" in text


def test_pdf_marks_rescheduled_and_cancelled_slots(client):
    created = event(client)
    selected_day = day(client, created["id"], "2026-10-01")
    first = room(client, created["id"], "Saal A")
    second = room(client, created["id"], "Saal B")
    moved = slot(client, selected_day["id"], first["id"], "Workshop", "10:00", "11:00")
    cancelled = slot(client, selected_day["id"], first["id"], "Pause", "12:00", "13:00")
    client.patch(
        f"/api/slots/{moved['id']}",
        json={"room_id": second["id"], "start_time": "11:00", "end_time": "12:00"},
    )
    client.patch(f"/api/slots/{cancelled['id']}", json={"is_cancelled": True})
    pdf = PdfReader(
        BytesIO(client.get(f"/api/events/{created['id']}/program.pdf").content)
    )
    text = pdf.pages[0].extract_text()
    assert "Verschoben" in text
    assert "Vorher: 10:00-11:00, Saal A" in text
    assert "Abgesagt" in text
