import re
from concurrent.futures import ThreadPoolExecutor
from datetime import date, time
from threading import Barrier

import pytest
from conftest import legacy_archive, make_account
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, select, text
from sqlalchemy.orm import Session
from test_auth import login_as
from test_backups import alter_archive, upload
from test_helpers import setup_event

from app.db.base import Base
from app.db.migrate_helper_accounts import migrate_helper_accounts
from app.main import app
from app.models.auth import User
from app.models.duty import Duty
from app.models.event import Event
from app.models.event_day import EventDay
from app.models.helper import duty_users
from app.schemas.helper import DutyUpdate
from app.services.errors import Conflict
from app.services.helper_service import HelperService


def new_duty(client, event, day, **values):
    response = client.post(f"/api/events/{event}/duties", json={
        "kind": "general", "title": "Einlass", "day_id": day,
        "start_time": "10:00", "end_time": "12:00", **values,
    })
    assert response.status_code == 201, response.text
    return response.json()


def test_helper_invitation_name_and_existing_account(client, db, monkeypatch):
    event, _, _ = setup_event(client)
    sent = []
    monkeypatch.setattr("app.api.routes.auth.send_email", lambda to, subject, body: sent.append(body))
    path = f"/api/events/{event['id']}/members/invitations"
    assert client.post(path, json={"email": "help@example.invalid", "role": "helper"}).status_code == 204
    assert "Rolle „Helfer“" in sent[-1]
    token = re.search(r"/einladung/([^\s]+)", sent[-1]).group(1)
    person = TestClient(app)
    response = person.post("/api/auth/invitations/accept", json={"token": token, "password": "Testpassword123!"})
    assert response.status_code == 200
    assert response.json()["name"] is None
    assert response.json()["event_roles"][str(event["id"])] == "helper"
    person.headers["X-CSRF-Token"] = response.json()["csrf_token"]
    for name in [" ", "x" * 256]:
        assert person.patch("/api/auth/me", json={"name": name}).status_code == 422
    for extra in [{"is_superadmin": True}, {"id": 1}, {"email": "other@example.invalid"}]:
        assert person.patch("/api/auth/me", json={"name": "Ada", **extra}).status_code == 422
    assert person.patch("/api/auth/me", json={"name": "  Ada\n Müller  "}).json()["name"] == "Ada Müller"
    assert person.get("/api/auth/me").json()["name"] == "Ada Müller"
    assert person.get(f"/api/events/{event['id']}/members").status_code == 403
    assert person.post(path, json={"email": "next@example.invalid", "role": "helper"}).status_code == 403
    other, _, _ = setup_event(client, "Weitere Veranstaltung")
    assert client.post(f"/api/events/{other['id']}/members/invitations", json={"email": "help@example.invalid", "role": "helper"}).status_code == 204
    token = re.search(r"/einladung/([^\s]+)", sent[-1]).group(1)
    assert person.post("/api/auth/invitations/accept", json={"token": token}).status_code == 200
    assert len(person.get("/api/auth/me").json()["event_roles"]) == 2


def test_helper_read_access_and_all_planning_writes_denied(client, db):
    event, day, room = setup_event(client)
    account = make_account(db, event["id"], "Ada")
    person = login_as(account["email"])
    entry = new_duty(client, event["id"], day["id"])
    slot = client.post("/api/slots", json={"event_id": event["id"], "topic": "Session"}).json()
    speaker = client.post(f"/api/events/{event['id']}/speakers", json={"name": "Redner"}).json()
    category = client.post(f"/api/events/{event['id']}/categories", json={"name": "Kategorie", "color": "#123456"}).json()
    for path in [f"/events/{event['id']}/rooms", f"/events/{event['id']}/speakers",
                 f"/speakers/{speaker['id']}", f"/events/{event['id']}/categories",
                 f"/events/{event['id']}/unplanned-sessions", f"/schedule/days/{day['id']}",
                 f"/events/{event['id']}/helper-plan", f"/duties/{entry['id']}"]:
        assert person.get('/api' + path).status_code == 200, path
    writes = [
        ("PATCH", f"/events/{event['id']}", {"name": "Nein"}),
        ("POST", f"/events/{event['id']}/days", {"event_id": event['id'], "date": "2026-10-01", "start_time": "09:00", "end_time": "18:00"}),
        ("PATCH", f"/days/{day['id']}", {"start_time": "08:00"}),
        ("DELETE", f"/days/{day['id']}", None),
        ("POST", "/rooms", {"event_id": event['id'], "name": "Neu"}),
        ("PATCH", f"/rooms/{room['id']}", {"name": "Nein"}),
        ("DELETE", f"/rooms/{room['id']}", None),
        ("PATCH", f"/events/{event['id']}/rooms/order", {"room_ids": [room['id']]}),
        ("POST", "/slots", {"event_id": event['id'], "topic": "Nein"}),
        ("PATCH", f"/slots/{slot['id']}", {"topic": "Nein"}),
        ("DELETE", f"/slots/{slot['id']}", None),
        ("DELETE", f"/slots/{slot['id']}/rescheduled-notice", None),
        ("DELETE", f"/events/{event['id']}/change-notices", None),
        ("DELETE", f"/events/{event['id']}/rescheduled-notices", None),
        ("POST", f"/events/{event['id']}/speakers", {"name": "Nein"}),
        ("PATCH", f"/speakers/{speaker['id']}", {"name": "Nein"}),
        ("DELETE", f"/speakers/{speaker['id']}", None),
        ("DELETE", f"/speakers/{speaker['id']}/photo", None),
        ("POST", f"/events/{event['id']}/categories", {"name": "Nein", "color": "#123456"}),
        ("PATCH", f"/categories/{category['id']}", {"name": "Nein"}),
        ("DELETE", f"/categories/{category['id']}", None),
        ("POST", f"/events/{event['id']}/duties", {"kind": "session", "slot_id": slot['id']}),
        ("PATCH", f"/duties/{entry['id']}", {"user_ids": [account['id']]}),
        ("DELETE", f"/duties/{entry['id']}", None),
        ("PATCH", f"/events/{event['id']}/duties/order", {"day_id": day['id'], "room_id": None, "duty_ids": [entry['id']]}),
        ("PATCH", f"/events/{event['id']}/members/{account['id']}", {"role": "admin"}),
        ("DELETE", f"/events/{event['id']}/members/{account['id']}", None),
    ]
    for method, path, body in writes:
        response = person.request(method, '/api' + path, json=body)
        assert response.status_code == 403, (method, path, response.text)
    for path in [f"/api/events/{event['id']}/duty-participants", f"/api/backups/events/{event['id']}", "/api/users"]:
        assert person.get(path).status_code == 403
    assert person.post(f"/api/speakers/{speaker['id']}/photo", files={"photo": ("x.png", b"x")}).status_code == 403
    assert person.post(f"/api/events/{event['id']}/logo", files={"logo": ("x.png", b"x")}).status_code == 403
    foreign, foreign_day, _ = setup_event(client, "Fremd")
    foreign_duty = new_duty(client, foreign["id"], foreign_day["id"])
    for path in [f"/api/events/{foreign['id']}/helper-plan", f"/api/duties/{foreign_duty['id']}"]:
        assert person.get(path).status_code == 404
    assert person.put(f"/api/duties/{foreign_duty['id']}/signup").status_code == 404
    assert person.delete(f"/api/duties/{foreign_duty['id']}/signup").status_code == 404
    assert TestClient(app).put(f"/api/duties/{entry['id']}/signup").status_code == 401
    person.headers.pop("X-CSRF-Token")
    assert person.put(f"/api/duties/{entry['id']}/signup").status_code == 403


@pytest.mark.parametrize("role", ["helper", "editor", "admin", "superadmin"])
def test_each_role_can_signup_and_leave_idempotently(client, db, role):
    event, day, _ = setup_event(client)
    if role == "superadmin":
        person = client
        user_id = client.get("/api/auth/me").json()["id"]
    else:
        account = make_account(db, event["id"], "Ada", role)
        person, user_id = login_as(account["email"]), account["id"]
    entry = new_duty(client, event["id"], day["id"])
    path = f"/api/duties/{entry['id']}/signup"
    assert entry["capacity"] == 1
    for _ in range(2):
        response = person.put(path, json={"user_id": 99999})
        assert response.status_code == 200, response.text
        assert response.json()["user_ids"] == [user_id]
    for _ in range(2):
        assert person.delete(path).json()["user_ids"] == []


def test_capacity_conflicts_status_and_membership_lifecycle(client, db):
    event, day, room = setup_event(client)
    ada, ben = [make_account(db, event['id'], name) for name in ["Ada", "Ben"]]
    a, b = login_as(ada['email']), login_as(ben['email'])
    entry = new_duty(client, event['id'], day['id'])
    path = f"/api/duties/{entry['id']}/signup"
    assert a.put(path).status_code == 200
    assert b.put(path).status_code == 409
    assert client.patch(f"/api/duties/{entry['id']}", json={"user_ids": [ada['id'], ben['id']]}).status_code == 409
    assert client.patch(f"/api/duties/{entry['id']}", json={"capacity": 2, "user_ids": [ada['id'], ben['id']]}).status_code == 200
    assert client.patch(f"/api/duties/{entry['id']}", json={"capacity": 1}).status_code == 409
    for capacity in [0, -1, None, 1.5, True, "2", 2**31]:
        assert client.patch(f"/api/duties/{entry['id']}", json={"capacity": capacity}).status_code in {400, 422}
    overlap = new_duty(client, event['id'], day['id'])
    assert a.put(f"/api/duties/{overlap['id']}/signup").status_code == 200
    assert client.get(f"/api/events/{event['id']}/helper-plan").json()['conflicts'][0]['user_ids'] == [ada['id']]
    assert client.patch(f"/api/users/{ada['id']}", json={"is_active": False}).status_code == 200
    assert a.delete(path).status_code == 401
    assert ada['id'] in client.get(f"/api/duties/{entry['id']}").json()['user_ids']
    assert client.patch(f"/api/duties/{entry['id']}", json={"user_ids": [ada['id']]}).status_code == 200
    assert client.delete(f"/api/events/{event['id']}/members/{ada['id']}").status_code == 204
    assert client.get(f"/api/duties/{entry['id']}").json()['user_ids'] == []
    assert client.get(f"/api/duties/{overlap['id']}").json()['user_ids'] == []
    unnamed = make_account(db, event['id'], None)
    assert client.patch(f"/api/duties/{entry['id']}", json={"user_ids": [unnamed['id']]}).status_code == 400
    assert login_as(unnamed['email']).put(path).status_code == 400
    slot = client.post('/api/slots', json={"event_id": event['id'], "day_id": day['id'], "room_id": room['id'], "topic": "Session", "start_time": "10:00", "end_time": "11:00"}).json()
    linked = client.post(f"/api/events/{event['id']}/duties", json={"kind": "session", "slot_id": slot['id']}).json()
    linked_path = f"/api/duties/{linked['id']}/signup"
    assert b.put(linked_path).status_code == 200
    client.patch(f"/api/slots/{slot['id']}", json={"is_cancelled": True})
    assert b.delete(linked_path).status_code == 200
    assert b.put(linked_path).status_code == 409
    client.patch(f"/api/slots/{slot['id']}", json={"day_id": None, "room_id": None, "start_time": None, "end_time": None})
    assert b.put(linked_path).status_code == 409
    assert b.delete(linked_path).status_code == 200


def test_role_change_takes_effect_on_existing_session(client, db):
    event, day, _ = setup_event(client)
    account = make_account(db, event['id'], 'Ada', 'editor')
    person = login_as(account['email'])
    entry = new_duty(client, event['id'], day['id'])
    assert client.patch(f"/api/events/{event['id']}/members/{account['id']}", json={"role": "helper"}).status_code == 200
    assert person.patch(f"/api/duties/{entry['id']}", json={"title": "Nein"}).status_code == 403
    assert person.put(f"/api/duties/{entry['id']}/signup").status_code == 200


def test_last_place_is_atomic_with_independent_sqlite_connections(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'race.db'}", connect_args={"timeout": 10})
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        event = Event(name='Race', start_date=date(2026, 10, 1), end_date=date(2026, 10, 1))
        db.add(event); db.flush()
        day = EventDay(event_id=event.id, date=event.start_date, start_time=time(9), end_time=time(18))
        db.add(day); db.flush()
        ids = [make_account(db, event.id, name)['id'] for name in ['Ada', 'Ben']]
        entry = Duty(event_id=event.id, kind='general', day_id=day.id, start_time=time(10), end_time=time(11), capacity=1)
        db.add(entry); db.commit()
        duty_id = entry.id
    barrier = Barrier(2)
    def enter(user_id):
        with Session(engine, expire_on_commit=False) as db:
            user = db.get(User, user_id)
            barrier.wait(timeout=10)
            try:
                HelperService(db).signup(duty_id, user)
                return 200
            except Conflict:
                db.rollback()
                return 409
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(enter, ids)) == [200, 409]
    with Session(engine) as db:
        assert len(db.execute(select(duty_users)).all()) == 1
        with pytest.raises(Conflict):
            HelperService(db).update_duty(duty_id, DutyUpdate(user_ids=ids))
    engine.dispose()


def test_migration_discards_legacy_helpers_and_preserves_duties(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'legacy.db'}")
    with engine.begin() as connection:
        for statement in [
            'PRAGMA foreign_keys=ON',
            'CREATE TABLE users (id INTEGER PRIMARY KEY, email VARCHAR(320))',
            'CREATE TABLE duties (id INTEGER PRIMARY KEY, title TEXT)',
            'CREATE TABLE helpers (id INTEGER PRIMARY KEY, name TEXT)',
            'CREATE TABLE duty_helpers (duty_id INTEGER REFERENCES duties(id), helper_id INTEGER REFERENCES helpers(id))',
            "INSERT INTO users VALUES (1, 'ada@example.invalid')",
            "INSERT INTO duties VALUES (5, 'Technik')",
            "INSERT INTO helpers VALUES (7, 'Ada')",
            'INSERT INTO duty_helpers VALUES (5, 7)',
        ]:
            connection.execute(text(statement))
    migrate_helper_accounts(engine)
    migrate_helper_accounts(engine)
    with engine.connect() as connection:
        assert connection.execute(text('SELECT id, title, capacity FROM duties')).all() == [(5, 'Technik', 1)]
        assert connection.execute(text('SELECT name FROM users')).scalar() is None
        assert not {'helpers', 'duty_helpers'} & set(inspect(connection).get_table_names())
    engine.dispose()


def test_backup_account_matching_capacity_and_legacy_warning(client, db):
    event, day, _ = setup_event(client)
    account = make_account(db, event['id'], 'Ada')
    entry = new_duty(client, event['id'], day['id'], capacity=3, user_ids=[account['id']])
    content = client.get(f"/api/backups/events/{event['id']}").content
    assert upload(client, content, event['id']).json()['restored_assignments'] == 1
    restored = upload(client, content, event['id'], 'restore')
    assert restored.status_code == 200, restored.text
    assert client.get(f"/api/events/{event['id']}/helper-plan").json()['duties'][0]['capacity'] == 3
    new = upload(client, content, endpoint='restore')
    assert new.status_code == 200
    assert new.json()['skipped_assignments'] == 1 and new.json()['warnings']
    assert client.get(f"/api/events/{new.json()['event_id']}/helper-plan").json()['duties'][0]['user_ids'] == []
    legacy = alter_archive(legacy_archive(content, '4'), replace={
        'helpers.csv': f"id,event_id,name,normalized_name\r\n7,{event['id']},Alt,alt\r\n".encode(),
        'duty_helpers.csv': f"duty_id,helper_id\r\n{entry['id']},7\r\n".encode(),
    })
    preview = upload(client, legacy, event['id'])
    assert preview.status_code == 200, preview.text
    assert 'verworfen' in preview.json()['warnings'][0]
    assert upload(client, legacy, event['id'], 'restore').status_code == 200
    legacy_duty = client.get(f"/api/events/{event['id']}/helper-plan").json()['duties'][0]
    assert legacy_duty['capacity'] == 1 and legacy_duty['user_ids'] == []
