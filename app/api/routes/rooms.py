from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.models.auth import User
from app.models.room import Room
from app.schemas.room import (
    RoomCreate,
    RoomOrder,
    RoomResponse,
    RoomUpdate,
)
from app.services.auth import authorize_event, authorize_object, require_user
from app.services.room_service import RoomService

router = APIRouter(tags=["Rooms"], dependencies=[Depends(require_user)])


@router.get("/events/{event_id}/rooms", response_model=list[RoomResponse])
def get_rooms(event_id: int, db: Session = Depends(get_db), user: User = Depends(require_user)):
    authorize_event(db, user, event_id, "helper")
    return RoomService(db).get_for_event(event_id)


@router.patch("/events/{event_id}/rooms/order", response_model=list[RoomResponse])
def reorder_rooms(event_id: int, data: RoomOrder, db: Session = Depends(get_db), user: User = Depends(require_user)):
    authorize_event(db, user, event_id, "admin")
    return RoomService(db).reorder(event_id, data.room_ids)


@router.post(
    "/rooms",
    response_model=RoomResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_room(
    data: RoomCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
):
    authorize_event(db, user, data.event_id, "admin")
    return RoomService(db).create(data)


@router.patch(
    "/rooms/{room_id}",
    response_model=RoomResponse,
)
def update_room(
    room_id: int,
    data: RoomUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
):
    authorize_object(db, user, Room, room_id, "admin")
    return RoomService(db).update(room_id, data)


@router.delete("/rooms/{room_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_room(room_id: int, db: Session = Depends(get_db), user: User = Depends(require_user)):
    authorize_object(db, user, Room, room_id, "admin")
    RoomService(db).delete(room_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
