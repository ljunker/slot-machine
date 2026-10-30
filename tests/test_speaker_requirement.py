import csv
from io import BytesIO, StringIO
from zipfile import ZipFile

import pytest
from conftest import legacy_archive, make_account
from sqlalchemy import create_engine, text

from app.db.migrate_speaker_requirement import migrate_speaker_requirement


@pytest.fixture
def program(client):
    event = client.post('/api/events', json={
        'name': 'Dashboard', 'start_date': '2026-10-01', 'end_date': '2026-10-02',
    }).json()['id']
    day = client.post(f'/api/events/{event}/days', json={
        'event_id': event, 'date': '2026-10-01', 'start_time': '09:00', 'end_time': '18:00',
    }).json()['id']
    room = client.post('/api/rooms', json={'event_id': event, 'name': 'Saal'}).json()['id']
    return event, day, room


def test_internal_requirement_preserves_public_program_and_speakers(client, program):
    event, day, room = program
    speaker = client.post(f'/api/events/{event}/speakers', json={'name': 'Ada'}).json()['id']
    slot = client.post('/api/slots', json={
        'day_id': day, 'room_id': room, 'topic': 'Vortrag', 'start_time': '10:00',
        'end_time': '11:00', 'speaker_ids': [speaker],
    }).json()
    assert slot['speaker_required'] is True
    path = f"/api/slots/{slot['id']}"
    public_path = f"/api/events/{event}/sessions/{slot['id']}"
    public_before = client.get(public_path).json()
    assert 'speaker_required' not in public_before
    changed = client.patch(path, json={'speaker_required': False}).json()
    assert changed['speaker_required'] is False
    assert changed['speaker_ids'] == [speaker]
    assert changed['change_notice'] is None
    assert client.get(public_path).json() == public_before
    assert client.patch(path, json={'description': 'Text'}).json()['speaker_required'] is False
    assert client.patch(path, json={'speaker_required': None}).status_code == 400
    internal = client.get(f'/api/schedule/days/{day}').json()['rooms'][0]['slots'][0]
    public = client.get(f'/api/public/events/{event}/days/{day}/schedule').json()['rooms'][0]['slots'][0]
    assert internal['speaker_required'] is False
    assert 'speaker_required' not in public


def test_unplanned_sessions_allow_missing_speakers_and_optional_requirement(client, program):
    event, _, _ = program
    default = client.post('/api/slots', json={'event_id': event, 'topic': 'Offen'})
    optional = client.post('/api/slots', json={
        'event_id': event, 'topic': 'Pause', 'scope': 'all_rooms', 'speaker_required': False,
    })
    assert default.status_code == optional.status_code == 201
    assert default.json()['speaker_required'] is True
    backlog = client.get(f'/api/events/{event}/unplanned-sessions').json()
    assert {slot['topic']: slot['speaker_required'] for slot in backlog} == {'Offen': True, 'Pause': False}
    assert client.post('/api/slots', json={
        'event_id': event, 'topic': 'Ungültig', 'speaker_required': None,
    }).status_code == 422


@pytest.mark.parametrize('version', ['1', '2', '3', '4', '5', '6'])
def test_backup_requirement_and_legacy_assignments(client, db, program, version):
    event, day, room = program
    slot = client.post('/api/slots', json={
        'day_id': day, 'room_id': room, 'topic': 'Pause', 'start_time': '10:00',
        'end_time': '11:00', 'speaker_required': False,
    }).json()
    helper = make_account(db, event, 'Bo')
    duty = client.post(f'/api/events/{event}/duties', json={
        'kind': 'session', 'slot_id': slot['id'], 'capacity': 3, 'user_ids': [helper['id']],
    }).json()
    backup = client.get(f'/api/backups/events/{event}').content
    with ZipFile(BytesIO(backup)) as archive:
        assert archive.read('manifest.csv').splitlines()[1].startswith(b'6,')
        rows = list(csv.DictReader(StringIO(archive.read('slots.csv').decode())))
        assert rows[0]['speaker_required'] == 'false'
    if version != '6':
        backup = legacy_archive(backup, version)
    restored = client.post('/api/backups/restore', data={'target_event_id': str(event)},
                           files={'backup': ('backup.zip', backup, 'application/zip')})
    assert restored.status_code == 200, restored.text
    internal = client.get(f'/api/schedule/days/{day}').json()['rooms'][0]['slots'][0]
    assert internal['speaker_required'] is (version != '6')
    restored_duty = client.get(f"/api/duties/{duty['id']}").json()
    assert restored_duty['capacity'] == (3 if version in {'5', '6'} else 1)
    assert restored_duty['user_ids'] == ([helper['id']] if version in {'5', '6'} else [])


def test_requirement_migration_defaults_preserves_values_and_is_idempotent():
    engine = create_engine('sqlite://')
    with engine.begin() as connection:
        connection.execute(text('CREATE TABLE slots (id INTEGER PRIMARY KEY, topic TEXT)'))
        connection.execute(text("INSERT INTO slots VALUES (7, 'Pause')"))
    migrate_speaker_requirement(engine)
    with engine.begin() as connection:
        assert connection.execute(text('SELECT id, topic, speaker_required FROM slots')).one() == (7, 'Pause', 1)
        connection.execute(text('UPDATE slots SET speaker_required=FALSE WHERE id=7'))
    migrate_speaker_requirement(engine)
    with engine.connect() as connection:
        assert connection.scalar(text('SELECT speaker_required FROM slots')) == 0
    engine.dispose()
