from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine


def migrate_slot_changes(engine: Engine) -> None:
    """Add change markers to databases created before this feature."""
    columns = {
        "is_cancelled": "BOOLEAN NOT NULL DEFAULT FALSE",
        "schedule_changed_at": "BIGINT",
        "content_changed_at": "BIGINT",
        "previous_start_time": "TIME",
        "previous_end_time": "TIME",
        "previous_room_name": "VARCHAR(255)",
    }
    with engine.begin() as connection:
        existing = {
            column["name"] for column in inspect(connection).get_columns("slots")
        }
        for name, definition in columns.items():
            if name not in existing:
                connection.execute(
                    text(f"ALTER TABLE slots ADD COLUMN {name} {definition}")
                )
