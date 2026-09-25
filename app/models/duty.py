from datetime import time

from sqlalchemy import CheckConstraint, ForeignKey, String, Time
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.helper import duty_helpers


class Duty(Base):
    __tablename__ = "duties"
    __table_args__ = (
        CheckConstraint(
            "(kind = 'general' AND day_id IS NOT NULL AND room_id IS NULL AND slot_id IS NULL "
            "AND start_time IS NOT NULL AND end_time IS NOT NULL) OR "
            "(kind = 'room' AND day_id IS NOT NULL AND room_id IS NOT NULL AND slot_id IS NULL "
            "AND start_time IS NOT NULL AND end_time IS NOT NULL) OR "
            "(kind = 'session' AND day_id IS NULL AND room_id IS NULL AND slot_id IS NOT NULL "
            "AND start_time IS NULL AND end_time IS NULL)",
            name="duty_target_complete",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id"), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    title: Mapped[str | None] = mapped_column(String(255))
    day_id: Mapped[int | None] = mapped_column(ForeignKey("event_days.id"))
    room_id: Mapped[int | None] = mapped_column(ForeignKey("rooms.id"))
    slot_id: Mapped[int | None] = mapped_column(ForeignKey("slots.id"))
    start_time: Mapped[time | None] = mapped_column(Time)
    end_time: Mapped[time | None] = mapped_column(Time)
    helpers = relationship(
        "Helper", secondary=duty_helpers, back_populates="duties", order_by="Helper.id"
    )
