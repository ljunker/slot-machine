from datetime import date

from pydantic import BaseModel, ConfigDict, Field


class EventDesignFields(BaseModel):
    accent_color: str | None = None
    background_color: str | None = None
    text_color: str | None = None
    header_background_color: str | None = None
    card_color: str | None = None
    program_eyebrow: str | None = None
    program_subtitle: str | None = None
    website_url: str | None = None


class EventCreate(EventDesignFields):
    name: str
    start_date: date
    end_date: date
    program_published: bool = False


class EventUpdate(EventDesignFields):
    name: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    program_published: bool | None = None


class PartnerLogoResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    subtitle: str | None
    url: str | None
    image_url: str | None
    sort_order: int


class InfoBlockResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    body: str
    sort_order: int


class EventResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    start_date: date
    end_date: date
    program_published: bool
    accent_color: str | None
    logo_url: str | None
    background_color: str | None
    text_color: str | None
    header_background_color: str | None
    card_color: str | None
    program_eyebrow: str | None
    program_subtitle: str | None
    website_url: str | None
    header_graphic_url: str | None
    footer_graphic_url: str | None
    partner_logos: list[PartnerLogoResponse] = Field(default_factory=list)
    info_blocks: list[InfoBlockResponse] = Field(default_factory=list)


class PartnerLogoCreate(BaseModel):
    name: str
    subtitle: str | None = None
    url: str | None = None


class PartnerLogoUpdate(BaseModel):
    name: str | None = None
    subtitle: str | None = None
    url: str | None = None


class InfoBlockCreate(BaseModel):
    title: str
    body: str = ""


class InfoBlockUpdate(BaseModel):
    title: str | None = None
    body: str | None = None


class OrderUpdate(BaseModel):
    ids: list[int]
