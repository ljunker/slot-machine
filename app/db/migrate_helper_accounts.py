"""Replace standalone helpers with account-backed duty assignments."""

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

from app.models.helper import duty_users


def migrate_helper_accounts(engine: Engine) -> None:
    with engine.begin() as connection:
        inspector = inspect(connection)
        if "name" not in {c["name"] for c in inspector.get_columns("users")}:
            connection.execute(text("ALTER TABLE users ADD COLUMN name VARCHAR(255)"))
        if "capacity" not in {c["name"] for c in inspector.get_columns("duties")}:
            connection.execute(text(
                "ALTER TABLE duties ADD COLUMN capacity INTEGER NOT NULL DEFAULT 1 "
                "CHECK (capacity > 0)"
            ))
        tables = set(inspector.get_table_names())
        # Der ausdrücklich gewünschte Umstieg verwirft alte Profile und Belegungen.
        if "duty_helpers" in tables:
            connection.execute(text("DROP TABLE duty_helpers"))
        if "helpers" in tables:
            connection.execute(text("DROP TABLE helpers"))
        duty_users.create(connection, checkfirst=True)
