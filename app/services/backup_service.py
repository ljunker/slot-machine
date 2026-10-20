"""Versioned, event-scoped CSV archives and transactional restore."""

import csv
import logging
import os
import re
import zipfile
import zlib
from datetime import UTC, date, datetime, time
from io import BytesIO, StringIO
from pathlib import Path
from uuid import uuid4

from PIL import Image, UnidentifiedImageError
from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    Integer,
    String,
    Text,
    Time,
    delete,
    func,
    select,
    text,
)
from sqlalchemy.orm import Session

from app.models.duty import Duty
from app.models.event import Event
from app.models.event_day import EventDay
from app.models.helper import Helper, duty_helpers
from app.models.room import Room
from app.models.slot import Slot
from app.models.speaker import Speaker, slot_speakers
from app.services.errors import DomainError, NotFound
from app.services.event_branding import (
    LOGO_EXTENSIONS,
    MAX_LOGO_BYTES,
    MAX_LOGO_PIXELS,
    accent_color,
    logo_directory,
)
from app.services.speaker_service import (
    MAX_PHOTO_BYTES,
    PHOTO_EXTENSIONS,
    photo_directory,
)

FORMAT_VERSION = "2"
logger = logging.getLogger(__name__)
MAX_ARCHIVE_BYTES = 128 * 1024 * 1024
MAX_UNPACKED_BYTES = 256 * 1024 * 1024
MAX_CSV_BYTES = 32 * 1024 * 1024
MAX_ID = 2**31 - 1
MAX_BIGINT = 2**63 - 1
csv.field_size_limit(MAX_CSV_BYTES)
TABLES = {
    "events": Event,
    "event_days": EventDay,
    "rooms": Room,
    "slots": Slot,
    "speakers": Speaker,
    "helpers": Helper,
    "duties": Duty,
    "slot_speakers": slot_speakers,
    "duty_helpers": duty_helpers,
}
ORDER = tuple(TABLES)


def _columns(table_name: str):
    model = TABLES[table_name]
    return model.columns if hasattr(model, "columns") else model.__table__.columns


def _encode(value) -> str:
    if value is None:
        return r"\N"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (date, time)):
        value = value.isoformat()
    value = str(value)
    return "\\" + value if value.startswith("\\") else value


def _decode(value: str, column):
    if value == r"\N":
        if not column.nullable:
            raise DomainError(f"{column.name} darf nicht leer sein")
        return None
    if value.startswith("\\"):
        if not value.startswith("\\\\"):
            raise DomainError(f"Ungültige CSV-Kodierung in {column.name}")
        value = value[1:]
    kind = column.type
    try:
        if isinstance(kind, Boolean):
            if value not in {"true", "false"}:
                raise ValueError
            return value == "true"
        if isinstance(kind, Date):
            return date.fromisoformat(value)
        if isinstance(kind, Time):
            result = time.fromisoformat(value)
            if result.tzinfo is not None:
                raise ValueError
            return result
        if isinstance(kind, (Integer, BigInteger)):
            if not re.fullmatch(r"-?\d+", value):
                raise ValueError
            result = int(value)
            if abs(result) > (MAX_BIGINT if isinstance(kind, BigInteger) else MAX_ID):
                raise ValueError
            return result
        if isinstance(kind, (String, Text)):
            if getattr(kind, "length", None) and len(value) > kind.length:
                raise ValueError
            return value
    except ValueError as error:
        raise DomainError(f"Ungültiger Wert in {column.name}") from error
    raise RuntimeError(f"Unbekannter Spaltentyp: {column.name}")


def _csv_bytes(headers: list[str], rows: list[dict]) -> bytes:
    output = StringIO(newline="")
    writer = csv.writer(output, lineterminator="\r\n")
    writer.writerow(headers)
    writer.writerows([_encode(row[name]) for name in headers] for row in rows)
    return output.getvalue().encode("utf-8")


def _read_csv(content: bytes, headers: list[str], label: str) -> list[dict[str, str]]:
    if len(content) > MAX_CSV_BYTES:
        raise DomainError(f"{label} ist zu groß")
    try:
        reader = csv.reader(
            StringIO(content.decode("utf-8-sig"), newline=""), strict=True
        )
        if next(reader, None) != headers:
            raise DomainError(f"Ungültige Spalten in {label}")
        rows = []
        for row in reader:
            if len(row) != len(headers):
                raise DomainError(f"Ungültige Zeile in {label}")
            rows.append(dict(zip(headers, row, strict=True)))
        return rows
    except (UnicodeError, csv.Error) as error:
        raise DomainError(f"Ungültige CSV-Datei: {label}") from error


def _model_rows(db: Session, model, event_id: int) -> list[dict]:
    rows = db.scalars(
        select(model).where(model.event_id == event_id).order_by(model.id)
    )
    return [
        {column.name: getattr(row, column.name) for column in model.__table__.columns}
        for row in rows
    ]


def _link_rows(db: Session, table, left: str, parent_ids: list[int]) -> list[dict]:
    if not parent_ids:
        return []
    return [
        dict(row._mapping)
        for row in db.execute(
            select(table)
            .where(table.c[left].in_(parent_ids))
            .order_by(*table.primary_key.columns)
        )
    ]


def _media_bytes(path: Path | None, label: str) -> bytes | None:
    if path is None:
        return None
    try:
        data = path.read_bytes()
    except OSError as error:
        raise DomainError(f"{label} fehlt oder ist nicht lesbar") from error
    return data


def build_backup(db: Session, event_id: int) -> bytes:
    event = db.get(Event, event_id)
    if event is None:
        raise NotFound("Veranstaltung nicht gefunden")
    rows = {
        "events": [
            {
                column.name: getattr(event, column.name)
                for column in Event.__table__.columns
            }
        ]
    }
    for name in ("event_days", "rooms", "slots", "speakers", "helpers", "duties"):
        rows[name] = _model_rows(db, TABLES[name], event_id)
    rows["slot_speakers"] = _link_rows(
        db, slot_speakers, "slot_id", [r["id"] for r in rows["slots"]]
    )
    rows["duty_helpers"] = _link_rows(
        db, duty_helpers, "duty_id", [r["id"] for r in rows["duties"]]
    )

    media: dict[str, bytes] = {}
    logo = rows["events"][0]["logo_filename"]
    if logo:
        extension = Path(logo).suffix.lower().lstrip(".")
        if extension not in LOGO_EXTENSIONS.values():
            raise DomainError("Ungültige Logo-Datei")
        archive_name = f"media/logo.{extension}"
        media[archive_name] = _media_bytes(logo_directory() / logo, "Logo")
        _image(media[archive_name], extension, True)
        rows["events"][0]["logo_filename"] = archive_name
    for speaker in rows["speakers"]:
        filename = speaker["photo_filename"]
        if filename:
            extension = Path(filename).suffix.lower().lstrip(".")
            if extension not in PHOTO_EXTENSIONS.values():
                raise DomainError("Ungültige Fotodatei")
            archive_name = f"media/speakers/{speaker['id']}.{extension}"
            media[archive_name] = _media_bytes(
                photo_directory() / filename, "Rednerfoto"
            )
            _image(media[archive_name], extension, False)
            speaker["photo_filename"] = archive_name

    output = BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(
            "manifest.csv",
            _csv_bytes(
                ["format_version", "source_event_id", "exported_at"],
                [
                    {
                        "format_version": FORMAT_VERSION,
                        "source_event_id": event_id,
                        "exported_at": datetime.now(UTC).isoformat(),
                    }
                ],
            ),
        )
        for name in ORDER:
            content = _csv_bytes([column.name for column in _columns(name)], rows[name])
            if len(content) > MAX_CSV_BYTES:
                raise DomainError(f"{name}.csv ist zu groß")
            archive.writestr(f"{name}.csv", content)
        for name, content in media.items():
            archive.writestr(name, content)
    result = output.getvalue()
    if len(result) > MAX_ARCHIVE_BYTES:
        raise DomainError("Backup ist zu groß")
    return result


def _image(data: bytes, extension: str, logo: bool) -> None:
    limit = MAX_LOGO_BYTES if logo else MAX_PHOTO_BYTES
    if not data or len(data) > limit:
        raise DomainError("Bildgröße im Backup ist ungültig")
    try:
        with Image.open(BytesIO(data)) as image:
            if logo and image.width * image.height > MAX_LOGO_PIXELS:
                raise DomainError("Logo hat zu viele Bildpunkte")
            image.load()
            actual = (LOGO_EXTENSIONS if logo else PHOTO_EXTENSIONS).get(
                image.format or ""
            )
    except (UnidentifiedImageError, OSError, ValueError) as error:
        raise DomainError("Ungültiges Bild im Backup") from error
    if actual != extension:
        raise DomainError("Bildformat und Dateiendung stimmen nicht überein")


def _parse_archive(
    content: bytes,
) -> tuple[dict[str, list[dict]], dict[str, bytes], int]:
    if not content or len(content) > MAX_ARCHIVE_BYTES:
        raise DomainError("Backup-Datei ist leer oder zu groß")
    try:
        with zipfile.ZipFile(BytesIO(content)) as archive:
            entries = archive.infolist()
            names = [entry.filename for entry in entries]
            if len(names) != len(set(names)) or any(
                name.startswith("/")
                or "\\" in name
                or ".." in Path(name).parts
                or name.endswith("/")
                or (entry.external_attr >> 16) & 0o170000 == 0o120000
                for name, entry in zip(names, entries, strict=True)
            ):
                raise DomainError("Unsichere oder doppelte ZIP-Einträge")
            if sum(entry.file_size for entry in entries) > MAX_UNPACKED_BYTES:
                raise DomainError("Entpacktes Backup ist zu groß")
            if any(
                entry.file_size
                > (
                    MAX_CSV_BYTES
                    if entry.filename.endswith(".csv")
                    else MAX_PHOTO_BYTES
                )
                for entry in entries
            ):
                raise DomainError("Datei im Backup ist zu groß")
            required = {"manifest.csv", *(f"{name}.csv" for name in ORDER)}
            if not required.issubset(names):
                raise DomainError("CSV-Dateien im Backup fehlen")
            if any(
                name not in required and not name.startswith("media/") for name in names
            ):
                raise DomainError("Unbekannte Datei im Backup")
            manifest = _read_csv(
                archive.read("manifest.csv"),
                ["format_version", "source_event_id", "exported_at"],
                "manifest.csv",
            )
            if len(manifest) != 1 or manifest[0]["format_version"] not in {"1", FORMAT_VERSION}:
                raise DomainError("Nicht unterstützte Backup-Version")
            version = manifest[0]["format_version"]
            source_id = int(manifest[0]["source_event_id"])
            datetime.fromisoformat(manifest[0]["exported_at"])
            rows: dict[str, list[dict]] = {}
            for name in ORDER:
                columns = list(_columns(name))
                if version == "1" and name == "duties":
                    columns = [column for column in columns if column.name != "sort_order"]
                raw = _read_csv(
                    archive.read(f"{name}.csv"),
                    [column.name for column in columns],
                    f"{name}.csv",
                )
                rows[name] = [
                    {
                        column.name: _decode(row[column.name], column)
                        for column in columns
                    }
                    for row in raw
                ]
                if version == "1" and name == "duties":
                    slots_by_id = {slot["id"]: slot for slot in rows["slots"]}
                    ordered = sorted(
                        rows[name],
                        key=lambda row: (
                            row["start_time"]
                            or (slots_by_id.get(row["slot_id"]) or {}).get("start_time")
                            or time.min,
                            row["id"],
                        ),
                    )
                    for index, row in enumerate(ordered):
                        row["sort_order"] = index
            media = {
                name: archive.read(name) for name in names if name.startswith("media/")
            }
    except (
        zipfile.BadZipFile,
        OSError,
        EOFError,
        ValueError,
        OverflowError,
        RuntimeError,
        zlib.error,
    ) as error:
        raise DomainError("Ungültige Backup-Datei") from error
    _validate(rows, media, source_id)
    return rows, media, source_id


def _validate(
    rows: dict[str, list[dict]], media: dict[str, bytes], source_id: int
) -> None:
    if (
        source_id <= 0
        or source_id >= MAX_ID
        or len(rows["events"]) != 1
        or rows["events"][0]["id"] != source_id
    ):
        raise DomainError("Backup muss genau eine Veranstaltung enthalten")
    event = rows["events"][0]
    if not event["name"].strip() or event["start_date"] > event["end_date"]:
        raise DomainError("Ungültige Veranstaltung im Backup")
    accent_color(event["accent_color"])
    by_id = {}
    for name in ("event_days", "rooms", "slots", "speakers", "helpers", "duties"):
        identifiers = [row["id"] for row in rows[name]]
        if any(identifier <= 0 for identifier in identifiers) or len(
            identifiers
        ) != len(set(identifiers)):
            raise DomainError(f"Doppelte oder ungültige IDs in {name}.csv")
        if any(row["event_id"] != source_id for row in rows[name]):
            raise DomainError(f"Fremde Veranstaltung in {name}.csv")
        by_id[name] = {row["id"]: row for row in rows[name]}
    for day in rows["event_days"]:
        if (
            not event["start_date"] <= day["date"] <= event["end_date"]
            or day["start_time"] >= day["end_time"]
        ):
            raise DomainError("Ungültiger Veranstaltungstag im Backup")
    for name in ("speakers", "helpers"):
        normalized = [person["normalized_name"] for person in rows[name]]
        if len(normalized) != len(set(normalized)) or any(
            not person["name"].strip()
            or person["name"].casefold() != person["normalized_name"]
            for person in rows[name]
        ):
            raise DomainError(f"Ungültige Namen in {name}.csv")
    for slot in rows["slots"]:
        if not slot["topic"].strip():
            raise DomainError("Leeres Session-Thema im Backup")
        planned = [
            slot[key] is not None
            for key in ("day_id", "room_id", "start_time", "end_time")
        ]
        if len(set(planned)) != 1 or (not planned[0] and slot["is_cancelled"]):
            raise DomainError("Ungültige Session-Planung im Backup")
        if planned[0]:
            day = by_id["event_days"].get(slot["day_id"])
            if (
                day is None
                or slot["room_id"] not in by_id["rooms"]
                or not day["start_time"]
                <= slot["start_time"]
                < slot["end_time"]
                <= day["end_time"]
            ):
                raise DomainError("Session liegt außerhalb der Planung")
    for duty in rows["duties"]:
        kind = duty["kind"]
        if duty["sort_order"] < 0:
            raise DomainError("Ungültige Dienstreihenfolge im Backup")
        if kind == "session":
            valid = duty["slot_id"] in by_id["slots"] and all(
                duty[key] is None
                for key in ("day_id", "room_id", "start_time", "end_time")
            )
        elif kind in {"general", "room"}:
            day = by_id["event_days"].get(duty["day_id"])
            valid = (
                day is not None
                and duty["slot_id"] is None
                and duty["start_time"] is not None
                and duty["end_time"] is not None
            )
            valid = (
                valid
                and day["start_time"]
                <= duty["start_time"]
                < duty["end_time"]
                <= day["end_time"]
            )
            valid = valid and (
                duty["room_id"] in by_id["rooms"]
                if kind == "room"
                else duty["room_id"] is None
            )
        else:
            valid = False
        if not valid:
            raise DomainError("Ungültiger Dienst im Backup")
    for name, left, right, left_table, right_table in (
        ("slot_speakers", "slot_id", "speaker_id", "slots", "speakers"),
        ("duty_helpers", "duty_id", "helper_id", "duties", "helpers"),
    ):
        pairs = [(row[left], row[right]) for row in rows[name]]
        if len(pairs) != len(set(pairs)) or any(
            a not in by_id[left_table] or b not in by_id[right_table] for a, b in pairs
        ):
            raise DomainError(f"Ungültige Zuordnung in {name}.csv")
    expected = set()
    logo = event["logo_filename"]
    if logo is not None:
        if not re.fullmatch(r"media/logo\.(jpg|png|webp)", logo):
            raise DomainError("Ungültige Logo-Referenz")
        expected.add(logo)
    for speaker in rows["speakers"]:
        photo = speaker["photo_filename"]
        if photo is not None:
            if not re.fullmatch(
                rf"media/speakers/{speaker['id']}\.(jpg|png|webp)", photo
            ):
                raise DomainError("Ungültige Foto-Referenz")
            expected.add(photo)
    if expected != set(media):
        raise DomainError("Bilder im Backup fehlen oder sind nicht referenziert")
    for name, data in media.items():
        _image(data, name.rsplit(".", 1)[1], name.startswith("media/logo."))


def _preview(
    db: Session, rows: dict[str, list[dict]], source_id: int, target_id: int | None
) -> dict:
    if target_id is not None and db.get(Event, target_id) is None:
        raise NotFound("Zielveranstaltung nicht gefunden")
    source_slots = {row["id"] for row in rows["slots"]}
    foreign_ids = (
        set(
            db.scalars(
                select(Slot.id).where(
                    Slot.id.in_(source_slots), Slot.event_id != target_id
                )
            ).all()
        )
        if source_slots
        else set()
    )
    old_ids = (
        set(
            db.scalars(
                select(Slot.id).where(
                    Slot.event_id == target_id, Slot.day_id.is_not(None)
                )
            ).all()
        )
        if target_id is not None
        else set()
    )
    preserved = source_slots - foreign_ids if target_id is not None else set()
    restored_public_ids = {
        row["id"] for row in rows["slots"] if row["day_id"] is not None
    } & preserved
    return {
        "name": rows["events"][0]["name"],
        "source_event_id": source_id,
        "target_event_id": target_id,
        "mode": "replace" if target_id is not None else "create",
        "counts": {name: len(rows[name]) for name in ORDER if name != "events"},
        "remapped_session_ids": len(source_slots - preserved),
        "removed_session_links": len(old_ids - restored_public_ids),
    }


def preview_backup(db: Session, content: bytes, target_id: int | None) -> dict:
    rows, _, source_id = _parse_archive(content)
    return _preview(db, rows, source_id, target_id)


def _delete_event_contents(db: Session, event_id: int) -> tuple[str | None, list[str]]:
    old_logo = db.get(Event, event_id).logo_filename
    photos = list(
        db.scalars(
            select(Speaker.photo_filename).where(Speaker.event_id == event_id)
        ).all()
    )
    slot_ids = select(Slot.id).where(Slot.event_id == event_id)
    duty_ids = select(Duty.id).where(Duty.event_id == event_id)
    db.execute(delete(duty_helpers).where(duty_helpers.c.duty_id.in_(duty_ids)))
    db.execute(delete(slot_speakers).where(slot_speakers.c.slot_id.in_(slot_ids)))
    for model in (Duty, Helper, Slot, Speaker, EventDay, Room):
        db.execute(delete(model).where(model.event_id == event_id))
    db.expire_all()
    return old_logo, [name for name in photos if name]


def _install_media(media: dict[str, bytes]) -> tuple[dict[str, str], list[Path]]:
    names = {}
    installed = []
    try:
        for archive_name, data in media.items():
            directory = (
                logo_directory()
                if archive_name.startswith("media/logo.")
                else photo_directory()
            )
            directory.mkdir(parents=True, exist_ok=True)
            final_name = f"{uuid4().hex}.{archive_name.rsplit('.', 1)[1]}"
            final = directory / final_name
            temporary = directory / f".{final_name}.tmp"
            try:
                temporary.write_bytes(data)
                os.replace(temporary, final)
            finally:
                temporary.unlink(missing_ok=True)
            installed.append(final)
            names[archive_name] = final_name
    except Exception:
        for path in installed:
            path.unlink(missing_ok=True)
        raise
    return names, installed


def _sync_postgres_sequence(db: Session, table: str) -> None:
    if db.bind.dialect.name == "postgresql":
        db.execute(
            text(
                "SELECT setval(pg_get_serial_sequence(:table, 'id'), "
                "COALESCE((SELECT MAX(id) FROM " + table + "), 1), true)"
            ),
            {"table": table},
        )


def restore_backup(db: Session, content: bytes, target_id: int | None) -> dict:
    rows, media, source_id = _parse_archive(content)
    summary = _preview(db, rows, source_id, target_id)
    names, installed = _install_media(media)
    old_logo = None
    old_photos = []
    try:
        event_data = rows["events"][0]
        if target_id is None:
            event_id = max(db.scalar(select(func.max(Event.id))) or 0, source_id) + 1
            if event_id > MAX_ID:
                raise DomainError("Keine freie Veranstaltungs-ID verfügbar")
            event = Event(
                id=event_id,
                name=event_data["name"],
                start_date=event_data["start_date"],
                end_date=event_data["end_date"],
                accent_color=event_data["accent_color"],
                logo_filename=names.get(event_data["logo_filename"]),
            )
            db.add(event)
            db.flush()
        else:
            event = db.get(Event, target_id)
            old_logo, old_photos = _delete_event_contents(db, target_id)
        for key in ("name", "start_date", "end_date", "accent_color"):
            setattr(event, key, event_data[key])
        event.logo_filename = names.get(event_data["logo_filename"])
        db.flush()
        maps: dict[str, dict[int, int]] = {}
        for name in ("event_days", "rooms", "speakers", "helpers", "slots", "duties"):
            model = TABLES[name]
            maps[name] = {}
            records = rows[name]
            next_slot_id = None
            if name == "slots" and target_id is None:
                next_slot_id = (
                    max(
                        db.scalar(select(func.max(Slot.id))) or 0,
                        max((record["id"] for record in records), default=0),
                    )
                    + 1
                )
                if next_slot_id + len(records) - 1 > MAX_ID:
                    raise DomainError("Keine freien Session-IDs verfügbar")
            if name == "slots" and target_id is not None:
                collision = set(
                    db.scalars(
                        select(Slot.id).where(
                            Slot.id.in_([record["id"] for record in records])
                        )
                    ).all()
                )
                records = sorted(records, key=lambda record: record["id"] in collision)
            for record in records:
                original_id = record["id"]
                values = {
                    key: value
                    for key, value in record.items()
                    if key not in {"id", "event_id"}
                }
                if name == "slots":
                    values["day_id"] = maps["event_days"].get(values["day_id"])
                    values["room_id"] = maps["rooms"].get(values["room_id"])
                if name == "duties":
                    values["day_id"] = maps["event_days"].get(values["day_id"])
                    values["room_id"] = maps["rooms"].get(values["room_id"])
                    values["slot_id"] = maps["slots"].get(values["slot_id"])
                if name == "speakers":
                    values["photo_filename"] = names.get(values["photo_filename"])
                obj = model(event_id=event.id, **values)
                if (
                    name == "slots"
                    and target_id is not None
                    and original_id not in collision
                ):
                    obj.id = original_id
                elif name == "slots" and next_slot_id is not None:
                    obj.id = next_slot_id
                    next_slot_id += 1
                db.add(obj)
                db.flush()
                maps[name][original_id] = obj.id
        if rows["slot_speakers"]:
            db.execute(
                slot_speakers.insert(),
                [
                    {
                        "slot_id": maps["slots"][row["slot_id"]],
                        "speaker_id": maps["speakers"][row["speaker_id"]],
                    }
                    for row in rows["slot_speakers"]
                ],
            )
        if rows["duty_helpers"]:
            db.execute(
                duty_helpers.insert(),
                [
                    {
                        "duty_id": maps["duties"][row["duty_id"]],
                        "helper_id": maps["helpers"][row["helper_id"]],
                    }
                    for row in rows["duty_helpers"]
                ],
            )
        if target_id is None:
            _sync_postgres_sequence(db, "events")
        _sync_postgres_sequence(db, "slots")
        db.commit()
    except Exception:
        db.rollback()
        for path in installed:
            path.unlink(missing_ok=True)
        raise
    for path in ([logo_directory() / old_logo] if old_logo else []) + [
        photo_directory() / filename for filename in old_photos
    ]:
        try:
            path.unlink(missing_ok=True)
        except OSError:
            logger.warning(
                "Alte Bilddatei konnte nach Restore nicht entfernt werden: %s", path
            )
    return {**summary, "event_id": event.id}
