import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import PublicSessionPage from './PublicSessionPage'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('loads a public session and links back to its event', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify(
    String(input).endsWith('/sessions/21')
      ? { id: 21, event_id: 7, date: '2099-06-01', room_name: 'Saal A', topic: 'Eröffnung',
          start_time: '10:00:00', end_time: '11:00:00', description: 'Willkommen',
          speakers: [{ id: 1, name: 'Ada' }], change_notice: null }
      : { id: 7, name: 'Konferenz', start_date: '2099-06-01', end_date: '2099-06-01' },
  ), { status: 200 })))
  render(<PublicSessionPage eventId={7} sessionId={21} />)
  expect(await screen.findByRole('heading', { name: 'Eröffnung' })).toBeTruthy()
  expect(screen.getByText(/2099-06-01.*10:00–11:00 Uhr.*Saal A/)).toBeTruthy()
  expect(screen.getByText('Redner: Ada')).toBeTruthy()
  expect(screen.getByText('Willkommen')).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Zum Veranstaltungsprogramm' }).getAttribute('href')).toBe('/programm/7')
})

it('shows a load error for a missing session', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/sessions/99')
    ? new Response(JSON.stringify({ detail: 'Session nicht gefunden' }), { status: 404 })
    : new Response(JSON.stringify({ id: 7, name: 'Konferenz' }), { status: 200 })))
  render(<PublicSessionPage eventId={7} sessionId={99} />)
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('Session nicht gefunden'))
})
