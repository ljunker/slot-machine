from datetime import time
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.speaker import SpeakerSummary


class SlotBase(BaseModel):
    model_config = ConfigDict(extra="forbid")

    topic: str
    speaker_ids: list[int] = Field(default_factory=list)
    description: str | None = None

    day_id: int | None = None
    room_id: int | None = None
    start_time: time | None = None
    end_time: time | None = None


class SlotCreate(SlotBase):
    event_id: int | None = None


class SlotUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    topic: str | None = None
    speaker_ids: list[int] | None = None
    description: str | None = None

    start_time: time | None = None
    end_time: time | None = None

    day_id: int | None = None
    room_id: int | None = None
    is_cancelled: bool | None = None


class ChangeNotice(BaseModel):
    type: Literal["rescheduled", "updated", "cancelled"]
    # Unix time in seconds; null for permanent cancellation notices.
    expires_at: int | None = None
    previous_start_time: time | None = None
    previous_end_time: time | None = None
    previous_room_name: str | None = None


class SlotResponse(SlotBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    event_id: int
    speakers: list[SpeakerSummary]
    is_cancelled: bool = False
    change_notice: ChangeNotice | None = None


class PlannedSlotResponse(SlotResponse):
    day_id: int
    room_id: int
    start_time: time
    end_time: time
