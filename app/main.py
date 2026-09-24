from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

# Models importieren, damit SQLAlchemy sie kennt.
import app.models
from app.api.routes import (
    event_days,
    events,
    rooms,
    schedule,
    slots,
    speakers,
)
from app.db.base import Base
from app.db.database import engine
from app.db.migrate_slot_changes import migrate_slot_changes
from app.db.migrate_speakers import migrate_legacy_speakers
from app.db.migrate_unplanned_sessions import migrate_unplanned_sessions
from app.services.errors import DomainError


@asynccontextmanager
async def lifespan(application: FastAPI):
    Base.metadata.create_all(bind=engine)
    migrate_slot_changes(engine)
    migrate_legacy_speakers(engine)
    migrate_unplanned_sessions(engine)
    yield


app = FastAPI(
    title="Event Scheduler",
    version="0.1.0",
    lifespan=lifespan,
)


@app.exception_handler(DomainError)
def domain_error_handler(request: Request, error: DomainError):
    return JSONResponse(
        status_code=error.status_code, content={"detail": error.message}
    )


@app.get("/api/health")
def health():
    return {
        "status": "ok",
    }


app.include_router(
    events.router,
    prefix="/api",
)

app.include_router(event_days.router, prefix="/api")

app.include_router(
    rooms.router,
    prefix="/api",
)

app.include_router(
    slots.router,
    prefix="/api",
)

app.include_router(
    schedule.router,
    prefix="/api",
)

app.include_router(speakers.router, prefix="/api")
