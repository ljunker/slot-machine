from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine


def migrate_program_published(engine: Engine) -> None:
    """Add the publication switch; existing events keep marking changes as before."""
    with engine.begin() as connection:
        columns = {column["name"] for column in inspect(connection).get_columns("events")}
        if "program_published" not in columns:
            connection.execute(text(
                "ALTER TABLE events ADD COLUMN program_published BOOLEAN NOT NULL DEFAULT TRUE"
            ))
