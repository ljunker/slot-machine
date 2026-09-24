from datetime import time
from time import time as epoch_time

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    ForeignKey,
    String,
    Text,
    Time,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class Slot(Base):
    __tablename__ = "slots"
    __table_args__ = (
        CheckConstraint(
            "(day_id IS NULL AND room_id IS NULL AND start_time IS NULL AND end_time IS NULL) "
            "OR (day_id IS NOT NULL AND room_id IS NOT NULL AND start_time IS NOT NULL AND end_time IS NOT NULL)",
            name="slot_planning_complete",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)

    event_id: Mapped[int] = mapped_column(ForeignKey("events.id"), nullable=False)

    day_id: Mapped[int | None] = mapped_column(
        ForeignKey("event_days.id"),
        nullable=True,
    )

    room_id: Mapped[int | None] = mapped_column(
        ForeignKey("rooms.id"),
        nullable=True,
    )

    topic: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    description: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    start_time: Mapped[time | None] = mapped_column(
        Time,
        nullable=True,
    )

    end_time: Mapped[time | None] = mapped_column(
        Time,
        nullable=True,
    )

    is_cancelled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    schedule_changed_at: Mapped[int | None] = mapped_column(BigInteger)
    content_changed_at: Mapped[int | None] = mapped_column(BigInteger)
    previous_start_time: Mapped[time | None] = mapped_column(Time)
    previous_end_time: Mapped[time | None] = mapped_column(Time)
    previous_room_name: Mapped[str | None] = mapped_column(String(255))

    speakers = relationship(
        "Speaker",
        secondary="slot_speakers",
        back_populates="slots",
        order_by="Speaker.id",
    )

    @property
    def speaker_ids(self) -> list[int]:
        return [speaker.id for speaker in self.speakers]

    @property
    def change_notice(self) -> dict | None:
        if self.day_id is None:
            return None
        if self.is_cancelled:
            return {"type": "cancelled", "expires_at": None}
        now = int(epoch_time())
        if (
            self.schedule_changed_at is not None
            and now < self.schedule_changed_at + 86400
        ):
            return {
                "type": "rescheduled",
                "expires_at": self.schedule_changed_at + 86400,
                "previous_start_time": self.previous_start_time,
                "previous_end_time": self.previous_end_time,
                "previous_room_name": self.previous_room_name,
            }
        if (
            self.content_changed_at is not None
            and now < self.content_changed_at + 86400
        ):
            return {"type": "updated", "expires_at": self.content_changed_at + 86400}
        return None
