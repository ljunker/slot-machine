from datetime import date, time

from pydantic import BaseModel

from app.schemas.slot import SlotResponse


class ScheduleRoom(BaseModel):
    id: int
    name: str
    sort_order: int

    slots: list[SlotResponse]


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
    collisions: list[CollisionPair]
    speaker_conflicts: list[SpeakerConflict]
