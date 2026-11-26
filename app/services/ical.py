"""Minimaler iCalendar-Export (RFC 5545) für einzelne Sessions und die eigenen Dienste."""

from datetime import date, datetime, time, timezone

from app.schemas.helper import DutyResponse
from app.schemas.slot import PublicSessionResponse


def _escape(value: str) -> str:
    return (
        value.replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\r\n", "\\n")
        .replace("\n", "\\n")
        .replace("\r", "\\n")
    )


def _fold(line: str) -> str:
    """Faltet eine Inhaltszeile nach höchstens 75 Oktetts, ohne UTF-8-Zeichen zu teilen."""
    parts: list[str] = []
    current = ""
    size = 0
    limit = 75
    for character in line:
        length = len(character.encode("utf-8"))
        if size + length > limit:
            parts.append(current)
            current = " "
            size = 1
            limit = 75
        current += character
        size += length
    parts.append(current)
    return "\r\n".join(parts)


def _local(day: date, moment: time) -> str:
    return f"{day:%Y%m%d}T{moment:%H%M%S}"


def session_calendar(session: PublicSessionResponse, event_name: str, url: str, now: datetime | None = None) -> str:
    stamp = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    details = []
    if session.speakers:
        details.append("Redner: " + ", ".join(speaker.name for speaker in session.speakers))
    if session.description:
        details.append(session.description)
    details.append(url)
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Event Scheduler//Programm//DE",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "BEGIN:VEVENT",
        f"UID:session-{session.id}@event-scheduler",
        f"DTSTAMP:{stamp:%Y%m%dT%H%M%SZ}",
        f"DTSTART:{_local(session.date, session.start_time)}",
        f"DTEND:{_local(session.date, session.end_time)}",
        f"SUMMARY:{_escape(session.topic)}",
        f"LOCATION:{_escape(f'{session.room_name} · {event_name}')}",
        f"DESCRIPTION:{_escape(chr(10).join(details))}",
        f"URL:{url}",
        f"STATUS:{'CANCELLED' if session.is_cancelled else 'CONFIRMED'}",
        "END:VEVENT",
        "END:VCALENDAR",
    ]
    return "".join(_fold(line) + "\r\n" for line in lines)


def duties_calendar(
    duties: list[DutyResponse],
    event_name: str,
    room_names: dict[int, str],
    now: datetime | None = None,
) -> str:
    """Kalender mit den aktiven Diensten einer Person; ungeplante und abgesagte fehlen."""
    stamp = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Event Scheduler//Dienste//DE",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:{_escape(f'Meine Dienste · {event_name}')}",
    ]
    for duty in duties:
        if duty.status != "active" or duty.date is None or duty.start_time is None or duty.end_time is None:
            continue
        title = duty_title(duty)
        place = room_names.get(duty.room_id, "Raum") if duty.room_id is not None else (
            "Alle Räume" if duty.kind == "session" else "Allgemein"
        )
        details = [f"Session: {duty.session_topic}"] if duty.session_topic else []
        details.append("Eingeteilt: " + ", ".join(user.name for user in duty.users))
        lines += [
            "BEGIN:VEVENT",
            f"UID:duty-{duty.id}@event-scheduler",
            f"DTSTAMP:{stamp:%Y%m%dT%H%M%SZ}",
            f"DTSTART:{_local(duty.date, duty.start_time)}",
            f"DTEND:{_local(duty.date, duty.end_time)}",
            f"SUMMARY:{_escape(title)}",
            f"LOCATION:{_escape(f'{place} · {event_name}')}",
            f"DESCRIPTION:{_escape(chr(10).join(details))}",
            "END:VEVENT",
        ]
    lines.append("END:VCALENDAR")
    return "".join(_fold(line) + "\r\n" for line in lines)


def duty_title(duty: DutyResponse) -> str:
    if duty.title and duty.session_topic:
        return f"{duty.title}: {duty.session_topic}"
    return duty.title or duty.session_topic or ("Raumdienst" if duty.kind == "room" else "Allgemeiner Dienst")
