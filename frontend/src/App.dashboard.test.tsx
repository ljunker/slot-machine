import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import App from './App'
import type { CurrentUser, DaySchedule, Slot } from './types'

const admin: CurrentUser = { id: 1, name: 'Admin', email: 'admin@example.invalid', is_superadmin: false,
  event_roles: { '1': 'admin', '2': 'helper' }, csrf_token: 'test' }
const days = [11, 12].map((id, index) => ({ id, event_id: 1, date: `2026-10-0${index + 1}`, start_time: '09:00:00', end_time: '18:00:00' }))
const rooms = [{ id: 1, event_id: 1, name: 'Saal', sort_order: 0 }]

function mockApi() {
  let secondDayRequests = 0
  let secondDayResponse: Promise<Response> | null = null
  let failParticipants = false
  let failDay = false
  let slot: Slot = { id: 7, event_id: 1, day_id: 12, room_id: 1, topic: 'Vortrag',
    speaker_ids: [], speaker_required: true, speakers: [], description: null,
    start_time: '10:00:00', end_time: '11:00:00', is_cancelled: false, change_notice: null }
  const schedule = (id: number): DaySchedule => ({
    day_id: id, date: days.find(day => day.id === id)!.date, start_time: '09:00:00', end_time: '18:00:00',
    rooms: [{ ...rooms[0], slots: id === 12 ? [slot] : [] }], collisions: [], speaker_conflicts: [],
  })
  const fetchMock = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
    const path = String(input).replace('/api', '')
    let body: unknown
    if (path === '/events') body = [1, 2].map(id => ({ id, name: id === 1 ? 'Konferenz' : 'Andere', start_date: '2026-10-01', end_date: '2026-10-02', accent_color: null, logo_url: null }))
    else if (path === '/events/1/days') body = days
    else if (path === '/events/1/rooms') body = rooms
    else if (path === '/events/1/duty-participants' && failParticipants) return new Response(JSON.stringify({ detail: 'Team nicht verfügbar' }), { status: 500 })
    else if (path.match(/^\/events\/\d+\/helper-plan$/)) body = { duties: [], conflicts: [] }
    else if (path === '/schedule/days/11') body = schedule(11)
    else if (path === '/schedule/days/12') {
      secondDayRequests++
      if (secondDayResponse) return secondDayResponse
      if (failDay) return new Response(JSON.stringify({ detail: 'Tag nicht verfügbar' }), { status: 500 })
      body = schedule(12)
    } else if (path === '/slots/7' && options?.method === 'PATCH') {
      slot = { ...slot, ...JSON.parse(options.body as string) }
      body = slot
    } else if (/^\/events\/\d+\//.test(path)) body = []
    else throw new Error(`Unexpected request: ${path}`)
    return new Response(JSON.stringify(body), { status: 200 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, secondDayRequests: () => secondDayRequests, schedule,
    delaySecondDay: (response: Promise<Response> | null) => { secondDayResponse = response },
    failParticipants: (fail: boolean) => { failParticipants = fail }, failDay: (fail: boolean) => { failDay = fail } }
}

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

async function openDashboard() {
  fireEvent.click(await screen.findByRole('button', { name: 'Dashboard' }))
  await screen.findByRole('button', { name: 'Vortrag am 2. Oktober 2026 bearbeiten' })
  return screen.getByRole('region', { name: 'Veranstaltungsdashboard' })
}

it('loads all days on demand, shares data with conflicts and keeps the filter after editing another day', async () => {
  const api = mockApi()
  render(<App currentUser={admin} />)
  await screen.findByRole('button', { name: 'Dashboard' })
  expect(api.secondDayRequests()).toBe(0)
  expect(screen.getByRole('button', { name: 'Tagesplan' }).getAttribute('aria-pressed')).toBe('true')
  await openDashboard()
  expect(api.secondDayRequests()).toBe(1)
  fireEvent.click(screen.getByRole('button', { name: 'Konflikte' }))
  await screen.findByText('Keine Konflikte in dieser Veranstaltung.')
  expect(api.secondDayRequests()).toBe(1)
  fireEvent.click(screen.getByRole('button', { name: 'Dashboard' }))
  fireEvent.change(screen.getByLabelText('Zeitraum'), { target: { value: '12' } })
  fireEvent.click(screen.getByRole('button', { name: 'Vortrag am 2. Oktober 2026 bearbeiten' }))
  const checkbox = await screen.findByRole('checkbox', { name: 'Redner erforderlich' })
  expect((screen.getByLabelText('Veranstaltungstag') as HTMLSelectElement).value).toBe('12')
  fireEvent.click(checkbox)
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
  await screen.findByText('Keine Sessions mit fehlenden Rednern.')
  expect(screen.queryByRole('checkbox', { name: 'Redner erforderlich' })).toBeNull()
  expect((screen.getByLabelText('Zeitraum') as HTMLSelectElement).value).toBe('12')
  expect(screen.getByRole('button', { name: 'Dashboard' }).getAttribute('aria-pressed')).toBe('true')
  expect(api.fetchMock.mock.calls.find(([, options]) => options?.method === 'PATCH')?.[1]?.body).toContain('"speaker_required":false')
})

it('reports failed overview and base data loads without showing stale counts, and retries everything', async () => {
  const api = mockApi()
  render(<App currentUser={admin} />)
  await openDashboard()
  api.failDay(true)
  fireEvent.click(screen.getByRole('button', { name: 'Aktualisieren' }))
  const dashboard = screen.getByRole('region', { name: 'Veranstaltungsdashboard' })
  expect((await within(dashboard).findByRole('alert')).textContent).toContain('Tag nicht verfügbar')
  expect(dashboard.querySelector('dl')).toBeNull()
  api.failDay(false)
  api.failParticipants(true)
  fireEvent.click(within(dashboard).getByRole('button', { name: 'Erneut versuchen' }))
  await waitFor(() => expect(within(dashboard).getByRole('alert').textContent).toContain('Team nicht verfügbar'))
  expect(dashboard.querySelector('dl')).toBeNull()
  api.failParticipants(false)
  fireEvent.click(within(dashboard).getByRole('button', { name: 'Erneut versuchen' }))
  await within(dashboard).findByRole('button', { name: 'Vortrag am 2. Oktober 2026 bearbeiten' })
})

it('ignores late event responses and returns to the day view when the next event has no admin access', async () => {
  const api = mockApi()
  let finish!: (response: Response) => void
  api.delaySecondDay(new Promise(resolve => { finish = resolve }))
  render(<App currentUser={admin} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Dashboard' }))
  await waitFor(() => expect(api.secondDayRequests()).toBe(1))
  fireEvent.change(screen.getByLabelText('Veranstaltung wählen'), { target: { value: '2' } })
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Dashboard' })).toBeNull())
  await act(async () => finish(new Response(JSON.stringify(api.schedule(12)), { status: 200 })))
  expect(screen.queryByText('Vortrag')).toBeNull()
  expect(screen.queryByRole('region', { name: 'Veranstaltungsdashboard' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Tagesplan' }).getAttribute('aria-pressed')).toBe('true')
})

it.each(['editor', 'helper'] as const)('does not offer the dashboard to %s accounts', async role => {
  mockApi()
  render(<App currentUser={{ ...admin, event_roles: { '1': role } }} />)
  await screen.findByRole('button', { name: 'Tagesplan' })
  expect(screen.queryByRole('button', { name: 'Dashboard' })).toBeNull()
})

it('closes the dashboard if the current role changes', async () => {
  mockApi()
  const { rerender } = render(<App currentUser={admin} />)
  await openDashboard()
  rerender(<App currentUser={{ ...admin, event_roles: { '1': 'editor' } }} />)
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Veranstaltungsdashboard' })).toBeNull())
  expect(screen.getByRole('button', { name: 'Tagesplan' }).getAttribute('aria-pressed')).toBe('true')
})
