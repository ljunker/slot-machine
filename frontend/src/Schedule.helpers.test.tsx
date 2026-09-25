import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import Schedule from './Schedule'
import type { DaySchedule, Duty, HelperPlan } from './types'

const schedule: DaySchedule = {
  day_id: 1, date: '2026-10-01', start_time: '09:00:00', end_time: '18:00:00',
  collisions: [], speaker_conflicts: [],
  rooms: [
    { id: 1, event_id: 1, name: 'Saal A', sort_order: 0, slots: [] },
    { id: 2, event_id: 1, name: 'Saal B', sort_order: 1, slots: [] },
  ],
}

const ada = { id: 1, event_id: 1, name: 'Ada' }
const ben = { id: 2, event_id: 1, name: 'Ben' }
const base: Duty = {
  id: 1, event_id: 1, kind: 'general', title: 'Aufbau', helper_ids: [], helpers: [],
  day_id: 1, date: '2026-10-01', room_id: null, slot_id: null, session_topic: null,
  start_time: '09:00:00', end_time: '12:00:00', status: 'active',
}

afterEach(cleanup)

it('shows a duty column beside each room, open duties, lanes and conflicts', () => {
  const roomDuty: Duty = { ...base, id: 2, kind: 'room', title: 'Einlass', room_id: 1,
    start_time: '10:00:00', end_time: '11:00:00', helper_ids: [1, 2], helpers: [ada, ben] }
  const other: Duty = { ...roomDuty, id: 3, title: 'Technik', helper_ids: [1], helpers: [ada],
    start_time: '10:30:00', end_time: '11:30:00' }
  const plan: HelperPlan = {
    duties: [base, roomDuty, other],
    conflicts: [{ first_duty_id: 2, second_duty_id: 3, helper_ids: [1] }],
  }
  const onEditDuty = vi.fn()
  const { container } = render(<Schedule schedule={schedule} helperPlan={plan} onEdit={() => {}} onEditDuty={onEditDuty} onChange={async () => {}} />)
  expect(container.querySelectorAll('[data-room-column]')).toHaveLength(2)
  expect(container.querySelectorAll('.duty-column')).toHaveLength(3)
  expect(screen.getAllByText('Helferdienste')).toHaveLength(2)
  expect(container.querySelector('[data-duty-id="1"]')?.textContent).toContain('Offen')
  expect(container.querySelector('[data-duty-id="2"]')?.textContent).toContain('Ada, Ben')
  expect((container.querySelector('[data-duty-id="3"]') as HTMLElement).style.left).toBe('50%')
  expect(container.querySelectorAll('.duty-card.duty-conflict')).toHaveLength(2)
  expect(screen.getByRole('region', { name: 'Helferkonflikte' }).textContent).toContain('Ada: Einlass und Technik')
  fireEvent.click(container.querySelector('[data-duty-id="2"]')!)
  expect(onEditDuty).toHaveBeenCalledWith(roomDuty)
})
