from datetime import date

from pydantic import BaseModel, ConfigDict


class EventCreate(BaseModel):
    name: str
    start_date: date
    end_date: date
    accent_color: str | None = None


class EventUpdate(BaseModel):
    name: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    accent_color: str | None = None


class EventResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    start_date: date
    end_date: date
    accent_color: str | None
    logo_url: str | None
