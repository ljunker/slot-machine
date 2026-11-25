import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import App from './App'
import type { CurrentUser, DaySchedule, Event, EventDay, Slot } from './types'

vi.mock('./Schedule', () => ({
  default: ({ schedule, onChange }: { schedule: DaySchedule; onChange: (id: number, patch: Record<string, unknown>) => Promise<unknown> }) => {
    const slot = schedule.rooms.flatMap(room => room.slots)[0]
    return <div>
      <p data-testid="position">{slot.room_id} {slot.start_time.slice(0, 5)}</p>
      <button type="button" onClick={() => void onChange(slot.id, { room_id: 3, start_time: '12:00', end_time: '13:00' })}>Ziehen</button>
    </div>
  },
}))

const currentUser: CurrentUser = { id: 1, email: 'admin@example.invalid', name: 'Testperson', is_superadmin: true, event_roles: {}, csrf_token: 'test' }
const event: Event = { id: 1, name: 'Konferenz', start_date: '2099-06-01', end_date: '2099-06-01', accent_color: null, logo_url: null, program_published: true }
const day: EventDay = { id: 11, event_id: 1, date: '2099-06-01', start_time: '09:00:00', end_time: '18:00:00' }
const rooms = [{ id: 2, event_id: 1, name: 'Saal A', sort_order: 0 }, { id: 3, event_id: 1, name: 'Saal B', sort_order: 1 }]

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('moves a slot at once and takes the move back from the toast', async () => {
  let slot: Slot = {
    id: 7, event_id: 1, day_id: 11, room_id: 2, topic: 'Eröffnung', speaker_required: false, speaker_ids: [], speakers: [],
    description: null, start_time: '10:00:00', end_time: '11:00:00', is_cancelled: false, change_notice: null,
  }
  const patches: unknown[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
    const path = String(input).replace('/api', '')
    if (options?.method === 'PATCH' && path === '/slots/7') {
      const patch = JSON.parse(String(options.body))
      patches.push(patch)
      slot = { ...slot, room_id: patch.room_id, start_time: `${patch.start_time}:00`, end_time: `${patch.end_time}:00` }
      return new Response(JSON.stringify(slot), { status: 200 })
    }
    let body: unknown
    if (path === '/events') body = [event]
    else if (path === '/events/1/days') body = [day]
    else if (path === '/events/1/rooms') body = rooms
    else if (['/events/1/speakers', '/events/1/categories', '/events/1/unplanned-sessions', '/events/1/duty-participants'].includes(path)) body = []
    else if (path === '/events/1/helper-plan') body = { duties: [], conflicts: [] }
    else if (path === '/schedule/days/11') body = {
      day_id: 11, date: day.date, start_time: day.start_time, end_time: day.end_time,
      rooms: rooms.map(room => ({ ...room, slots: slot.room_id === room.id ? [slot] : [] })),
      collisions: [], speaker_conflicts: [],
    } satisfies DaySchedule
    else throw new Error(`Unexpected request: ${path}`)
    return new Response(JSON.stringify(body), { status: 200 })
  })
  vi.stubGlobal('fetch', fetchMock)

  render(<App currentUser={currentUser} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Ziehen' }))
  expect(screen.getByTestId('position').textContent).toBe('3 12:00')
  expect(screen.queryByText('Lade Programm …')).toBeNull()
  expect(await screen.findByText('„Eröffnung“ verschoben.')).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: 'Rückgängig' }))
  await waitFor(() => expect(patches).toEqual([
    { room_id: 3, start_time: '12:00', end_time: '13:00' },
    { room_id: 2, start_time: '10:00', end_time: '11:00' },
  ]))
  await waitFor(() => expect(screen.getByTestId('position').textContent).toBe('2 10:00'))
  expect(screen.queryByText('„Eröffnung“ verschoben.')).toBeNull()
})
