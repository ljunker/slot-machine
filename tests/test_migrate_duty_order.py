from sqlalchemy import create_engine, text

from app.db.migrate_duty_order import migrate_duty_order


def test_existing_duties_keep_timeline_lane_order():
    engine = create_engine("sqlite://")
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE slots (id INTEGER PRIMARY KEY, start_time TIME)"))
        connection.execute(text("INSERT INTO slots (id, start_time) VALUES (1, '09:30')"))
        connection.execute(text(
            "CREATE TABLE duties (id INTEGER PRIMARY KEY, event_id INTEGER, "
            "slot_id INTEGER, start_time TIME)"
        ))
        connection.execute(text(
            "INSERT INTO duties (id, event_id, slot_id, start_time) VALUES "
            "(7, 1, NULL, '10:00'), (3, 1, NULL, '11:00'), "
            "(12, 1, 1, NULL), (20, 2, NULL, '12:00')"
        ))
    migrate_duty_order(engine)
    migrate_duty_order(engine)
    with engine.connect() as connection:
        rows = connection.execute(
            text("SELECT id, sort_order FROM duties ORDER BY id")
        ).all()
    assert rows == [(3, 2), (7, 1), (12, 0), (20, 0)]
    engine.dispose()
