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

const ada = { id: 1, is_active: true, email: 'person@example.invalid', name: 'Ada' }
const ben = { id: 2, is_active: true, email: 'person@example.invalid', name: 'Ben' }
const base: Duty = {
  id: 1, event_id: 1, kind: 'general', title: 'Aufbau', capacity: 1, user_ids: [], users: [],
  day_id: 1, date: '2026-10-01', room_id: null, slot_id: null, session_topic: null,
  start_time: '09:00:00', end_time: '12:00:00', sort_order: 1, status: 'active',
}

afterEach(cleanup)

it.each(['program', 'helpers'] as const)('shows duty columns, open duties, lanes and conflicts in %s view', focus => {
  const roomDuty: Duty = { ...base, id: 2, kind: 'room', title: 'Einlass', room_id: 1,
    start_time: '10:00:00', end_time: '11:00:00', user_ids: [1, 2], users: [ada, ben] }
  const other: Duty = { ...roomDuty, id: 3, title: 'Technik', user_ids: [1], users: [ada],
    start_time: '10:30:00', end_time: '11:30:00' }
  const plan: HelperPlan = {
    duties: [base, roomDuty, other],
    conflicts: [{ first_duty_id: 2, second_duty_id: 3, user_ids: [1] }],
  }
  const onEditDuty = vi.fn()
  const { container } = render(<Schedule schedule={schedule} helperPlan={plan} focus={focus} onEdit={() => {}} onEditDuty={onEditDuty} onChange={async () => {}} />)
  expect(container.querySelectorAll('[data-room-column]')).toHaveLength(2)
  expect(container.querySelectorAll('.duty-column')).toHaveLength(3)
  expect(screen.getAllByText('Helferdienste')).toHaveLength(2)
  expect(container.querySelector('[data-duty-id="1"]')?.textContent).toContain('Offen')
  expect(container.querySelector('[data-duty-id="2"]')?.textContent).toContain('Ada, Ben')
  expect((container.querySelector('[data-duty-id="3"]') as HTMLElement).style.left).toBe('50%')
  expect(container.querySelectorAll('.duty-card.duty-conflict')).toHaveLength(0)
  expect(container.querySelectorAll('.helper-conflict-name')).toHaveLength(2)
  expect(container.querySelector('[data-duty-id="2"] .helper-conflict-name')?.textContent).toBe('Ada')
  expect(container.querySelector('[data-duty-id="2"]')?.getAttribute('aria-label')).toContain('Helferkonflikt: Ada')
  expect(container.querySelector('[data-duty-id="2"] .duty-grip small')?.textContent).toBe('Ada, Ben')
  expect(screen.getByRole('region', { name: 'Helferkonflikte' }).textContent).toContain('Ada: Einlass und Technik')
  fireEvent.click(container.querySelector('[data-duty-id="2"]')!)
  expect(onEditDuty).toHaveBeenCalledWith(roomDuty)
})

it('marks Helfer 2 and Helfer 4 separately when a general duty overlaps room duties', () => {
  const helper2 = { id: 2, is_active: true, email: 'person@example.invalid', name: 'Helfer 2' }
  const helper4 = { id: 4, is_active: true, email: 'person@example.invalid', name: 'Helfer 4' }
  const helper5 = { id: 5, is_active: true, email: 'person@example.invalid', name: 'Helfer 5' }
  const general: Duty = { ...base, title: 'Getränke', start_time: '15:00:00', end_time: '17:00:00',
    user_ids: [2, 4, 5], users: [helper2, helper4, helper5] }
  const room1: Duty = { ...base, id: 2, kind: 'room', title: 'Caller-Betreuung', room_id: 1,
    start_time: '16:00:00', end_time: '17:00:00', user_ids: [2], users: [helper2] }
  const room2: Duty = { ...room1, id: 3, room_id: 2, user_ids: [4], users: [helper4] }
  const plan: HelperPlan = { duties: [general, room1, room2], conflicts: [
    { first_duty_id: 1, second_duty_id: 2, user_ids: [2] },
    { first_duty_id: 1, second_duty_id: 3, user_ids: [4] },
  ] }

  const { container } = render(<Schedule schedule={schedule} helperPlan={plan} focus="helpers" onEdit={() => {}} onChange={async () => {}} />)
  expect([...container.querySelectorAll('[data-duty-id="1"] .helper-conflict-name')].map(element => element.textContent)).toEqual(['Helfer 2', 'Helfer 4'])
  expect(container.querySelector('[data-duty-id="2"] .helper-conflict-name')?.textContent).toBe('Helfer 2')
  expect(container.querySelector('[data-duty-id="3"] .helper-conflict-name')?.textContent).toBe('Helfer 4')
  expect(container.querySelector('[data-duty-id="1"] .duty-grip small')?.textContent).toBe('Helfer 2, Helfer 4, Helfer 5')
  expect(container.querySelectorAll('.duty-card.duty-conflict')).toHaveLength(0)
  const warnings = screen.getByRole('region', { name: 'Helferkonflikte' }).querySelectorAll('li')
  expect([...warnings].map(warning => warning.textContent)).toEqual([
    'Helfer 2: Getränke und Caller-Betreuung',
    'Helfer 4: Getränke und Caller-Betreuung',
  ])
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

it.each(['program', 'helpers'] as const)('reorders parallel duties in %s without changing their times', focus => {
  const drinks: Duty = { ...base, title: 'Getränke', start_time: '15:00:00', end_time: '17:00:00' }
  const parking: Duty = { ...drinks, id: 2, title: 'Parkeinweisung', sort_order: 2 }
  const registration: Duty = { ...drinks, id: 3, title: 'Registration', sort_order: 3 }
  const onChangeDuty = vi.fn(async () => {})
  const onReorderDuties = vi.fn(async () => {})
  const original = Element.prototype.getBoundingClientRect
  Element.prototype.getBoundingClientRect = function () {
    const column = (this as HTMLElement).dataset.dutyColumn
    return { left: column === 'general' ? 0 : 700, right: column === 'general' ? 600 : 1300,
      width: 600 } as DOMRect
  }
  try {
    const { container } = render(<Schedule schedule={schedule} helperPlan={{ duties: [drinks, parking, registration], conflicts: [] }}
      focus={focus} onEdit={() => {}} onChange={async () => {}} onChangeDuty={onChangeDuty} onReorderDuties={onReorderDuties} />)
    fireEvent.pointerDown(container.querySelector('[data-duty-id="1"] .duty-grip')!, { button: 0, clientX: 50, clientY: 100 })
    fireEvent.pointerMove(window, { clientX: 550, clientY: 104 })
    expect((container.querySelector('[data-duty-id="1"].ghost') as HTMLElement).style.left).toBe('66.66666666666667%')
    expect((container.querySelector('[data-duty-id="2"]') as HTMLElement).style.left).toBe('0%')
    expect((container.querySelector('[data-duty-id="3"]') as HTMLElement).style.left).toBe('33.333333333333336%')
    fireEvent.pointerUp(window)
    expect(onReorderDuties).toHaveBeenCalledWith(1, null, [2, 3, 1])
    expect(onChangeDuty).not.toHaveBeenCalled()

    fireEvent.pointerDown(container.querySelector('[data-duty-id="1"] .duty-grip')!, { button: 0, clientX: 50, clientY: 100 })
    fireEvent.pointerMove(window, { clientX: 50, clientY: 124 })
    fireEvent.pointerUp(window)
    expect(onChangeDuty).toHaveBeenCalledWith(drinks, { start_time: '15:15', end_time: '17:15' })
    expect(onReorderDuties).toHaveBeenCalledTimes(1)
  } finally { Element.prototype.getBoundingClientRect = original }
})
