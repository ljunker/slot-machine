from pydantic import BaseModel, ConfigDict


class RoomCreate(BaseModel):
    event_id: int
    name: str


class RoomUpdate(BaseModel):
    name: str | None = None


class RoomOrder(BaseModel):
    room_ids: list[int]


class RoomResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    event_id: int
    name: str
    sort_order: int
