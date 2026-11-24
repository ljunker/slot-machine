from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel

PROGRAM_EXPORT_FORMAT = "slot-machine-programm"
PROGRAM_EXPORT_VERSION = 1


class ExportEvent(BaseModel):
    id: int
    name: str
    start_date: date
    end_date: date
    eyebrow: str | None
    subtitle: str | None
    website_url: str | None


class ExportRoom(BaseModel):
    id: int
    name: str
    sort_order: int


class ExportCategory(BaseModel):
    id: int
    name: str
    color: str


class ExportSpeaker(BaseModel):
    id: int
    name: str
    bio: str | None
    website: str | None


class ExportSlot(BaseModel):
    id: int
    start_time: str
    end_time: str
    scope: Literal["room", "all_rooms"]
    room_id: int | None
    topic: str
    description: str | None
    speaker_ids: list[int]
    category_ids: list[int]
    is_cancelled: bool


class ExportDay(BaseModel):
    date: date
    weekday: str
    start_time: str
    end_time: str
    slots: list[ExportSlot]


class ExportInfoBlock(BaseModel):
    title: str
    body: str


class ExportPartner(BaseModel):
    name: str
    subtitle: str | None
    url: str | None


class ProgramExport(BaseModel):
    format: Literal["slot-machine-programm"] = PROGRAM_EXPORT_FORMAT
    version: int = PROGRAM_EXPORT_VERSION
    exported_at: datetime
    event: ExportEvent
    rooms: list[ExportRoom]
    categories: list[ExportCategory]
    speakers: list[ExportSpeaker]
    days: list[ExportDay]
    info_blocks: list[ExportInfoBlock]
    partners: list[ExportPartner]
