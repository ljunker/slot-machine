import os
import re
from io import BytesIO
from pathlib import Path
from typing import Literal
from uuid import uuid4

from PIL import Image, UnidentifiedImageError
from sqlalchemy.orm import Session

from app.models.event import Event
from app.services.errors import DomainError, NotFound

MAX_LOGO_BYTES = 5 * 1024 * 1024
MAX_LOGO_PIXELS = 16_000_000
LOGO_EXTENSIONS = {"JPEG": "jpg", "PNG": "png", "WEBP": "webp"}
LOGO_MIME = {"jpg": "image/jpeg", "png": "image/png", "webp": "image/webp"}

COLOR_FIELDS = (
    "accent_color",
    "background_color",
    "text_color",
    "header_background_color",
    "card_color",
)
COLOR_LABELS = {
    "accent_color": "Akzentfarbe",
    "background_color": "Hintergrundfarbe",
    "text_color": "Textfarbe",
    "header_background_color": "Kopfbereichsfarbe",
    "card_color": "Kartenfarbe",
}
TEXT_LIMITS = {"program_eyebrow": 60, "program_subtitle": 160}
TEXT_LABELS = {"program_eyebrow": "Überschrift", "program_subtitle": "Untertitel"}

GraphicSlot = Literal["header", "footer"]
GRAPHIC_FIELDS: dict[str, str] = {
    "header": "header_graphic_filename",
    "footer": "footer_graphic_filename",
}
GRAPHIC_LABELS = {"header": "Kopfgrafik", "footer": "Fußgrafik"}


def logo_directory() -> Path:
    return Path(os.environ.get("EVENT_LOGO_DIR", "./uploads/logos"))


def hex_color(value: str | None, label: str = "Farbe") -> str | None:
    if value is None:
        return None
    if not re.fullmatch(r"#[0-9a-fA-F]{6}", value):
        raise DomainError(f"{label} muss im Format #RRGGBB sein")
    return value.upper()


def accent_color(value: str | None) -> str | None:
    return hex_color(value, "Akzentfarbe")


def optional_text(value: str | None, limit: int, label: str) -> str | None:
    if value is None:
        return None
    result = " ".join(value.split())
    if not result:
        return None
    if len(result) > limit:
        raise DomainError(f"{label} darf höchstens {limit} Zeichen lang sein")
    return result


def web_url(value: str | None, label: str = "Webadresse") -> str | None:
    if value is None:
        return None
    result = value.strip()
    if not result:
        return None
    if len(result) > 255 or not re.fullmatch(r"https?://[^\s/?#]+\.[^\s/?#]+[^\s]*", result, re.IGNORECASE):
        raise DomainError(f"{label} muss mit http:// oder https:// beginnen")
    return result


def clean_design(changes: dict) -> dict:
    """Validate and normalize all design fields present in a create or update payload."""
    for field in COLOR_FIELDS:
        if field in changes:
            changes[field] = hex_color(changes[field], COLOR_LABELS[field])
    for field, limit in TEXT_LIMITS.items():
        if field in changes:
            changes[field] = optional_text(changes[field], limit, TEXT_LABELS[field])
    if "website_url" in changes:
        changes["website_url"] = web_url(changes["website_url"])
    return changes


def image_file(filename: str | None) -> Path | None:
    if not filename:
        return None
    return logo_directory() / filename


def logo_path(event: Event) -> Path | None:
    return image_file(event.logo_filename)


def graphic_path(event: Event, slot: str) -> Path | None:
    return image_file(getattr(event, GRAPHIC_FIELDS[slot]))


def remove_logo_file(filename: str | None) -> None:
    if filename:
        (logo_directory() / filename).unlink(missing_ok=True)


def store_image(content: bytes, label: str) -> str:
    """Validate an uploaded image and store it in the logo directory; return its file name."""
    if not content or len(content) > MAX_LOGO_BYTES:
        raise DomainError(f"{label} muss zwischen 1 Byte und 5 MB groß sein")
    try:
        with Image.open(BytesIO(content)) as image:
            extension = LOGO_EXTENSIONS.get(image.format or "")
            if image.width * image.height > MAX_LOGO_PIXELS:
                raise DomainError(f"{label} hat zu viele Bildpunkte")
            image.load()
    except (UnidentifiedImageError, OSError, ValueError) as error:
        raise DomainError("Ungültige Bilddatei") from error
    if extension is None:
        raise DomainError("Nur JPEG, PNG und WebP sind erlaubt")
    directory = logo_directory()
    directory.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid4().hex}.{extension}"
    (directory / filename).write_bytes(content)
    return filename


def replace_image(db: Session, target: object, attribute: str, content: bytes, label: str) -> None:
    """Store a new image on ``target.attribute`` and delete the previous file after commit."""
    filename = store_image(content, label)
    old = getattr(target, attribute)
    try:
        setattr(target, attribute, filename)
        db.commit()
    except Exception:
        db.rollback()
        remove_logo_file(filename)
        raise
    remove_logo_file(old)


def clear_image(db: Session, target: object, attribute: str) -> None:
    old = getattr(target, attribute)
    setattr(target, attribute, None)
    db.commit()
    remove_logo_file(old)


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
        replace_image(self.db, event, "logo_filename", content, "Logo")
        return event

    def delete_logo(self, event_id: int) -> Event:
        event = self._event(event_id)
        clear_image(self.db, event, "logo_filename")
        return event

    def upload_graphic(self, event_id: int, slot: str, content: bytes) -> Event:
        event = self._event(event_id)
        replace_image(self.db, event, GRAPHIC_FIELDS[slot], content, GRAPHIC_LABELS[slot])
        return event

    def delete_graphic(self, event_id: int, slot: str) -> Event:
        event = self._event(event_id)
        clear_image(self.db, event, GRAPHIC_FIELDS[slot])
        return event
