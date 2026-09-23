from datetime import date, time

from pydantic import BaseModel, ConfigDict


class SpeakerCreate(BaseModel):
    name: str
    bio: str | None = None
    website: str | None = None


class SpeakerUpdate(BaseModel):
    name: str | None = None
    bio: str | None = None
    website: str | None = None


class SpeakerSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str


class SpeakerResponse(SpeakerSummary):
    event_id: int
    bio: str | None
    website: str | None
    photo_url: str | None


class SpeakerSession(BaseModel):
    id: int
    day_id: int
    date: date
    room_id: int
    room_name: str
    topic: str
    start_time: time
    end_time: time


class SpeakerDetail(SpeakerResponse):
    sessions: list[SpeakerSession]
