from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine


def migrate_unplanned_sessions(engine: Engine) -> None:
    """Keep existing slot IDs while making planning optional."""
    with engine.connect() as connection:
        columns = {column["name"] for column in inspect(connection).get_columns("slots")}
        if "event_id" in columns:
            return
        missing_days = connection.scalar(text(
            "SELECT COUNT(*) FROM slots LEFT JOIN event_days ON event_days.id = slots.day_id "
            "WHERE event_days.id IS NULL"
        ))
        if missing_days:
            raise RuntimeError("Slots ohne Veranstaltungstag können nicht migriert werden")
        connection.commit()

        if engine.dialect.name == "sqlite":
            foreign_keys = connection.exec_driver_sql("PRAGMA foreign_keys").scalar()
            connection.commit()
            if foreign_keys:
                connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
                connection.commit()
            try:
                with connection.begin():
                    connection.exec_driver_sql("""
                        CREATE TABLE slots_unplanned_new (
                            id INTEGER PRIMARY KEY,
                            event_id INTEGER NOT NULL REFERENCES events(id),
                            day_id INTEGER REFERENCES event_days(id),
                            room_id INTEGER REFERENCES rooms(id),
                            topic VARCHAR(255) NOT NULL,
                            description TEXT,
                            start_time TIME,
                            end_time TIME,
                            is_cancelled BOOLEAN NOT NULL DEFAULT FALSE,
                            schedule_changed_at BIGINT,
                            content_changed_at BIGINT,
                            previous_start_time TIME,
                            previous_end_time TIME,
                            previous_room_name VARCHAR(255),
                            CONSTRAINT slot_planning_complete CHECK (
                                (day_id IS NULL AND room_id IS NULL AND start_time IS NULL AND end_time IS NULL)
                                OR (day_id IS NOT NULL AND room_id IS NOT NULL AND start_time IS NOT NULL AND end_time IS NOT NULL)
                            )
                        )
                    """)
                    connection.exec_driver_sql("""
                        INSERT INTO slots_unplanned_new (
                            id, event_id, day_id, room_id, topic, description, start_time,
                            end_time, is_cancelled, schedule_changed_at, content_changed_at,
                            previous_start_time, previous_end_time, previous_room_name
                        )
                        SELECT slots.id, event_days.event_id, slots.day_id, slots.room_id,
                            slots.topic, slots.description, slots.start_time, slots.end_time,
                            slots.is_cancelled, slots.schedule_changed_at, slots.content_changed_at,
                            slots.previous_start_time, slots.previous_end_time, slots.previous_room_name
                        FROM slots JOIN event_days ON event_days.id = slots.day_id
                    """)
                    connection.exec_driver_sql("DROP TABLE slots")
                    connection.exec_driver_sql("ALTER TABLE slots_unplanned_new RENAME TO slots")
                    if connection.exec_driver_sql("PRAGMA foreign_key_check").first():
                        raise RuntimeError("Fremdschlüssel nach Slot-Migration ungültig")
            finally:
                if foreign_keys:
                    connection.exec_driver_sql("PRAGMA foreign_keys=ON")
                    connection.commit()
        elif engine.dialect.name == "postgresql":
            with connection.begin():
                connection.execute(text("ALTER TABLE slots ADD COLUMN event_id INTEGER"))
                connection.execute(text(
                    "UPDATE slots SET event_id = event_days.event_id FROM event_days "
                    "WHERE slots.day_id = event_days.id"
                ))
                connection.execute(text("ALTER TABLE slots ALTER COLUMN event_id SET NOT NULL"))
                for column in ("day_id", "room_id", "start_time", "end_time"):
                    connection.execute(text(f"ALTER TABLE slots ALTER COLUMN {column} DROP NOT NULL"))
                connection.execute(text(
                    "ALTER TABLE slots ADD CONSTRAINT slots_event_id_fkey "
                    "FOREIGN KEY (event_id) REFERENCES events(id)"
                ))
                connection.execute(text("""
                    ALTER TABLE slots ADD CONSTRAINT slot_planning_complete CHECK (
                        (day_id IS NULL AND room_id IS NULL AND start_time IS NULL AND end_time IS NULL)
                        OR (day_id IS NOT NULL AND room_id IS NOT NULL AND start_time IS NOT NULL AND end_time IS NOT NULL)
                    )
                """))
        else:
            raise RuntimeError(f"Slot-Migration für {engine.dialect.name} nicht unterstützt")
