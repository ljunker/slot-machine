import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import App from './App'
import type { CurrentUser } from './types'

const user = (role: 'admin' | 'editor'): CurrentUser => ({
  id: 3, email: 'person@example.invalid', name: 'Testperson', is_superadmin: false,
  event_roles: { '1': role }, csrf_token: 'test',
})

function mockApi() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input).replace('/api', '')
    const body = path === '/events' ? [{ id: 1, name: 'Konferenz', start_date: '2099-06-01', end_date: '2099-06-01', accent_color: null, logo_url: null }]
      : path === '/events/1/days' ? [{ id: 2, event_id: 1, date: '2099-06-01', start_time: '09:00:00', end_time: '18:00:00' }]
        : path === '/events/1/rooms' ? [{ id: 3, event_id: 1, name: 'Saal', sort_order: 0 }]
          : path === '/events/1/helper-plan' ? { duties: [], conflicts: [] }
            : path === '/schedule/days/2' ? { day_id: 2, date: '2099-06-01', start_time: '09:00:00', end_time: '18:00:00', rooms: [{ id: 3, event_id: 1, name: 'Saal', sort_order: 0, slots: [] }], collisions: [], speaker_conflicts: [] }
              : []
    return new Response(JSON.stringify(body), { status: 200 })
  }))
}

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('shows planning actions to editors without admin controls', async () => {
  mockApi()
  render(<App currentUser={user('editor')} />)
  await screen.findByRole('button', { name: '+ Slot' })
  expect(screen.getByRole('button', { name: '+ Dienst' })).toBeTruthy()
  for (const name of ['+ Veranstaltung', '+ Tag', '+ Raum', 'Team verwalten', 'Restore', 'Benutzer', 'Bearbeiten']) {
    expect(screen.queryByRole('button', { name })).toBeNull()
  }
  expect(screen.queryByRole('link', { name: 'Backup herunterladen' })).toBeNull()
})

it('shows event controls to event admins without global controls', async () => {
  mockApi()
  render(<App currentUser={user('admin')} />)
  await screen.findByRole('button', { name: '+ Tag' })
  expect(screen.getByRole('button', { name: '+ Raum' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Team verwalten' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Restore' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: '+ Veranstaltung' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Benutzer' })).toBeNull()
})
