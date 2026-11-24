from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

PROGRAM_DESIGN_COLUMNS = {
    "background_color": "VARCHAR(7)",
    "text_color": "VARCHAR(7)",
    "header_background_color": "VARCHAR(7)",
    "card_color": "VARCHAR(7)",
    "program_eyebrow": "VARCHAR(60)",
    "program_subtitle": "VARCHAR(160)",
    "website_url": "VARCHAR(255)",
    "header_graphic_filename": "VARCHAR(100)",
    "footer_graphic_filename": "VARCHAR(100)",
}


def migrate_program_design(engine: Engine) -> None:
    """Add visitor program design fields to databases created before this feature.

    The new tables for partner logos and info blocks are created by create_all.
    """
    with engine.begin() as connection:
        existing = {column["name"] for column in inspect(connection).get_columns("events")}
        for name, definition in PROGRAM_DESIGN_COLUMNS.items():
            if name not in existing:
                connection.execute(text(f"ALTER TABLE events ADD COLUMN {name} {definition}"))
