from sqlalchemy import MetaData, inspect, text
from sqlalchemy.engine import Engine

from app.models.slot import Slot


def migrate_shared_sessions(engine: Engine) -> None:
    """Add room scope without changing session IDs or their dependent records."""
    with engine.connect() as connection:
        columns = {column["name"] for column in inspect(connection).get_columns("slots")}
        if "scope" in columns:
            return
        connection.commit()
        if engine.dialect.name == "sqlite":
            foreign_keys = connection.exec_driver_sql("PRAGMA foreign_keys").scalar()
            connection.commit()
            if foreign_keys:
                connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
                connection.commit()
            try:
                with connection.begin():
                    # SQLite's legacy transaction mode does not start a transaction for DDL.
                    connection.exec_driver_sql("BEGIN")
                    metadata = MetaData()
                    for table in Slot.metadata.tables.values():
                        table.to_metadata(metadata)
                    temporary = Slot.__table__.to_metadata(metadata, name="slots_shared_new")
                    temporary.create(connection)
                    names = [column.name for column in Slot.__table__.columns
                             if column.name != "scope" and column.name in columns]
                    fields = ", ".join(names)
                    connection.exec_driver_sql(
                        f"INSERT INTO slots_shared_new ({fields}, scope) SELECT {fields}, 'room' FROM slots"
                    )
                    connection.exec_driver_sql("DROP TABLE slots")
                    connection.exec_driver_sql("ALTER TABLE slots_shared_new RENAME TO slots")
                    if connection.exec_driver_sql("PRAGMA foreign_key_check").first():
                        raise RuntimeError("Fremdschlüssel nach Slot-Migration ungültig")
            finally:
                if foreign_keys:
                    connection.exec_driver_sql("PRAGMA foreign_keys=ON")
                    connection.commit()
        elif engine.dialect.name == "postgresql":
            with connection.begin():
                connection.execute(text(
                    "ALTER TABLE slots ADD COLUMN scope VARCHAR(16) NOT NULL DEFAULT 'room'"
                ))
                connection.execute(text("ALTER TABLE slots DROP CONSTRAINT slot_planning_complete"))
                for constraint in Slot.__table__.constraints:
                    if constraint.name in {"slot_planning_complete", "slot_scope_valid"}:
                        connection.execute(text(
                            f"ALTER TABLE slots ADD CONSTRAINT {constraint.name} CHECK ({constraint.sqltext})"
                        ))
        else:
            raise RuntimeError(f"Slot-Migration für {engine.dialect.name} nicht unterstützt")
