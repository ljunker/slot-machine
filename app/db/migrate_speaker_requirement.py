from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine


def migrate_speaker_requirement(engine: Engine) -> None:
    """Add the internal speaker requirement without changing existing sessions."""
    with engine.begin() as connection:
        columns = {column["name"] for column in inspect(connection).get_columns("slots")}
        if "speaker_required" not in columns:
            connection.execute(text(
                "ALTER TABLE slots ADD COLUMN speaker_required BOOLEAN NOT NULL DEFAULT TRUE"
            ))
