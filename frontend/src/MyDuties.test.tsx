import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import MyDuties from './MyDuties'
import type { Duty } from './types'

const duty = (id: number, changes: Partial<Duty> = {}): Duty => ({
  id, event_id: 1, kind: 'general', title: `Dienst ${id}`, user_ids: [], users: [], capacity: 2,
  day_id: 1, date: '2026-10-01', room_id: null, slot_id: null, session_topic: null,
  start_time: '10:00:00', end_time: '11:00:00', sort_order: 0, status: 'active', ...changes,
})
const ada = { id: 9, name: 'Ada', is_active: true }
const ben = { id: 8, name: 'Ben', is_active: true }
const rooms = [{ id: 5, event_id: 1, name: 'Saal', sort_order: 0 }]
const duties = [
  duty(1, { date: '2026-10-02', day_id: 2, user_ids: [9], users: [ada] }),
  duty(2, { kind: 'room', room_id: 5, title: 'Einlass', start_time: '09:00:00', user_ids: [9, 8], users: [ada, ben] }),
  duty(3, { title: 'Kasse', user_ids: [8], users: [ben] }),
  duty(4, { title: 'Voll', capacity: 1, user_ids: [8], users: [ben] }),
  duty(5, { title: 'Abgesagt', status: 'cancelled', start_time: null, end_time: null }),
]
const props = { eventId: 1, rooms, currentUserId: 9, onSignup: vi.fn(async () => {}), onOpenDuty: vi.fn(),
  helperPlan: { duties, conflicts: [{ first_duty_id: 2, second_duty_id: 9, user_ids: [9] }] } }

afterEach(() => { cleanup(); vi.clearAllMocks() })

it('lists own duties chronologically with co-helpers and the open duties below', () => {
  render(<MyDuties {...props} />)
  const own = screen.getByRole('region', { name: /Wo bin ich eingeteilt/ })
  const titles = within(own).getAllByRole('button', { name: /Details$/ }).map(button => button.querySelector('strong')?.textContent)
  expect(titles).toEqual(['Einlass', 'Dienst 1'])
  expect(within(own).getByText('Mit Ben')).toBeTruthy()
  expect(within(own).getByText(/Bisher allein eingeteilt · 1 Platz frei/)).toBeTruthy()
  expect(within(own).getByText('Überschneidet sich mit einem anderen Dienst')).toBeTruthy()
  expect(within(own).getByRole('link', { name: 'In den Kalender' }).getAttribute('href')).toBe('/api/events/1/my-duties.ics')
  const open = screen.getByRole('region', { name: /Wo werden noch Leute gebraucht/ })
  expect(within(open).getAllByRole('listitem')).toHaveLength(1)
  fireEvent.click(within(open).getByRole('button', { name: 'Eintragen in Kasse' }))
  expect(props.onSignup).toHaveBeenCalledWith(duties[2], false)
  fireEvent.click(within(own).getByRole('button', { name: /^Einlass,/ }))
  expect(props.onOpenDuty).toHaveBeenCalledWith(duties[1])
})

it('explains the empty state and hides the calendar without own duties', () => {
  render(<MyDuties {...props} currentUserId={1} helperPlan={{ duties: [], conflicts: [] }} />)
  expect(screen.getByText(/noch für keinen Dienst eingetragen/)).toBeTruthy()
  expect(screen.getByText('Alle Dienste sind besetzt.')).toBeTruthy()
  expect(screen.queryByRole('link', { name: 'In den Kalender' })).toBeNull()
})
