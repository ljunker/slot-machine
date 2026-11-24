from datetime import time
from io import BytesIO
from pathlib import Path
from xml.sax.saxutils import escape

import reportlab
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import Frame, Paragraph
from sqlalchemy.orm import Session

from app.models.event import Event
from app.schemas.category import CategorySummary
from app.schemas.schedule import DaySchedule, ScheduleRoom
from app.schemas.slot import SlotResponse
from app.services.design_palette import PdfPalette, parse, readable, to_hex
from app.services.errors import Conflict
from app.services.event_branding import graphic_path, image_file, logo_path
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
    palette: PdfPalette,
) -> None:
    if width <= 0 or height <= 0:
        return
    notice = slot.change_notice
    topic = f"{slot.topic} - Alle Räume" if slot.scope == "all_rooms" else slot.topic
    notice_colors = {
        "rescheduled": ("#FFF1D6", "#B96F0D"),
        "updated": ("#F2E7FF", "#8C5ABA"),
        "cancelled": ("#E7E9ED", "#596579"),
    }
    default = (palette.card, palette.card_border)
    fill, stroke = notice_colors.get(notice.type, default) if notice else default
    text_color = palette.card_text if (fill, stroke) == default else to_hex(
        readable(parse(palette.card_text), [parse(fill)], 4.5)
    )
    pdf.setFillColor(colors.HexColor(fill))
    pdf.setStrokeColor(colors.HexColor(stroke))
    pdf.roundRect(
        x, y, width, height, min(2.5, height / 3, width / 3), fill=1, stroke=1
    )
    if slot.categories:
        stripe_height = min(3, height)
        segment_width = width / len(slot.categories)
        for index, category in enumerate(slot.categories):
            pdf.setFillColor(colors.HexColor(category.color))
            pdf.rect(x + index * segment_width, y + height - stripe_height,
                     segment_width, stripe_height, fill=1, stroke=0)

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
            lines = [(interval, FONT, 6.2), (topic, BOLD_FONT, 7.2)]
            if status:
                lines.append((status, BOLD_FONT, 6.2))
            if previous and height >= 45:
                lines.append((previous, FONT, 5.8))
            if speakers:
                lines.append((speakers, FONT, 6))
        elif height >= 18:
            if status:
                lines = [(f"{status}: {topic}", BOLD_FONT, 6.3)]
                if speakers:
                    lines.append((speakers, FONT, 6))
            elif speakers:
                lines = [
                    (f"{interval} {topic}", BOLD_FONT, 6.3),
                    (speakers, FONT, 6),
                ]
            else:
                lines = [(interval, FONT, 5.8), (topic, BOLD_FONT, 6.5)]
        elif height >= 9:
            lines = [
                (f"{status}: {topic}", BOLD_FONT, 6)
                if status
                else (f"{speakers} - {topic}", FONT, 6)
                if speakers
                else (topic, BOLD_FONT, 6)
            ]
        baseline = y + height - 8
        pdf.setFillColor(colors.HexColor(text_color))
        for text, font, size in lines:
            if baseline < y + 2:
                break
            fitted = _fit(text, inner_width, font, size)
            if fitted:
                pdf.setFont(font, size)
                pdf.drawString(x + 3, baseline, fitted)
            baseline -= size + 2
    pdf.restoreState()

def _image(path: Path | None) -> ImageReader | None:
    if path is None or not path.is_file():
        return None
    return ImageReader(str(path))


def _draw_image(pdf: canvas.Canvas, image: ImageReader, x: float, y: float, max_width: float, max_height: float,
                align: str = "left") -> float:
    """Draw an image scaled into a box (bottom-left at x, y); return the drawn width."""
    image_width, image_height = image.getSize()
    scale = min(max_width / image_width, max_height / image_height)
    width, height = image_width * scale, image_height * scale
    left = x + (max_width - width) if align == "right" else x + (max_width - width) / 2 if align == "center" else x
    pdf.drawImage(image, left, y + (max_height - height) / 2, width=width, height=height, mask="auto")
    return width


def _display_url(url: str) -> str:
    text = url.split("://", 1)[-1]
    return text.removesuffix("/")


def _draw_background(pdf: canvas.Canvas, palette: PdfPalette) -> None:
    if palette.page:
        pdf.setFillColor(colors.HexColor(palette.page))
        pdf.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, fill=1, stroke=0)


def _draw_header(pdf: canvas.Canvas, event: Event, palette: PdfPalette, line: str) -> None:
    title_x = 27
    logo = _image(logo_path(event))
    if logo is not None:
        _draw_image(pdf, logo, 27, PAGE_HEIGHT - 69, 88, 44)
        title_x = 27 + 100
    title_right = PAGE_WIDTH - 27
    graphic = _image(graphic_path(event, "header"))
    if graphic is not None:
        width = _draw_image(pdf, graphic, PAGE_WIDTH - 27 - 170, PAGE_HEIGHT - 72, 170, 52, align="right")
        title_right -= width + 14
    if event.program_eyebrow:
        pdf.setFillColor(colors.HexColor(palette.eyebrow))
        pdf.setFont(BOLD_FONT, 7.5)
        eyebrow = _fit(event.program_eyebrow, title_right - title_x, BOLD_FONT, 7.5)
        pdf.drawString(title_x, PAGE_HEIGHT - 22, eyebrow)
        pdf.setStrokeColor(colors.HexColor(palette.title))
        pdf.setLineWidth(0.8)
        underline = min(pdfmetrics.stringWidth(eyebrow, BOLD_FONT, 7.5), title_right - title_x)
        pdf.line(title_x, PAGE_HEIGHT - 25.5, title_x + underline, PAGE_HEIGHT - 25.5)
    pdf.setFillColor(colors.HexColor(palette.title))
    pdf.setFont(BOLD_FONT, 18)
    pdf.drawString(title_x, PAGE_HEIGHT - 42, _fit(event.name, title_right - title_x, BOLD_FONT, 18))
    pdf.setFont(FONT, 10)
    pdf.drawString(title_x, PAGE_HEIGHT - 61, _fit(line, title_right - title_x, FONT, 10))
    if palette.accent:
        pdf.setFillColor(colors.HexColor(palette.accent))
        pdf.rect(27, PAGE_HEIGHT - 80, PAGE_WIDTH - 54, 3, fill=1, stroke=0)


def _draw_footer(pdf: canvas.Canvas, event: Event, palette: PdfPalette, page: int, pages: int) -> None:
    pdf.setFillColor(colors.HexColor(palette.label))
    pdf.setFont(FONT, 7)
    page_label = f"Seite {page}/{pages}"
    pdf.drawRightString(PAGE_WIDTH - 27, 19, page_label)
    right = PAGE_WIDTH - 27 - pdfmetrics.stringWidth(page_label, FONT, 7) - 18
    if event.website_url:
        url = _display_url(event.website_url)
        pdf.setFont(BOLD_FONT, 7)
        pdf.drawRightString(right, 19, url)
        right -= pdfmetrics.stringWidth(url, BOLD_FONT, 7) + 18
    x = 27.0
    for partner in event.partner_logos:
        image = _image(image_file(partner.image_filename))
        width = 0.0
        if image is not None and x + 40 <= right:
            width = _draw_image(pdf, image, x, 11, 40, 18)
        name_width = min(150, right - x - width - 4)
        name = _fit(partner.name, name_width, FONT, 6.5) if name_width > 0 else ""
        pdf.setFillColor(colors.HexColor(palette.label))
        pdf.setFont(FONT, 6.5)
        if name:
            pdf.drawString(x + width + (4 if width else 0), 17.5, name)
        advance = width + (4 if width else 0) + pdfmetrics.stringWidth(name, FONT, 6.5)
        if not advance:
            break
        x += advance + 16
        if x >= right:
            break


def _day_line(event: Event, schedule: DaySchedule) -> str:
    day = f"Programm - {schedule.date:%d.%m.%Y}"
    return f"{event.program_subtitle} · {day}" if event.program_subtitle else day


def _draw_day(
    pdf: canvas.Canvas, event: Event, schedule: DaySchedule, page: int, pages: int, palette: PdfPalette
) -> None:
    categories = sorted({
        category.id: category
        for slot in [*(slot for room in schedule.rooms for slot in room.slots), *schedule.shared_slots]
        for category in slot.categories
    }.values(), key=lambda category: (category.name.casefold(), category.id))
    footer_rows: list[list[tuple[CategorySummary, float]]] = []
    row: list[tuple[CategorySummary, float]] = []
    row_width = 0.0
    for category in categories:
        width = min(170, pdfmetrics.stringWidth(category.name, FONT, 7) + 24)
        if row and row_width + width > PAGE_WIDTH - 54:
            footer_rows.append(row)
            row = []
            row_width = 0
        row.append((category, width))
        row_width += width + 9
    if row:
        footer_rows.append(row)
    grid_bottom = GRID_BOTTOM + (20 + 14 * len(footer_rows) if footer_rows else 0)

    _draw_background(pdf, palette)
    _draw_header(pdf, event, palette, _day_line(event, schedule))
    _draw_footer(pdf, event, palette, page, pages)
    if footer_rows:
        pdf.setFillColor(colors.HexColor(palette.label))
        pdf.setFont(BOLD_FONT, 7)
        pdf.drawString(27, grid_bottom - 15, "Kategorien")
        for index, items in enumerate(footer_rows):
            x = 27.0
            y = grid_bottom - 31 - 14 * index
            for category, width in items:
                pdf.setFillColor(colors.HexColor(category.color))
                pdf.roundRect(x, y - 1, 9, 8, 1.5, fill=1, stroke=0)
                pdf.setFillColor(colors.HexColor(palette.label))
                pdf.setFont(FONT, 7)
                pdf.drawString(x + 14, y, _fit(category.name, width - 19, FONT, 7))
                x += width + 9

    if not schedule.rooms and not schedule.shared_slots:
        pdf.setFillColor(colors.HexColor(palette.label))
        pdf.setFont(FONT, 11)
        pdf.drawString(
            27, PAGE_HEIGHT - 115, "Für diesen Tag sind keine Räume angelegt."
        )
        return

    rooms = schedule.rooms or [ScheduleRoom(id=0, name="Alle Räume", sort_order=0, slots=[])]
    all_slots = [*(slot for room in schedule.rooms for slot in room.slots), *schedule.shared_slots]
    repeated = [slot for slot in schedule.shared_slots if any(
        other.id != slot.id and slot.start_time < other.end_time and slot.end_time > other.start_time
        for other in all_slots
    )]
    repeated_ids = {slot.id for slot in repeated}
    spanning = [slot for slot in schedule.shared_slots if slot.id not in repeated_ids]
    room_width = (GRID_RIGHT - GRID_LEFT) / len(rooms)
    start = _seconds(schedule.start_time)
    end = _seconds(schedule.end_time)
    scale = (GRID_TOP - grid_bottom) / (end - start)
    pdf.setFillColor(colors.HexColor(palette.grid))
    pdf.rect(
        GRID_LEFT,
        grid_bottom,
        GRID_RIGHT - GRID_LEFT,
        GRID_TOP - grid_bottom,
        fill=1,
        stroke=0,
    )

    pdf.setStrokeColor(colors.HexColor(palette.room_line))
    pdf.setLineWidth(0.5)
    for index, room in enumerate(rooms):
        room_x = GRID_LEFT + index * room_width
        pdf.line(room_x, grid_bottom, room_x, GRID_TOP)
        pdf.setFillColor(colors.HexColor(palette.label))
        pdf.setFont(BOLD_FONT, 8)
        room_name = _fit(room.name, room_width - 6, BOLD_FONT, 8)
        if room_name:
            pdf.drawString(room_x + 3, GRID_TOP + 9, room_name)
    pdf.line(GRID_RIGHT, grid_bottom, GRID_RIGHT, GRID_TOP)

    ticks = sorted(
        {start, end} | set(range((int(start) // 3600 + 1) * 3600, int(end), 3600))
    )
    for second in ticks:
        y = GRID_TOP - (second - start) * scale
        pdf.setStrokeColor(colors.HexColor(palette.line))
        pdf.line(GRID_LEFT, y, GRID_RIGHT, y)
        pdf.setFont(FONT, 7)
        pdf.setFillColor(colors.HexColor(palette.time))
        pdf.drawRightString(
            GRID_LEFT - 5,
            max(grid_bottom, min(GRID_TOP - 6, y - 2)),
            f"{int(second) // 3600:02d}:{int(second) // 60 % 60:02d}",
        )

    for slot in spanning:
        top = GRID_TOP - (_seconds(slot.start_time) - start) * scale
        bottom = GRID_TOP - (_seconds(slot.end_time) - start) * scale
        _draw_slot(pdf, slot, GRID_LEFT + 1, bottom + 0.5, GRID_RIGHT - GRID_LEFT - 2, max(0.5, top - bottom - 1), palette)

    for index, room in enumerate(rooms):
        room_x = GRID_LEFT + index * room_width
        for slot, lane, lanes in _slot_lanes([*room.slots, *repeated]):
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
                palette,
            )


INFO_TOP = PAGE_HEIGHT - 100
INFO_BOTTOM = 40
INFO_GRAPHIC_HEIGHT = 80
INFO_GAP = 24


def _info_story(event: Event, palette: PdfPalette) -> list:
    style = ParagraphStyle(
        "InfoBody", fontName=FONT, fontSize=9, leading=12.5,
        textColor=colors.HexColor(palette.label), spaceAfter=14,
    )
    story: list = []
    for block in event.info_blocks:
        title = (
            f'<font name="{BOLD_FONT}" size="11" color="{palette.title}">{escape(block.title)}</font>'
        )
        lines = [escape(line) for line in block.body.split("\n")] if block.body else []
        story.append(Paragraph("<br/>".join([title, *lines]), style))
    return story


def _fill_frame(frame: Frame, story: list, pdf: canvas.Canvas) -> None:
    """Fill a frame from the front of story, splitting paragraphs that do not fit."""
    while story:
        if frame.add(story[0], pdf, trySplit=0):
            story.pop(0)
            continue
        parts = frame.split(story[0], pdf)
        if len(parts) < 2 or not frame.add(parts[0], pdf, trySplit=0):
            return
        story[0:1] = parts[1:]


def _info_frames(event: Event) -> list[Frame]:
    bottom = INFO_BOTTOM
    if _image(graphic_path(event, "footer")) is not None:
        bottom += INFO_GRAPHIC_HEIGHT + 12
    width = (PAGE_WIDTH - 54 - INFO_GAP) / 2
    return [
        Frame(27 + index * (width + INFO_GAP), bottom, width, INFO_TOP - bottom,
              leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0, showBoundary=0)
        for index in range(2)
    ]


def _info_page_count(event: Event, palette: PdfPalette) -> int:
    if not event.info_blocks:
        return 0
    story = _info_story(event, palette)
    scratch = canvas.Canvas(BytesIO(), pagesize=(PAGE_WIDTH, PAGE_HEIGHT))
    pages = 0
    while story and pages < 50:
        pages += 1
        for frame in _info_frames(event):
            _fill_frame(frame, story, scratch)
    return pages


def _draw_info_pages(pdf: canvas.Canvas, event: Event, palette: PdfPalette, first_page: int, pages: int) -> None:
    story = _info_story(event, palette)
    footer_graphic = _image(graphic_path(event, "footer"))
    page = first_page
    while story and page <= pages:
        _draw_background(pdf, palette)
        _draw_header(pdf, event, palette, event.program_subtitle or "Informationen")
        _draw_footer(pdf, event, palette, page, pages)
        if footer_graphic is not None:
            _draw_image(pdf, footer_graphic, 27, INFO_BOTTOM, PAGE_WIDTH - 54, INFO_GRAPHIC_HEIGHT, align="center")
        for frame in _info_frames(event):
            _fill_frame(frame, story, pdf)
        pdf.showPage()
        page += 1


def build_program_pdf(db: Session, event_id: int) -> bytes:
    event = EventService(db).get(event_id)
    days = EventDayService(db).get_for_event(event_id)
    if not days:
        raise Conflict("Für diese Veranstaltung sind noch keine Tage angelegt")
    _register_fonts()
    schedule_service = ScheduleService(db)
    schedules = [schedule_service.get_day_schedule(day.id) for day in days]
    palette = PdfPalette.for_event(event)
    info_pages = _info_page_count(event, palette)
    pages = len(schedules) + info_pages
    output = BytesIO()
    pdf = canvas.Canvas(output, pagesize=(PAGE_WIDTH, PAGE_HEIGHT), pageCompression=1)
    pdf.setTitle(f"Programm - {event.name}")
    pdf.setAuthor("Event Scheduler")
    for index, schedule in enumerate(schedules, start=1):
        _draw_day(pdf, event, schedule, index, pages, palette)
        pdf.showPage()
    if info_pages:
        _draw_info_pages(pdf, event, palette, len(schedules) + 1, pages)
    pdf.save()
    return output.getvalue()
