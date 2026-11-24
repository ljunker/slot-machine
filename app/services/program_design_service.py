from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.event import Event
from app.models.program_design import InfoBlock, PartnerLogo
from app.schemas.event import (
    InfoBlockCreate,
    InfoBlockUpdate,
    PartnerLogoCreate,
    PartnerLogoUpdate,
)
from app.services.errors import DomainError, NotFound
from app.services.event_branding import (
    clear_image,
    optional_text,
    remove_logo_file,
    replace_image,
    web_url,
)
from app.services.validation import required_patch

MAX_INFO_BODY = 4000


def _required_text(value: str, limit: int, label: str) -> str:
    result = optional_text(value, limit, label)
    if result is None:
        raise DomainError(f"{label} darf nicht leer sein")
    return result


def _body(value: str) -> str:
    result = "\n".join(line.rstrip() for line in value.replace("\r\n", "\n").split("\n")).strip()
    if len(result) > MAX_INFO_BODY:
        raise DomainError(f"Text darf höchstens {MAX_INFO_BODY} Zeichen lang sein")
    return result


class ProgramDesignService:
    def __init__(self, db: Session):
        self.db = db

    def _event(self, event_id: int) -> Event:
        event = self.db.get(Event, event_id)
        if event is None:
            raise NotFound("Veranstaltung nicht gefunden")
        return event

    def _refresh(self, event_id: int) -> None:
        """Drop cached partner/info lists so the next event response shows the change."""
        event = self.db.get(Event, event_id)
        if event is not None:
            self.db.expire(event, ["partner_logos", "info_blocks"])

    def _next_order(self, model, event_id: int) -> int:
        current = self.db.scalar(select(func.max(model.sort_order)).where(model.event_id == event_id))
        return 0 if current is None else current + 1

    def _reorder(self, model, event_id: int, ids: list[int]) -> None:
        self._event(event_id)
        items = list(self.db.scalars(select(model).where(model.event_id == event_id)).all())
        if len(ids) != len(set(ids)) or set(ids) != {item.id for item in items}:
            raise DomainError("Reihenfolge muss alle Einträge genau einmal enthalten")
        positions = {item_id: index for index, item_id in enumerate(ids)}
        for item in items:
            item.sort_order = positions[item.id]
        self.db.commit()
        self._refresh(event_id)

    # Partnerlogos

    def partner(self, event_id: int, partner_id: int) -> PartnerLogo:
        partner = self.db.get(PartnerLogo, partner_id)
        if partner is None or partner.event_id != event_id:
            raise NotFound("Partnerlogo nicht gefunden")
        return partner

    def create_partner(self, event_id: int, data: PartnerLogoCreate) -> PartnerLogo:
        self._event(event_id)
        partner = PartnerLogo(
            event_id=event_id,
            name=_required_text(data.name, 120, "Name"),
            subtitle=optional_text(data.subtitle, 160, "Untertitel"),
            url=web_url(data.url, "Link"),
            sort_order=self._next_order(PartnerLogo, event_id),
        )
        self.db.add(partner)
        self.db.commit()
        self._refresh(event_id)
        return partner

    def update_partner(self, event_id: int, partner_id: int, data: PartnerLogoUpdate) -> PartnerLogo:
        partner = self.partner(event_id, partner_id)
        changes = data.model_dump(exclude_unset=True)
        required_patch(changes, {"name"})
        if "name" in changes:
            partner.name = _required_text(changes["name"], 120, "Name")
        if "subtitle" in changes:
            partner.subtitle = optional_text(changes["subtitle"], 160, "Untertitel")
        if "url" in changes:
            partner.url = web_url(changes["url"], "Link")
        self.db.commit()
        self._refresh(event_id)
        return partner

    def delete_partner(self, event_id: int, partner_id: int) -> None:
        partner = self.partner(event_id, partner_id)
        image = partner.image_filename
        self.db.delete(partner)
        self.db.commit()
        self._refresh(event_id)
        remove_logo_file(image)

    def upload_partner_image(self, event_id: int, partner_id: int, content: bytes) -> PartnerLogo:
        partner = self.partner(event_id, partner_id)
        replace_image(self.db, partner, "image_filename", content, "Partnerlogo")
        self._refresh(event_id)
        return partner

    def delete_partner_image(self, event_id: int, partner_id: int) -> PartnerLogo:
        partner = self.partner(event_id, partner_id)
        clear_image(self.db, partner, "image_filename")
        self._refresh(event_id)
        return partner

    def reorder_partners(self, event_id: int, ids: list[int]) -> None:
        self._reorder(PartnerLogo, event_id, ids)

    # Infoblöcke

    def info_block(self, event_id: int, block_id: int) -> InfoBlock:
        block = self.db.get(InfoBlock, block_id)
        if block is None or block.event_id != event_id:
            raise NotFound("Infoblock nicht gefunden")
        return block

    def create_info_block(self, event_id: int, data: InfoBlockCreate) -> InfoBlock:
        self._event(event_id)
        block = InfoBlock(
            event_id=event_id,
            title=_required_text(data.title, 120, "Titel"),
            body=_body(data.body),
            sort_order=self._next_order(InfoBlock, event_id),
        )
        self.db.add(block)
        self.db.commit()
        self._refresh(event_id)
        return block

    def update_info_block(self, event_id: int, block_id: int, data: InfoBlockUpdate) -> InfoBlock:
        block = self.info_block(event_id, block_id)
        changes = data.model_dump(exclude_unset=True)
        required_patch(changes, {"title", "body"})
        if "title" in changes:
            block.title = _required_text(changes["title"], 120, "Titel")
        if "body" in changes:
            block.body = _body(changes["body"])
        self.db.commit()
        self._refresh(event_id)
        return block

    def delete_info_block(self, event_id: int, block_id: int) -> None:
        self.db.delete(self.info_block(event_id, block_id))
        self.db.commit()
        self._refresh(event_id)

    def reorder_info_blocks(self, event_id: int, ids: list[int]) -> None:
        self._reorder(InfoBlock, event_id, ids)
