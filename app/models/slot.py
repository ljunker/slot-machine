from datetime import time

from sqlalchemy import ForeignKey, String, Text, Time
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class Slot(Base):
    __tablename__ = "slots"

    id: Mapped[int] = mapped_column(primary_key=True)

    day_id: Mapped[int] = mapped_column(
        ForeignKey("event_days.id"),
        nullable=False,
    )

    room_id: Mapped[int] = mapped_column(
        ForeignKey("rooms.id"),
        nullable=False,
    )

    topic: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    description: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    start_time: Mapped[time] = mapped_column(
        Time,
        nullable=False,
    )

    end_time: Mapped[time] = mapped_column(
        Time,
        nullable=False,
    )

    speakers = relationship("Speaker", secondary="slot_speakers", back_populates="slots", order_by="Speaker.id")

    @property
    def speaker_ids(self) -> list[int]:
        return [speaker.id for speaker in self.speakers]
