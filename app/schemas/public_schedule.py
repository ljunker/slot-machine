from datetime import date, time

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.slot import PublicSlotResponse


class PublicScheduleRoom(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    slots: list[PublicSlotResponse]


class PublicDaySchedule(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    day_id: int
    date: date
    start_time: time
    end_time: time
    rooms: list[PublicScheduleRoom]
    shared_slots: list[PublicSlotResponse] = Field(default_factory=list)
