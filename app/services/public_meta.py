"""Open-Graph-Metadaten für die öffentlichen Seiten, die nginx per SSI in index.html einsetzt."""

import os
import re
from datetime import date
from html import escape

from fastapi import Request
from sqlalchemy.orm import Session

from app.models.event import Event
from app.services.errors import NotFound
from app.services.slot_service import SlotService

DEFAULT_TITLE = "Event Scheduler"
MONTHS = (
    "Januar", "Februar", "März", "April", "Mai", "Juni",
    "Juli", "August", "September", "Oktober", "November", "Dezember",
)
PROGRAM = re.compile(r"^/programm/([1-9]\d*)/?$")
SESSION = re.compile(r"^/programm/([1-9]\d*)/sessions/([1-9]\d*)/?$")


def german_date(value: date) -> str:
    return f"{value.day}. {MONTHS[value.month - 1]} {value.year}"


def _period(event: Event) -> str:
    if event.start_date == event.end_date:
        return german_date(event.start_date)
    return f"{german_date(event.start_date)} bis {german_date(event.end_date)}"


def _shorten(text: str, limit: int = 200) -> str:
    text = " ".join(text.split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def page_meta(db: Session, path: str) -> dict[str, str | None]:
    """Titel, Beschreibung und Bild (relativ) für einen Seitenpfad."""
    path = "/" + path.split("?", 1)[0].split("#", 1)[0].lstrip("/")
    session_match = SESSION.match(path)
    program_match = PROGRAM.match(path)
    event_id = int((session_match or program_match).group(1)) if session_match or program_match else None
    event = db.get(Event, event_id) if event_id is not None else None
    if event is None:
        return {"title": DEFAULT_TITLE, "description": None, "image": None}
    image = event.header_graphic_url or event.logo_url
    if session_match:
        try:
            session = SlotService(db).get_public_session(event.id, int(session_match.group(2)))
        except NotFound:
            return {"title": f"Programm · {event.name}", "description": _period(event), "image": image}
        parts = [
            f"{german_date(session.date)}, {session.start_time:%H:%M}–{session.end_time:%H:%M} Uhr, {session.room_name}",
        ]
        if session.is_cancelled:
            parts.insert(0, "Abgesagt")
        if session.speakers:
            parts.append("mit " + ", ".join(speaker.name for speaker in session.speakers))
        description = " · ".join(parts)
        if session.description:
            description += ". " + session.description
        return {"title": f"{session.topic} · {event.name}", "description": _shorten(description), "image": image}
    return {
        "title": f"Programm · {event.name}",
        "description": _shorten(event.program_subtitle or _period(event)),
        "image": image,
    }


def public_base_url(request: Request) -> str:
    """Basis-URL, wie sie der Besucher sieht.

    Vorrang hat PUBLIC_BASE_URL (wie bei den Links in Einladungs-Mails): Hinter zwei
    Proxys überschreibt das nginx im Frontend-Container X-Forwarded-Proto mit http.
    Ohne die Variable gelten die Forwarded-Header.
    """
    configured = os.environ.get("PUBLIC_BASE_URL", "").strip().rstrip("/")
    if configured:
        return configured
    scheme = request.headers.get("x-forwarded-proto", request.url.scheme).split(",")[0].strip()
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc
    return f"{scheme}://{host.split(',')[0].strip()}"


def meta_html(meta: dict[str, str | None], base_url: str, page_url: str) -> str:
    title = escape(meta["title"] or DEFAULT_TITLE)
    tags = [
        f"<title>{title}</title>",
        f'<meta property="og:title" content="{title}" />',
        '<meta property="og:type" content="website" />',
        f'<meta property="og:url" content="{escape(page_url)}" />',
    ]
    if meta["description"]:
        description = escape(meta["description"])
        tags.append(f'<meta name="description" content="{description}" />')
        tags.append(f'<meta property="og:description" content="{description}" />')
    if meta["image"]:
        tags.append(f'<meta property="og:image" content="{escape(base_url + meta["image"])}" />')
        tags.append('<meta name="twitter:card" content="summary_large_image" />')
    else:
        tags.append('<meta name="twitter:card" content="summary" />')
    return "\n    ".join(tags)
