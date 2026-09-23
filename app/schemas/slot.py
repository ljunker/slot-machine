from datetime import time

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.speaker import SpeakerSummary


class SlotBase(BaseModel):
    model_config = ConfigDict(extra="forbid")

    topic: str
    speaker_ids: list[int] = Field(default_factory=list)
    description: str | None = None

    start_time: time
    end_time: time

    room_id: int


class SlotCreate(SlotBase):
    day_id: int


class SlotUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    topic: str | None = None
    speaker_ids: list[int] | None = None
    description: str | None = None

    start_time: time | None = None
    end_time: time | None = None

    room_id: int | None = None


class SlotResponse(SlotBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    day_id: int
    speakers: list[SpeakerSummary]
