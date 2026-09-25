import type { CSSProperties } from 'react'

type RGB = [number, number, number]

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

export function brandingStyle(accent: string | null | undefined): CSSProperties | undefined {
  if (!accent) return undefined
  const color = parse(accent)
  const light = readable(color, [255, 255, 255], [0, 0, 0], 4.55)
  const dark = readable(color, [24, 35, 55], [255, 255, 255], 4.55)
  const lightHover = readable(color, [255, 255, 255], [0, 0, 0], 6)
  const darkHover = readable(color, [24, 35, 55], [255, 255, 255], 6)
  return {
    '--brand-light': hex(light),
    '--brand-dark': hex(dark),
    '--brand-light-hover': hex(lightHover),
    '--brand-dark-hover': hex(darkHover),
    '--brand-on-light': luminance(light) > 0.179 ? '#000000' : '#ffffff',
    '--brand-on-dark': luminance(dark) > 0.179 ? '#000000' : '#ffffff',
  } as CSSProperties
}
