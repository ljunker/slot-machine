from datetime import date

from sqlalchemy import Boolean, Date, String, false
from sqlalchemy.orm import Mapped, mapped_column, relationship

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

    # Erst nach der Veröffentlichung markiert das Besucherprogramm Verschiebungen und Änderungen.
    program_published: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )

    accent_color: Mapped[str | None] = mapped_column(String(7), nullable=True)
    logo_filename: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Gestaltung des Besucherprogramms. None bedeutet jeweils Standarddesign.
    background_color: Mapped[str | None] = mapped_column(String(7), nullable=True)
    text_color: Mapped[str | None] = mapped_column(String(7), nullable=True)
    header_background_color: Mapped[str | None] = mapped_column(String(7), nullable=True)
    card_color: Mapped[str | None] = mapped_column(String(7), nullable=True)
    program_eyebrow: Mapped[str | None] = mapped_column(String(60), nullable=True)
    program_subtitle: Mapped[str | None] = mapped_column(String(160), nullable=True)
    website_url: Mapped[str | None] = mapped_column(String(255), nullable=True)
    header_graphic_filename: Mapped[str | None] = mapped_column(String(100), nullable=True)
    footer_graphic_filename: Mapped[str | None] = mapped_column(String(100), nullable=True)

    partner_logos = relationship(
        "PartnerLogo",
        order_by="(PartnerLogo.sort_order, PartnerLogo.id)",
        lazy="selectin",
        viewonly=True,
    )
    info_blocks = relationship(
        "InfoBlock",
        order_by="(InfoBlock.sort_order, InfoBlock.id)",
        lazy="selectin",
        viewonly=True,
    )

    @property
    def logo_url(self) -> str | None:
        return f"/api/events/{self.id}/logo" if self.logo_filename else None

    @property
    def header_graphic_url(self) -> str | None:
        return f"/api/events/{self.id}/graphics/header" if self.header_graphic_filename else None

    @property
    def footer_graphic_url(self) -> str | None:
        return f"/api/events/{self.id}/graphics/footer" if self.footer_graphic_filename else None
