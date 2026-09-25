import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import App from './App'
import type { DaySchedule, Event, EventDay, Slot } from './types'

const event: Event = { id: 1, name: 'Konferenz', start_date: '2099-06-01', end_date: '2099-06-02', accent_color: null, logo_url: null }
const days: EventDay[] = [
  { id: 11, event_id: 1, date: '2099-06-01', start_time: '09:00:00', end_time: '18:00:00' },
  { id: 12, event_id: 1, date: '2099-06-02', start_time: '09:00:00', end_time: '18:00:00' },
]
const slots: Slot[] = [1, 2].map(id => ({
  id, event_id: 1, day_id: 12, room_id: 2, topic: id === 1 ? 'Erster' : 'Zweiter',
  speaker_ids: [], speakers: [], description: null, start_time: id === 1 ? '10:00:00' : '10:30:00',
  end_time: id === 1 ? '11:00:00' : '11:30:00', is_cancelled: false, change_notice: null,
}))
const schedule = (dayId: number): DaySchedule => ({
  day_id: dayId, date: days.find(day => day.id === dayId)!.date,
  start_time: '09:00:00', end_time: '18:00:00',
  rooms: [{ id: 2, event_id: 1, name: 'Saal', sort_order: 0, slots: dayId === 12 ? slots : [] }],
  collisions: dayId === 12 ? [{ first_slot_id: 1, second_slot_id: 2 }] : [], speaker_conflicts: [],
})

function mockApi(failOverview = false) {
  let secondDayRequests = 0
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input).replace('/api', '')
    let body: unknown
    if (path === '/events') body = [event]
    else if (path === '/events/1/days') body = days
    else if (path === '/events/1/rooms') body = [{ id: 2, event_id: 1, name: 'Saal', sort_order: 0 }]
    else if (path === '/events/1/speakers' || path === '/events/1/unplanned-sessions' || path === '/events/1/helpers') body = []
    else if (path === '/events/1/helper-plan') body = { duties: [], conflicts: [] }
    else if (path === '/schedule/days/11') body = schedule(11)
    else if (path === '/schedule/days/12') {
      secondDayRequests++
      if (failOverview) return new Response(JSON.stringify({ detail: 'Tagesplan nicht verfügbar' }), { status: 500 })
      body = schedule(12)
    } else throw new Error(`Unexpected request: ${path}`)
    return new Response(JSON.stringify(body), { status: 200 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return { secondDayRequests: () => secondDayRequests }
}

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('loads every day only for the overview and opens a slot on its day', async () => {
  const api = mockApi()
  render(<App />)
  await screen.findByRole('button', { name: 'Konflikte' })
  expect(api.secondDayRequests()).toBe(0)
  fireEvent.click(screen.getByRole('button', { name: 'Konflikte' }))
  expect(await screen.findByText('1 Konflikt in dieser Veranstaltung')).toBeTruthy()
  expect(api.secondDayRequests()).toBe(1)
  fireEvent.click(screen.getByRole('button', { name: 'Zweiter am 2099-06-02 bearbeiten' }))
  await waitFor(() => expect((screen.getByLabelText('Thema') as HTMLInputElement).value).toBe('Zweiter'))
  expect(screen.getByRole('button', { name: 'Tagesplan' }).getAttribute('aria-pressed')).toBe('true')
})

it('reports a failed day request instead of showing an incomplete overview', async () => {
  mockApi(true)
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: 'Konflikte' }))
  expect((await screen.findByRole('alert')).textContent).toContain('Konflikte konnten nicht geladen werden: Tagesplan nicht verfügbar')
  expect(screen.getByRole('button', { name: 'Erneut versuchen' })).toBeTruthy()
  expect(screen.queryByText('Keine Konflikte in dieser Veranstaltung.')).toBeNull()
})
