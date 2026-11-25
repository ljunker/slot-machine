import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { contrastRatio } from './branding'

const css = readFileSync(resolve(__dirname, 'styles.css'), 'utf8')

function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`)
  if (start === -1) throw new Error(`${selector} fehlt in styles.css`)
  const block = css.slice(start, css.indexOf('}', start))
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)]
    .map(([, name, value]) => [name, `#${value.length === 3 ? [...value].map(digit => digit + digit).join('') : value}`]))
}

const light = tokens(':root')
const dark = { ...light, ...tokens(':root[data-theme="dark"]') }
const textTokens = ['text', 'subtext', 'muted', 'eyebrow', 'link', 'danger-accent']
const backgroundTokens = ['surface', 'page-bg', 'surface-soft', 'selected']

describe.each([['hell', light], ['dunkel', dark]])('Farbkontrast im %s Theme', (_name, theme) => {
  it.each(textTokens.flatMap(text => backgroundTokens.map(background => [text, background])))(
    '--%s auf --%s erreicht WCAG AA (4,5:1)',
    (text, background) => {
      expect(contrastRatio(theme[text], theme[background])).toBeGreaterThanOrEqual(4.5)
    },
  )
})
