import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from './App'
import type { CurrentUser, Duty } from './types'

const currentUser: CurrentUser = {
  id: 3, email: 'person@example.invalid', name: 'Testperson', is_superadmin: false,
  event_roles: { '1': 'editor' }, csrf_token: 'test',
}

const duty = (id: number, dayId: number | null, title: string): Duty => ({
  id, event_id: 1, kind: 'general', title, capacity: 1, user_ids: [], users: [],
  day_id: dayId, date: dayId === 2 ? '2099-06-01' : dayId === 5 ? '2099-06-02' : null, room_id: null, slot_id: null, session_topic: null,
  start_time: dayId ? '09:00:00' : null, end_time: dayId ? '10:00:00' : null, sort_order: id, status: dayId ? 'active' : 'unplanned',
})

const speakers = Array.from({ length: 12 }, (_, index) => ({ id: index + 1, event_id: 1, name: index === 0 ? 'Grace Hopper' : `Person ${index + 1}`, bio: null, website: null, photo_url: null }))

function mockApi() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input).replace('/api', '')
    const day = (id: number, date: string) => ({ id, event_id: 1, date, start_time: '09:00:00', end_time: '18:00:00' })
    const body = path === '/events' ? [{ id: 1, name: 'Konferenz', start_date: '2099-06-01', end_date: '2099-06-02', accent_color: null, logo_url: null }]
      : path === '/events/1/days' ? [day(2, '2099-06-01'), day(5, '2099-06-02')]
        : path === '/events/1/rooms' ? [{ id: 3, event_id: 1, name: 'Saal', sort_order: 0 }]
          : path === '/events/1/speakers' ? speakers
            : path === '/events/1/helper-plan' ? { duties: [duty(1, 2, 'Aufbau'), duty(2, 5, 'Abbau'), duty(3, null, 'Springer')], conflicts: [] }
              : path.startsWith('/schedule/days/') ? { day_id: Number(path.split('/').pop()), date: '2099-06-01', start_time: '09:00:00', end_time: '18:00:00', rooms: [{ id: 3, event_id: 1, name: 'Saal', sort_order: 0, slots: [] }], collisions: [], speaker_conflicts: [] }
                : []
    return new Response(JSON.stringify(body), { status: 200 })
  }))
}

beforeEach(() => window.localStorage.clear())
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function sidebar() { return screen.getByRole('navigation', { name: 'Planung' }) }

it('lists the backlog right after the days', async () => {
  mockApi()
  render(<App currentUser={currentUser} />)
  await screen.findByRole('button', { name: 'Tagesplan' })
  const headings = within(sidebar()).getAllByRole('heading', { level: 2 }).map(heading => heading.textContent)
  expect(headings.slice(0, 3)).toEqual(['Tage', 'Ungeplante Sessions (0)', 'Räume'])
})

it('collapses sections and remembers them', async () => {
  mockApi()
  const { unmount } = render(<App currentUser={currentUser} />)
  const toggle = await within(sidebar()).findByRole('button', { name: 'Räume' })
  expect(toggle.getAttribute('aria-expanded')).toBe('true')
  fireEvent.click(toggle)
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  expect(within(sidebar()).queryByRole('button', { name: 'Saal nach oben' })).toBeNull()
  expect(screen.getByText('Saal', { selector: '.room-name' }).closest('[hidden]')).toBeTruthy()
  unmount()
  render(<App currentUser={currentUser} />)
  expect((await within(sidebar()).findByRole('button', { name: 'Räume' })).getAttribute('aria-expanded')).toBe('false')
})

it('shows the duties of the selected day and all days on request', async () => {
  mockApi()
  render(<App currentUser={currentUser} />)
  const duties = await within(sidebar()).findByRole('button', { name: /^Dienste/ })
  expect(duties.textContent).toBe('Dienste (2)')
  const list = () => [...sidebar().querySelectorAll('.duty-list strong')].map(item => item.textContent)
  expect(list()).toEqual(['Aufbau', 'Springer'])
  fireEvent.click(within(sidebar()).getByLabelText('Alle Tage zeigen'))
  expect(list()).toEqual(['Aufbau', 'Abbau', 'Springer'])
  expect(duties.textContent).toBe('Dienste (3)')
})

it('filters long speaker lists', async () => {
  mockApi()
  render(<App currentUser={currentUser} />)
  const search = await within(sidebar()).findByRole('searchbox', { name: 'Redner durchsuchen' })
  fireEvent.change(search, { target: { value: 'hopper' } })
  expect(within(sidebar()).getByRole('button', { name: 'Grace Hopper' })).toBeTruthy()
  expect(within(sidebar()).queryByRole('button', { name: 'Person 2' })).toBeNull()
  fireEvent.change(search, { target: { value: 'niemand' } })
  expect(within(sidebar()).getByText('Keine Treffer')).toBeTruthy()
})

it('opens the sidebar as a drawer and closes it after choosing a day', async () => {
  mockApi()
  render(<App currentUser={currentUser} />)
  const opener = await screen.findByRole('button', { name: 'Planung' })
  expect(opener.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(opener)
  expect(sidebar().classList.contains('open')).toBe(true)
  fireEvent.keyDown(sidebar(), { key: 'Escape' })
  expect(sidebar().classList.contains('open')).toBe(false)
  fireEvent.click(opener)
  fireEvent.click(within(sidebar()).getByRole('button', { name: /^2\. Juni 2099/ }))
  expect(sidebar().classList.contains('open')).toBe(false)
})

it('shows duty columns in the day view only on request and remembers it', async () => {
  mockApi()
  const { container } = render(<App currentUser={currentUser} />)
  const toggle = await screen.findByRole('checkbox', { name: 'Dienste anzeigen' }) as HTMLInputElement
  expect(toggle.checked).toBe(false)
  expect(container.querySelectorAll('.duty-column')).toHaveLength(0)
  fireEvent.click(toggle)
  expect(container.querySelectorAll('.duty-column')).toHaveLength(2)
  expect(window.localStorage.getItem('slot-machine-plan-show-duties')).toBe('true')
  fireEvent.click(screen.getByRole('button', { name: 'Helferplan' }))
  expect(screen.queryByRole('checkbox', { name: 'Dienste anzeigen' })).toBeNull()
})
