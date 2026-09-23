from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.schemas.schedule import DaySchedule
from app.services.schedule_service import ScheduleService

router = APIRouter(
    prefix="/schedule",
    tags=["Schedule"],
)


@router.get(
    "/days/{day_id}",
    response_model=DaySchedule,
)
def get_day_schedule(
    day_id: int,
    db: Session = Depends(get_db),
):
    service = ScheduleService(db)

    return service.get_day_schedule(day_id)
