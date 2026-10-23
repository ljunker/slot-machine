import re

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.category import Category, slot_categories
from app.models.event import Event
from app.schemas.category import CategoryCreate, CategoryUpdate
from app.services.errors import Conflict, DomainError, NotFound
from app.services.validation import name, required_patch


def category_color(value: str) -> str:
    if not re.fullmatch(r"#[0-9A-Fa-f]{6}", value):
        raise DomainError("Farbe muss #RRGGBB sein")
    return value.upper()


class CategoryService:
    def __init__(self, db: Session):
        self.db = db

    def get(self, category_id: int) -> Category:
        category = self.db.get(Category, category_id)
        if category is None:
            raise NotFound("Kategorie nicht gefunden")
        return category

    def list_for_event(self, event_id: int) -> list[Category]:
        if self.db.get(Event, event_id) is None:
            raise NotFound("Veranstaltung nicht gefunden")
        return list(self.db.scalars(
            select(Category).where(Category.event_id == event_id).order_by(Category.name, Category.id)
        ).all())

    def _name(self, event_id: int, value: str, own_id: int | None = None) -> tuple[str, str]:
        display = name(value)
        if len(display) > 255:
            raise DomainError("Kategoriename ist zu lang")
        normalized = display.casefold()
        other = self.db.scalar(select(Category.id).where(
            Category.event_id == event_id, Category.normalized_name == normalized
        ))
        if other is not None and other != own_id:
            raise Conflict("Kategoriename existiert bereits")
        return display, normalized

    def create(self, event_id: int, data: CategoryCreate) -> Category:
        if self.db.get(Event, event_id) is None:
            raise NotFound("Veranstaltung nicht gefunden")
        display, normalized = self._name(event_id, data.name)
        category = Category(event_id=event_id, name=display,
                            normalized_name=normalized, color=category_color(data.color))
        self.db.add(category)
        try:
            self.db.commit()
        except IntegrityError as error:
            self.db.rollback()
            raise Conflict("Kategoriename existiert bereits") from error
        return category

    def update(self, category_id: int, data: CategoryUpdate) -> Category:
        category = self.get(category_id)
        changes = data.model_dump(exclude_unset=True)
        required_patch(changes, {"name", "color"})
        display = normalized = color = None
        if "name" in changes:
            display, normalized = self._name(
                category.event_id, changes["name"], category.id
            )
        if "color" in changes:
            color = category_color(changes["color"])
        if display is not None:
            category.name, category.normalized_name = display, normalized
        if color is not None:
            category.color = color
        try:
            self.db.commit()
        except IntegrityError as error:
            self.db.rollback()
            raise Conflict("Kategoriename existiert bereits") from error
        return category

    def delete(self, category_id: int) -> None:
        category = self.get(category_id)
        self.db.execute(delete(slot_categories).where(slot_categories.c.category_id == category_id))
        self.db.delete(category)
        self.db.commit()
