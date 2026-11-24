from datetime import UTC, datetime, time

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.category import Category
from app.models.slot import Slot
from app.repositories.room_repository import RoomRepository
from app.repositories.slot_repository import SlotRepository
from app.schemas.program_export import (
    ExportCategory,
    ExportDay,
    ExportEvent,
    ExportInfoBlock,
    ExportPartner,
    ExportRoom,
    ExportSlot,
    ExportSpeaker,
    ProgramExport,
)
from app.services.event_day_service import EventDayService
from app.services.event_service import EventService

WEEKDAYS = ("Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag")


def _clock(value: time) -> str:
    return value.strftime("%H:%M")


def _slot(slot: Slot) -> ExportSlot:
    return ExportSlot(
        id=slot.id,
        start_time=_clock(slot.start_time),
        end_time=_clock(slot.end_time),
        scope=slot.scope,
        room_id=slot.room_id,
        topic=slot.topic,
        description=slot.description,
        speaker_ids=slot.speaker_ids,
        category_ids=slot.category_ids,
        is_cancelled=slot.is_cancelled,
    )


def build_program_export(db: Session, event_id: int) -> ProgramExport:
    event = EventService(db).get(event_id)
    rooms = RoomRepository(db).get_for_event(event_id)
    room_order = {room.id: (room.sort_order, room.id) for room in rooms}
    slots = SlotRepository(db)

    days = []
    speakers = {}
    for day in EventDayService(db).get_for_event(event_id):
        planned = sorted(
            slots.get_for_day(day.id),
            key=lambda slot: (slot.start_time, slot.scope != "all_rooms", room_order.get(slot.room_id, (0, 0)), slot.id),
        )
        for slot in planned:
            speakers.update({speaker.id: speaker for speaker in slot.speakers})
        days.append(ExportDay(
            date=day.date,
            weekday=WEEKDAYS[day.date.weekday()],
            start_time=_clock(day.start_time),
            end_time=_clock(day.end_time),
            slots=[_slot(slot) for slot in planned],
        ))

    categories = db.scalars(
        select(Category).where(Category.event_id == event_id).order_by(Category.id)
    ).all()
    return ProgramExport(
        exported_at=datetime.now(UTC).replace(microsecond=0),
        event=ExportEvent(
            id=event.id,
            name=event.name,
            start_date=event.start_date,
            end_date=event.end_date,
            eyebrow=event.program_eyebrow,
            subtitle=event.program_subtitle,
            website_url=event.website_url,
        ),
        rooms=[ExportRoom(id=room.id, name=room.name, sort_order=room.sort_order) for room in rooms],
        categories=[ExportCategory(id=item.id, name=item.name, color=item.color) for item in categories],
        speakers=[
            ExportSpeaker(id=speaker.id, name=speaker.name, bio=speaker.bio, website=speaker.website)
            for speaker in sorted(speakers.values(), key=lambda speaker: (speaker.name.casefold(), speaker.id))
        ],
        days=days,
        info_blocks=[ExportInfoBlock(title=block.title, body=block.body) for block in event.info_blocks],
        partners=[
            ExportPartner(name=partner.name, subtitle=partner.subtitle, url=partner.url)
            for partner in event.partner_logos
        ],
    )
