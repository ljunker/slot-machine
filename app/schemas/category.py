from pydantic import BaseModel, ConfigDict


class CategoryCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str
    color: str


class CategoryUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = None
    color: str | None = None


class CategoryResponse(CategoryCreate):
    model_config = ConfigDict(from_attributes=True)
    id: int
    event_id: int


class CategorySummary(CategoryCreate):
    model_config = ConfigDict(from_attributes=True)
    id: int
