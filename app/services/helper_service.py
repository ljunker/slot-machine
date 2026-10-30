from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.orm import Session

from app.models.auth import EventMembership, User
from app.models.duty import Duty
from app.models.event import Event
from app.models.event_day import EventDay
from app.models.helper import duty_users
from app.models.room import Room
from app.models.slot import Slot
from app.schemas.helper import (
    DutyConflict,
    DutyCreate,
    DutyOrder,
    DutyResponse,
    DutyUpdate,
    DutyUser,
    HelperPlan,
)
from app.services.errors import Conflict, DomainError, NotFound
from app.services.validation import required_patch, time_range


class HelperService:
    def __init__(self, db: Session):
        self.db = db

    def _event(self, event_id: int) -> None:
        if self.db.get(Event, event_id) is None:
            raise NotFound("Veranstaltung nicht gefunden")

    def list_participants(self, event_id: int) -> list[User]:
        self._event(event_id)
        member = select(EventMembership.id).where(
            EventMembership.event_id == event_id, EventMembership.user_id == User.id
        ).exists()
        return list(self.db.scalars(select(User).where(
            User.is_active, User.name.is_not(None), or_(User.is_superadmin, member)
        ).order_by(User.name, User.email, User.id)))

    def _lock_duty(self, duty_id: int) -> Duty:
        # Ein UPDATE sperrt die Zeile auch unter SQLite, wo FOR UPDATE wirkungslos ist.
        result = self.db.execute(update(Duty).where(Duty.id == duty_id).values(
            capacity=Duty.capacity
        ).execution_options(synchronize_session=False))
        if result.rowcount != 1:
            raise NotFound("Dienst nicht gefunden")
        self.db.expire_all()
        return self.get_duty(duty_id)

    def get_duty(self, duty_id: int) -> Duty:
        duty = self.db.get(Duty, duty_id)
        if duty is None:
            raise NotFound("Dienst nicht gefunden")
        return duty

    def get_duty_response(self, duty_id: int) -> DutyResponse:
        return self._response(self.get_duty(duty_id))

    def _users(self, event_id: int, user_ids: list[int] | None, retained: set[int] | None = None) -> list[User]:
        if user_ids is None:
            raise DomainError("Helferliste darf nicht null sein")
        if len(user_ids) != len(set(user_ids)):
            raise DomainError("Helfer dürfen nur einmal zugeordnet werden")
        eligible = {user.id: user for user in self.list_participants(event_id)}
        # Gesperrte Konten bleiben belegbar, solange ihre bestehende Zuordnung erhalten wird.
        for user_id in retained or set():
            eligible[user_id] = self.db.get(User, user_id)
        if any(user_id not in eligible for user_id in user_ids):
            raise DomainError("Helfer brauchen ein aktives, benanntes Konto mit Veranstaltungszugriff")
        return [eligible[user_id] for user_id in user_ids]

    @staticmethod
    def _check_capacity(capacity: int, users: list[User]) -> None:
        if len(users) > capacity:
            raise Conflict("Höchstzahl der Helfer überschritten")

    def signup(self, duty_id: int, user: User, *, leave: bool = False) -> DutyResponse:
        duty = self._lock_duty(duty_id)
        # Rechte nach Erwerb der Schreibsperre erneut prüfen (paralleler Teamaustritt).
        from app.services.auth import authorize_event
        authorize_event(self.db, user, duty.event_id, "helper")
        if not user.is_active:
            raise DomainError("Konto ist gesperrt")
        assigned = any(person.id == user.id for person in duty.users)
        if leave:
            duty.users = [person for person in duty.users if person.id != user.id]
        elif not assigned:
            if not user.name:
                raise DomainError("Bitte zuerst einen Namen festlegen")
            if self._response(duty).status != "active":
                raise Conflict("Dieser Dienst ist nicht aktiv")
            self._check_capacity(duty.capacity, [*duty.users, user])
            duty.users.append(user)
        self.db.commit()
        return self._response(duty)

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
            user_ids=[helper.id for helper in duty.users],
            capacity=duty.capacity,
            users=[DutyUser.model_validate(user) for user in duty.users],
            day_id=day_id,
            date=day.date if day else None,
            room_id=room_id,
            slot_id=duty.slot_id,
            session_topic=topic,
            start_time=start,
            end_time=end,
            sort_order=duty.sort_order,
            status=status,
        )

    def create_duty(self, event_id: int, data: DutyCreate) -> DutyResponse:
        self._event(event_id)
        values = self._validated(event_id, data.model_dump(exclude={"user_ids"}))
        users = self._users(event_id, data.user_ids)
        self._check_capacity(data.capacity, users)
        sort_order = (
            self.db.scalar(select(func.max(Duty.sort_order)).where(Duty.event_id == event_id))
            or 0
        ) + 1
        duty = Duty(event_id=event_id, sort_order=sort_order, **values)
        duty.users = users
        self.db.add(duty)
        self.db.commit()
        return self._response(duty)

    def reorder_duties(self, event_id: int, data: DutyOrder) -> list[DutyResponse]:
        self._event(event_id)
        day = self.db.get(EventDay, data.day_id)
        if day is None or day.event_id != event_id:
            raise DomainError("Tag gehört nicht zur Veranstaltung")
        if data.room_id is not None:
            room = self.db.get(Room, data.room_id)
            if room is None or room.event_id != event_id:
                raise DomainError("Raum gehört nicht zur Veranstaltung")
        duties = list(self.db.scalars(select(Duty).where(Duty.event_id == event_id)))
        active = {
            duty.id: duty
            for duty in duties
            if (response := self._response(duty)).status == "active"
            and response.day_id == data.day_id
            and response.room_id == data.room_id
        }
        if len(data.duty_ids) != len(active) or set(data.duty_ids) != set(active):
            raise DomainError(
                "Dienstliste muss alle aktiven Dienste der Spalte genau einmal enthalten"
            )
        for index, duty_id in enumerate(data.duty_ids):
            active[duty_id].sort_order = index
        self.db.commit()
        return [self._response(active[duty_id]) for duty_id in data.duty_ids]

    def update_duty(self, duty_id: int, data: DutyUpdate) -> DutyResponse:
        duty = self._lock_duty(duty_id)
        changes = data.model_dump(exclude_unset=True)
        required_patch(changes, {"kind", "user_ids", "capacity"})
        values = {
            key: getattr(duty, key)
            for key in (
                "kind",
                "capacity",
                "title",
                "day_id",
                "room_id",
                "slot_id",
                "start_time",
                "end_time",
            )
        }
        values.update(
            {key: value for key, value in changes.items() if key != "user_ids"}
        )
        values = self._validated(duty.event_id, values)
        users = (
            self._users(duty.event_id, changes["user_ids"], {user.id for user in duty.users})
            if "user_ids" in changes
            else list(duty.users)
        )
        self._check_capacity(values["capacity"], users)
        for key, value in values.items():
            setattr(duty, key, value)
        duty.users = users
        self.db.commit()
        return self._response(duty)

    def delete_duty(self, duty_id: int) -> None:
        duty = self._lock_duty(duty_id)
        self.db.execute(delete(duty_users).where(duty_users.c.duty_id == duty.id))
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
            if first.status != "active" or not first.user_ids:
                continue
            for second in responses[index + 1 :]:
                if second.status != "active" or first.day_id != second.day_id:
                    continue
                shared = sorted(set(first.user_ids).intersection(second.user_ids))
                if (
                    not shared
                    or first.start_time >= second.end_time
                    or second.start_time >= first.end_time
                ):
                    continue
                if self._room_covers_session(first, second) or self._room_covers_session(
                    second, first
                ):
                    continue
                conflicts.append(
                    DutyConflict(
                        first_duty_id=first.id,
                        second_duty_id=second.id,
                        user_ids=shared,
                    )
                )
        return HelperPlan(duties=responses, conflicts=conflicts)

    @staticmethod
    def _room_covers_session(broad: DutyResponse, narrow: DutyResponse) -> bool:
        if broad.start_time > narrow.start_time or broad.end_time < narrow.end_time:
            return False
        return (
            broad.kind == "room"
            and narrow.kind == "session"
            and broad.room_id == narrow.room_id
        )
