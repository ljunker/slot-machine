from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.models.auth import User
from app.models.event_day import EventDay
from app.schemas.schedule import DaySchedule
from app.services.auth import authorize_object, require_user
from app.services.schedule_service import ScheduleService

router = APIRouter(
    prefix="/schedule",
    tags=["Schedule"],
    dependencies=[Depends(require_user)],
)


@router.get(
    "/days/{day_id}",
    response_model=DaySchedule,
)
def get_day_schedule(
    day_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
):
    authorize_object(db, user, EventDay, day_id)
    service = ScheduleService(db)

    return service.get_day_schedule(day_id)
