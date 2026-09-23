from sqlalchemy import Column, Integer, MetaData, String, Table, inspect, select, text
from sqlalchemy.engine import Engine

from app.models.speaker import Speaker, slot_speakers


def migrate_legacy_speakers(engine: Engine) -> None:
    """Import the old slots.speaker column once, in the marker transaction."""
    marker = Table(
        "data_migrations",
        MetaData(),
        Column("name", String(100), primary_key=True),
        Column("completed", Integer, nullable=False),
    )
    with engine.begin() as connection:
        marker.create(connection, checkfirst=True)
        if connection.scalar(
            select(marker.c.name).where(marker.c.name == "speaker_profiles_v1")
        ):
            return
        columns = {
            column["name"] for column in inspect(connection).get_columns("slots")
        }
        if "speaker" in columns:
            rows = connection.execute(
                text(
                    "SELECT slots.id AS slot_id, event_days.event_id, slots.speaker "
                    "FROM slots JOIN event_days ON event_days.id = slots.day_id "
                    "WHERE slots.speaker IS NOT NULL ORDER BY slots.id"
                )
            )
            for slot_id, event_id, raw_name in rows:
                speaker_name = raw_name.strip()
                if not speaker_name:
                    continue
                normalized = speaker_name.casefold()
                speaker_id = connection.scalar(
                    select(Speaker.id).where(
                        Speaker.event_id == event_id,
                        Speaker.normalized_name == normalized,
                    )
                )
                if speaker_id is None:
                    result = connection.execute(
                        Speaker.__table__.insert().values(
                            event_id=event_id,
                            name=speaker_name,
                            normalized_name=normalized,
                        )
                    )
                    speaker_id = result.inserted_primary_key[0]
                existing = connection.scalar(
                    select(slot_speakers.c.slot_id).where(
                        slot_speakers.c.slot_id == slot_id,
                        slot_speakers.c.speaker_id == speaker_id,
                    )
                )
                if existing is None:
                    connection.execute(
                        slot_speakers.insert().values(
                            slot_id=slot_id,
                            speaker_id=speaker_id,
                        )
                    )
        connection.execute(
            marker.insert().values(name="speaker_profiles_v1", completed=1)
        )
