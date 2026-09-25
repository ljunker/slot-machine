def setup_event(client, name="Test"):
    event = client.post(
        "/api/events",
        json={"name": name, "start_date": "2026-10-01", "end_date": "2026-10-01"},
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
    room = client.post(
        "/api/rooms", json={"event_id": event["id"], "name": "Saal A"}
    ).json()
    return event, day, room


def helper(client, event_id, name):
    response = client.post(f"/api/events/{event_id}/helpers", json={"name": name})
    assert response.status_code == 201
    return response.json()


def duty(client, event_id, **data):
    response = client.post(f"/api/events/{event_id}/duties", json=data)
    assert response.status_code == 201, response.text
    return response.json()


def test_open_and_multiple_helpers_and_validation(client):
    event, day, room = setup_event(client)
    ada = helper(client, event["id"], "Ada")
    ben = helper(client, event["id"], "Ben")
    assert (
        client.post(
            f"/api/events/{event['id']}/helpers", json={"name": " ada "}
        ).status_code
        == 409
    )
    other, _, _ = setup_event(client, "Andere Veranstaltung")
    stranger = helper(client, other["id"], "Chris")
    common = {
        "kind": "room",
        "day_id": day["id"],
        "room_id": room["id"],
        "start_time": "10:00",
        "end_time": "12:00",
        "title": "Einlass",
    }
    open_duty = duty(client, event["id"], **common, helper_ids=[])
    assert open_duty["helper_ids"] == []
    assert open_duty["status"] == "active"
    assert client.get(f"/api/duties/{open_duty['id']}").json()["id"] == open_duty["id"]
    response = client.patch(
        f"/api/duties/{open_duty['id']}", json={"helper_ids": [ada["id"], ben["id"]]}
    )
    assert response.status_code == 200
    assert response.json()["helper_ids"] == [ada["id"], ben["id"]]
    assert (
        client.post(
            f"/api/events/{event['id']}/duties",
            json={**common, "helper_ids": [ada["id"], ada["id"]]},
        ).status_code
        == 400
    )
    assert (
        client.post(
            f"/api/events/{event['id']}/duties",
            json={**common, "helper_ids": [stranger["id"]]},
        ).status_code
        == 400
    )
    assert (
        client.post(
            f"/api/events/{event['id']}/duties", json={**common, "end_time": "19:00"}
        ).status_code
        == 400
    )
    assert (
        client.get(f"/api/events/{event['id']}/helper-plan").json()["duties"][0][
            "helpers"
        ][0]["name"]
        == "Ada"
    )
    assert client.get(f"/api/schedule/days/{day['id']}").json().get("duties") is None


def test_conflicts_are_per_helper_and_covered_duties_are_allowed(client):
    event, day, room_a = setup_event(client)
    room_b = client.post(
        "/api/rooms", json={"event_id": event["id"], "name": "Saal B"}
    ).json()
    ada = helper(client, event["id"], "Ada")
    ben = helper(client, event["id"], "Ben")
    common = {"day_id": day["id"], "helper_ids": [ada["id"]]}
    general = duty(
        client,
        event["id"],
        kind="general",
        start_time="09:00",
        end_time="17:00",
        **common,
    )
    room = duty(
        client,
        event["id"],
        kind="room",
        room_id=room_a["id"],
        start_time="10:00",
        end_time="12:00",
        **common,
    )
    slot = client.post(
        "/api/slots",
        json={
            "event_id": event["id"],
            "day_id": day["id"],
            "room_id": room_a["id"],
            "topic": "Vortrag",
            "start_time": "10:30",
            "end_time": "11:30",
        },
    ).json()
    session = duty(
        client,
        event["id"],
        kind="session",
        slot_id=slot["id"],
        helper_ids=[ada["id"], ben["id"]],
    )
    assert (
        client.get(f"/api/events/{event['id']}/helper-plan").json()["conflicts"] == []
    )
    other = duty(
        client,
        event["id"],
        kind="room",
        room_id=room_b["id"],
        start_time="10:15",
        end_time="11:15",
        **common,
    )
    conflicts = client.get(f"/api/events/{event['id']}/helper-plan").json()["conflicts"]
    assert {(pair["first_duty_id"], pair["second_duty_id"]) for pair in conflicts} == {
        (room["id"], other["id"]),
        (session["id"], other["id"]),
    }
    assert all(pair["helper_ids"] == [ada["id"]] for pair in conflicts)
    assert general["id"] not in {pair["first_duty_id"] for pair in conflicts}


def test_session_duty_follows_slot_and_survives_inactive_states(client):
    event, day, room_a = setup_event(client)
    room_b = client.post(
        "/api/rooms", json={"event_id": event["id"], "name": "Saal B"}
    ).json()
    ada = helper(client, event["id"], "Ada")
    slot = client.post(
        "/api/slots",
        json={
            "event_id": event["id"],
            "day_id": day["id"],
            "room_id": room_a["id"],
            "topic": "Vortrag",
            "start_time": "10:00",
            "end_time": "11:00",
        },
    ).json()
    session = duty(
        client, event["id"], kind="session", slot_id=slot["id"], helper_ids=[ada["id"]]
    )
    client.patch(
        f"/api/slots/{slot['id']}",
        json={"room_id": room_b["id"], "start_time": "12:00", "end_time": "13:00"},
    )
    current = client.get(f"/api/events/{event['id']}/helper-plan").json()["duties"][0]
    assert (current["room_id"], current["start_time"]) == (room_b["id"], "12:00:00")
    client.patch(f"/api/slots/{slot['id']}", json={"is_cancelled": True})
    assert (
        client.get(f"/api/events/{event['id']}/helper-plan").json()["duties"][0][
            "status"
        ]
        == "cancelled"
    )
    client.patch(
        f"/api/slots/{slot['id']}",
        json={"day_id": None, "room_id": None, "start_time": None, "end_time": None},
    )
    assert (
        client.get(f"/api/events/{event['id']}/helper-plan").json()["duties"][0][
            "status"
        ]
        == "unplanned"
    )
    client.delete(f"/api/slots/{slot['id']}")
    assert client.get(f"/api/events/{event['id']}/helper-plan").json()["duties"] == []
    assert session["id"] is not None


def test_room_and_helper_deletion_preserve_open_duty(client):
    event, day, room = setup_event(client)
    ada = helper(client, event["id"], "Ada")
    entry = duty(
        client,
        event["id"],
        kind="room",
        room_id=room["id"],
        day_id=day["id"],
        start_time="10:00",
        end_time="11:00",
        helper_ids=[ada["id"]],
    )
    client.delete(f"/api/rooms/{room['id']}")
    updated = client.get(f"/api/events/{event['id']}/helper-plan").json()["duties"][0]
    assert updated["id"] == entry["id"]
    assert updated["kind"] == "general" and updated["room_id"] is None
    client.delete(f"/api/helpers/{ada['id']}")
    assert (
        client.get(f"/api/events/{event['id']}/helper-plan").json()["duties"][0][
            "helper_ids"
        ]
        == []
    )
    assert (
        client.patch(f"/api/days/{day['id']}", json={"start_time": "10:30"}).status_code
        == 409
    )
    client.delete(f"/api/events/{event['id']}")
    assert client.get(f"/api/events/{event['id']}/helper-plan").status_code == 404


def test_day_deletion_removes_timed_duties_but_keeps_session_duty(client):
    event, day, room = setup_event(client)
    timed = duty(
        client,
        event["id"],
        kind="general",
        day_id=day["id"],
        start_time="10:00",
        end_time="11:00",
    )
    slot = client.post(
        "/api/slots",
        json={
            "event_id": event["id"],
            "day_id": day["id"],
            "room_id": room["id"],
            "topic": "Vortrag",
            "start_time": "10:00",
            "end_time": "11:00",
        },
    ).json()
    linked = duty(client, event["id"], kind="session", slot_id=slot["id"])
    assert client.delete(f"/api/days/{day['id']}").status_code == 204
    remaining = client.get(f"/api/events/{event['id']}/helper-plan").json()["duties"]
    assert len(remaining) == 1
    assert remaining[0]["id"] == linked["id"]
    assert remaining[0]["status"] == "unplanned"
    assert remaining[0]["id"] != timed["id"]


def test_helpers_are_absent_from_program_pdf(client):
    from io import BytesIO

    from pypdf import PdfReader

    event, day, room = setup_event(client)
    person = helper(client, event["id"], "Geheime Helferin")
    duty(
        client,
        event["id"],
        kind="room",
        day_id=day["id"],
        room_id=room["id"],
        start_time="10:00",
        end_time="11:00",
        helper_ids=[person["id"]],
        title="Einlass",
    )
    client.post(
        "/api/slots",
        json={
            "event_id": event["id"],
            "day_id": day["id"],
            "room_id": room["id"],
            "topic": "Vortrag",
            "start_time": "10:00",
            "end_time": "11:00",
        },
    )
    response = client.get(f"/api/events/{event['id']}/program.pdf")
    assert response.status_code == 200
    text = "\n".join(
        page.extract_text() for page in PdfReader(BytesIO(response.content)).pages
    )
    assert "Vortrag" in text
    assert "Geheime Helferin" not in text
    assert "Einlass" not in text
