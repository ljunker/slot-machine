from datetime import date

from sqlalchemy import Date, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Event(Base):
    __tablename__ = "events"

    id: Mapped[int] = mapped_column(primary_key=True)

    name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    start_date: Mapped[date] = mapped_column(
        Date,
        nullable=False,
    )

    end_date: Mapped[date] = mapped_column(
        Date,
        nullable=False,
    )

    accent_color: Mapped[str | None] = mapped_column(String(7), nullable=True)
    logo_filename: Mapped[str | None] = mapped_column(String(100), nullable=True)

    @property
    def logo_url(self) -> str | None:
        return f"/api/events/{self.id}/logo" if self.logo_filename else None
