from datetime import date as Date
from datetime import time as Time

from pydantic import BaseModel, ConfigDict


class EventDayCreate(BaseModel):
    event_id: int
    date: Date
    start_time: Time
    end_time: Time


class EventDayUpdate(BaseModel):
    date: Date | None = None
    start_time: Time | None = None
    end_time: Time | None = None


class EventDayResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    event_id: int
    date: Date
    start_time: Time
    end_time: Time
