from collections import defaultdict

from sqlalchemy.orm import Session

from app.models.slot import Slot
from app.repositories.room_repository import RoomRepository
from app.repositories.slot_repository import SlotRepository
from app.schemas.schedule import (
    CollisionPair,
    DaySchedule,
    ScheduleRoom,
    SpeakerConflict,
)
from app.schemas.slot import SlotResponse
from app.services.event_day_service import EventDayService


class ScheduleService:
    def __init__(self, db: Session):
        self.db = db
        self.slot_repository = SlotRepository(db)
        self.room_repository = RoomRepository(db)
        self.days = EventDayService(db)

    def get_day_schedule(
        self,
        day_id: int,
    ) -> DaySchedule:
        day = self.days.get(day_id)

        rooms = self.room_repository.get_for_event(day.event_id)

        slots = self.slot_repository.get_for_day(day_id)

        slots_by_room: dict[int, list[Slot]] = defaultdict(list)

        for slot in slots:
            slots_by_room[slot.room_id].append(slot)

        schedule_rooms = [
            ScheduleRoom(
                id=room.id,
                name=room.name,
                sort_order=room.sort_order,
                slots=[
                    SlotResponse.model_validate(slot) for slot in slots_by_room[room.id]
                ],
            )
            for room in rooms
        ]

        schedule_rooms.sort(key=lambda room: (room.sort_order, room.id))

        return DaySchedule(
            day_id=day.id,
            date=day.date,
            start_time=day.start_time,
            end_time=day.end_time,
            rooms=schedule_rooms,
            collisions=[
                CollisionPair(first_slot_id=first.id, second_slot_id=second.id)
                for first, second in self.check_collisions(day_id)
            ],
            speaker_conflicts=self.check_speaker_conflicts(slots),
        )

    def check_speaker_conflicts(self, slots: list[Slot]) -> list[SpeakerConflict]:
        conflicts = []
        ordered = sorted(
            (slot for slot in slots if not slot.is_cancelled),
            key=lambda slot: (slot.start_time, slot.id),
        )
        for index, first in enumerate(ordered):
            first_ids = set(first.speaker_ids)
            if not first_ids:
                continue
            for second in ordered[index + 1 :]:
                if second.start_time >= first.end_time:
                    break
                if first.room_id == second.room_id:
                    continue
                shared = sorted(first_ids.intersection(second.speaker_ids))
                if shared:
                    conflicts.append(
                        SpeakerConflict(
                            first_slot_id=first.id,
                            second_slot_id=second.id,
                            speaker_ids=shared,
                        )
                    )
        return conflicts

    def check_collisions(
        self,
        day_id: int,
    ):
        self.days.get(day_id)

        slots = self.slot_repository.get_for_day(day_id)

        slots_by_room: dict[int, list[Slot]] = defaultdict(list)

        for slot in slots:
            if slot.is_cancelled:
                continue
            slots_by_room[slot.room_id].append(slot)

        collisions: list[tuple[Slot, Slot]] = []

        for room_slots in slots_by_room.values():
            room_slots.sort(key=lambda slot: slot.start_time)

            for index, slot in enumerate(room_slots):
                for other_slot in room_slots[index + 1 :]:
                    if other_slot.start_time >= slot.end_time:
                        break

                    if self._slots_overlap(
                        slot,
                        other_slot,
                    ):
                        collisions.append((slot, other_slot))

        return collisions

    @staticmethod
    def _slots_overlap(
        first: Slot,
        second: Slot,
    ) -> bool:
        return first.start_time < second.end_time and first.end_time > second.start_time
