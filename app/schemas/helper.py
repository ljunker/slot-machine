from datetime import date, time
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class HelperCreate(BaseModel):
    name: str


class HelperUpdate(BaseModel):
    name: str | None = None


class HelperResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    event_id: int
    name: str


class DutyCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["general", "room", "session"]
    title: str | None = None
    helper_ids: list[int] = Field(default_factory=list)
    day_id: int | None = None
    room_id: int | None = None
    slot_id: int | None = None
    start_time: time | None = None
    end_time: time | None = None


class DutyUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["general", "room", "session"] | None = None
    title: str | None = None
    helper_ids: list[int] | None = None
    day_id: int | None = None
    room_id: int | None = None
    slot_id: int | None = None
    start_time: time | None = None
    end_time: time | None = None


class DutyResponse(BaseModel):
    id: int
    event_id: int
    kind: Literal["general", "room", "session"]
    title: str | None
    helper_ids: list[int]
    helpers: list[HelperResponse]
    day_id: int | None
    date: date | None
    room_id: int | None
    slot_id: int | None
    session_topic: str | None
    start_time: time | None
    end_time: time | None
    status: Literal["active", "unplanned", "cancelled"]


class DutyConflict(BaseModel):
    first_duty_id: int
    second_duty_id: int
    helper_ids: list[int]


class HelperPlan(BaseModel):
    duties: list[DutyResponse]
    conflicts: list[DutyConflict]
