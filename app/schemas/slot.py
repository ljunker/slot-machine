from datetime import time

from pydantic import BaseModel, ConfigDict


class SlotBase(BaseModel):
    topic: str
    speaker: str | None = None
    description: str | None = None

    start_time: time
    end_time: time

    room_id: int


class SlotCreate(SlotBase):
    day_id: int


class SlotUpdate(BaseModel):
    topic: str | None = None
    speaker: str | None = None
    description: str | None = None

    start_time: time | None = None
    end_time: time | None = None

    room_id: int | None = None


class SlotResponse(SlotBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    day_id: int
