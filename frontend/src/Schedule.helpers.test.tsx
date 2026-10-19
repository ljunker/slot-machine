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

it.each(['program', 'helpers'] as const)('shows duty columns, open duties, lanes and conflicts in %s view', focus => {
  const roomDuty: Duty = { ...base, id: 2, kind: 'room', title: 'Einlass', room_id: 1,
    start_time: '10:00:00', end_time: '11:00:00', helper_ids: [1, 2], helpers: [ada, ben] }
  const other: Duty = { ...roomDuty, id: 3, title: 'Technik', helper_ids: [1], helpers: [ada],
    start_time: '10:30:00', end_time: '11:30:00' }
  const plan: HelperPlan = {
    duties: [base, roomDuty, other],
    conflicts: [{ first_duty_id: 2, second_duty_id: 3, helper_ids: [1] }],
  }
  const onEditDuty = vi.fn()
  const { container } = render(<Schedule schedule={schedule} helperPlan={plan} focus={focus} onEdit={() => {}} onEditDuty={onEditDuty} onChange={async () => {}} />)
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

it('expands helper columns for parallel duties and keeps inactive duties off the timeline', () => {
  const first: Duty = { ...base, id: 2, kind: 'room', room_id: 1, title: 'Einlass',
    start_time: '10:00:00', end_time: '11:00:00' }
  const second: Duty = { ...first, id: 3, title: 'Technik' }
  const third: Duty = { ...first, id: 4, title: 'Info' }
  const cancelled: Duty = { ...first, id: 5, title: 'Abgesagt', status: 'cancelled' }
  const otherDay: Duty = { ...first, id: 6, title: 'Morgen', day_id: 2 }
  const plan: HelperPlan = { duties: [base, first, second, third, cancelled, otherDay], conflicts: [] }
  const { container } = render(<Schedule schedule={schedule} helperPlan={plan} focus="helpers" onEdit={() => {}} onChange={async () => {}} />)
  const grid = container.querySelector('.schedule-grid') as HTMLElement
  expect(grid.style.gridTemplateColumns).toBe('72px 320px 660px 180px 320px 180px')
  expect(container.querySelectorAll('.duty-card')).toHaveLength(4)
  expect((container.querySelector('[data-duty-id="2"]') as HTMLElement).style.width).toBe('33.333333333333336%')
  expect((container.querySelector('[data-duty-id="4"]') as HTMLElement).style.left).toBe('66.66666666666667%')
  expect(container.querySelector('[data-duty-id="5"]')).toBeNull()
  expect(container.querySelector('[data-duty-id="6"]')).toBeNull()
  expect(screen.getByLabelText('Helferplan')).toBeTruthy()
  expect(container.querySelector('[data-duty-id="1"]')?.textContent).toContain('Offen')
})

it('shows the empty general duty column without rooms', () => {
  const { container } = render(<Schedule schedule={{ ...schedule, rooms: [] }} focus="helpers" onEdit={() => {}} onChange={async () => {}} />)
  expect((container.querySelector('.schedule-grid') as HTMLElement).style.gridTemplateColumns).toBe('72px 320px')
  expect(screen.getByText('Keine Dienste')).toBeTruthy()
})

it('moves duties between general and room columns and resizes them', () => {
  const roomDuty: Duty = { ...base, id: 2, kind: 'room', room_id: 1, title: 'Einlass',
    start_time: '10:00:00', end_time: '11:00:00' }
  const onChangeDuty = vi.fn(async () => {})
  const original = Element.prototype.getBoundingClientRect
  Element.prototype.getBoundingClientRect = function () {
    const column = (this as HTMLElement).dataset.dutyColumn
    return { left: column === 'general' ? 0 : column === '1' ? 300 : 600,
      right: column === 'general' ? 299 : column === '1' ? 599 : 900 } as DOMRect
  }
  try {
    const { container } = render(<Schedule schedule={schedule} helperPlan={{ duties: [base, roomDuty], conflicts: [] }} focus="helpers"
      onEdit={() => {}} onChange={async () => {}} onChangeDuty={onChangeDuty} />)
    fireEvent.pointerDown(container.querySelector('[data-duty-id="1"] .duty-grip')!, { button: 0, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(window, { clientX: 350, clientY: 124 })
    fireEvent.pointerUp(window)
    expect(onChangeDuty).toHaveBeenCalledWith(base, { kind: 'room', room_id: 1, start_time: '09:15', end_time: '12:15' })

    fireEvent.pointerDown(container.querySelector('[data-duty-id="2"] .duty-grip')!, { button: 0, clientX: 350, clientY: 100 })
    fireEvent.pointerMove(window, { clientX: 650, clientY: 148 })
    fireEvent.pointerUp(window)
    expect(onChangeDuty).toHaveBeenCalledWith(roomDuty, { room_id: 2, start_time: '10:30', end_time: '11:30' })

    fireEvent.pointerDown(container.querySelector('[data-duty-id="2"] .duty-resize')!, { button: 0, clientX: 350, clientY: 100 })
    fireEvent.pointerMove(window, { clientX: 350, clientY: 124 })
    fireEvent.pointerUp(window)
    expect(onChangeDuty).toHaveBeenCalledWith(roomDuty, { end_time: '11:15' })
  } finally { Element.prototype.getBoundingClientRect = original }
})

it('keeps session duties in rooms and passes their changes to the linked session', () => {
  const sessionDuty: Duty = { ...base, id: 3, kind: 'session', room_id: 1, slot_id: 9, title: 'Betreuung',
    start_time: '10:00:00', end_time: '11:00:00' }
  const onChangeDuty = vi.fn(async () => {})
  const original = Element.prototype.getBoundingClientRect
  Element.prototype.getBoundingClientRect = function () {
    const column = (this as HTMLElement).dataset.dutyColumn
    return { left: column === 'general' ? 0 : column === '1' ? 300 : 600,
      right: column === 'general' ? 299 : column === '1' ? 599 : 900 } as DOMRect
  }
  try {
    const { container } = render(<Schedule schedule={schedule} helperPlan={{ duties: [sessionDuty], conflicts: [] }} focus="helpers"
      onEdit={() => {}} onChange={async () => {}} onChangeDuty={onChangeDuty} />)
    fireEvent.pointerDown(container.querySelector('[data-duty-id="3"] .duty-grip')!, { button: 0, clientX: 350, clientY: 100 })
    fireEvent.pointerMove(window, { clientX: 100, clientY: 124 })
    fireEvent.pointerUp(window)
    expect(onChangeDuty).not.toHaveBeenCalled()

    fireEvent.pointerDown(container.querySelector('[data-duty-id="3"] .duty-grip')!, { button: 0, clientX: 350, clientY: 100 })
    fireEvent.pointerMove(window, { clientX: 650, clientY: 124 })
    fireEvent.pointerUp(window)
    expect(onChangeDuty).toHaveBeenCalledWith(sessionDuty, { room_id: 2, start_time: '10:15', end_time: '11:15' })

    fireEvent.pointerDown(container.querySelector('[data-duty-id="3"] .duty-resize')!, { button: 0, clientX: 350, clientY: 100 })
    fireEvent.pointerMove(window, { clientX: 350, clientY: 76 })
    fireEvent.pointerUp(window)
    expect(onChangeDuty).toHaveBeenCalledWith(sessionDuty, { end_time: '10:45' })
  } finally { Element.prototype.getBoundingClientRect = original }
})
