import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import App from './App'
import type { DaySchedule, Event, EventDay, Slot } from './types'

const event: Event = { id: 1, name: 'Konferenz', start_date: '2099-06-01', end_date: '2099-06-01', accent_color: null, logo_url: null }
const day: EventDay = { id: 11, event_id: 1, date: '2099-06-01', start_time: '09:00:00', end_time: '18:00:00' }
const expiresAt = Math.floor(Date.now() / 1000) + 3600
const rescheduled = { type: 'rescheduled' as const, expires_at: expiresAt, previous_start_time: '09:00:00', previous_end_time: '10:00:00', previous_room_name: 'Saal' }
const slots: Slot[] = [1, 2].map(id => ({
  id, event_id: 1, day_id: 11, room_id: 2, topic: id === 1 ? 'Erster' : 'Zweiter',
  speaker_ids: [], speakers: [], description: null,
  start_time: id === 1 ? '10:00:00' : '13:00:00', end_time: id === 1 ? '11:00:00' : '14:00:00',
  is_cancelled: false, change_notice: rescheduled,
}))

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('removes one rescheduled notice in the editor and all remaining notices for the event', async () => {
  let currentSlots = slots
  const confirm = vi.fn(() => true)
  vi.stubGlobal('confirm', confirm)
  const fetchMock = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
    const path = String(input).replace('/api', '')
    if (options?.method === 'DELETE') {
      if (path === '/slots/1/rescheduled-notice') {
        currentSlots = currentSlots.map(slot => slot.id === 1 ? { ...slot, change_notice: { type: 'updated', expires_at: expiresAt, previous_start_time: null, previous_end_time: null, previous_room_name: null } } : slot)
      } else if (path === '/events/1/rescheduled-notices') {
        currentSlots = currentSlots.map(slot => slot.id === 2 ? { ...slot, change_notice: null } : slot)
      } else throw new Error(`Unexpected DELETE: ${path}`)
      return new Response(null, { status: 204 })
    }
    let body: unknown
    if (path === '/events') body = [event]
    else if (path === '/events/1/days') body = [day]
    else if (path === '/events/1/rooms') body = [{ id: 2, event_id: 1, name: 'Saal', sort_order: 0 }]
    else if (path === '/events/1/speakers' || path === '/events/1/unplanned-sessions' || path === '/events/1/helpers') body = []
    else if (path === '/events/1/helper-plan') body = { duties: [], conflicts: [] }
    else if (path === '/schedule/days/11') body = {
      day_id: 11, date: day.date, start_time: day.start_time, end_time: day.end_time,
      rooms: [{ id: 2, event_id: 1, name: 'Saal', sort_order: 0, slots: currentSlots }],
      collisions: [], speaker_conflicts: [],
    } satisfies DaySchedule
    else throw new Error(`Unexpected request: ${path}`)
    return new Response(JSON.stringify(body), { status: 200 })
  })
  vi.stubGlobal('fetch', fetchMock)

  const { container } = render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: 'Erster bearbeiten' }))
  expect(screen.getByRole('button', { name: 'Verschoben entfernen' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Verschoben entfernen' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Verschoben entfernen' })).toBeNull())
  expect(screen.getByRole('complementary', { name: 'Slot bearbeiten' }).textContent).toContain('Geändert')
  expect(container.querySelectorAll('.slot-card.notice-rescheduled')).toHaveLength(1)
  expect(fetchMock).toHaveBeenCalledWith('/api/slots/1/rescheduled-notice', expect.objectContaining({ method: 'DELETE' }))

  confirm.mockReturnValueOnce(false)
  fireEvent.click(screen.getByRole('button', { name: 'Alle Verschoben Flags entfernen' }))
  expect(fetchMock).not.toHaveBeenCalledWith('/api/events/1/rescheduled-notices', expect.anything())
  fireEvent.click(screen.getByRole('button', { name: 'Alle Verschoben Flags entfernen' }))
  await waitFor(() => expect(container.querySelectorAll('.slot-card.notice-rescheduled')).toHaveLength(0))
  expect(confirm).toHaveBeenCalledWith('Alle Verschoben-Flags dieser Veranstaltung entfernen?')
  expect(container.querySelectorAll('.slot-card.notice-updated')).toHaveLength(1)
  expect(fetchMock).toHaveBeenCalledWith('/api/events/1/rescheduled-notices', expect.objectContaining({ method: 'DELETE' }))
})
