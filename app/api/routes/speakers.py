from fastapi import APIRouter, Depends, File, Response, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.schemas.speaker import (
    SpeakerCreate,
    SpeakerDetail,
    SpeakerResponse,
    SpeakerUpdate,
)
from app.services.errors import NotFound
from app.services.speaker_service import (
    MAX_PHOTO_BYTES,
    PHOTO_MIME,
    SpeakerService,
    photo_directory,
)

router = APIRouter(tags=["Speakers"])


@router.get("/events/{event_id}/speakers", response_model=list[SpeakerResponse])
def list_speakers(event_id: int, db: Session = Depends(get_db)):
    return SpeakerService(db).list_for_event(event_id)


@router.post(
    "/events/{event_id}/speakers",
    response_model=SpeakerResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_speaker(event_id: int, data: SpeakerCreate, db: Session = Depends(get_db)):
    return SpeakerService(db).create(event_id, data)


@router.get("/speakers/{speaker_id}", response_model=SpeakerDetail)
def get_speaker(speaker_id: int, db: Session = Depends(get_db)):
    service = SpeakerService(db)
    speaker = service.get(speaker_id)
    return SpeakerDetail(
        **SpeakerResponse.model_validate(speaker).model_dump(),
        sessions=service.sessions(speaker_id),
    )


@router.patch("/speakers/{speaker_id}", response_model=SpeakerResponse)
def update_speaker(speaker_id: int, data: SpeakerUpdate, db: Session = Depends(get_db)):
    return SpeakerService(db).update(speaker_id, data)


@router.delete("/speakers/{speaker_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_speaker(speaker_id: int, db: Session = Depends(get_db)):
    SpeakerService(db).delete(speaker_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/speakers/{speaker_id}/photo", response_model=SpeakerResponse)
async def upload_photo(
    speaker_id: int, photo: UploadFile = File(...), db: Session = Depends(get_db)
):
    content = await photo.read(MAX_PHOTO_BYTES + 1)
    return SpeakerService(db).upload_photo(speaker_id, content)


@router.get("/speakers/{speaker_id}/photo")
def get_photo(speaker_id: int, db: Session = Depends(get_db)):
    speaker = SpeakerService(db).get(speaker_id)
    if not speaker.photo_filename:
        raise NotFound("Foto nicht gefunden")
    path = photo_directory() / speaker.photo_filename
    if not path.is_file():
        raise NotFound("Foto nicht gefunden")
    return FileResponse(path, media_type=PHOTO_MIME[path.suffix.lstrip(".")])


@router.delete("/speakers/{speaker_id}/photo", response_model=SpeakerResponse)
def delete_photo(speaker_id: int, db: Session = Depends(get_db)):
    return SpeakerService(db).delete_photo(speaker_id)
