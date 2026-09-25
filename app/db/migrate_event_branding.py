from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine


def migrate_event_branding(engine: Engine) -> None:
    """Add optional branding fields to databases created before this feature."""
    columns = {
        "accent_color": "VARCHAR(7)",
        "logo_filename": "VARCHAR(100)",
    }
    with engine.begin() as connection:
        existing = {column["name"] for column in inspect(connection).get_columns("events")}
        for name, definition in columns.items():
            if name not in existing:
                connection.execute(text(f"ALTER TABLE events ADD COLUMN {name} {definition}"))
