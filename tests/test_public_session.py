def test_public_session_link_follows_changes_and_hides_unplanned(client):
    event = client.post('/api/events', json={
        'name': 'Konferenz', 'start_date': '2026-10-01', 'end_date': '2026-10-01',
    }).json()
    day = client.post(f"/api/events/{event['id']}/days", json={
        'event_id': event['id'], 'date': '2026-10-01',
        'start_time': '09:00', 'end_time': '18:00',
    }).json()
    room = client.post('/api/rooms', json={'event_id': event['id'], 'name': 'Saal A'}).json()
    slot = client.post('/api/slots', json={
        'day_id': day['id'], 'room_id': room['id'], 'topic': 'Vortrag',
        'description': 'Beschreibung', 'start_time': '10:00', 'end_time': '11:00',
    }).json()
    path = f"/api/events/{event['id']}/sessions/{slot['id']}"

    response = client.get(path)
    assert response.status_code == 200
    assert response.json()['date'] == '2026-10-01'
    assert response.json()['room_name'] == 'Saal A'
    assert response.json()['description'] == 'Beschreibung'

    client.patch(f"/api/slots/{slot['id']}", json={
        'start_time': '12:00', 'end_time': '13:00', 'is_cancelled': True,
    })
    changed = client.get(path).json()
    assert changed['start_time'] == '12:00:00'
    assert changed['is_cancelled'] is True
    assert changed['change_notice']['type'] == 'cancelled'

    other = client.post('/api/events', json={
        'name': 'Andere', 'start_date': '2026-10-01', 'end_date': '2026-10-01',
    }).json()
    assert client.get(f"/api/events/{other['id']}/sessions/{slot['id']}").status_code == 404
    assert client.get(f"/api/events/{event['id']}/sessions/999999").status_code == 404

    client.patch(f"/api/slots/{slot['id']}", json={
        'day_id': None, 'room_id': None, 'start_time': None, 'end_time': None,
    })
    assert client.get(path).status_code == 404
    client.delete(f"/api/slots/{slot['id']}")
    assert client.get(path).status_code == 404
