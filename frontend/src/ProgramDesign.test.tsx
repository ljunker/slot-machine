import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { contrastRatio, programDesign } from './branding'
import ProgramDesignEditor, { PALETTES } from './ProgramDesignEditor'
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

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

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
  function stubApi(fail?: (method: string, path: string) => boolean) {
    const calls: { method: string; path: string; body: unknown }[] = []
    let created = 100
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:vorschau')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input)
      const method = init?.method ?? 'GET'
      const body = init?.body instanceof FormData ? init.body.get('image') ?? init.body.get('logo') : init?.body ? JSON.parse(String(init.body)) : undefined
      calls.push({ method, path, body })
      if (fail?.(method, path)) return new Response(JSON.stringify({ detail: 'Datei zu groß' }), { status: 400 })
      if (method === 'PUT' || method === 'DELETE') return new Response(null, { status: 204 })
      if (method === 'POST' && /(partner-logos|info-blocks)$/.test(path)) return new Response(JSON.stringify({ id: ++created }), { status: 201 })
      return new Response(JSON.stringify(flyer), { status: 200 })
    }))
    return calls
  }

  const plain: Event = { ...flyer, background_color: null, text_color: null, accent_color: null, header_background_color: null, card_color: null, program_eyebrow: null, program_subtitle: null, website_url: null }

  it('keeps every palette readable', () => {
    for (const { name, colors } of PALETTES) {
      for (const surface of [colors.background_color, colors.card_color]) {
        expect(contrastRatio(colors.text_color, surface), `${name} text`).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(colors.accent_color, surface), `${name} accent`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('collects colour and text changes and saves them together', async () => {
    const calls = stubApi()
    const onChanged = vi.fn(async () => {})
    render(<ProgramDesignEditor event={plain} onChanged={onChanged} onClose={() => {}} />)
    expect(screen.queryByRole('button', { name: /Flyer-Farben/ })).toBeNull()
    expect(screen.getByText('Alles gespeichert')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Änderungen speichern' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByLabelText('Farbe Hintergrund')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Vorlage Creme und Petrol' }))
    expect((screen.getByLabelText('Farbe Hintergrund') as HTMLInputElement).value).toBe('#faf7f0')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Session-Karten' }))
    fireEvent.change(screen.getByLabelText('Überschrift'), { target: { value: 'PROGRAMM' } })
    fireEvent.change(screen.getByLabelText('Webadresse'), { target: { value: 'https://rdf.example.org' } })
    expect(screen.getByText('6 ungespeicherte Änderungen')).toBeTruthy()
    const preview = screen.getByLabelText('Vorschau des Besucherprogramms')
    expect(preview.textContent).toContain('PROGRAMM')
    expect(preview.querySelector('.public-slot.notice-cancelled')).toBeTruthy()
    expect(preview.querySelector('.public-slot.notice-rescheduled')).toBeTruthy()
    expect(preview.querySelector('.category-labels')).toBeTruthy()
    expect(calls).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'Änderungen speichern' }))
    await screen.findByText('Alle Änderungen gespeichert.')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual({ method: 'PATCH', path: '/api/events/3', body: {
      background_color: '#FAF7F0', text_color: '#1D488B', accent_color: '#167B7B', header_background_color: '#FAF7F0', card_color: null,
      program_eyebrow: 'PROGRAMM', program_subtitle: null, website_url: 'https://rdf.example.org',
    } })
    expect(onChanged).toHaveBeenCalled()
  })

  it('discards the draft', () => {
    const calls = stubApi()
    render(<ProgramDesignEditor event={flyer} onChanged={async () => {}} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Überschrift'), { target: { value: 'ANDERS' } })
    fireEvent.click(screen.getByRole('button', { name: 'ECTA nach unten' }))
    expect(screen.getByText('2 ungespeicherte Änderungen')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Verwerfen' }))
    expect((screen.getByLabelText('Überschrift') as HTMLInputElement).value).toBe('PROGRAMM')
    expect(screen.getByText('Alles gespeichert')).toBeTruthy()
    expect(calls).toHaveLength(0)
  })

  it('asks before closing with unsaved changes', async () => {
    stubApi()
    const onClose = vi.fn()
    render(<ProgramDesignEditor event={flyer} onChanged={async () => {}} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Schließen' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.change(screen.getByLabelText('Überschrift'), { target: { value: 'ANDERS' } })
    fireEvent.click(screen.getByRole('button', { name: 'Schließen' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(await screen.findByRole('button', { name: 'Abbrechen' }))
    expect((screen.getByLabelText('Überschrift') as HTMLInputElement).value).toBe('ANDERS')
    fireEvent.click(screen.getByRole('button', { name: 'Schließen' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Verwerfen' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2))
  })

  it('saves partners, info blocks, order and graphics in one go', async () => {
    const calls = stubApi()
    const onChanged = vi.fn(async () => {})
    render(<ProgramDesignEditor event={flyer} onChanged={onChanged} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Neuer Partner'), { target: { value: 'Neuer Club' } })
    fireEvent.click(screen.getByRole('button', { name: 'Partner hinzufügen' }))
    fireEvent.click(screen.getByRole('button', { name: 'ECTA nach unten' }))
    expect((screen.getByRole('button', { name: 'Butterflies nach oben' }) as HTMLButtonElement).disabled).toBe(true)

    const info = screen.getByRole('group', { name: 'Infoblock Sprache' })
    fireEvent.change(info.querySelector('textarea')!, { target: { value: 'Cues auf Englisch und Deutsch' } })
    fireEvent.change(screen.getByLabelText('Neuer Infoblock'), { target: { value: 'Anfahrt' } })
    fireEvent.keyDown(screen.getByLabelText('Neuer Infoblock'), { key: 'Enter' })

    const file = new File(['png'], 'skyline.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText('Fußgrafik'), { target: { files: [file] } })
    expect(screen.getByText('Neu ausgewählt: skyline.png')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Kopfgrafik entfernen' }))
    expect(screen.getByText('Wird beim Speichern entfernt.')).toBeTruthy()
    expect(screen.getByText('6 ungespeicherte Änderungen')).toBeTruthy()
    expect(calls).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'Änderungen speichern' }))
    await screen.findByText('Alle Änderungen gespeichert.')
    const summary = calls.map(call => `${call.method} ${call.path}`)
    expect(summary).toEqual([
      'DELETE /api/events/3/graphics/header',
      'POST /api/events/3/graphics/footer',
      'POST /api/events/3/partner-logos',
      'PUT /api/events/3/partner-logos/order',
      'PATCH /api/events/3/info-blocks/5',
      'POST /api/events/3/info-blocks',
    ])
    expect(calls.find(call => call.path.endsWith('partner-logos/order'))?.body).toEqual({ ids: [2, 1, 101] })
    expect(calls.find(call => call.path.endsWith('info-blocks/5'))?.body).toEqual({ title: 'Sprache', body: 'Cues auf Englisch und Deutsch' })
    expect(onChanged).toHaveBeenCalledTimes(1)
  })

  it('removes a saved partner only after confirming and saving', async () => {
    const calls = stubApi()
    render(<ProgramDesignEditor event={flyer} onChanged={async () => {}} onClose={() => {}} />)
    const group = screen.getByRole('group', { name: 'Partner Butterflies' })
    fireEvent.click(within(group).getByRole('button', { name: 'Löschen' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Partner entfernen' }))
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Partner Butterflies' })).toBeNull())
    expect(calls).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Änderungen speichern' }))
    await screen.findByText('Alle Änderungen gespeichert.')
    expect(calls.map(call => `${call.method} ${call.path}`)).toEqual(['DELETE /api/events/3/partner-logos/2'])
  })

  it('does not create a partner twice when a later step fails', async () => {
    let failing = true
    const calls = stubApi((method, path) => failing && method === 'POST' && path.endsWith('/image'))
    render(<ProgramDesignEditor event={flyer} onChanged={async () => {}} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Neuer Partner'), { target: { value: 'Neuer Club' } })
    fireEvent.click(screen.getByRole('button', { name: 'Partner hinzufügen' }))
    const group = screen.getByRole('group', { name: 'Partner Neuer Club' })
    fireEvent.change(within(group).getByLabelText('Partnerlogo'), { target: { files: [new File(['png'], 'club.png', { type: 'image/png' })] } })
    fireEvent.click(screen.getByRole('button', { name: 'Änderungen speichern' }))
    await screen.findByText(/Nicht alles wurde gespeichert: Datei zu groß/)
    failing = false
    fireEvent.click(screen.getByRole('button', { name: 'Änderungen speichern' }))
    await screen.findByText('Alle Änderungen gespeichert.')
    expect(calls.filter(call => call.method === 'POST' && call.path === '/api/events/3/partner-logos')).toHaveLength(1)
    expect(calls.filter(call => call.path === '/api/events/3/partner-logos/101/image')).toHaveLength(2)
  })
})
