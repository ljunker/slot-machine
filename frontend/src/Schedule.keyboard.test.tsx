import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import Schedule, { keyboardAction } from './Schedule'
import type { DaySchedule, Duty, Slot } from './types'

const slot = (id: number, changes: Partial<Slot> = {}): Slot => ({
  id, event_id: 1, day_id: 1, room_id: 1, topic: `Talk ${id}`, speaker_required: true, speaker_ids: [], speakers: [],
  description: null, start_time: '10:00:00', end_time: '11:00:00', is_cancelled: false, change_notice: null, ...changes,
})
const schedule: DaySchedule = {
  day_id: 1, date: '2026-10-01', start_time: '09:00:00', end_time: '18:00:00', collisions: [], speaker_conflicts: [],
  rooms: [
    { id: 1, event_id: 1, name: 'Saal A', sort_order: 0, slots: [slot(1), slot(2, { start_time: '09:00:00', end_time: '09:30:00' })] },
    { id: 2, event_id: 1, name: 'Saal B', sort_order: 1, slots: [] },
  ],
}
const duty: Duty = { id: 7, event_id: 1, kind: 'general', title: 'Einlass', user_ids: [3], users: [{ id: 3, name: 'Ada', is_active: true }],
  capacity: 2, day_id: 1, date: '2026-10-01', room_id: null, slot_id: null, session_topic: null,
  start_time: '12:00:00', end_time: '13:00:00', sort_order: 0, status: 'active' }

afterEach(cleanup)

it('maps only Alt combinations with arrow keys to plan changes', () => {
  const key = (key: string, extra: Partial<KeyboardEvent> = {}) => keyboardAction({ key, altKey: true, shiftKey: false, ctrlKey: false, metaKey: false, ...extra })
  expect(key('ArrowDown')).toEqual({ kind: 'move', delta: 15 })
  expect(key('ArrowUp', { shiftKey: true })).toEqual({ kind: 'resize', delta: -15 })
  expect(key('ArrowLeft')).toEqual({ kind: 'room', direction: -1 })
  expect(key('ArrowLeft', { shiftKey: true })).toBeNull()
  expect(key('ArrowDown', { altKey: false })).toBeNull()
  expect(key('ArrowDown', { ctrlKey: true })).toBeNull()
})

it('moves, resizes and changes the room of the focused card and announces the result', () => {
  const onChange = vi.fn(async () => {})
  render(<Schedule schedule={schedule} onEdit={vi.fn()} onChange={onChange} />)
  const card = screen.getByRole('button', { name: 'Talk 1 bearbeiten' })
  expect(card.getAttribute('aria-keyshortcuts')).toContain('Alt+ArrowDown')
  fireEvent.keyDown(card, { key: 'ArrowDown', altKey: true })
  expect(onChange).toHaveBeenLastCalledWith(1, { room_id: 1, start_time: '10:15', end_time: '11:15' })
  expect(screen.getByText('Talk 1, 10:15–11:15, Saal A')).toBeTruthy()
  fireEvent.keyDown(card, { key: 'ArrowDown', altKey: true, shiftKey: true })
  expect(onChange).toHaveBeenLastCalledWith(1, { end_time: '11:15' })
  fireEvent.keyDown(card, { key: 'ArrowRight', altKey: true })
  expect(onChange).toHaveBeenLastCalledWith(1, { room_id: 2, start_time: '10:00', end_time: '11:00' })
  expect(screen.getByText('Talk 1, 10:00–11:00, Saal B')).toBeTruthy()
  fireEvent.keyDown(card, { key: 'ArrowLeft', altKey: true })
  expect(onChange).toHaveBeenCalledTimes(3)
  expect(screen.getByText('Talk 1: kein weiterer Raum in dieser Richtung')).toBeTruthy()
  fireEvent.keyDown(screen.getByRole('button', { name: 'Talk 2 bearbeiten' }), { key: 'ArrowUp', altKey: true })
  expect(onChange).toHaveBeenCalledTimes(3)
  expect(screen.getByText('Talk 2: Grenze des Tages erreicht')).toBeTruthy()
})

it('ignores shortcuts in read-only plans and moves duties by keyboard', () => {
  const onChange = vi.fn(async () => {})
  const { rerender } = render(<Schedule readOnly schedule={schedule} onEdit={vi.fn()} onChange={onChange} />)
  fireEvent.keyDown(screen.getByRole('button', { name: 'Talk 1 ansehen' }), { key: 'ArrowDown', altKey: true })
  expect(onChange).not.toHaveBeenCalled()
  const onChangeDuty = vi.fn(async () => {})
  rerender(<Schedule schedule={schedule} focus="helpers" currentUserId={3} helperPlan={{ duties: [duty], conflicts: [] }}
    onEdit={vi.fn()} onChange={onChange} onChangeDuty={onChangeDuty} />)
  const card = screen.getByRole('button', { name: /^Einlass, 12:00 bis 13:00, du bist eingeteilt/ })
  expect(card.className).toContain('duty-mine')
  fireEvent.keyDown(card, { key: 'ArrowUp', altKey: true })
  expect(onChangeDuty).toHaveBeenLastCalledWith(duty, { start_time: '11:45', end_time: '12:45' })
  fireEvent.keyDown(card, { key: 'ArrowUp', altKey: true, shiftKey: true })
  expect(onChangeDuty).toHaveBeenLastCalledWith(duty, { end_time: '12:45' })
})
