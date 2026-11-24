import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { contrastRatio, programDesign } from './branding'
import ProgramDesignEditor from './ProgramDesignEditor'
import PublicProgram from './PublicProgram'
import PublicSessionPage from './PublicSessionPage'
import type { Event } from './types'

const flyer: Event = {
  id: 3, name: 'Round Dance Festival', start_date: '2099-05-21', end_date: '2099-05-23',
  accent_color: '#167B7B', logo_url: null,
  background_color: '#FAF7F0', text_color: '#1D488B', header_background_color: '#FAF7F0', card_color: '#FFFFFF',
  program_eyebrow: 'PROGRAMM', program_subtitle: '21.–23.05.2099 · HAMBURG', website_url: 'https://rdf.example.org/',
  header_graphic_url: '/api/events/3/graphics/header', footer_graphic_url: '/api/events/3/graphics/footer',
  partner_logos: [
    { id: 1, name: 'ECTA', subtitle: 'Round Dance Council', url: 'https://ecta.example.org', image_url: '/api/events/3/partner-logos/1/image', sort_order: 0 },
    { id: 2, name: 'Butterflies', subtitle: null, url: null, image_url: null, sort_order: 1 },
  ],
  info_blocks: [{ id: 5, title: 'Sprache', body: 'Cues auf Englisch', sort_order: 0 }],
}

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function vars(event: Partial<Event>, theme: 'light' | 'dark') {
  const style = programDesign({ accent_color: null, logo_url: null, ...event }).style as Record<string, string>
  const get = (name: string) => style[`--design-${theme}-${name}`]
  return { style, get }
}

describe('program design', () => {
  it('keeps the plain and accent-only behaviour', () => {
    expect(programDesign({ accent_color: null, logo_url: null })).toEqual({ className: '', style: undefined })
    expect(programDesign({ accent_color: '#A64B18', logo_url: null }).className).toBe(' branding-active')
  })

  it('derives readable light and dark palettes for extreme colours', () => {
    const samples = ['#000000', '#FFFFFF', '#FAF7F0', '#1D488B', '#FFFF00', '#167B7B', '#808080']
    for (const background of samples) for (const text of samples) {
      for (const theme of ['light', 'dark'] as const) {
        const { style, get } = vars({ background_color: background, text_color: text, accent_color: '#167B7B', card_color: background }, theme)
        expect(programDesign({ accent_color: null, logo_url: null, background_color: background }).className).toContain('design-active')
        for (const surface of ['page-bg', 'surface']) {
          expect(contrastRatio(get('text'), get(surface)), `${theme} text on ${surface} ${background}/${text}`).toBeGreaterThanOrEqual(4.5)
          expect(contrastRatio(get('subtext'), get(surface))).toBeGreaterThanOrEqual(4.5)
        }
        expect(contrastRatio(get('text-strong'), get('card'))).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(get('header-text'), get('header-bg'))).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(style[`--brand-${theme}`], get('page-bg'))).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(style[`--brand-${theme}`], get('card'))).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('darkens the light palette for the dark theme', () => {
    const { get: light } = vars(flyer, 'light')
    const { get: dark } = vars(flyer, 'dark')
    expect(light('page-bg')).toBe('#faf7f0')
    expect(contrastRatio(dark('page-bg'), '#000000')).toBeLessThan(2)
    expect(dark('text')).not.toBe(light('text'))
  })

  it('renders flyer header, info blocks, partners and website on the public program', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const body = String(input).endsWith('/days') ? [] : flyer
      return new Response(JSON.stringify(body), { status: 200 })
    }))
    const { container } = render(<PublicProgram eventId={3} />)
    await screen.findByText('21.–23.05.2099 · HAMBURG')
    expect(screen.getByText('PROGRAMM')).toBeTruthy()
    expect(container.querySelector('.public-page')?.classList.contains('design-active')).toBe(true)
    expect(container.querySelector('.public-header-graphic')?.getAttribute('src')).toBe(flyer.header_graphic_url)
    expect(container.querySelector('.public-footer-graphic')?.getAttribute('src')).toBe(flyer.footer_graphic_url)
    expect(screen.getByRole('heading', { name: 'Sprache' })).toBeTruthy()
    const partners = screen.getByRole('list', { name: 'Partner' })
    expect(partners.querySelectorAll('li')).toHaveLength(2)
    expect(screen.getByRole('link', { name: /ECTA/ }).getAttribute('href')).toBe('https://ecta.example.org')
    expect(screen.getByRole('link', { name: 'rdf.example.org' }).getAttribute('href')).toBe('https://rdf.example.org/')
  })

  it('uses the default eyebrow and period without custom texts', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const body = String(input).endsWith('/days') ? [] : { ...flyer, program_eyebrow: null, program_subtitle: null, info_blocks: [], partner_logos: [], website_url: null, footer_graphic_url: null }
      return new Response(JSON.stringify(body), { status: 200 })
    }))
    const { container } = render(<PublicProgram eventId={3} />)
    await screen.findByText('21. Mai 2099 bis 23. Mai 2099')
    expect(screen.getByText('VERANSTALTUNGSPROGRAMM')).toBeTruthy()
    expect(container.querySelector('.public-footer')).toBeNull()
  })

  it('shows partners but no info blocks on session pages', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const body = String(input).includes('/sessions/') ? {
        id: 9, event_id: 3, topic: 'Welcome Dance', description: null, date: '2099-05-21', start_time: '19:30:00', end_time: '22:00:00',
        room_name: 'Saal A', speakers: [], categories: [], is_cancelled: false, change_notice: null,
      } : flyer
      return new Response(JSON.stringify(body), { status: 200 })
    }))
    render(<PublicSessionPage eventId={3} sessionId={9} />)
    await screen.findByText('Welcome Dance')
    expect(screen.getByRole('list', { name: 'Partner' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Sprache' })).toBeNull()
  })
})

describe('program design editor', () => {
  function stubApi() {
    const calls: { method: string; path: string; body: unknown }[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input)
      const body = init?.body instanceof FormData ? init.body.get('image') ?? init.body.get('logo') : init?.body ? JSON.parse(String(init.body)) : undefined
      calls.push({ method: init?.method ?? 'GET', path, body })
      return init?.method === 'PUT' || init?.method === 'DELETE' ? new Response(null, { status: 204 }) : new Response(JSON.stringify(flyer), { status: 200 })
    }))
    vi.stubGlobal('confirm', vi.fn(() => true))
    return calls
  }

  it('saves colours and texts and applies the flyer palette', async () => {
    const calls = stubApi()
    const onChanged = vi.fn(async () => {})
    const plain: Event = { ...flyer, background_color: null, text_color: null, accent_color: null, header_background_color: null, card_color: null, program_eyebrow: null, program_subtitle: null, website_url: null }
    render(<ProgramDesignEditor event={plain} onChanged={onChanged} onClose={() => {}} />)
    expect(screen.queryByLabelText('Farbe Hintergrund')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Flyer-Farben übernehmen/ }))
    expect((screen.getByLabelText('Farbe Hintergrund') as HTMLInputElement).value).toBe('#faf7f0')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Session-Karten' }))
    fireEvent.change(screen.getByLabelText('Überschrift'), { target: { value: 'PROGRAMM' } })
    fireEvent.change(screen.getByLabelText('Webadresse'), { target: { value: 'https://rdf.example.org' } })
    const preview = screen.getByLabelText('Vorschau des Besucherprogramms')
    expect(preview.textContent).toContain('PROGRAMM')
    fireEvent.click(screen.getByRole('button', { name: 'Farben und Texte speichern' }))
    await screen.findByText('Gestaltung gespeichert.')
    const patch = calls.find(call => call.method === 'PATCH')
    expect(patch?.path).toBe('/api/events/3')
    expect(patch?.body).toEqual({
      background_color: '#FAF7F0', text_color: '#1D488B', accent_color: '#167B7B', header_background_color: '#FAF7F0', card_color: null,
      program_eyebrow: 'PROGRAMM', program_subtitle: null, website_url: 'https://rdf.example.org',
    })
    expect(onChanged).toHaveBeenCalled()
  })

  it('manages partners, info blocks and graphics', async () => {
    const calls = stubApi()
    const onChanged = vi.fn(async () => {})
    render(<ProgramDesignEditor event={flyer} onChanged={onChanged} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Neuer Partner'), { target: { value: 'Neuer Club' } })
    fireEvent.click(screen.getByRole('button', { name: 'Partner hinzufügen' }))
    await waitFor(() => expect(calls.some(call => call.method === 'POST' && call.path === '/api/events/3/partner-logos')).toBe(true))
    fireEvent.click(screen.getByRole('button', { name: 'ECTA nach unten' }))
    await waitFor(() => expect(calls.find(call => call.method === 'PUT')?.body).toEqual({ ids: [2, 1] }))
    expect((screen.getByRole('button', { name: 'ECTA nach oben' }) as HTMLButtonElement).disabled).toBe(true)

    const info = screen.getByRole('form', { name: 'Infoblock Sprache' })
    fireEvent.change(info.querySelector('textarea')!, { target: { value: 'Cues auf Englisch und Deutsch' } })
    fireEvent.click(screen.getByRole('button', { name: 'Infoblock speichern' }))
    await waitFor(() => expect(calls.find(call => call.method === 'PATCH' && call.path === '/api/events/3/info-blocks/5')?.body)
      .toEqual({ title: 'Sprache', body: 'Cues auf Englisch und Deutsch' }))

    const file = new File(['png'], 'skyline.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText('Fußgrafik'), { target: { files: [file] } })
    await waitFor(() => expect(calls.some(call => call.method === 'POST' && call.path === '/api/events/3/graphics/footer')).toBe(true))
    fireEvent.click(screen.getByRole('button', { name: 'Kopfgrafik entfernen' }))
    await waitFor(() => expect(calls.some(call => call.method === 'DELETE' && call.path === '/api/events/3/graphics/header')).toBe(true))
    expect(onChanged.mock.calls.length).toBeGreaterThanOrEqual(5)
  })
})
