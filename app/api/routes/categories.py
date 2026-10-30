from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.models.auth import User
from app.models.category import Category
from app.schemas.category import CategoryCreate, CategoryResponse, CategoryUpdate
from app.services.auth import authorize_event, authorize_object, require_user
from app.services.category_service import CategoryService

router = APIRouter(tags=["Categories"], dependencies=[Depends(require_user)])


@router.get("/events/{event_id}/categories", response_model=list[CategoryResponse])
def list_categories(event_id: int, db: Session = Depends(get_db), user: User = Depends(require_user)):
    authorize_event(db, user, event_id, "helper")
    return CategoryService(db).list_for_event(event_id)


@router.post("/events/{event_id}/categories", response_model=CategoryResponse,
             status_code=status.HTTP_201_CREATED)
def create_category(event_id: int, data: CategoryCreate, db: Session = Depends(get_db),
                    user: User = Depends(require_user)):
    authorize_event(db, user, event_id, "admin")
    return CategoryService(db).create(event_id, data)


@router.patch("/categories/{category_id}", response_model=CategoryResponse)
def update_category(category_id: int, data: CategoryUpdate, db: Session = Depends(get_db),
                    user: User = Depends(require_user)):
    authorize_object(db, user, Category, category_id, "admin")
    return CategoryService(db).update(category_id, data)


@router.delete("/categories/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_category(category_id: int, db: Session = Depends(get_db), user: User = Depends(require_user)):
    authorize_object(db, user, Category, category_id, "admin")
    CategoryService(db).delete(category_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
