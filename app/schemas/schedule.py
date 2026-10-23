from datetime import date, time

from pydantic import BaseModel, Field

from app.schemas.slot import PlannedSlotResponse


class ScheduleRoom(BaseModel):
    id: int
    name: str
    sort_order: int

    slots: list[PlannedSlotResponse]


class CollisionPair(BaseModel):
    first_slot_id: int
    second_slot_id: int


class SpeakerConflict(CollisionPair):
    speaker_ids: list[int]


class DaySchedule(BaseModel):
    day_id: int
    date: date

    start_time: time
    end_time: time

    rooms: list[ScheduleRoom]
    shared_slots: list[PlannedSlotResponse] = Field(default_factory=list)
    collisions: list[CollisionPair]
    speaker_conflicts: list[SpeakerConflict]
