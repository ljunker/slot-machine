from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.schemas.slot import (
    SlotCreate,
    SlotResponse,
    SlotUpdate,
)
from app.services.slot_service import SlotService

router = APIRouter(
    prefix="/slots",
    tags=["Slots"],
)


@router.post(
    "",
    response_model=SlotResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_slot(
    data: SlotCreate,
    db: Session = Depends(get_db),
):
    service = SlotService(db)

    return service.create(data)


@router.patch(
    "/{slot_id}",
    response_model=SlotResponse,
)
def update_slot(
    slot_id: int,
    data: SlotUpdate,
    db: Session = Depends(get_db),
):
    service = SlotService(db)

    return service.update(slot_id, data)


@router.delete(
    "/{slot_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_slot(
    slot_id: int,
    db: Session = Depends(get_db),
):
    service = SlotService(db)

    service.delete(slot_id)

    return Response(status_code=status.HTTP_204_NO_CONTENT)
