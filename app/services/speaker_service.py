import os
from io import BytesIO
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid4

from PIL import Image, UnidentifiedImageError
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.event_day import EventDay
from app.models.room import Room
from app.models.slot import Slot
from app.models.speaker import Speaker, slot_speakers
from app.repositories.event_repository import EventRepository
from app.schemas.speaker import SpeakerCreate, SpeakerSession, SpeakerUpdate
from app.services.errors import Conflict, DomainError, NotFound
from app.services.validation import name, required_patch

MAX_PHOTO_BYTES = 5 * 1024 * 1024
PHOTO_EXTENSIONS = {"JPEG": "jpg", "PNG": "png", "WEBP": "webp"}
PHOTO_MIME = {"jpg": "image/jpeg", "png": "image/png", "webp": "image/webp"}


def photo_directory() -> Path:
    return Path(os.environ.get("SPEAKER_UPLOAD_DIR", "./uploads"))


def _website(value: str | None) -> str | None:
    if value is None:
        return None
    result = value.strip()
    if not result:
        return None
    try:
        parsed = urlsplit(result)
    except ValueError as error:
        raise DomainError("Website muss eine HTTP- oder HTTPS-URL sein") from error
    if (
        parsed.scheme not in {"https", "http"}
        or not parsed.netloc
        or parsed.hostname is None
        or any(character.isspace() for character in parsed.netloc)
        or parsed.username
        or parsed.password
        or len(result) > 2048
    ):
        raise DomainError("Website muss eine HTTP- oder HTTPS-URL sein")
    return result


def _bio(value: str | None) -> str | None:
    if value is None:
        return None
    return value.strip() or None


class SpeakerService:
    def __init__(self, db: Session):
        self.db = db
        self.events = EventRepository(db)

    def get(self, speaker_id: int) -> Speaker:
        speaker = self.db.get(Speaker, speaker_id)
        if speaker is None:
            raise NotFound("Redner nicht gefunden")
        return speaker

    def list_for_event(self, event_id: int) -> list[Speaker]:
        if self.events.get_by_id(event_id) is None:
            raise NotFound("Veranstaltung nicht gefunden")
        return list(
            self.db.scalars(
                select(Speaker)
                .where(Speaker.event_id == event_id)
                .order_by(Speaker.name, Speaker.id)
            ).all()
        )

    def _check_name(
        self, event_id: int, value: str, own_id: int | None = None
    ) -> tuple[str, str]:
        display = name(value)
        if len(display) > 255:
            raise DomainError("Rednername ist zu lang")
        normalized = display.casefold()
        other = self.db.scalar(
            select(Speaker.id).where(
                Speaker.event_id == event_id,
                Speaker.normalized_name == normalized,
            )
        )
        if other is not None and other != own_id:
            raise Conflict("Rednername existiert bereits")
        return display, normalized

    def create(self, event_id: int, data: SpeakerCreate) -> Speaker:
        if self.events.get_by_id(event_id) is None:
            raise NotFound("Veranstaltung nicht gefunden")
        display, normalized = self._check_name(event_id, data.name)
        speaker = Speaker(
            event_id=event_id,
            name=display,
            normalized_name=normalized,
            bio=_bio(data.bio),
            website=_website(data.website),
        )
        self.db.add(speaker)
        try:
            self.db.commit()
        except IntegrityError as error:
            self.db.rollback()
            raise Conflict("Rednername existiert bereits") from error
        return speaker

    def update(self, speaker_id: int, data: SpeakerUpdate) -> Speaker:
        speaker = self.get(speaker_id)
        changes = data.model_dump(exclude_unset=True)
        required_patch(changes, {"name"})
        prepared: dict[str, str | None] = {}
        if "name" in changes:
            prepared["name"], prepared["normalized_name"] = self._check_name(
                speaker.event_id,
                changes["name"],
                speaker.id,
            )
        if "bio" in changes:
            prepared["bio"] = _bio(changes["bio"])
        if "website" in changes:
            prepared["website"] = _website(changes["website"])
        for key, value in prepared.items():
            setattr(speaker, key, value)
        try:
            self.db.commit()
        except IntegrityError as error:
            self.db.rollback()
            raise Conflict("Rednername existiert bereits") from error
        return speaker

    def sessions(self, speaker_id: int) -> list[SpeakerSession]:
        self.get(speaker_id)
        rows = self.db.execute(
            select(Slot, EventDay.date, Room.name)
            .join(slot_speakers, slot_speakers.c.slot_id == Slot.id)
            .join(EventDay, EventDay.id == Slot.day_id)
            .join(Room, Room.id == Slot.room_id)
            .where(slot_speakers.c.speaker_id == speaker_id)
            .order_by(EventDay.date, Slot.start_time, Slot.id)
        ).all()
        return [
            SpeakerSession(
                id=slot.id,
                day_id=slot.day_id,
                date=day_date,
                room_id=slot.room_id,
                room_name=room_name,
                topic=slot.topic,
                start_time=slot.start_time,
                end_time=slot.end_time,
            )
            for slot, day_date, room_name in rows
        ]

    def delete(self, speaker_id: int) -> None:
        speaker = self.get(speaker_id)
        old_photo = speaker.photo_filename
        self.db.execute(
            delete(slot_speakers).where(slot_speakers.c.speaker_id == speaker_id)
        )
        self.db.delete(speaker)
        self.db.commit()
        self.db.expire_all()
        self._remove_file(old_photo)

    @staticmethod
    def _remove_file(filename: str | None) -> None:
        if filename:
            (photo_directory() / filename).unlink(missing_ok=True)

    def upload_photo(self, speaker_id: int, content: bytes) -> Speaker:
        speaker = self.get(speaker_id)
        if len(content) > MAX_PHOTO_BYTES or not content:
            raise DomainError("Foto muss zwischen 1 Byte und 5 MB groß sein")
        try:
            with Image.open(BytesIO(content)) as image:
                image.verify()
                extension = PHOTO_EXTENSIONS.get(image.format or "")
        except (UnidentifiedImageError, OSError, ValueError) as error:
            raise DomainError("Ungültige Bilddatei") from error
        if extension is None:
            raise DomainError("Nur JPEG, PNG und WebP sind erlaubt")
        directory = photo_directory()
        directory.mkdir(parents=True, exist_ok=True)
        filename = f"{uuid4().hex}.{extension}"
        path = directory / filename
        path.write_bytes(content)
        old_photo = speaker.photo_filename
        try:
            speaker.photo_filename = filename
            self.db.commit()
        except Exception:
            self.db.rollback()
            path.unlink(missing_ok=True)
            raise
        self._remove_file(old_photo)
        return speaker

    def delete_photo(self, speaker_id: int) -> Speaker:
        speaker = self.get(speaker_id)
        old_photo = speaker.photo_filename
        speaker.photo_filename = None
        self.db.commit()
        self._remove_file(old_photo)
        return speaker
