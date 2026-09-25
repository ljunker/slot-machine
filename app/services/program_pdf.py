from datetime import time
from io import BytesIO
from pathlib import Path

import reportlab
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from sqlalchemy.orm import Session

from app.schemas.schedule import DaySchedule
from app.schemas.slot import SlotResponse
from app.models.event import Event
from app.services.errors import Conflict
from app.services.event_branding import logo_path
from app.services.event_day_service import EventDayService
from app.services.event_service import EventService
from app.services.schedule_service import ScheduleService

PAGE_WIDTH, PAGE_HEIGHT = landscape(A4)
GRID_LEFT = 69
GRID_RIGHT = PAGE_WIDTH - 27
GRID_TOP = PAGE_HEIGHT - 111
GRID_BOTTOM = 39
FONT = "ProgramVera"
BOLD_FONT = "ProgramVeraBold"


def _register_fonts() -> None:
    fonts = Path(reportlab.__file__).resolve().parent / "fonts"
    if FONT not in pdfmetrics.getRegisteredFontNames():
        pdfmetrics.registerFont(TTFont(FONT, str(fonts / "Vera.ttf")))
        pdfmetrics.registerFont(TTFont(BOLD_FONT, str(fonts / "VeraBd.ttf")))


def _seconds(value: time) -> float:
    return (
        value.hour * 3600
        + value.minute * 60
        + value.second
        + value.microsecond / 1_000_000
    )


def _fit(text: str, width: float, font: str, size: float) -> str:
    text = " ".join(text.split())
    if width <= 0:
        return ""
    if pdfmetrics.stringWidth(text, font, size) <= width:
        return text
    suffix = "..."
    if pdfmetrics.stringWidth(suffix, font, size) > width:
        return ""
    low, high = 0, len(text)
    while low < high:
        middle = (low + high + 1) // 2
        if pdfmetrics.stringWidth(text[:middle] + suffix, font, size) <= width:
            low = middle
        else:
            high = middle - 1
    return text[:low] + suffix


def _slot_lanes(slots: list[SlotResponse]) -> list[tuple[SlotResponse, int, int]]:
    ordered = sorted(slots, key=lambda slot: (slot.start_time, slot.end_time, slot.id))
    result: list[tuple[SlotResponse, int, int]] = []
    group: list[tuple[SlotResponse, int]] = []
    lane_ends: list[time] = []
    group_end: time | None = None

    def flush() -> None:
        result.extend((slot, lane, len(lane_ends)) for slot, lane in group)

    for slot in ordered:
        if group and group_end is not None and slot.start_time >= group_end:
            flush()
            group = []
            lane_ends = []
        lane = next(
            (index for index, end in enumerate(lane_ends) if end <= slot.start_time),
            len(lane_ends),
        )
        if lane == len(lane_ends):
            lane_ends.append(slot.end_time)
        else:
            lane_ends[lane] = slot.end_time
        group.append((slot, lane))
        group_end = max(group_end, slot.end_time) if group_end else slot.end_time
    if group:
        flush()
    return result


def _draw_slot(
    pdf: canvas.Canvas,
    slot: SlotResponse,
    x: float,
    y: float,
    width: float,
    height: float,
) -> None:
    if width <= 0 or height <= 0:
        return
    notice = slot.change_notice
    palette = {
        "rescheduled": ("#FFF1D6", "#B96F0D"),
        "updated": ("#F2E7FF", "#8C5ABA"),
        "cancelled": ("#E7E9ED", "#596579"),
    }
    fill, stroke = (
        palette.get(notice.type, ("#E7EFFF", "#7B9BE8"))
        if notice
        else ("#E7EFFF", "#7B9BE8")
    )
    pdf.setFillColor(colors.HexColor(fill))
    pdf.setStrokeColor(colors.HexColor(stroke))
    pdf.roundRect(
        x, y, width, height, min(2.5, height / 3, width / 3), fill=1, stroke=1
    )

    # Clip text to its own card. Very short slots remain visible as cards.
    pdf.saveState()
    path = pdf.beginPath()
    path.rect(x + 1, y + 1, max(0, width - 2), max(0, height - 2))
    pdf.clipPath(path, stroke=0, fill=0)
    inner_width = width - 6
    if inner_width > 0:
        lines: list[tuple[str, str, float]] = []
        interval = f"{slot.start_time:%H:%M}-{slot.end_time:%H:%M}"
        speakers = ", ".join(speaker.name for speaker in slot.speakers)
        status = (
            {
                "rescheduled": "Verschoben",
                "updated": "Geändert",
                "cancelled": "Abgesagt",
            }.get(notice.type, "")
            if notice
            else ""
        )
        previous = ""
        if (
            notice
            and notice.type == "rescheduled"
            and notice.previous_start_time
            and notice.previous_end_time
        ):
            previous = f"Vorher: {notice.previous_start_time:%H:%M}-{notice.previous_end_time:%H:%M}"
            if notice.previous_room_name:
                previous += f", {notice.previous_room_name}"
        if height >= 30:
            lines = [(interval, FONT, 6.2), (slot.topic, BOLD_FONT, 7.2)]
            if status:
                lines.append((status, BOLD_FONT, 6.2))
            if previous and height >= 45:
                lines.append((previous, FONT, 5.8))
            if speakers:
                lines.append((speakers, FONT, 6))
        elif height >= 18:
            if status:
                lines = [(f"{status}: {slot.topic}", BOLD_FONT, 6.3)]
                if speakers:
                    lines.append((speakers, FONT, 6))
            elif speakers:
                lines = [
                    (f"{interval} {slot.topic}", BOLD_FONT, 6.3),
                    (speakers, FONT, 6),
                ]
            else:
                lines = [(interval, FONT, 5.8), (slot.topic, BOLD_FONT, 6.5)]
        elif height >= 9:
            lines = [
                (f"{status}: {slot.topic}", BOLD_FONT, 6)
                if status
                else (f"{speakers} - {slot.topic}", FONT, 6)
                if speakers
                else (slot.topic, BOLD_FONT, 6)
            ]
        baseline = y + height - 8
        pdf.setFillColor(colors.HexColor("#24324D"))
        for text, font, size in lines:
            if baseline < y + 2:
                break
            fitted = _fit(text, inner_width, font, size)
            if fitted:
                pdf.setFont(font, size)
                pdf.drawString(x + 3, baseline, fitted)
            baseline -= size + 2
    pdf.restoreState()


def _draw_day(
    pdf: canvas.Canvas, event: Event, schedule: DaySchedule, page: int, pages: int
) -> None:
    title_x = 27
    path = logo_path(event)
    if path is not None and path.is_file():
        image = ImageReader(str(path))
        image_width, image_height = image.getSize()
        width = min(88, 44 * image_width / image_height)
        height = min(44, 88 * image_height / image_width)
        pdf.drawImage(
            image, 27, PAGE_HEIGHT - 69 + (44 - height) / 2,
            width=width, height=height, mask="auto",
        )
        title_x = 27 + 100
    pdf.setFillColor(colors.HexColor("#172039"))
    pdf.setFont(BOLD_FONT, 18)
    pdf.drawString(
        title_x, PAGE_HEIGHT - 40, _fit(event.name, PAGE_WIDTH - title_x - 27, BOLD_FONT, 18)
    )
    pdf.setFont(FONT, 10)
    pdf.drawString(title_x, PAGE_HEIGHT - 61, f"Programm - {schedule.date:%d.%m.%Y}")
    if event.accent_color:
        pdf.setFillColor(colors.HexColor(event.accent_color))
        pdf.rect(27, PAGE_HEIGHT - 80, PAGE_WIDTH - 54, 3, fill=1, stroke=0)
    pdf.setFont(FONT, 7)
    pdf.drawRightString(PAGE_WIDTH - 27, 19, f"Seite {page}/{pages}")

    if not schedule.rooms:
        pdf.setFont(FONT, 11)
        pdf.drawString(
            27, PAGE_HEIGHT - 115, "Für diesen Tag sind keine Räume angelegt."
        )
        return

    room_width = (GRID_RIGHT - GRID_LEFT) / len(schedule.rooms)
    start = _seconds(schedule.start_time)
    end = _seconds(schedule.end_time)
    scale = (GRID_TOP - GRID_BOTTOM) / (end - start)
    pdf.setFillColor(colors.HexColor("#F7F9FD"))
    pdf.rect(
        GRID_LEFT,
        GRID_BOTTOM,
        GRID_RIGHT - GRID_LEFT,
        GRID_TOP - GRID_BOTTOM,
        fill=1,
        stroke=0,
    )

    pdf.setStrokeColor(colors.HexColor("#D8E0ED"))
    pdf.setLineWidth(0.5)
    for index, room in enumerate(schedule.rooms):
        room_x = GRID_LEFT + index * room_width
        pdf.line(room_x, GRID_BOTTOM, room_x, GRID_TOP)
        pdf.setFillColor(colors.HexColor("#35445F"))
        pdf.setFont(BOLD_FONT, 8)
        room_name = _fit(room.name, room_width - 6, BOLD_FONT, 8)
        if room_name:
            pdf.drawString(room_x + 3, GRID_TOP + 9, room_name)
    pdf.line(GRID_RIGHT, GRID_BOTTOM, GRID_RIGHT, GRID_TOP)

    ticks = sorted(
        {start, end} | set(range((int(start) // 3600 + 1) * 3600, int(end), 3600))
    )
    for second in ticks:
        y = GRID_TOP - (second - start) * scale
        pdf.setStrokeColor(colors.HexColor("#CDD7E7"))
        pdf.line(GRID_LEFT, y, GRID_RIGHT, y)
        pdf.setFont(FONT, 7)
        pdf.setFillColor(colors.HexColor("#536887"))
        pdf.drawRightString(
            GRID_LEFT - 5,
            max(GRID_BOTTOM, min(GRID_TOP - 6, y - 2)),
            f"{int(second) // 3600:02d}:{int(second) // 60 % 60:02d}",
        )

    for index, room in enumerate(schedule.rooms):
        room_x = GRID_LEFT + index * room_width
        for slot, lane, lanes in _slot_lanes(room.slots):
            lane_width = room_width / lanes
            padding = min(1, lane_width / 10)
            top = GRID_TOP - (_seconds(slot.start_time) - start) * scale
            bottom = GRID_TOP - (_seconds(slot.end_time) - start) * scale
            _draw_slot(
                pdf,
                slot,
                room_x + lane * lane_width + padding,
                bottom + 0.5,
                lane_width - 2 * padding,
                max(0.5, top - bottom - 1),
            )


def build_program_pdf(db: Session, event_id: int) -> bytes:
    event = EventService(db).get(event_id)
    days = EventDayService(db).get_for_event(event_id)
    if not days:
        raise Conflict("Für diese Veranstaltung sind noch keine Tage angelegt")
    _register_fonts()
    schedule_service = ScheduleService(db)
    output = BytesIO()
    pdf = canvas.Canvas(output, pagesize=(PAGE_WIDTH, PAGE_HEIGHT), pageCompression=1)
    pdf.setTitle(f"Programm - {event.name}")
    pdf.setAuthor("Event Scheduler")
    for index, day in enumerate(days, start=1):
        _draw_day(
            pdf, event, schedule_service.get_day_schedule(day.id), index, len(days)
        )
        pdf.showPage()
    pdf.save()
    return output.getvalue()
