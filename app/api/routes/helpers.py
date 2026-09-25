from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.schemas.helper import (
    DutyCreate,
    DutyResponse,
    DutyUpdate,
    HelperCreate,
    HelperPlan,
    HelperResponse,
    HelperUpdate,
)
from app.services.helper_service import HelperService

router = APIRouter(tags=["Helpers"])


@router.get("/events/{event_id}/helpers", response_model=list[HelperResponse])
def list_helpers(event_id: int, db: Session = Depends(get_db)):
    return HelperService(db).list_helpers(event_id)


@router.post(
    "/events/{event_id}/helpers",
    response_model=HelperResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_helper(event_id: int, data: HelperCreate, db: Session = Depends(get_db)):
    return HelperService(db).create_helper(event_id, data)


@router.get("/helpers/{helper_id}", response_model=HelperResponse)
def get_helper(helper_id: int, db: Session = Depends(get_db)):
    return HelperService(db).get_helper(helper_id)


@router.patch("/helpers/{helper_id}", response_model=HelperResponse)
def update_helper(helper_id: int, data: HelperUpdate, db: Session = Depends(get_db)):
    return HelperService(db).update_helper(helper_id, data)


@router.delete("/helpers/{helper_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_helper(helper_id: int, db: Session = Depends(get_db)):
    HelperService(db).delete_helper(helper_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/events/{event_id}/helper-plan", response_model=HelperPlan)
def get_helper_plan(event_id: int, db: Session = Depends(get_db)):
    return HelperService(db).get_plan(event_id)


@router.post(
    "/events/{event_id}/duties",
    response_model=DutyResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_duty(event_id: int, data: DutyCreate, db: Session = Depends(get_db)):
    return HelperService(db).create_duty(event_id, data)


@router.get("/duties/{duty_id}", response_model=DutyResponse)
def get_duty(duty_id: int, db: Session = Depends(get_db)):
    return HelperService(db).get_duty_response(duty_id)


@router.patch("/duties/{duty_id}", response_model=DutyResponse)
def update_duty(duty_id: int, data: DutyUpdate, db: Session = Depends(get_db)):
    return HelperService(db).update_duty(duty_id, data)


@router.delete("/duties/{duty_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_duty(duty_id: int, db: Session = Depends(get_db)):
    HelperService(db).delete_duty(duty_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
