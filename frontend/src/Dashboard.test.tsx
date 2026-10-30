import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import Dashboard from './Dashboard'
import type { DaySchedule, Duty, HelperPlan, Slot, UnplannedSession } from './types'

const days = [1, 2].map(id => ({ id, event_id: 1, date: `2026-10-0${id}`, start_time: '09:00:00', end_time: '18:00:00' }))
const rooms = [{ id: 1, event_id: 1, name: 'Saal', sort_order: 0 }]
const slot = (id: number, changes: Partial<Slot> = {}): Slot => ({
  id, event_id: 1, day_id: 1, room_id: 1, topic: `Session ${id}`, start_time: '10:00:00', end_time: '11:00:00',
  speaker_ids: [], speaker_required: true, speakers: [], description: null, is_cancelled: false, change_notice: null, ...changes,
})
const shared = slot(5, { scope: 'all_rooms', room_id: null, speaker_required: false, topic: 'Pause' })
const schedules: DaySchedule[] = days.map(day => ({
  day_id: day.id, date: day.date, start_time: day.start_time, end_time: day.end_time,
  rooms: [{ ...rooms[0], slots: day.id === 1 ? [slot(1), slot(2, { speaker_ids: [9], speakers: [{ id: 9, name: 'Ada' }] }), slot(3, { is_cancelled: true }), shared] : [slot(4, { day_id: 2 })] }],
  shared_slots: day.id === 1 ? [shared] : [],
  collisions: day.id === 1 ? [{ first_slot_id: 1, second_slot_id: 2 }] : [], speaker_conflicts: [],
}))
const backlog: UnplannedSession[] = [slot(6), slot(7, { speaker_required: false })].map(item => ({
  ...item, day_id: null, room_id: null, start_time: null, end_time: null,
}))
const duty = (id: number, changes: Partial<Duty> = {}): Duty => ({
  id, event_id: 1, kind: 'general', title: `Dienst ${id}`, user_ids: [], users: [], capacity: 2,
  day_id: 1, date: days[0].date, room_id: null, slot_id: null, session_topic: null,
  start_time: '10:00:00', end_time: '11:00:00', sort_order: 0, status: 'active', ...changes,
})
const helperPlan: HelperPlan = { duties: [
  duty(1), duty(2, { user_ids: [8], users: [{ id: 8, name: 'Bo', is_active: false }] }),
  duty(3, { user_ids: [8, 9] }), duty(4, { status: 'cancelled' }), duty(5, { status: 'unplanned', day_id: null }),
  duty(6, { day_id: 2, date: days[1].date, capacity: 1 }),
], conflicts: [] }
const props = { days, rooms, speakerCount: 3, schedules, helperPlan, unplanned: backlog, dayId: null,
  onDayChange: vi.fn(), loading: false, error: '', onRefresh: vi.fn(), onOpenSlot: vi.fn(), onOpenDuty: vi.fn() }

afterEach(() => { cleanup(); vi.clearAllMocks() })

function metric(label: string) {
  const terms = screen.getByRole('region', { name: 'Veranstaltungsdashboard' }).querySelectorAll('dt')
  return Array.from(terms).find(item => item.textContent === label)?.nextElementSibling?.textContent
}

it('counts partially staffed duties, required speakers, shared sessions and cancellations once', () => {
  render(<Dashboard {...props} />)
  expect(metric('Geplante aktive Sessions')).toBe('4')
  expect(metric('Ungeplante Sessions')).toBe('2')
  expect(metric('Absagen')).toBe('1')
  expect(metric('Offene Helferplätze')).toBe('4')
  expect(metric('Redner fehlen')).toBe('3')
  expect(metric('Konflikte')).toBe('1')
  const open = within(screen.getByRole('region', { name: 'Offene Helferplätze' }))
  expect(open.getAllByRole('button')).toHaveLength(3)
  expect(open.getByText('1/2 belegt · 1 Platz fehlt')).toBeTruthy()
  expect(open.queryByText('Dienst 3')).toBeNull()
  const missing = within(screen.getByRole('region', { name: 'Redner fehlen' }))
  expect(missing.queryByText('Pause')).toBeNull()
  expect(missing.queryByText('Session 3')).toBeNull()
  fireEvent.click(missing.getByRole('button', { name: 'Session 6 ungeplant bearbeiten' }))
  expect(props.onOpenSlot).toHaveBeenCalledWith(null, 6)
  fireEvent.click(open.getByRole('button', { name: /Dienst 1 am/ }))
  expect(props.onOpenDuty).toHaveBeenCalledWith(1, 1)
})

it('filters by day, excludes the backlog, and keeps event metadata global', () => {
  render(<Dashboard {...props} dayId={2} />)
  expect(metric('Geplante aktive Sessions')).toBe('1')
  expect(metric('Ungeplante Sessions')).toBe('0')
  expect(metric('Absagen')).toBe('0')
  expect(metric('Offene Helferplätze')).toBe('1')
  expect(metric('Redner fehlen')).toBe('1')
  expect(metric('Konflikte')).toBe('0')
  expect(screen.getByText('Veranstaltung gesamt: 2 Tage · 1 Raum · 3 Rednerprofile')).toBeTruthy()
  expect(screen.getByText('Keine Konflikte in diesem Veranstaltungstag.')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Alle Tage' }))
  expect(props.onDayChange).toHaveBeenCalledWith(null)
  fireEvent.change(screen.getByLabelText('Zeitraum'), { target: { value: '1' } })
  expect(props.onDayChange).toHaveBeenCalledWith(1)
})

it('does not show partial or false zero counts while loading or after failures', () => {
  const { rerender } = render(<Dashboard {...props} schedules={null} loading />)
  expect(screen.getByRole('status').textContent).toBe('Lade Dashboard …')
  expect(screen.queryByText('Keine Dienste mit offenen Helferplätzen.')).toBeNull()
  expect(screen.queryByRole('definition')).toBeNull()
  rerender(<Dashboard {...props} schedules={null} error="Tag fehlt" />)
  expect(screen.getByRole('alert').textContent).toContain('Tag fehlt')
  expect(screen.queryByRole('definition')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }))
  expect(props.onRefresh).toHaveBeenCalledOnce()
})

it('shows valid empty states even when an event has no days or rooms', () => {
  render(<Dashboard {...props} days={[]} rooms={[]} schedules={[]} unplanned={[]} helperPlan={{ duties: [], conflicts: [] }} />)
  expect(metric('Geplante aktive Sessions')).toBe('0')
  expect(screen.getByText('Keine Sessions mit fehlenden Rednern.')).toBeTruthy()
  expect(screen.getByText('Keine Dienste mit offenen Helferplätzen.')).toBeTruthy()
})
