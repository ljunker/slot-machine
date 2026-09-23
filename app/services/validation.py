from datetime import date, time

from app.services.errors import DomainError


def required_patch(data: dict, fields: set[str]) -> None:
    if any(key in data and data[key] is None for key in fields):
        raise DomainError("Pflichtfeld darf nicht null sein")


def name(value: str) -> str:
    result = value.strip()
    if not result:
        raise DomainError("Name oder Thema darf nicht leer sein")
    return result


def date_range(start: date, end: date) -> None:
    if start > end:
        raise DomainError("Startdatum muss vor oder am Enddatum liegen")


def time_range(start: time, end: time) -> None:
    if start.tzinfo is not None or end.tzinfo is not None or start >= end:
        raise DomainError("Ungültiger Zeitraum")
