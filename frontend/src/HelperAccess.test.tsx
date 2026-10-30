import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import App from './App'
import { AuthGate } from './Auth'
import DutySignup from './DutySignup'
import type { CurrentUser, Duty, Slot } from './types'

const currentUser: CurrentUser = { id: 9, name: 'Ada', email: 'ada@example.invalid', is_superadmin: false, event_roles: { '1': 'helper', '2': 'editor' }, csrf_token: 'test' }
const slot: Slot = { id: 3, event_id: 1, day_id: 4, room_id: 5, topic: 'Vortrag', description: 'Details zum Vortrag', start_time: '10:00:00', end_time: '11:00:00', speaker_ids: [], speakers: [], is_cancelled: false, change_notice: null }
const duty: Duty = { id: 6, event_id: 1, kind: 'general', title: 'Einlass', user_ids: [], users: [], capacity: 1, day_id: 4, date: '2026-10-01', room_id: null, slot_id: null, session_topic: null, start_time: '10:00:00', end_time: '12:00:00', sort_order: 0, status: 'active' }

function mockApi(user = currentUser) {
  let assigned = false
  const fetch = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
    const path = String(input).replace('/api', '')
    if (path === '/duties/6/signup') assigned = options?.method === 'PUT'
    const currentDuty = { ...duty, user_ids: assigned ? [9] : [], users: assigned ? [{ id: 9, name: 'Ada', is_active: true }] : [] }
    const body = path === '/auth/me' ? options?.method === 'PATCH' ? { ...user, name: 'Ada Müller' } : user
      : path === '/events' ? [1, 2].map(id => ({ id, name: `Veranstaltung ${id}`, start_date: '2026-10-01', end_date: '2026-10-01', accent_color: null, logo_url: null }))
        : /\/events\/\d+\/days/.test(path) ? [{ id: 4, event_id: 1, date: '2026-10-01', start_time: '09:00:00', end_time: '18:00:00' }]
          : /\/events\/\d+\/rooms/.test(path) ? [{ id: 5, event_id: 1, name: 'Saal', sort_order: 0 }]
            : path.endsWith('/helper-plan') ? { duties: [currentDuty], conflicts: [] }
              : path === '/schedule/days/4' ? { day_id: 4, date: '2026-10-01', start_time: '09:00:00', end_time: '18:00:00', rooms: [{ id: 5, event_id: 1, name: 'Saal', sort_order: 0, slots: [slot] }], collisions: [], speaker_conflicts: [] }
                : path === '/duties/6/signup' ? currentDuty : []
    return new Response(JSON.stringify(body), { status: 200 })
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('shows helper read-only details and persists own signup and leave', async () => {
  const fetch = mockApi()
  const { container } = render(<App currentUser={currentUser} />)
  await screen.findByRole('button', { name: 'Vortrag ansehen' })
  for (const name of ['+ Slot', '+ Dienst', '+ Helfer', '+ Redner', '+ Session', 'Team verwalten', 'Alle Änderungs-Flags entfernen']) {
    expect(screen.queryByRole('button', { name })).toBeNull()
  }
  expect(container.querySelector('.slot-resize, .duty-resize')).toBeNull()
  expect(fetch.mock.calls.some(([url]) => String(url).includes('duty-participants'))).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'Vortrag ansehen' }))
  expect(screen.getByLabelText('Sessiondetails').textContent).toContain('Details zum Vortrag')
  expect(screen.queryByRole('button', { name: 'Speichern' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Schließen' }))
  fireEvent.click(screen.getByText('0 / 1 Plätze belegt'))
  expect(screen.getByLabelText('Dienstdetails')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Schließen' }))
  fireEvent.click(screen.getByRole('button', { name: 'Eintragen in Einlass' }))
  await screen.findByRole('button', { name: 'Austragen aus Einlass' })
  expect(screen.queryByLabelText('Dienstdetails')).toBeNull()
  expect(fetch.mock.calls.some(([url, options]) => String(url) === '/api/duties/6/signup' && options?.method === 'PUT')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Austragen aus Einlass' }))
  await screen.findByRole('button', { name: 'Eintragen in Einlass' })
  expect(fetch.mock.calls.some(([url, options]) => String(url) === '/api/duties/6/signup' && options?.method === 'DELETE')).toBe(true)
})

it('closes editing panels and removes editing controls when switching to helper event', async () => {
  mockApi()
  render(<App currentUser={currentUser} />)
  await screen.findByRole('button', { name: 'Vortrag ansehen' })
  fireEvent.change(screen.getByLabelText('Veranstaltung wählen'), { target: { value: '2' } })
  await screen.findByRole('button', { name: '+ Dienst' })
  fireEvent.click(screen.getByRole('button', { name: '+ Dienst' }))
  expect(screen.getByRole('heading', { name: 'Dienst anlegen' })).toBeTruthy()
  fireEvent.change(screen.getByLabelText('Veranstaltung wählen'), { target: { value: '1' } })
  await screen.findByRole('button', { name: 'Vortrag ansehen' })
  expect(screen.queryByRole('heading', { name: 'Dienst anlegen' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Speichern' })).toBeNull()
})

it('requires a name before opening the application', async () => {
  const fetch = mockApi({ ...currentUser, name: null })
  render(<AuthGate />)
  await screen.findByRole('heading', { name: 'Namen festlegen' })
  expect(screen.queryByLabelText('Veranstaltung wählen')).toBeNull()
  fireEvent.change(screen.getByLabelText('Name', { exact: true }), { target: { value: 'Ada Müller' } })
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
  await screen.findByLabelText('Veranstaltung wählen')
  expect(fetch.mock.calls.some(([url, options]) => String(url) === '/api/auth/me' && options?.method === 'PATCH' && JSON.parse(String(options.body)).name === 'Ada Müller')).toBe(true)
})

it('blocks full and inactive duties but always allows leaving an own assignment', () => {
  const onSignup = vi.fn(async () => {})
  const full = { ...duty, user_ids: [8], users: [{ id: 8, name: 'Ben', is_active: true }] }
  const { rerender } = render(<DutySignup duty={full} currentUserId={9} onSignup={onSignup} />)
  expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true)
  rerender(<DutySignup duty={{ ...duty, status: 'cancelled' }} currentUserId={9} onSignup={onSignup} />)
  expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true)
  rerender(<DutySignup duty={{ ...duty, status: 'unplanned', user_ids: [9] }} currentUserId={9} onSignup={onSignup} />)
  expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(false)
})
