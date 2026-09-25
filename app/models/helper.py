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

duty_helpers = Table(
    "duty_helpers",
    Base.metadata,
    Column("duty_id", Integer, ForeignKey("duties.id"), primary_key=True),
    Column("helper_id", Integer, ForeignKey("helpers.id"), primary_key=True),
)


class Helper(Base):
    __tablename__ = "helpers"
    __table_args__ = (UniqueConstraint("event_id", "normalized_name"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    normalized_name: Mapped[str] = mapped_column(Text, nullable=False)
    duties = relationship("Duty", secondary=duty_helpers, back_populates="helpers")
