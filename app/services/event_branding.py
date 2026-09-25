import os
import re
from io import BytesIO
from pathlib import Path
from uuid import uuid4

from PIL import Image, UnidentifiedImageError
from sqlalchemy.orm import Session

from app.models.event import Event
from app.services.errors import DomainError, NotFound

MAX_LOGO_BYTES = 5 * 1024 * 1024
MAX_LOGO_PIXELS = 16_000_000
LOGO_EXTENSIONS = {"JPEG": "jpg", "PNG": "png", "WEBP": "webp"}
LOGO_MIME = {"jpg": "image/jpeg", "png": "image/png", "webp": "image/webp"}


def logo_directory() -> Path:
    return Path(os.environ.get("EVENT_LOGO_DIR", "./uploads/logos"))


def accent_color(value: str | None) -> str | None:
    if value is None:
        return None
    if not re.fullmatch(r"#[0-9a-fA-F]{6}", value):
        raise DomainError("Akzentfarbe muss im Format #RRGGBB sein")
    return value.upper()


def logo_path(event: Event) -> Path | None:
    if not event.logo_filename:
        return None
    return logo_directory() / event.logo_filename


def remove_logo_file(filename: str | None) -> None:
    if filename:
        (logo_directory() / filename).unlink(missing_ok=True)


class EventBrandingService:
    def __init__(self, db: Session):
        self.db = db

    def _event(self, event_id: int) -> Event:
        event = self.db.get(Event, event_id)
        if event is None:
            raise NotFound("Veranstaltung nicht gefunden")
        return event

    def upload_logo(self, event_id: int, content: bytes) -> Event:
        event = self._event(event_id)
        if not content or len(content) > MAX_LOGO_BYTES:
            raise DomainError("Logo muss zwischen 1 Byte und 5 MB groß sein")
        try:
            with Image.open(BytesIO(content)) as image:
                extension = LOGO_EXTENSIONS.get(image.format or "")
                if image.width * image.height > MAX_LOGO_PIXELS:
                    raise DomainError("Logo hat zu viele Bildpunkte")
                image.load()
        except (UnidentifiedImageError, OSError, ValueError) as error:
            raise DomainError("Ungültige Bilddatei") from error
        if extension is None:
            raise DomainError("Nur JPEG, PNG und WebP sind erlaubt")
        directory = logo_directory()
        directory.mkdir(parents=True, exist_ok=True)
        filename = f"{uuid4().hex}.{extension}"
        path = directory / filename
        path.write_bytes(content)
        old_logo = event.logo_filename
        try:
            event.logo_filename = filename
            self.db.commit()
        except Exception:
            self.db.rollback()
            path.unlink(missing_ok=True)
            raise
        remove_logo_file(old_logo)
        return event

    def delete_logo(self, event_id: int) -> Event:
        event = self._event(event_id)
        old_logo = event.logo_filename
        event.logo_filename = None
        self.db.commit()
        remove_logo_file(old_logo)
        return event
