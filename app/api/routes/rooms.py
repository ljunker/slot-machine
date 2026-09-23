from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.schemas.room import (
    RoomCreate,
    RoomOrder,
    RoomResponse,
    RoomUpdate,
)
from app.services.room_service import RoomService

router = APIRouter(tags=["Rooms"])


@router.get("/events/{event_id}/rooms", response_model=list[RoomResponse])
def get_rooms(event_id: int, db: Session = Depends(get_db)):
    return RoomService(db).get_for_event(event_id)


@router.patch("/events/{event_id}/rooms/order", response_model=list[RoomResponse])
def reorder_rooms(event_id: int, data: RoomOrder, db: Session = Depends(get_db)):
    return RoomService(db).reorder(event_id, data.room_ids)


@router.post(
    "/rooms",
    response_model=RoomResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_room(
    data: RoomCreate,
    db: Session = Depends(get_db),
):
    return RoomService(db).create(data)


@router.patch(
    "/rooms/{room_id}",
    response_model=RoomResponse,
)
def update_room(
    room_id: int,
    data: RoomUpdate,
    db: Session = Depends(get_db),
):
    return RoomService(db).update(room_id, data)


@router.delete("/rooms/{room_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_room(room_id: int, db: Session = Depends(get_db)):
    RoomService(db).delete(room_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
