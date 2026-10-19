from fastapi import APIRouter, Depends, File, Form, Response, UploadFile
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.services.backup_service import (
    MAX_ARCHIVE_BYTES,
    build_backup,
    preview_backup,
    restore_backup,
)

router = APIRouter(prefix="/backups", tags=["Backups"])


@router.get("/events/{event_id}")
def download_backup(event_id: int, db: Session = Depends(get_db)):
    return Response(
        content=build_backup(db, event_id),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="veranstaltung-{event_id}-backup.zip"',
            "Cache-Control": "no-store",
        },
    )


@router.post("/preview")
async def preview(
    backup: UploadFile = File(...),
    target_event_id: int | None = Form(None),
    db: Session = Depends(get_db),
):
    content = await backup.read(MAX_ARCHIVE_BYTES + 1)
    return preview_backup(db, content, target_event_id)


@router.post("/restore")
async def restore(
    backup: UploadFile = File(...),
    target_event_id: int | None = Form(None),
    db: Session = Depends(get_db),
):
    content = await backup.read(MAX_ARCHIVE_BYTES + 1)
    return restore_backup(db, content, target_event_id)
