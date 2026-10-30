import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import Editor from './Editor'
import Schedule from './Schedule'
import PublicSchedule from './PublicSchedule'
import { collectConflicts } from './ConflictOverview'
import type { DaySchedule, Duty, Slot } from './types'

const shared: Slot = {
  id: 5, event_id: 1, day_id: 2, scope: 'all_rooms', room_id: null, topic: 'Mittagspause',
  speaker_required: true, speaker_ids: [], speakers: [], description: 'Gemeinsam essen',
  start_time: '12:00:00', end_time: '13:00:00', is_cancelled: false, change_notice: null,
}
const schedule: DaySchedule = {
  day_id: 2, date: '2026-10-01', start_time: '09:00:00', end_time: '18:00:00',
  collisions: [], speaker_conflicts: [], shared_slots: [shared],
  rooms: [
    { id: 3, event_id: 1, name: 'Saal A', sort_order: 0, slots: [] },
    { id: 4, event_id: 1, name: 'Saal B', sort_order: 1, slots: [] },
  ],
}
const days = [{ id: 2, event_id: 1, date: '2026-10-01', start_time: '09:00:00', end_time: '18:00:00' }]
const onChange = async () => {}
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('creates shared sessions without rooms and retains scope when unplanning', async () => {
  const onSave = vi.fn(async () => true)
  const { unmount } = render(<Editor kind="slot" days={days} day={days[0]} rooms={[]} speakers={[]}
    onSave={onSave} onDelete={null} onClose={() => {}} />)
  expect((screen.getByLabelText('Geltungsbereich') as HTMLSelectElement).value).toBe('room')
  fireEvent.change(screen.getByLabelText('Geltungsbereich'), { target: { value: 'all_rooms' } })
  expect(screen.queryByLabelText('Raum')).toBeNull()
  fireEvent.change(screen.getByLabelText('Thema'), { target: { value: 'Pause' } })
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
  await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ scope: 'all_rooms', room_id: null, day_id: 2 })))
  unmount()
  render(<Editor kind="slot" slot={shared} days={days} day={days[0]} rooms={schedule.rooms} speakers={[]}
    onSave={onSave} onDelete={null} onClose={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: 'Planung entfernen' }))
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
  await waitFor(() => expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ scope: 'all_rooms', room_id: null, day_id: null, start_time: null, end_time: null })))
})

it.each(['program', 'helpers'] as const)('spans room columns and keeps shared duties in the general column in %s view', focus => {
  const duty: Duty = { id: 7, event_id: 1, kind: 'session', title: null, capacity: 1, user_ids: [], users: [],
    day_id: 2, date: '2026-10-01', room_id: null, slot_id: 5, session_topic: 'Mittagspause',
    start_time: '12:00:00', end_time: '13:00:00', sort_order: 0, status: 'active' }
  const onEdit = vi.fn()
  const { container } = render(<Schedule schedule={schedule} focus={focus} helperPlan={{ duties: [duty], conflicts: [] }} onEdit={onEdit} onChange={onChange} />)
  expect(container.querySelectorAll('[data-slot-id="5"]')).toHaveLength(1)
  expect(container.querySelector('[data-shared-layer] [data-slot-id="5"]')).not.toBeNull()
  expect(container.querySelector('[data-duty-column="general"] [data-duty-id="7"]')).not.toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Mittagspause bearbeiten' }))
  expect(onEdit).toHaveBeenCalledWith(shared)
})

it('uses room lanes for all visible overlaps including cancellation and shared/shared overlaps', () => {
  const cancelled: Slot = { ...shared, id: 6, scope: 'room', room_id: 3, topic: 'Abgesagt', is_cancelled: true,
    change_notice: { type: 'cancelled', expires_at: null, previous_start_time: null, previous_end_time: null, previous_room_name: null } }
  const overlapping = { ...schedule, rooms: [{ ...schedule.rooms[0], slots: [cancelled] }, schedule.rooms[1]] }
  const { container, rerender } = render(<Schedule schedule={overlapping} onEdit={() => {}} onChange={onChange} />)
  expect(container.querySelector('[data-shared-layer] [data-slot-id]')).toBeNull()
  expect(container.querySelectorAll('[data-slot-id="5"]')).toHaveLength(2)
  expect((container.querySelector('[data-room-column="3"] [data-slot-id="5"]') as HTMLElement).style.width).toBe('50%')
  rerender(<Schedule schedule={{ ...schedule, shared_slots: [shared, { ...shared, id: 6, topic: 'Zweite Pause' }] }} onEdit={() => {}} onChange={onChange} />)
  expect(container.querySelectorAll('[data-slot-id]')).toHaveLength(4)
})

it('moves shared sessions vertically across room columns without assigning a room and resizes them', () => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const second = this.dataset.programColumn === '4'
    return { left: second ? 300 : 0, right: second ? 600 : 299 } as DOMRect
  })
  const change = vi.fn(async () => {})
  render(<Schedule schedule={schedule} onEdit={() => {}} onChange={change} />)
  fireEvent.pointerDown(screen.getByLabelText('Mittagspause verschieben'), { button: 0, clientY: 100 })
  fireEvent.pointerMove(window, { clientX: 350, clientY: 124 })
  fireEvent.pointerUp(window)
  expect(change).toHaveBeenCalledWith(5, { room_id: null, start_time: '12:15', end_time: '13:15' })
  fireEvent.pointerDown(screen.getByLabelText('Mittagspause verlängern oder verkürzen'), { button: 0, clientY: 100 })
  fireEvent.pointerMove(window, { clientX: 350, clientY: 124 })
  fireEvent.pointerUp(window)
  expect(change).toHaveBeenCalledWith(5, { end_time: '13:15' })
})

it('renders shared sessions without rooms and resolves their conflicts once', () => {
  const other: Slot = { ...shared, id: 6, scope: 'room', room_id: 3, topic: 'Vortrag' }
  const overlapping: DaySchedule = { ...schedule, rooms: [{ ...schedule.rooms[0], slots: [other] }],
    collisions: [{ first_slot_id: 5, second_slot_id: 6 }] }
  const entries = collectConflicts([overlapping], { duties: [], conflicts: [] })
  expect(entries).toHaveLength(1)
  expect(entries[0].first.detail).toContain('Alle Räume')
  const { container } = render(<Schedule schedule={{ ...schedule, rooms: [] }} onEdit={() => {}} onChange={onChange} />)
  expect(container.querySelector('[data-shared-layer] [data-slot-id="5"]')).not.toBeNull()
  expect(screen.getByText('Alle Räume', { selector: '.room-head' })).toBeTruthy()
})

it('shows one desktop bar, includes the session in every mobile room, and opens shared details', () => {
  const { container } = render(<PublicSchedule schedule={schedule} />)
  expect(container.querySelectorAll('.public-desktop-program [data-slot-id="5"]')).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: /Mittagspause,.*Details anzeigen/ }))
  expect(screen.getByRole('region', { name: 'Session-Details' }).textContent).toContain('Alle Räume')
  for (const name of ['Saal A', 'Saal B']) {
    fireEvent.click(screen.getByRole('tab', { name }))
    const panel = screen.getByRole('tabpanel')
    expect(panel.textContent).toContain('Mittagspause')
    expect(within(panel).getByRole('link', { name: 'Session-Seite öffnen' }).getAttribute('href')).toBe('/programm/1/sessions/5')
  }
})

it('shows public shared sessions without rooms', () => {
  render(<PublicSchedule schedule={{ ...schedule, rooms: [] }} />)
  expect(screen.getByRole('tab', { name: 'Alle Räume' })).toBeTruthy()
  expect(screen.getByRole('tabpanel').textContent).toContain('Mittagspause')
})
