import type { CSSProperties } from 'react'
import type { EventDesign } from './types'

type RGB = [number, number, number]

const WHITE: RGB = [255, 255, 255]
const BLACK: RGB = [0, 0, 0]
const DARK_BASE: RGB = [14, 22, 38]

function parse(hex: string): RGB {
  return [1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16)) as RGB
}

function hex(rgb: RGB): string {
  return `#${rgb.map(value => Math.round(value).toString(16).padStart(2, '0')).join('')}`
}

function luminance(rgb: RGB): number {
  const [red, green, blue] = rgb.map(value => {
    const channel = value / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function contrast(first: RGB, second: RGB): number {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a)
  return (lighter + 0.05) / (darker + 0.05)
}

/** Kontrastverhältnis zweier #RRGGBB-Farben, z. B. für Hinweise im Editor. */
export function contrastRatio(first: string, second: string): number {
  return contrast(parse(first), parse(second))
}

function mix(start: RGB, end: RGB, amount: number): RGB {
  return start.map((value, index) => value * (1 - amount) + end[index] * amount) as RGB
}

function readable(color: RGB, background: RGB, target: RGB, minimum: number): RGB {
  if (contrast(color, background) >= minimum) return color
  let low = 0
  let high = 1
  for (let attempt = 0; attempt < 16; attempt++) {
    const middle = (low + high) / 2
    if (contrast(mix(color, target, middle), background) >= minimum) high = middle
    else low = middle
  }
  return mix(color, target, high)
}

/** Schwarz oder Weiß, je nachdem was auf allen Hintergründen mehr Kontrast erreicht. */
function textTarget(backgrounds: RGB[]): RGB {
  const worst = (target: RGB) => Math.min(...backgrounds.map(background => contrast(target, background)))
  return worst(WHITE) > worst(BLACK) ? WHITE : BLACK
}

/** Wie readable, aber gegen mehrere Hintergründe zugleich. */
function readableOn(color: RGB, backgrounds: RGB[], minimum: number): RGB {
  const target = textTarget(backgrounds)
  let result = color
  for (let round = 0; round < 3; round++) {
    for (const background of backgrounds) result = readable(result, background, target, minimum)
  }
  return result
}

function onColor(background: RGB): string {
  return luminance(background) > 0.179 ? '#000000' : '#ffffff'
}

function accentVars(accent: string, light: RGB[], dark: RGB[]): Record<string, string> {
  const color = parse(accent)
  const brandLight = readableOn(color, light, 4.55)
  const brandDark = readableOn(color, dark, 4.55)
  return {
    '--brand-light': hex(brandLight),
    '--brand-dark': hex(brandDark),
    '--brand-light-hover': hex(readableOn(color, light, 6)),
    '--brand-dark-hover': hex(readableOn(color, dark, 6)),
    '--brand-on-light': onColor(brandLight),
    '--brand-on-dark': onColor(brandDark),
  }
}

export function brandingStyle(accent: string | null | undefined): CSSProperties | undefined {
  if (!accent) return undefined
  return accentVars(accent, [WHITE], [[24, 35, 55]]) as CSSProperties
}

// Standardwerte des Besucherprogramms, gespiegelt aus styles.css (:root und Dunkelmodus).
const DEFAULT_LIGHT = { pageBg: '#f5f7fb', surface: '#ffffff', headerBg: '#15213c', text: '#172039', card: '#e7efff' }
const DEFAULT_DARK = { pageBg: '#0e1626', surface: '#182337', headerBg: '#0a1120', text: '#e9eef8', card: '#243b5b' }

type Palette = Record<string, RGB>

function palette(background: RGB, surface: RGB, header: RGB, text: RGB, card: RGB, accent: RGB | null, minimumText: number): Palette {
  const content = [background, surface]
  const body = readableOn(text, content, minimumText)
  const headerText = luminance(header) > 0.179 ? readableOn(text, [header], 7) : readableOn(WHITE, [header], 7)
  const cardText = readableOn(body, [card], 4.55)
  const line = accent ?? body
  return {
    'page-bg': background,
    surface,
    'surface-soft': mix(surface, background, 0.5),
    'header-bg': header,
    'header-text': headerText,
    'header-muted': readableOn(mix(headerText, header, 0.3), [header], 4.55),
    'header-eyebrow': readableOn(accent ?? mix(headerText, header, 0.2), [header], 4.55),
    text: body,
    'text-strong': cardText,
    'input-text': body,
    subtext: readableOn(mix(body, surface, 0.25), [...content, card], 4.55),
    muted: readableOn(mix(body, surface, 0.4), content, 4.55),
    eyebrow: readableOn(mix(accent ?? body, surface, 0.15), content, 4.55),
    border: mix(body, background, 0.8),
    'border-soft': mix(body, background, 0.9),
    card,
    'card-hover': mix(card, body, 0.07),
    'card-border': mix(card, line, 0.4),
  }
}

export type ProgramDesign = { className: string; style: CSSProperties | undefined }

/**
 * Leitet aus den Veranstaltungsfarben vollständige helle und dunkle Paletten für das
 * Besucherprogramm ab. Text und Akzent werden bei Bedarf aufgehellt oder abgedunkelt,
 * damit sie auf Hintergrund und Karten mindestens 4,5:1 Kontrast haben.
 */
export function programDesign(design: EventDesign | null | undefined): ProgramDesign {
  if (!design) return { className: '', style: undefined }
  const colors = [design.background_color, design.text_color, design.header_background_color, design.card_color]
  if (!colors.some(Boolean)) {
    return { className: design.accent_color ? ' branding-active' : '', style: brandingStyle(design.accent_color) }
  }
  const accent = design.accent_color ? parse(design.accent_color) : null

  const lightBg = design.background_color ? parse(design.background_color) : parse(DEFAULT_LIGHT.pageBg)
  const lightSurface = !design.background_color ? parse(DEFAULT_LIGHT.surface)
    : textTarget([lightBg]) === BLACK ? mix(lightBg, WHITE, 0.7) : mix(lightBg, BLACK, 0.12)
  const lightText = design.text_color ? parse(design.text_color) : parse(DEFAULT_LIGHT.text)
  const lightHeader = design.header_background_color ? parse(design.header_background_color) : parse(DEFAULT_LIGHT.headerBg)
  const lightCard = design.card_color ? parse(design.card_color)
    : design.background_color || design.text_color ? mix(lightSurface, accent ?? lightText, 0.1) : parse(DEFAULT_LIGHT.card)
  const light = palette(lightBg, lightSurface, lightHeader, lightText, lightCard, accent, 7)

  const darkBg = design.background_color ? mix(lightBg, DARK_BASE, 0.92) : parse(DEFAULT_DARK.pageBg)
  const darkSurface = design.background_color ? mix(darkBg, WHITE, 0.07) : parse(DEFAULT_DARK.surface)
  const darkText = design.text_color ? readableOn(lightText, [darkBg, darkSurface], 9) : parse(DEFAULT_DARK.text)
  const darkHeader = design.header_background_color ? mix(lightHeader, DARK_BASE, 0.88) : parse(DEFAULT_DARK.headerBg)
  const darkCard = design.card_color || design.background_color || design.text_color
    ? mix(mix(lightCard, accent ?? lightText, 0.35), DARK_BASE, 0.78) : parse(DEFAULT_DARK.card)
  const dark = palette(darkBg, darkSurface, darkHeader, darkText, darkCard, accent ? readableOn(accent, [darkBg], 4.55) : null, 7)

  const style: Record<string, string> = {}
  for (const [name, value] of Object.entries(light)) style[`--design-light-${name}`] = hex(value)
  for (const [name, value] of Object.entries(dark)) style[`--design-dark-${name}`] = hex(value)
  const accentSource = design.accent_color ?? hex(light.text)
  Object.assign(style, accentVars(accentSource, [lightBg, lightSurface, lightCard], [darkBg, darkSurface, darkCard]))
  return { className: ' branding-active design-active', style: style as CSSProperties }
}
