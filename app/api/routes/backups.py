from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.models.auth import User
from app.services.auth import authorize_event, require_user
from app.services.backup_service import (
    MAX_ARCHIVE_BYTES,
    build_backup,
    preview_backup,
    restore_backup,
)

router = APIRouter(prefix="/backups", tags=["Backups"], dependencies=[Depends(require_user)])


@router.get("/events/{event_id}")
def download_backup(event_id: int, db: Session = Depends(get_db), user: User = Depends(require_user)):
    authorize_event(db, user, event_id, "admin")
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
    user: User = Depends(require_user),
):
    if target_event_id is None:
        if not user.is_superadmin:
            raise HTTPException(status_code=403, detail="Superadmin-Recht erforderlich")
    else:
        authorize_event(db, user, target_event_id, "admin")
    content = await backup.read(MAX_ARCHIVE_BYTES + 1)
    return preview_backup(db, content, target_event_id)


@router.post("/restore")
async def restore(
    backup: UploadFile = File(...),
    target_event_id: int | None = Form(None),
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
):
    if target_event_id is None:
        if not user.is_superadmin:
            raise HTTPException(status_code=403, detail="Superadmin-Recht erforderlich")
    else:
        authorize_event(db, user, target_event_id, "admin")
    content = await backup.read(MAX_ARCHIVE_BYTES + 1)
    return restore_backup(db, content, target_event_id)
