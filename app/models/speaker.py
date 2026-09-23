from sqlalchemy import (
    Column,
    ForeignKey,
    Integer,
    String,
    Table,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

slot_speakers = Table(
    "slot_speakers",
    Base.metadata,
    Column("slot_id", Integer, ForeignKey("slots.id"), primary_key=True),
    Column("speaker_id", Integer, ForeignKey("speakers.id"), primary_key=True),
)


class Speaker(Base):
    __tablename__ = "speakers"
    __table_args__ = (UniqueConstraint("event_id", "normalized_name"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    normalized_name: Mapped[str] = mapped_column(Text, nullable=False)
    bio: Mapped[str | None] = mapped_column(Text)
    website: Mapped[str | None] = mapped_column(String(2048))
    photo_filename: Mapped[str | None] = mapped_column(String(255))
    slots = relationship("Slot", secondary=slot_speakers, back_populates="speakers")

    @property
    def photo_url(self) -> str | None:
        return f"/api/speakers/{self.id}/photo" if self.photo_filename else None
