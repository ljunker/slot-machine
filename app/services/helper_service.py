from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.duty import Duty
from app.models.event import Event
from app.models.event_day import EventDay
from app.models.helper import Helper, duty_helpers
from app.models.room import Room
from app.models.slot import Slot
from app.schemas.helper import (
    DutyConflict,
    DutyCreate,
    DutyResponse,
    DutyUpdate,
    HelperCreate,
    HelperPlan,
    HelperResponse,
    HelperUpdate,
)
from app.services.errors import Conflict, DomainError, NotFound
from app.services.validation import name, required_patch, time_range


class HelperService:
    def __init__(self, db: Session):
        self.db = db

    def _event(self, event_id: int) -> None:
        if self.db.get(Event, event_id) is None:
            raise NotFound("Veranstaltung nicht gefunden")

    def get_helper(self, helper_id: int) -> Helper:
        helper = self.db.get(Helper, helper_id)
        if helper is None:
            raise NotFound("Helfer nicht gefunden")
        return helper

    def list_helpers(self, event_id: int) -> list[Helper]:
        self._event(event_id)
        return list(
            self.db.scalars(
                select(Helper)
                .where(Helper.event_id == event_id)
                .order_by(Helper.name, Helper.id)
            ).all()
        )

    def _helper_name(
        self, event_id: int, value: str, own_id: int | None = None
    ) -> tuple[str, str]:
        display = name(value)
        if len(display) > 255:
            raise DomainError("Helfername ist zu lang")
        normalized = display.casefold()
        other = self.db.scalar(
            select(Helper.id).where(
                Helper.event_id == event_id, Helper.normalized_name == normalized
            )
        )
        if other is not None and other != own_id:
            raise Conflict("Helfername existiert bereits")
        return display, normalized

    def create_helper(self, event_id: int, data: HelperCreate) -> Helper:
        self._event(event_id)
        display, normalized = self._helper_name(event_id, data.name)
        helper = Helper(event_id=event_id, name=display, normalized_name=normalized)
        self.db.add(helper)
        try:
            self.db.commit()
        except IntegrityError as error:
            self.db.rollback()
            raise Conflict("Helfername existiert bereits") from error
        return helper

    def update_helper(self, helper_id: int, data: HelperUpdate) -> Helper:
        helper = self.get_helper(helper_id)
        changes = data.model_dump(exclude_unset=True)
        required_patch(changes, {"name"})
        if "name" in changes:
            helper.name, helper.normalized_name = self._helper_name(
                helper.event_id, changes["name"], helper.id
            )
        try:
            self.db.commit()
        except IntegrityError as error:
            self.db.rollback()
            raise Conflict("Helfername existiert bereits") from error
        return helper

    def delete_helper(self, helper_id: int) -> None:
        helper = self.get_helper(helper_id)
        self.db.execute(
            delete(duty_helpers).where(duty_helpers.c.helper_id == helper_id)
        )
        self.db.delete(helper)
        self.db.commit()
        self.db.expire_all()

    def get_duty(self, duty_id: int) -> Duty:
        duty = self.db.get(Duty, duty_id)
        if duty is None:
            raise NotFound("Dienst nicht gefunden")
        return duty

    def get_duty_response(self, duty_id: int) -> DutyResponse:
        return self._response(self.get_duty(duty_id))

    def _helpers(self, event_id: int, helper_ids: list[int] | None) -> list[Helper]:
        if helper_ids is None:
            raise DomainError("Helferliste darf nicht null sein")
        if len(helper_ids) != len(set(helper_ids)):
            raise DomainError("Helfer dürfen nur einmal zugeordnet werden")
        if not helper_ids:
            return []
        helpers = list(
            self.db.scalars(select(Helper).where(Helper.id.in_(helper_ids))).all()
        )
        if len(helpers) != len(helper_ids) or any(
            helper.event_id != event_id for helper in helpers
        ):
            raise DomainError("Helfer gehören nicht zur Veranstaltung")
        by_id = {helper.id: helper for helper in helpers}
        return [by_id[helper_id] for helper_id in helper_ids]

    def _validated(self, event_id: int, values: dict) -> dict:
        kind = values["kind"]
        title = values["title"]
        if title is not None:
            title = title.strip() or None
            if title is not None and len(title) > 255:
                raise DomainError("Diensttitel ist zu lang")
        values["title"] = title
        day_id, room_id, slot_id = (
            values["day_id"],
            values["room_id"],
            values["slot_id"],
        )
        start, end = values["start_time"], values["end_time"]
        if kind == "session":
            if slot_id is None or any(
                value is not None for value in (day_id, room_id, start, end)
            ):
                raise DomainError("Session-Dienst braucht nur eine Session")
            slot = self.db.get(Slot, slot_id)
            if slot is None:
                raise NotFound("Slot nicht gefunden")
            if slot.event_id != event_id:
                raise DomainError("Session gehört nicht zur Veranstaltung")
            return values
        if day_id is None or start is None or end is None or slot_id is not None:
            raise DomainError("Dienst braucht Veranstaltungstag, Beginn und Ende")
        if kind == "general" and room_id is not None:
            raise DomainError("Allgemeiner Dienst darf keinen Raum haben")
        if kind == "room" and room_id is None:
            raise DomainError("Raumdienst braucht einen Raum")
        day = self.db.get(EventDay, day_id)
        if day is None:
            raise NotFound("Veranstaltungstag nicht gefunden")
        if day.event_id != event_id:
            raise DomainError("Tag gehört nicht zur Veranstaltung")
        if room_id is not None:
            room = self.db.get(Room, room_id)
            if room is None:
                raise NotFound("Raum nicht gefunden")
            if room.event_id != event_id:
                raise DomainError("Raum gehört nicht zur Veranstaltung")
        time_range(start, end)
        if start < day.start_time or end > day.end_time:
            raise DomainError("Dienst liegt außerhalb der Tageszeiten")
        return values

    def _response(self, duty: Duty) -> DutyResponse:
        if duty.kind == "session":
            slot = self.db.get(Slot, duty.slot_id)
            day_id = slot.day_id
            day = self.db.get(EventDay, day_id) if day_id is not None else None
            status = (
                "unplanned"
                if day_id is None
                else "cancelled"
                if slot.is_cancelled
                else "active"
            )
            room_id = slot.room_id
            start = slot.start_time if status == "active" else None
            end = slot.end_time if status == "active" else None
            topic = slot.topic
        else:
            day_id = duty.day_id
            day = self.db.get(EventDay, day_id)
            status = "active"
            room_id = duty.room_id
            start, end = duty.start_time, duty.end_time
            topic = None
        return DutyResponse(
            id=duty.id,
            event_id=duty.event_id,
            kind=duty.kind,
            title=duty.title,
            helper_ids=[helper.id for helper in duty.helpers],
            helpers=[HelperResponse.model_validate(helper) for helper in duty.helpers],
            day_id=day_id,
            date=day.date if day else None,
            room_id=room_id,
            slot_id=duty.slot_id,
            session_topic=topic,
            start_time=start,
            end_time=end,
            status=status,
        )

    def create_duty(self, event_id: int, data: DutyCreate) -> DutyResponse:
        self._event(event_id)
        values = self._validated(event_id, data.model_dump(exclude={"helper_ids"}))
        helpers = self._helpers(event_id, data.helper_ids)
        duty = Duty(event_id=event_id, **values)
        duty.helpers = helpers
        self.db.add(duty)
        self.db.commit()
        return self._response(duty)

    def update_duty(self, duty_id: int, data: DutyUpdate) -> DutyResponse:
        duty = self.get_duty(duty_id)
        changes = data.model_dump(exclude_unset=True)
        required_patch(changes, {"kind", "helper_ids"})
        values = {
            key: getattr(duty, key)
            for key in (
                "kind",
                "title",
                "day_id",
                "room_id",
                "slot_id",
                "start_time",
                "end_time",
            )
        }
        values.update(
            {key: value for key, value in changes.items() if key != "helper_ids"}
        )
        values = self._validated(duty.event_id, values)
        helpers = (
            self._helpers(duty.event_id, changes["helper_ids"])
            if "helper_ids" in changes
            else None
        )
        for key, value in values.items():
            setattr(duty, key, value)
        if helpers is not None:
            duty.helpers = helpers
        self.db.commit()
        return self._response(duty)

    def delete_duty(self, duty_id: int) -> None:
        duty = self.get_duty(duty_id)
        self.db.execute(delete(duty_helpers).where(duty_helpers.c.duty_id == duty.id))
        self.db.delete(duty)
        self.db.commit()

    def get_plan(self, event_id: int) -> HelperPlan:
        self._event(event_id)
        duties = list(
            self.db.scalars(
                select(Duty).where(Duty.event_id == event_id).order_by(Duty.id)
            ).all()
        )
        responses = [self._response(duty) for duty in duties]
        conflicts: list[DutyConflict] = []
        for index, first in enumerate(responses):
            if first.status != "active" or not first.helper_ids:
                continue
            for second in responses[index + 1 :]:
                if second.status != "active" or first.day_id != second.day_id:
                    continue
                shared = sorted(set(first.helper_ids).intersection(second.helper_ids))
                if (
                    not shared
                    or first.start_time >= second.end_time
                    or second.start_time >= first.end_time
                ):
                    continue
                if self._covers(first, second) or self._covers(second, first):
                    continue
                conflicts.append(
                    DutyConflict(
                        first_duty_id=first.id,
                        second_duty_id=second.id,
                        helper_ids=shared,
                    )
                )
        return HelperPlan(duties=responses, conflicts=conflicts)

    @staticmethod
    def _covers(broad: DutyResponse, narrow: DutyResponse) -> bool:
        if broad.start_time > narrow.start_time or broad.end_time < narrow.end_time:
            return False
        return (
            broad.kind == "general"
            and narrow.kind != "general"
            and (
                broad.start_time < narrow.start_time or broad.end_time > narrow.end_time
            )
        ) or (
            broad.kind == "room"
            and narrow.kind == "session"
            and broad.room_id == narrow.room_id
        )
