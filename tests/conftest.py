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
        db.add(User(email="test@example.invalid", password_hash=password_hash("Testpassword123!"), is_superadmin=True))
        db.commit()
        test_client = TestClient(app)
        login = test_client.post("/api/auth/login", json={"email": "test@example.invalid", "password": "Testpassword123!"})
        assert login.status_code == 200, login.text
        test_client.headers.update({"X-CSRF-Token": login.json()["csrf_token"]})
        yield test_client
    finally:
        app.dependency_overrides.clear()
