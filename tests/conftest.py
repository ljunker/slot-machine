import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

import app.models
from app.db.base import Base
from app.db.database import get_db
from app.main import app
from app.models.auth import User
from app.services.auth import password_hash


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    with Session(engine, expire_on_commit=False) as session:
        yield session
    engine.dispose()


@pytest.fixture
def client(db):
    def override_db():
        yield db

    app.dependency_overrides[get_db] = override_db
    try:
        db.add(User(name="Testadmin", email="test@example.invalid", password_hash=password_hash("Testpassword123!"), is_superadmin=True))
        db.commit()
        test_client = TestClient(app)
        login = test_client.post("/api/auth/login", json={"email": "test@example.invalid", "password": "Testpassword123!"})
        assert login.status_code == 200, login.text
        test_client.headers.update({"X-CSRF-Token": login.json()["csrf_token"]})
        yield test_client
    finally:
        app.dependency_overrides.clear()


def make_account(db, event_id, name, role="helper"):
    from uuid import uuid4

    from app.models.auth import EventMembership
    user = User(name=name, email=f"{uuid4().hex}@example.invalid", password_hash=password_hash("Testpassword123!"))
    db.add(user)
    db.flush()
    db.add(EventMembership(event_id=event_id, user_id=user.id, role=role))
    db.commit()
    return {"id": user.id, "name": user.name, "email": user.email, "is_active": user.is_active}


def legacy_archive(content, version):
    import csv
    from io import BytesIO, StringIO
    from zipfile import ZipFile

    from app.services.backup_service import FORMAT_VERSION
    old_helpers = version in {"1", "2", "3", "4"}
    output = BytesIO()
    with ZipFile(BytesIO(content)) as source, ZipFile(output, "w") as target:
        for filename in source.namelist():
            if (old_helpers and filename == "duty_assignments.csv") or (version in {"1", "2"} and filename in {"categories.csv", "slot_categories.csv"}):
                continue
            data = source.read(filename)
            if filename == "manifest.csv":
                data = data.replace(FORMAT_VERSION.encode() + b",", version.encode() + b",", 1)
            omit = set()
            if filename == "duties.csv" and old_helpers:
                omit.add("capacity")
                if version == "1":
                    omit.add("sort_order")
            if filename == "slots.csv":
                omit.add("speaker_required")
                if version in {"1", "2", "3"}:
                    omit.add("scope")
            if omit:
                rows = list(csv.reader(StringIO(data.decode())))
                indices = [i for i, key in enumerate(rows[0]) if key not in omit]
                text = StringIO(newline="")
                csv.writer(text).writerows([row[i] for i in indices] for row in rows)
                data = text.getvalue().encode()
            target.writestr(filename, data)
        if old_helpers:
            target.writestr("helpers.csv", "id,event_id,name,normalized_name\r\n")
            target.writestr("duty_helpers.csv", "duty_id,helper_id\r\n")
    return output.getvalue()
