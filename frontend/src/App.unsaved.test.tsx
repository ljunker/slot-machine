import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from './App'
import type { CurrentUser, DaySchedule, Event, EventDay, Slot } from './types'

const currentUser: CurrentUser = { id: 1, email: 'admin@example.invalid', name: 'Testperson', is_superadmin: true, event_roles: {}, csrf_token: 'test' }
const event: Event = { id: 1, name: 'Konferenz', start_date: '2099-06-01', end_date: '2099-06-01', accent_color: null, logo_url: null, program_published: true }
const day: EventDay = { id: 11, event_id: 1, date: '2099-06-01', start_time: '09:00:00', end_time: '18:00:00' }
const slots: Slot[] = [[1, 'Erster', '10:00:00', '11:00:00'], [2, 'Zweiter', '13:00:00', '14:00:00']].map(([id, topic, start, end]) => ({
  id: id as number, event_id: 1, day_id: 11, room_id: 2, topic: topic as string, speaker_required: false, speaker_ids: [], speakers: [],
  description: null, start_time: start as string, end_time: end as string, is_cancelled: false, change_notice: null,
}))

let patches: { path: string; body: Record<string, unknown> }[] = []

beforeEach(() => {
  patches = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
    const path = String(input).replace('/api', '')
    if (options?.method === 'PATCH') {
      patches.push({ path, body: JSON.parse(String(options.body)) })
      return new Response(JSON.stringify(slots[0]), { status: 200 })
    }
    let body: unknown
    if (path === '/events') body = [event]
    else if (path === '/events/1/days') body = [day]
    else if (path === '/events/1/rooms') body = [{ id: 2, event_id: 1, name: 'Saal', sort_order: 0 }]
    else if (['/events/1/speakers', '/events/1/categories', '/events/1/unplanned-sessions', '/events/1/duty-participants'].includes(path)) body = []
    else if (path === '/events/1/helper-plan') body = { duties: [], conflicts: [] }
    else if (path === '/schedule/days/11') body = {
      day_id: 11, date: day.date, start_time: day.start_time, end_time: day.end_time,
      rooms: [{ id: 2, event_id: 1, name: 'Saal', sort_order: 0, slots }], collisions: [], speaker_conflicts: [],
    } satisfies DaySchedule
    else throw new Error(`Unexpected request: ${path}`)
    return new Response(JSON.stringify(body), { status: 200 })
  }))
})

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

async function editFirstDescription() {
  render(<App currentUser={currentUser} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Erster bearbeiten' }))
  const editor = screen.getByRole('complementary', { name: 'Slot bearbeiten' })
  expect(within(editor).queryByText('Ungespeichert')).toBeNull()
  fireEvent.change(within(editor).getByLabelText('Beschreibung'), { target: { value: 'Halb fertig' } })
  expect(within(editor).getByText('Ungespeichert')).toBeTruthy()
}

it('switches slots without asking when nothing changed', async () => {
  render(<App currentUser={currentUser} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Erster bearbeiten' }))
  fireEvent.click(screen.getByRole('button', { name: 'Zweiter bearbeiten' }))
  expect(screen.queryByRole('alertdialog')).toBeNull()
  expect((screen.getByLabelText('Thema') as HTMLInputElement).value).toBe('Zweiter')
})

it('asks before another slot replaces unsaved input and keeps it on cancel', async () => {
  await editFirstDescription()
  fireEvent.click(screen.getByRole('button', { name: 'Zweiter bearbeiten' }))
  const dialog = screen.getByRole('alertdialog', { name: 'Änderungen verwerfen?' })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }))
  expect(screen.queryByRole('alertdialog')).toBeNull()
  expect((screen.getByLabelText('Beschreibung') as HTMLTextAreaElement).value).toBe('Halb fertig')
  expect((screen.getByLabelText('Thema') as HTMLInputElement).value).toBe('Erster')
})

it('discards unsaved input and opens the other slot', async () => {
  await editFirstDescription()
  fireEvent.click(screen.getByRole('button', { name: 'Zweiter bearbeiten' }))
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Verwerfen' }))
  expect((screen.getByLabelText('Thema') as HTMLInputElement).value).toBe('Zweiter')
  expect((screen.getByLabelText('Beschreibung') as HTMLTextAreaElement).value).toBe('')
  expect(patches).toEqual([])
})

it('saves unsaved input before closing the editor', async () => {
  await editFirstDescription()
  fireEvent.click(within(screen.getByRole('complementary', { name: 'Slot bearbeiten' })).getByRole('button', { name: 'Schließen' }))
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Speichern' }))
  await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Slot bearbeiten' })).toBeNull())
  expect(patches).toEqual([{ path: '/slots/1', body: expect.objectContaining({ description: 'Halb fertig' }) }])
  expect(screen.queryByRole('alertdialog')).toBeNull()
})

it('warns before leaving the page with unsaved input', async () => {
  await editFirstDescription()
  const leave = new window.Event('beforeunload', { cancelable: true })
  window.dispatchEvent(leave)
  expect(leave.defaultPrevented).toBe(true)
})

it('does not ask while the input is being saved', async () => {
  await editFirstDescription()
  fireEvent.click(within(screen.getByRole('complementary', { name: 'Slot bearbeiten' })).getByRole('button', { name: 'Speichern' }))
  fireEvent.click(screen.getByRole('button', { name: 'Zweiter bearbeiten' }))
  expect(screen.queryByRole('alertdialog')).toBeNull()
  await waitFor(() => expect(patches).toHaveLength(1))
  await waitFor(() => expect((screen.getByLabelText('Thema') as HTMLInputElement).value).toBe('Zweiter'))
})
