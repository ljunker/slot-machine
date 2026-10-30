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


def helper(db, event_id, name):
    from conftest import make_account
    return make_account(db, event_id, name)


def duty(client, event_id, **data):
    data.setdefault("capacity", max(1, len(data.get("user_ids", []))))
    response = client.post(f"/api/events/{event_id}/duties", json=data)
    assert response.status_code == 201, response.text
    return response.json()


def test_reorder_duties_within_one_column(client, db):
    event, day, room_a = setup_event(client)
    room_b = client.post(
        "/api/rooms", json={"event_id": event["id"], "name": "Saal B"}
    ).json()
    general = [
        duty(
            client,
            event["id"],
            kind="general",
            title=title,
            day_id=day["id"],
            start_time="15:00",
            end_time="17:00",
        )
        for title in ("Getränke", "Parkeinweisung", "Registration")
    ]
    room_duty = duty(
        client,
        event["id"],
        kind="room",
        title="Einlass",
        day_id=day["id"],
        room_id=room_a["id"],
        start_time="15:00",
        end_time="17:00",
    )
    slot = client.post(
        "/api/slots",
        json={
            "event_id": event["id"],
            "day_id": day["id"],
            "room_id": room_a["id"],
            "topic": "Vortrag",
            "start_time": "15:00",
            "end_time": "17:00",
        },
    ).json()
    session = duty(
        client, event["id"], kind="session", slot_id=slot["id"]
    )
    other_room = duty(
        client,
        event["id"],
        kind="room",
        day_id=day["id"],
        room_id=room_b["id"],
        start_time="15:00",
        end_time="17:00",
    )
    endpoint = f"/api/events/{event['id']}/duties/order"
    general_ids = [item["id"] for item in general]
    desired = [general_ids[1], general_ids[2], general_ids[0]]
    response = client.patch(
        endpoint,
        json={"day_id": day["id"], "room_id": None, "duty_ids": desired},
    )
    assert response.status_code == 200, response.text
    assert [item["sort_order"] for item in response.json()] == [0, 1, 2]
    assert [client.get(f"/api/duties/{duty_id}").json()["sort_order"] for duty_id in desired] == [0, 1, 2]
    assert [client.get(f"/api/duties/{duty_id}").json()["start_time"] for duty_id in desired] == ["15:00:00"] * 3

    room_ids = [room_duty["id"], session["id"]]
    response = client.patch(
        endpoint,
        json={"day_id": day["id"], "room_id": room_a["id"], "duty_ids": room_ids[::-1]},
    )
    assert response.status_code == 200, response.text
    assert [item["sort_order"] for item in response.json()] == [0, 1]
    scheduled_slot = next(
        item
        for room in client.get(f"/api/schedule/days/{day['id']}").json()["rooms"]
        for item in room["slots"]
        if item["id"] == slot["id"]
    )
    assert scheduled_slot["room_id"] == room_a["id"]
    assert scheduled_slot["start_time"] == "15:00:00"

    invalid = [
        {"day_id": day["id"], "room_id": None, "duty_ids": desired[:-1]},
        {"day_id": day["id"], "room_id": None, "duty_ids": [desired[0]] * 3},
        {"day_id": day["id"], "room_id": None, "duty_ids": [*desired[:-1], other_room["id"]]},
        {"day_id": day["id"], "room_id": room_b["id"], "duty_ids": room_ids},
    ]
    for body in invalid:
        assert client.patch(endpoint, json=body).status_code == 400
    assert [client.get(f"/api/duties/{duty_id}").json()["sort_order"] for duty_id in desired] == [0, 1, 2]
    assert client.get(f"/api/duties/{other_room['id']}").json()["sort_order"] == other_room["sort_order"]


def test_open_and_multiple_helpers_and_validation(client, db):
    event, day, room = setup_event(client)
    ada = helper(db, event["id"], "Ada")
    ben = helper(db, event["id"], "Ben")
    # Freie Profile existieren nicht mehr; Konten dürfen denselben Namen haben.
    assert client.post(f"/api/events/{event['id']}/helpers", json={"name": " ada "}).status_code == 404
    assert helper(db, event["id"], "Ada")["id"] != ada["id"]
    other, _, _ = setup_event(client, "Andere Veranstaltung")
    stranger = helper(db, other["id"], "Chris")
    common = {
        "kind": "room",
        "day_id": day["id"],
        "room_id": room["id"],
        "start_time": "10:00",
        "end_time": "12:00",
        "title": "Einlass",
    }
    open_duty = duty(client, event["id"], **common, user_ids=[])
    assert open_duty["user_ids"] == []
    assert open_duty["status"] == "active"
    assert client.get(f"/api/duties/{open_duty['id']}").json()["id"] == open_duty["id"]
    response = client.patch(
        f"/api/duties/{open_duty['id']}", json={"capacity": 2, "user_ids": [ada["id"], ben["id"]]}
    )
    assert response.status_code == 200
    assert response.json()["user_ids"] == [ada["id"], ben["id"]]
    assert (
        client.post(
            f"/api/events/{event['id']}/duties",
            json={**common, "user_ids": [ada["id"], ada["id"]]},
        ).status_code
        == 400
    )
    assert (
        client.post(
            f"/api/events/{event['id']}/duties",
            json={**common, "user_ids": [stranger["id"]]},
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
            "users"
        ][0]["name"]
        == "Ada"
    )
    assert client.get(f"/api/schedule/days/{day['id']}").json().get("duties") is None


def test_general_duties_conflict_but_room_duties_cover_sessions(client, db):
    event, day, room_a = setup_event(client)
    room_b = client.post(
        "/api/rooms", json={"event_id": event["id"], "name": "Saal B"}
    ).json()
    ada = helper(db, event["id"], "Ada")
    ben = helper(db, event["id"], "Ben")
    common = {"day_id": day["id"], "user_ids": [ada["id"]]}
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
        user_ids=[ada["id"], ben["id"]],
    )
    conflicts = client.get(f"/api/events/{event['id']}/helper-plan").json()["conflicts"]
    assert {(pair["first_duty_id"], pair["second_duty_id"]) for pair in conflicts} == {
        (general["id"], room["id"]),
        (general["id"], session["id"]),
    }
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
        (general["id"], room["id"]),
        (general["id"], session["id"]),
        (general["id"], other["id"]),
        (room["id"], other["id"]),
        (session["id"], other["id"]),
    }
    assert all(pair["user_ids"] == [ada["id"]] for pair in conflicts)


def test_two_helpers_have_separate_conflicts_with_general_duty(client, db):
    event, day, room_a = setup_event(client)
    room_b = client.post(
        "/api/rooms", json={"event_id": event["id"], "name": "Saal B"}
    ).json()
    helper_2 = helper(db, event["id"], "Helfer 2")
    helper_4 = helper(db, event["id"], "Helfer 4")
    general = duty(
        client,
        event["id"],
        kind="general",
        title="Getränke",
        day_id=day["id"],
        start_time="15:00",
        end_time="17:00",
        user_ids=[helper_2["id"], helper_4["id"]],
    )
    room_duties = [
        duty(
            client,
            event["id"],
            kind="room",
            title="Caller-Betreuung",
            day_id=day["id"],
            room_id=room["id"],
            start_time="16:00",
            end_time="17:00",
            user_ids=[person["id"]],
        )
        for room, person in ((room_a, helper_2), (room_b, helper_4))
    ]
    duty(
        client,
        event["id"],
        kind="room",
        day_id=day["id"],
        room_id=room_a["id"],
        start_time="17:00",
        end_time="18:00",
        user_ids=[helper_2["id"]],
    )

    conflicts = client.get(f"/api/events/{event['id']}/helper-plan").json()["conflicts"]
    assert conflicts == [
        {
            "first_duty_id": general["id"],
            "second_duty_id": room_duties[0]["id"],
            "user_ids": [helper_2["id"]],
        },
        {
            "first_duty_id": general["id"],
            "second_duty_id": room_duties[1]["id"],
            "user_ids": [helper_4["id"]],
        },
    ]


def test_session_duty_follows_slot_and_survives_inactive_states(client, db):
    event, day, room_a = setup_event(client)
    room_b = client.post(
        "/api/rooms", json={"event_id": event["id"], "name": "Saal B"}
    ).json()
    ada = helper(db, event["id"], "Ada")
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
        client, event["id"], kind="session", slot_id=slot["id"], user_ids=[ada["id"]]
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


def test_room_and_helper_deletion_preserve_open_duty(client, db):
    event, day, room = setup_event(client)
    ada = helper(db, event["id"], "Ada")
    entry = duty(
        client,
        event["id"],
        kind="room",
        room_id=room["id"],
        day_id=day["id"],
        start_time="10:00",
        end_time="11:00",
        user_ids=[ada["id"]],
    )
    client.delete(f"/api/rooms/{room['id']}")
    updated = client.get(f"/api/events/{event['id']}/helper-plan").json()["duties"][0]
    assert updated["id"] == entry["id"]
    assert updated["kind"] == "general" and updated["room_id"] is None
    client.delete(f"/api/events/{event['id']}/members/{ada['id']}")
    assert (
        client.get(f"/api/events/{event['id']}/helper-plan").json()["duties"][0][
            "user_ids"
        ]
        == []
    )
    assert (
        client.patch(f"/api/days/{day['id']}", json={"start_time": "10:30"}).status_code
        == 409
    )
    client.delete(f"/api/events/{event['id']}")
    assert client.get(f"/api/events/{event['id']}/helper-plan").status_code == 404


def test_day_deletion_removes_timed_duties_but_keeps_session_duty(client, db):
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


def test_helpers_are_absent_from_program_pdf(client, db):
    from io import BytesIO

    from pypdf import PdfReader

    event, day, room = setup_event(client)
    person = helper(db, event["id"], "Geheime Helferin")
    duty(
        client,
        event["id"],
        kind="room",
        day_id=day["id"],
        room_id=room["id"],
        start_time="10:00",
        end_time="11:00",
        user_ids=[person["id"]],
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
