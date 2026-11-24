from fastapi import APIRouter, Depends, File, Response, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.models.auth import EventMembership, User
from app.models.event import Event
from app.schemas.event import (
    EventCreate,
    EventResponse,
    EventUpdate,
    InfoBlockCreate,
    InfoBlockResponse,
    InfoBlockUpdate,
    OrderUpdate,
    PartnerLogoCreate,
    PartnerLogoResponse,
    PartnerLogoUpdate,
)
from app.schemas.program_export import ProgramExport
from app.schemas.slot import PublicSessionResponse, SlotResponse
from app.services.auth import authorize_event, require_superadmin, require_user
from app.services.errors import NotFound
from app.services.event_branding import (
    LOGO_MIME,
    MAX_LOGO_BYTES,
    EventBrandingService,
    GraphicSlot,
    graphic_path,
    image_file,
    logo_path,
)
from app.services.event_service import EventService
from app.services.program_design_service import ProgramDesignService
from app.services.program_export import build_program_export
from app.services.program_pdf import build_program_pdf
from app.services.slot_service import SlotService

router = APIRouter(
    prefix="/events",
    tags=["Events"],
    dependencies=[Depends(require_user)],
)
public_router = APIRouter(prefix="/events", tags=["Public Program"])


@router.get("", response_model=list[EventResponse])
def get_events(db: Session = Depends(get_db), user: User = Depends(require_user)):
    if user.is_superadmin:
        return EventService(db).get_all()
    return list(db.scalars(
        select(Event).join(EventMembership, EventMembership.event_id == Event.id)
        .where(EventMembership.user_id == user.id)
        .order_by(Event.start_date, Event.id)
    ).all())


@router.post("", response_model=EventResponse, status_code=status.HTTP_201_CREATED)
def create_event(data: EventCreate, db: Session = Depends(get_db), user: User = Depends(require_superadmin)):
    return EventService(db).create(data)


@public_router.get("/{event_id}", response_model=EventResponse)
def get_event(event_id: int, db: Session = Depends(get_db)):
    return EventService(db).get(event_id)


@router.get("/{event_id}/unplanned-sessions", response_model=list[SlotResponse])
def get_unplanned_sessions(event_id: int, db: Session = Depends(get_db), user: User = Depends(require_user)):
    authorize_event(db, user, event_id, "helper")
    return SlotService(db).get_unplanned_for_event(event_id)


@public_router.get("/{event_id}/sessions/{slot_id}", response_model=PublicSessionResponse)
def get_public_session(event_id: int, slot_id: int, db: Session = Depends(get_db)):
    return SlotService(db).get_public_session(event_id, slot_id)


@router.delete("/{event_id}/rescheduled-notices", status_code=status.HTTP_204_NO_CONTENT)
def clear_event_rescheduled_notices(event_id: int, db: Session = Depends(get_db), user: User = Depends(require_user)):
    authorize_event(db, user, event_id)
    SlotService(db).clear_event_rescheduled_notices(event_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/{event_id}/change-notices", status_code=status.HTTP_204_NO_CONTENT)
def clear_event_change_notices(event_id: int, db: Session = Depends(get_db), user: User = Depends(require_user)):
    authorize_event(db, user, event_id)
    SlotService(db).clear_event_change_notices(event_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@public_router.get("/{event_id}/program.pdf")
def get_program_pdf(event_id: int, db: Session = Depends(get_db)):
    data = build_program_pdf(db, event_id)
    return Response(
        content=data,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="programm-{event_id}.pdf"',
            "Cache-Control": "no-store",
        },
    )


@router.get("/{event_id}/program.json", response_model=ProgramExport)
def get_program_export(event_id: int, response: Response, db: Session = Depends(get_db), user: User = Depends(require_user)):
    authorize_event(db, user, event_id, "helper")
    response.headers["Content-Disposition"] = f'attachment; filename="programm-{event_id}.json"'
    response.headers["Cache-Control"] = "no-store"
    return build_program_export(db, event_id)


@router.post("/{event_id}/logo", response_model=EventResponse)
async def upload_logo(
    event_id: int, logo: UploadFile = File(...), db: Session = Depends(get_db), user: User = Depends(require_user)
):
    authorize_event(db, user, event_id, "admin")
    content = await logo.read(MAX_LOGO_BYTES + 1)
    return EventBrandingService(db).upload_logo(event_id, content)


@public_router.get("/{event_id}/logo")
def get_logo(event_id: int, db: Session = Depends(get_db)):
    return _image_response(logo_path(EventService(db).get(event_id)), "Logo nicht gefunden")


@router.delete("/{event_id}/logo", response_model=EventResponse)
def delete_logo(event_id: int, db: Session = Depends(get_db), user: User = Depends(require_user)):
    authorize_event(db, user, event_id, "admin")
    return EventBrandingService(db).delete_logo(event_id)


def _image_response(path, missing: str) -> FileResponse:
    if path is None or not path.is_file():
        raise NotFound(missing)
    return FileResponse(
        path, media_type=LOGO_MIME[path.suffix.lstrip(".")],
        headers={"Cache-Control": "no-store"},
    )


@router.post("/{event_id}/graphics/{slot}", response_model=EventResponse)
async def upload_graphic(
    event_id: int, slot: GraphicSlot, image: UploadFile = File(...),
    db: Session = Depends(get_db), user: User = Depends(require_user),
):
    authorize_event(db, user, event_id, "admin")
    content = await image.read(MAX_LOGO_BYTES + 1)
    return EventBrandingService(db).upload_graphic(event_id, slot, content)


@public_router.get("/{event_id}/graphics/{slot}")
def get_graphic(event_id: int, slot: GraphicSlot, db: Session = Depends(get_db)):
    return _image_response(graphic_path(EventService(db).get(event_id), slot), "Grafik nicht gefunden")


@router.delete("/{event_id}/graphics/{slot}", response_model=EventResponse)
def delete_graphic(event_id: int, slot: GraphicSlot, db: Session = Depends(get_db), user: User = Depends(require_user)):
    authorize_event(db, user, event_id, "admin")
    return EventBrandingService(db).delete_graphic(event_id, slot)


@router.post("/{event_id}/partner-logos", response_model=PartnerLogoResponse, status_code=status.HTTP_201_CREATED)
def create_partner_logo(
    event_id: int, data: PartnerLogoCreate, db: Session = Depends(get_db), user: User = Depends(require_user)
):
    authorize_event(db, user, event_id, "admin")
    return ProgramDesignService(db).create_partner(event_id, data)


@router.put("/{event_id}/partner-logos/order", status_code=status.HTTP_204_NO_CONTENT)
def reorder_partner_logos(
    event_id: int, data: OrderUpdate, db: Session = Depends(get_db), user: User = Depends(require_user)
):
    authorize_event(db, user, event_id, "admin")
    ProgramDesignService(db).reorder_partners(event_id, data.ids)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch("/{event_id}/partner-logos/{partner_id}", response_model=PartnerLogoResponse)
def update_partner_logo(
    event_id: int, partner_id: int, data: PartnerLogoUpdate,
    db: Session = Depends(get_db), user: User = Depends(require_user),
):
    authorize_event(db, user, event_id, "admin")
    return ProgramDesignService(db).update_partner(event_id, partner_id, data)


@router.delete("/{event_id}/partner-logos/{partner_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_partner_logo(event_id: int, partner_id: int, db: Session = Depends(get_db), user: User = Depends(require_user)):
    authorize_event(db, user, event_id, "admin")
    ProgramDesignService(db).delete_partner(event_id, partner_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{event_id}/partner-logos/{partner_id}/image", response_model=PartnerLogoResponse)
async def upload_partner_image(
    event_id: int, partner_id: int, image: UploadFile = File(...),
    db: Session = Depends(get_db), user: User = Depends(require_user),
):
    authorize_event(db, user, event_id, "admin")
    content = await image.read(MAX_LOGO_BYTES + 1)
    return ProgramDesignService(db).upload_partner_image(event_id, partner_id, content)


@public_router.get("/{event_id}/partner-logos/{partner_id}/image")
def get_partner_image(event_id: int, partner_id: int, db: Session = Depends(get_db)):
    partner = ProgramDesignService(db).partner(event_id, partner_id)
    return _image_response(image_file(partner.image_filename), "Partnerlogo nicht gefunden")


@router.delete("/{event_id}/partner-logos/{partner_id}/image", response_model=PartnerLogoResponse)
def delete_partner_image(event_id: int, partner_id: int, db: Session = Depends(get_db), user: User = Depends(require_user)):
    authorize_event(db, user, event_id, "admin")
    return ProgramDesignService(db).delete_partner_image(event_id, partner_id)


@router.post("/{event_id}/info-blocks", response_model=InfoBlockResponse, status_code=status.HTTP_201_CREATED)
def create_info_block(
    event_id: int, data: InfoBlockCreate, db: Session = Depends(get_db), user: User = Depends(require_user)
):
    authorize_event(db, user, event_id, "admin")
    return ProgramDesignService(db).create_info_block(event_id, data)


@router.put("/{event_id}/info-blocks/order", status_code=status.HTTP_204_NO_CONTENT)
def reorder_info_blocks(
    event_id: int, data: OrderUpdate, db: Session = Depends(get_db), user: User = Depends(require_user)
):
    authorize_event(db, user, event_id, "admin")
    ProgramDesignService(db).reorder_info_blocks(event_id, data.ids)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch("/{event_id}/info-blocks/{block_id}", response_model=InfoBlockResponse)
def update_info_block(
    event_id: int, block_id: int, data: InfoBlockUpdate,
    db: Session = Depends(get_db), user: User = Depends(require_user),
):
    authorize_event(db, user, event_id, "admin")
    return ProgramDesignService(db).update_info_block(event_id, block_id, data)


@router.delete("/{event_id}/info-blocks/{block_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_info_block(event_id: int, block_id: int, db: Session = Depends(get_db), user: User = Depends(require_user)):
    authorize_event(db, user, event_id, "admin")
    ProgramDesignService(db).delete_info_block(event_id, block_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch("/{event_id}", response_model=EventResponse)
def update_event(event_id: int, data: EventUpdate, db: Session = Depends(get_db), user: User = Depends(require_user)):
    authorize_event(db, user, event_id, "admin")
    return EventService(db).update(event_id, data)


@router.delete("/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_event(event_id: int, db: Session = Depends(get_db), user: User = Depends(require_superadmin)):
    EventService(db).delete(event_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
