import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import App from './App'
import type { CurrentUser } from './types'

const user: CurrentUser = { id: 3, email: 'person@example.invalid', name: 'Testperson', is_superadmin: false, event_roles: { '1': 'editor' }, csrf_token: 'test' }
const day = { id: 2, event_id: 1, date: '2099-06-01', start_time: '09:00:00', end_time: '18:00:00' }
const idea = { id: 8, event_id: 1, day_id: null, room_id: null, start_time: null, end_time: null, scope: 'room', topic: 'Neue Idee',
  speaker_required: false, speaker_ids: [], speakers: [], description: null, is_cancelled: false, change_notice: null }

function mockApi() {
  const fetch = vi.fn(async (input: RequestInfo | URL, _options?: RequestInit) => {
    const path = String(input).replace('/api', '')
    const body = path === '/events' ? [{ id: 1, name: 'Konferenz', start_date: '2099-06-01', end_date: '2099-06-01', accent_color: null, logo_url: null }]
      : path === '/events/1/days' ? [day]
        : path === '/events/1/rooms' ? [{ id: 3, event_id: 1, name: 'Saal', sort_order: 0 }, { id: 4, event_id: 1, name: 'Foyer', sort_order: 1 }]
          : path === '/events/1/unplanned-sessions' ? [idea]
            : path === '/events/1/helper-plan' ? { duties: [], conflicts: [] }
              : path === '/schedule/days/2' ? { ...day, day_id: 2, rooms: [{ id: 3, event_id: 1, name: 'Saal', sort_order: 0, slots: [] }, { id: 4, event_id: 1, name: 'Foyer', sort_order: 1, slots: [] }], collisions: [], speaker_conflicts: [] }
                : path === '/slots/8' ? { ...idea, day_id: 2, room_id: 4, start_time: '10:30:00', end_time: '11:15:00' }
                  : []
    return new Response(JSON.stringify(body), { status: 200 })
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('plans an unplanned session through a dialog instead of dragging', async () => {
  const fetch = mockApi()
  render(<App currentUser={user} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Neue Idee einplanen' }))
  const dialog = screen.getByRole('dialog', { name: '„Neue Idee“ einplanen' })
  fireEvent.change(within(dialog).getByLabelText('Raum'), { target: { value: '4' } })
  fireEvent.change(within(dialog).getByLabelText('Beginn'), { target: { value: '17:30' } })
  expect(within(dialog).getByText('Die Session muss zwischen 09:00 und 18:00 Uhr liegen.')).toBeTruthy()
  expect((within(dialog).getByRole('button', { name: 'Einplanen' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.change(within(dialog).getByLabelText('Beginn'), { target: { value: '10:30' } })
  fireEvent.change(within(dialog).getByLabelText('Dauer in Minuten'), { target: { value: '45' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Einplanen' }))
  await screen.findByText('„Neue Idee“ eingeplant.')
  const call = fetch.mock.calls.find(([url, options]) => String(url) === '/api/slots/8' && options?.method === 'PATCH')
  expect(JSON.parse(String(call?.[1]?.body))).toEqual({ day_id: 2, room_id: 4, start_time: '10:30', end_time: '11:15' })
  expect(screen.queryByRole('dialog', { name: '„Neue Idee“ einplanen' })).toBeNull()
})

it('opens the keyboard help with ? but not while typing', async () => {
  mockApi()
  render(<App currentUser={user} />)
  await screen.findByRole('button', { name: 'Tastenkürzel' })
  const search = document.createElement('input')
  document.body.append(search)
  fireEvent.keyDown(search, { key: '?' })
  expect(screen.queryByRole('dialog', { name: 'Tastenkürzel im Plan' })).toBeNull()
  search.remove()
  fireEvent.keyDown(document.body, { key: '?' })
  const help = screen.getByRole('dialog', { name: 'Tastenkürzel im Plan' })
  expect(within(help).getByText('15 Minuten später')).toBeTruthy()
  fireEvent.click(within(help).getByRole('button', { name: 'Schließen' }))
  expect(screen.queryByRole('dialog', { name: 'Tastenkürzel im Plan' })).toBeNull()
})
