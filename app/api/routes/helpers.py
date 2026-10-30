from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.models.auth import User
from app.models.duty import Duty
from app.schemas.helper import (
    DutyCreate,
    DutyOrder,
    DutyParticipant,
    DutyResponse,
    DutyUpdate,
    HelperPlan,
)
from app.services.auth import authorize_event, authorize_object, require_user
from app.services.helper_service import HelperService

router = APIRouter(tags=["Helpers"], dependencies=[Depends(require_user)])


@router.get("/events/{event_id}/duty-participants", response_model=list[DutyParticipant])
def list_participants(event_id: int, db: Session = Depends(get_db), user: User = Depends(require_user)):
    authorize_event(db, user, event_id)
    return HelperService(db).list_participants(event_id)


@router.get("/events/{event_id}/helper-plan", response_model=HelperPlan)
def get_helper_plan(event_id: int, db: Session = Depends(get_db), user: User = Depends(require_user)):
    authorize_event(db, user, event_id, "helper")
    return HelperService(db).get_plan(event_id)


@router.post(
    "/events/{event_id}/duties",
    response_model=DutyResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_duty(event_id: int, data: DutyCreate, db: Session = Depends(get_db), user: User = Depends(require_user)):
    authorize_event(db, user, event_id)
    return HelperService(db).create_duty(event_id, data)


@router.patch("/events/{event_id}/duties/order", response_model=list[DutyResponse])
def reorder_duties(event_id: int, data: DutyOrder, db: Session = Depends(get_db), user: User = Depends(require_user)):
    authorize_event(db, user, event_id)
    return HelperService(db).reorder_duties(event_id, data)


@router.get("/duties/{duty_id}", response_model=DutyResponse)
def get_duty(duty_id: int, db: Session = Depends(get_db), user: User = Depends(require_user)):
    authorize_object(db, user, Duty, duty_id, "helper")
    return HelperService(db).get_duty_response(duty_id)


@router.patch("/duties/{duty_id}", response_model=DutyResponse)
def update_duty(duty_id: int, data: DutyUpdate, db: Session = Depends(get_db), user: User = Depends(require_user)):
    authorize_object(db, user, Duty, duty_id)
    return HelperService(db).update_duty(duty_id, data)


@router.delete("/duties/{duty_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_duty(duty_id: int, db: Session = Depends(get_db), user: User = Depends(require_user)):
    authorize_object(db, user, Duty, duty_id)
    HelperService(db).delete_duty(duty_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/duties/{duty_id}/signup", response_model=DutyResponse)
def signup(duty_id: int, db: Session = Depends(get_db), user: User = Depends(require_user)):
    authorize_object(db, user, Duty, duty_id, "helper")
    return HelperService(db).signup(duty_id, user)


@router.delete("/duties/{duty_id}/signup", response_model=DutyResponse)
def leave_duty(duty_id: int, db: Session = Depends(get_db), user: User = Depends(require_user)):
    authorize_object(db, user, Duty, duty_id, "helper")
    return HelperService(db).signup(duty_id, user, leave=True)
