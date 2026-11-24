"""Helle Farbpalette für das Programm-PDF, abgeleitet aus der Veranstaltungsgestaltung.

Spiegelt die Kontrastregeln aus frontend/src/branding.ts: Textfarben werden bei Bedarf
Richtung Schwarz oder Weiß verschoben, bis sie das geforderte Kontrastverhältnis erreichen.
"""

from dataclasses import dataclass

from app.models.event import Event

RGB = tuple[float, float, float]
WHITE: RGB = (255.0, 255.0, 255.0)
BLACK: RGB = (0.0, 0.0, 0.0)


def parse(value: str) -> RGB:
    return tuple(float(int(value[index:index + 2], 16)) for index in (1, 3, 5))  # type: ignore[return-value]


def to_hex(color: RGB) -> str:
    return "#" + "".join(f"{round(channel):02X}" for channel in color)


def luminance(color: RGB) -> float:
    def channel(value: float) -> float:
        value /= 255
        return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4

    red, green, blue = (channel(value) for value in color)
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue


def contrast(first: RGB, second: RGB) -> float:
    lighter, darker = sorted((luminance(first), luminance(second)), reverse=True)
    return (lighter + 0.05) / (darker + 0.05)


def mix(start: RGB, end: RGB, amount: float) -> RGB:
    return tuple(a * (1 - amount) + b * amount for a, b in zip(start, end, strict=True))  # type: ignore[return-value]


def text_target(backgrounds: list[RGB]) -> RGB:
    def worst(target: RGB) -> float:
        return min(contrast(target, background) for background in backgrounds)

    return WHITE if worst(WHITE) > worst(BLACK) else BLACK


def readable(color: RGB, backgrounds: list[RGB], minimum: float) -> RGB:
    target = text_target(backgrounds)
    result = color
    for _ in range(3):
        for background in backgrounds:
            if contrast(result, background) >= minimum:
                continue
            low, high = 0.0, 1.0
            for _ in range(16):
                middle = (low + high) / 2
                if contrast(mix(result, target, middle), background) >= minimum:
                    high = middle
                else:
                    low = middle
            result = mix(result, target, high)
    return result


@dataclass(frozen=True)
class PdfPalette:
    page: str | None
    grid: str
    title: str
    label: str
    time: str
    line: str
    room_line: str
    card: str
    card_border: str
    card_text: str
    accent: str | None
    eyebrow: str

    @classmethod
    def for_event(cls, event: Event) -> "PdfPalette":
        custom = any((event.background_color, event.text_color, event.card_color))
        accent = parse(event.accent_color) if event.accent_color else None
        if not custom:
            return cls(
                page=None, grid="#F7F9FD", title="#172039", label="#35445F", time="#536887",
                line="#CDD7E7", room_line="#D8E0ED", card="#E7EFFF", card_border="#7B9BE8",
                card_text="#24324D", accent=event.accent_color,
                eyebrow=to_hex(readable(accent, [WHITE], 4.5)) if accent else "#35445F",
            )
        page = parse(event.background_color) if event.background_color else WHITE
        grid = mix(page, WHITE, 0.6) if text_target([page]) == BLACK else mix(page, BLACK, 0.1)
        text = readable(parse(event.text_color) if event.text_color else parse("#172039"), [page, grid], 7)
        line_color = accent or text
        if event.card_color:
            card = parse(event.card_color)
        else:
            card = mix(grid, line_color, 0.1)
        return cls(
            page=to_hex(page) if event.background_color else None,
            grid=to_hex(grid),
            title=to_hex(text),
            label=to_hex(readable(text, [page, grid], 4.5)),
            time=to_hex(readable(mix(text, page, 0.25), [page], 4.5)),
            line=to_hex(mix(text, grid, 0.8)),
            room_line=to_hex(mix(text, grid, 0.85)),
            card=to_hex(card),
            card_border=to_hex(mix(card, line_color, 0.45)),
            card_text=to_hex(readable(text, [card], 4.5)),
            accent=event.accent_color,
            eyebrow=to_hex(readable(accent or text, [page], 4.5)),
        )
