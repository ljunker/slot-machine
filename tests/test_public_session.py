from fastapi.testclient import TestClient


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


def _public_event(client, topic='Vortrag; Teil 1, mit Gästen'):
    event = client.post('/api/events', json={
        'name': 'Konferenz <2026>', 'start_date': '2026-10-01', 'end_date': '2026-10-01',
    }).json()
    day = client.post(f"/api/events/{event['id']}/days", json={
        'event_id': event['id'], 'date': '2026-10-01',
        'start_time': '09:00', 'end_time': '18:00',
    }).json()
    room = client.post('/api/rooms', json={'event_id': event['id'], 'name': 'Saal A'}).json()
    speaker = client.post(f"/api/events/{event['id']}/speakers", json={
        'name': 'Ada', 'bio': 'Pionierin', 'website': 'https://ada.example',
    }).json()
    slot = client.post('/api/slots', json={
        'day_id': day['id'], 'room_id': room['id'], 'topic': topic,
        'description': 'Zeile eins\nZeile zwei', 'start_time': '10:00', 'end_time': '11:30',
        'speaker_ids': [speaker['id']],
    }).json()
    return event, day, speaker, slot


def _png():
    from io import BytesIO

    from PIL import Image

    buffer = BytesIO()
    Image.new('RGB', (2, 2), 'red').save(buffer, format='PNG')
    return buffer.getvalue()


def test_public_responses_include_speaker_profiles(client, monkeypatch, tmp_path):
    monkeypatch.setenv('SPEAKER_UPLOAD_DIR', str(tmp_path))
    event, day, speaker, slot = _public_event(client)
    photo = _png()
    client.post(f"/api/speakers/{speaker['id']}/photo", files={'photo': ('p.png', photo, 'image/png')})
    expected = {
        'id': speaker['id'], 'name': 'Ada', 'bio': 'Pionierin', 'website': 'https://ada.example',
        'photo_url': f"/api/public/speakers/{speaker['id']}/photo",
    }

    session = client.get(f"/api/events/{event['id']}/sessions/{slot['id']}").json()
    assert session['speakers'] == [expected]
    schedule = client.get(f"/api/public/events/{event['id']}/days/{day['id']}/schedule").json()
    assert schedule['rooms'][0]['slots'][0]['speakers'] == [expected]

    anonymous = TestClient(client.app)
    assert anonymous.get(expected['photo_url']).content == photo

    client.patch(f"/api/slots/{slot['id']}", json={
        'day_id': None, 'room_id': None, 'start_time': None, 'end_time': None,
    })
    assert anonymous.get(expected['photo_url']).status_code == 404
    assert anonymous.get('/api/public/speakers/999999/photo').status_code == 404


def test_session_calendar_export(client):
    event, _, _, slot = _public_event(client)
    response = client.get(f"/api/events/{event['id']}/sessions/{slot['id']}.ics")
    assert response.status_code == 200
    assert response.headers['content-type'].startswith('text/calendar')
    assert 'attachment' in response.headers['content-disposition']
    body = response.text
    assert body.startswith('BEGIN:VCALENDAR\r\n') and body.endswith('END:VCALENDAR\r\n')
    unfolded = body.replace('\r\n ', '')
    assert 'DTSTART:20261001T100000\r\n' in unfolded
    assert 'DTEND:20261001T113000\r\n' in unfolded
    assert 'SUMMARY:Vortrag\; Teil 1\\, mit Gästen\r\n' in unfolded
    assert 'Redner: Ada\\nZeile eins\\nZeile zwei\\n' in unfolded
    assert f"URL:http://testserver/programm/{event['id']}/sessions/{slot['id']}" in unfolded
    assert 'STATUS:CONFIRMED' in unfolded
    assert all(len(line.encode()) <= 75 for line in body.split('\r\n'))

    client.patch(f"/api/slots/{slot['id']}", json={'is_cancelled': True})
    assert 'STATUS:CANCELLED' in client.get(f"/api/events/{event['id']}/sessions/{slot['id']}.ics").text
    assert client.get(f"/api/events/{event['id']}/sessions/999999.ics").status_code == 404


def test_page_meta_for_link_previews(client):
    event, _, _, slot = _public_event(client, topic='Workshop "Kunst" & mehr')
    headers = {'x-forwarded-proto': 'https', 'host': 'programm.example'}

    session = client.get(f"/api/public/meta/programm/{event['id']}/sessions/{slot['id']}", headers=headers)
    assert session.status_code == 200
    assert '<title>Workshop &quot;Kunst&quot; &amp; mehr · Konferenz &lt;2026&gt;</title>' in session.text
    assert '1. Oktober 2026, 10:00–11:30 Uhr, Saal A · mit Ada. Zeile eins Zeile zwei' in session.text
    assert f'og:url" content="https://programm.example/programm/{event["id"]}/sessions/{slot["id"]}"' in session.text

    program = client.get(f"/api/public/meta/programm/{event['id']}", headers=headers).text
    assert '<title>Programm · Konferenz &lt;2026&gt;</title>' in program
    assert 'og:description" content="1. Oktober 2026"' in program
    assert 'og:image' not in program

    assert '<title>Event Scheduler</title>' in client.get('/api/public/meta/').text
    assert '<title>Event Scheduler</title>' in client.get('/api/public/meta/programm/999999').text
    missing = client.get(f"/api/public/meta/programm/{event['id']}/sessions/999999").text
    assert '<title>Programm · Konferenz &lt;2026&gt;</title>' in missing
