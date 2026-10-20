from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine


def migrate_duty_order(engine: Engine) -> None:
    """Give existing duties their creation order as a stable display order."""
    with engine.begin() as connection:
        existing = {column["name"] for column in inspect(connection).get_columns("duties")}
        if "sort_order" not in existing:
            connection.execute(
                text("ALTER TABLE duties ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0")
            )
            rows = connection.execute(
                text(
                    "SELECT duties.id, duties.event_id "
                    "FROM duties LEFT JOIN slots ON slots.id = duties.slot_id "
                    "ORDER BY duties.event_id, "
                    "COALESCE(duties.start_time, slots.start_time), duties.id"
                )
            ).all()
            order = 0
            previous_event = None
            for duty_id, event_id in rows:
                if event_id != previous_event:
                    order = 0
                    previous_event = event_id
                connection.execute(
                    text("UPDATE duties SET sort_order = :sort_order WHERE id = :id"),
                    {"sort_order": order, "id": duty_id},
                )
                order += 1
