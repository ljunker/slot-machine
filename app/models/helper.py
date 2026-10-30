from sqlalchemy import Column, ForeignKey, Integer, Table

from app.db.base import Base

# Dienstbelegungen referenzieren ausschließlich Benutzerkonten.
duty_users = Table(
    "duty_users",
    Base.metadata,
    Column("duty_id", Integer, ForeignKey("duties.id"), primary_key=True),
    Column("user_id", Integer, ForeignKey("users.id"), primary_key=True),
)
