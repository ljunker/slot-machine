import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import ConflictOverview, { collectConflicts } from './ConflictOverview'
import type { DaySchedule, Duty, HelperPlan, Slot } from './types'

const slot = (id: number, dayId: number, roomId: number, topic: string, start: string, end: string): Slot => ({
  id, event_id: 1, day_id: dayId, room_id: roomId, topic, start_time: start, end_time: end,
  speaker_ids: [8], speakers: [{ id: 8, name: 'Ada' }], description: null,
  is_cancelled: false, change_notice: null,
})

const first = slot(1, 11, 2, 'Erster', '10:00:00', '11:00:00')
const second = slot(2, 11, 2, 'Zweiter', '10:30:00', '11:30:00')
const third = slot(3, 12, 2, 'Dritter', '09:00:00', '10:00:00')
const fourth = slot(4, 12, 3, 'Vierter', '09:30:00', '10:30:00')
const schedules: DaySchedule[] = [
  { day_id: 11, date: '2099-06-01', start_time: '09:00:00', end_time: '18:00:00',
    rooms: [{ id: 2, event_id: 1, name: 'Saal A', sort_order: 0, slots: [first, second] }],
    collisions: [{ first_slot_id: 1, second_slot_id: 2 }], speaker_conflicts: [] },
  { day_id: 12, date: '2099-06-02', start_time: '09:00:00', end_time: '18:00:00',
    rooms: [
      { id: 2, event_id: 1, name: 'Saal A', sort_order: 0, slots: [third] },
      { id: 3, event_id: 1, name: 'Saal B', sort_order: 1, slots: [fourth] },
    ], collisions: [], speaker_conflicts: [{ first_slot_id: 3, second_slot_id: 4, speaker_ids: [8] }] },
]
const duty = (id: number, title: string): Duty => ({
  id, event_id: 1, kind: 'room', title, helper_ids: [9], helpers: [{ id: 9, event_id: 1, name: 'Ben' }],
  day_id: 12, date: '2099-06-02', room_id: 2, slot_id: null, session_topic: null,
  start_time: '11:00:00', end_time: '12:00:00', sort_order: id, status: 'active',
})
const helperPlan: HelperPlan = {
  duties: [duty(21, 'Aufbau'), duty(22, 'Einlass')],
  conflicts: [{ first_duty_id: 21, second_duty_id: 22, helper_ids: [9] }],
}

afterEach(cleanup)

it('sorts all conflict types across days and opens the selected entry', () => {
  const entries = collectConflicts([...schedules].reverse(), helperPlan)
  expect(entries.map(entry => entry.kind)).toEqual(['room', 'speaker', 'helper'])
  const onOpenSlot = vi.fn()
  const onOpenDuty = vi.fn()
  render(<ConflictOverview schedules={schedules} helperPlan={helperPlan} onOpenSlot={onOpenSlot} onOpenDuty={onOpenDuty} />)
  expect(screen.getByText('3 Konflikte in dieser Veranstaltung')).toBeTruthy()
  expect(screen.getByText('Betroffen: Ada')).toBeTruthy()
  expect(screen.getByText('Helferkonflikt: Ben')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Vierter am 2099-06-02 bearbeiten' }))
  fireEvent.click(screen.getByRole('button', { name: 'Einlass am 2099-06-02 bearbeiten' }))
  expect(onOpenSlot).toHaveBeenCalledWith(12, 4)
  expect(onOpenDuty).toHaveBeenCalledWith(12, 22)
})

it('lists one conflict per helper with time and both duties', () => {
  const helper2 = { id: 2, event_id: 1, name: 'Helfer 2' }
  const helper4 = { id: 4, event_id: 1, name: 'Helfer 4' }
  const general: Duty = { ...duty(31, 'Getränke'), kind: 'general', room_id: null,
    start_time: '15:00:00', end_time: '17:00:00', helper_ids: [2, 4], helpers: [helper2, helper4] }
  const room1: Duty = { ...duty(32, 'Caller-Betreuung'), start_time: '16:00:00', end_time: '17:00:00',
    helper_ids: [2], helpers: [helper2] }
  const room2: Duty = { ...room1, id: 33, room_id: 3, helper_ids: [4], helpers: [helper4] }
  const plan: HelperPlan = { duties: [general, room1, room2], conflicts: [
    { first_duty_id: 31, second_duty_id: 32, helper_ids: [2] },
    { first_duty_id: 31, second_duty_id: 33, helper_ids: [4] },
  ] }

  const { container } = render(<ConflictOverview schedules={[{ ...schedules[1], speaker_conflicts: [] }]} helperPlan={plan} onOpenSlot={() => {}} onOpenDuty={() => {}} />)
  expect(screen.getByText('2 Konflikte in dieser Veranstaltung')).toBeTruthy()
  const entries = [...container.querySelectorAll('.conflict-item')]
  expect(entries.map(entry => entry.querySelector('strong')?.textContent)).toEqual(['Helferkonflikt: Helfer 2', 'Helferkonflikt: Helfer 4'])
  for (const entry of entries) {
    expect(entry.textContent).toContain('16:00–17:00')
    expect(entry.textContent).toContain('Getränke')
    expect(entry.textContent).toContain('Caller-Betreuung')
  }
})

it('splits a shared duty pair into one entry per helper', () => {
  const helpers = [{ id: 2, event_id: 1, name: 'Helfer 2' }, { id: 4, event_id: 1, name: 'Helfer 4' }]
  const first: Duty = { ...duty(41, 'Getränke'), kind: 'general', room_id: null, helper_ids: [2, 4], helpers }
  const second: Duty = { ...duty(42, 'Einlass'), helper_ids: [2, 4], helpers }
  const plan: HelperPlan = { duties: [first, second], conflicts: [{ first_duty_id: 41, second_duty_id: 42, helper_ids: [2, 4] }] }
  const entries = collectConflicts([{ ...schedules[1], speaker_conflicts: [] }], plan)
  expect(entries.map(entry => entry.people)).toEqual([['Helfer 2'], ['Helfer 4']])
})

it('ignores cancelled or inactive pairs and shows empty state', () => {
  const cancelled = [{ ...schedules[0], rooms: [{ ...schedules[0].rooms[0], slots: [first, { ...second, is_cancelled: true }] }] }]
  const inactivePlan: HelperPlan = { ...helperPlan, duties: [{ ...helperPlan.duties[0], status: 'cancelled' }, helperPlan.duties[1]] }
  expect(collectConflicts(cancelled, inactivePlan)).toEqual([])
  render(<ConflictOverview schedules={cancelled} helperPlan={inactivePlan} onOpenSlot={() => {}} onOpenDuty={() => {}} />)
  expect(screen.getByText('Keine Konflikte in dieser Veranstaltung.')).toBeTruthy()
})
