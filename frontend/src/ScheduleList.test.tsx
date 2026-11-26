import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import ScheduleList from './ScheduleList'
import type { DaySchedule, Duty, Slot } from './types'

const slot = (id: number, changes: Partial<Slot> = {}): Slot => ({
  id, event_id: 1, day_id: 1, room_id: 1, topic: `Talk ${id}`, speaker_required: true, speaker_ids: [], speakers: [],
  description: null, start_time: '10:00:00', end_time: '11:00:00', is_cancelled: false, change_notice: null, ...changes,
})
const pause = slot(9, { scope: 'all_rooms', room_id: null, topic: 'Pause', start_time: '12:00:00', end_time: '13:00:00' })
const schedule: DaySchedule = {
  day_id: 1, date: '2026-10-01', start_time: '09:00:00', end_time: '18:00:00', collisions: [{ first_slot_id: 1, second_slot_id: 2 }], speaker_conflicts: [],
  shared_slots: [pause],
  rooms: [
    { id: 1, event_id: 1, name: 'Saal A', sort_order: 0, slots: [slot(2, { start_time: '11:00:00', end_time: '12:00:00' }), slot(1, { speakers: [{ id: 4, name: 'Ada' }] })] },
    { id: 2, event_id: 1, name: 'Saal B', sort_order: 1, slots: [slot(3, { room_id: 2 })] },
  ],
}
const duty = (id: number, changes: Partial<Duty> = {}): Duty => ({ id, event_id: 1, kind: 'room', title: `Dienst ${id}`, user_ids: [], users: [],
  capacity: 1, day_id: 1, date: '2026-10-01', room_id: 1, slot_id: null, session_topic: null,
  start_time: '10:00:00', end_time: '11:00:00', sort_order: 0, status: 'active', ...changes })
const props = { schedule, helperPlan: { duties: [duty(1, { user_ids: [5], users: [{ id: 5, name: 'Ben', is_active: true }] }), duty(2, { kind: 'general', room_id: null })], conflicts: [] },
  readOnly: false, currentUserId: 5, onSignup: vi.fn(async () => {}), onEdit: vi.fn(), onEditDuty: vi.fn() }

afterEach(() => { cleanup(); vi.clearAllMocks() })

it('lists the sessions of one room chronologically with shared sessions and switches rooms by tab', () => {
  render(<ScheduleList {...props} focus="program" />)
  const panel = () => screen.getByRole('tabpanel')
  expect(within(panel()).getAllByRole('button').map(button => button.querySelector('strong')?.textContent)).toEqual(['Talk 1', 'Talk 2', 'Pause · Alle Räume'])
  expect(within(panel()).getAllByText('Raumkonflikt')).toHaveLength(2)
  fireEvent.click(within(panel()).getByRole('button', { name: 'Talk 1 bearbeiten' }))
  expect(props.onEdit).toHaveBeenCalledWith(schedule.rooms[0].slots[1])
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Saal A' }), { key: 'ArrowRight' })
  expect(screen.getByRole('tab', { name: 'Saal B' }).getAttribute('aria-selected')).toBe('true')
  expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Saal B' }))
  expect(within(panel()).getByText('Talk 3')).toBeTruthy()
})

it('lists duties per room and general duties in their own tab, marking own duties', () => {
  render(<ScheduleList {...props} focus="helpers" />)
  expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['Allgemein', 'Saal A', 'Saal B'])
  fireEvent.click(screen.getByRole('tab', { name: 'Saal A' }))
  const item = screen.getByRole('button', { name: 'Dienst 1 bearbeiten' }).closest('li')!
  expect(item.className).toContain('duty-mine')
  expect(within(item).getByText('Du')).toBeTruthy()
  fireEvent.click(screen.getByRole('tab', { name: 'Allgemein' }))
  fireEvent.click(screen.getByRole('button', { name: 'Eintragen in Dienst 2' }))
  expect(props.onSignup).toHaveBeenCalledWith(props.helperPlan.duties[1], false)
})
