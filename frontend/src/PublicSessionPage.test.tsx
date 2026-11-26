import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import PublicSessionPage from './PublicSessionPage'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('loads a public session and links back to its event', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify(
    String(input).endsWith('/sessions/21')
      ? { id: 21, event_id: 7, date: '2099-06-01', room_name: 'Saal A', topic: 'Eröffnung',
          start_time: '10:00:00', end_time: '11:00:00', description: 'Willkommen',
          speakers: [{ id: 1, name: 'Ada Lovelace', bio: 'Mathematikerin', website: 'https://ada.example/', photo_url: '/api/public/speakers/1/photo' }, { id: 2, name: 'Grace Hopper', bio: null, website: null, photo_url: null }],
          change_notice: null }
      : { id: 7, name: 'Konferenz', start_date: '2099-06-01', end_date: '2099-06-01' },
  ), { status: 200 })))
  render(<PublicSessionPage eventId={7} sessionId={21} />)
  expect(await screen.findByRole('heading', { name: 'Eröffnung' })).toBeTruthy()
  expect(screen.getByText(/1\. Juni 2099.*10:00–11:00 Uhr.*Saal A/)).toBeTruthy()
  const speakers = screen.getByRole('region', { name: 'Redner' })
  expect(within(speakers).getByText('Ada Lovelace')).toBeTruthy()
  expect(within(speakers).getByText('Mathematikerin')).toBeTruthy()
  expect(within(speakers).getByRole('link', { name: 'ada.example' }).getAttribute('href')).toBe('https://ada.example/')
  expect(speakers.querySelector('img')?.getAttribute('src')).toBe('/api/public/speakers/1/photo')
  expect(within(speakers).getByText('GH')).toBeTruthy()
  expect(screen.getByText('Willkommen')).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Zum Kalender hinzufügen' }).getAttribute('href')).toBe('/api/events/7/sessions/21.ics')
  expect(screen.getByRole('link', { name: 'Zum Veranstaltungsprogramm' }).getAttribute('href')).toBe('/programm/7')
  expect(document.title).toBe('Eröffnung · Konferenz')
})

it('copies the session link when the browser cannot share', async () => {
  const writeText = vi.fn(async () => undefined)
  vi.stubGlobal('navigator', { ...navigator, share: undefined, clipboard: { writeText } })
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify(
    String(input).endsWith('/sessions/21')
      ? { id: 21, event_id: 7, date: '2099-06-01', room_name: 'Saal A', topic: 'Eröffnung', start_time: '10:00:00', end_time: '11:00:00', description: null, speakers: [], change_notice: null }
      : { id: 7, name: 'Konferenz', start_date: '2099-06-01', end_date: '2099-06-01' },
  ), { status: 200 })))
  render(<PublicSessionPage eventId={7} sessionId={21} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Link teilen' }))
  expect(await screen.findByText('Link in die Zwischenablage kopiert.')).toBeTruthy()
  expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/programm/7/sessions/21`)
  expect(screen.queryByRole('region', { name: 'Redner' })).toBeNull()
})

it('shows a load error for a missing session', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/sessions/99')
    ? new Response(JSON.stringify({ detail: 'Session nicht gefunden' }), { status: 404 })
    : new Response(JSON.stringify({ id: 7, name: 'Konferenz' }), { status: 200 })))
  render(<PublicSessionPage eventId={7} sessionId={99} />)
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('Session nicht gefunden'))
})
