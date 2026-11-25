import { describe, expect, it } from 'vitest'
import { applyDutyOrder, applyDutyPatch, applySlotPatch } from './optimistic'
import type { DaySchedule, Duty, HelperPlan, Slot } from './types'

function slot(id: number, roomId: number | null, start: string, end: string, scope: 'room' | 'all_rooms' = 'room'): Slot {
  return { id, event_id: 1, day_id: 1, scope, room_id: roomId, topic: `Slot ${id}`, speaker_ids: [], speaker_required: false,
    speakers: [], description: null, start_time: start, end_time: end, is_cancelled: false, change_notice: null }
}

function duty(id: number, values: Partial<Duty> = {}): Duty {
  return { id, event_id: 1, kind: 'general', title: null, user_ids: [], capacity: 1, users: [], day_id: 1, date: '2026-10-01',
    room_id: null, slot_id: null, session_topic: null, start_time: '09:00:00', end_time: '10:00:00', sort_order: 0, status: 'active', ...values }
}

const schedule: DaySchedule = {
  day_id: 1, date: '2026-10-01', start_time: '09:00:00', end_time: '18:00:00',
  rooms: [
    { id: 1, event_id: 1, name: 'A', sort_order: 0, slots: [slot(10, 1, '10:00:00', '11:00:00'), slot(11, 1, '12:00:00', '13:00:00')] },
    { id: 2, event_id: 1, name: 'B', sort_order: 1, slots: [] },
  ],
  shared_slots: [slot(20, null, '13:00:00', '14:00:00', 'all_rooms')],
  collisions: [], speaker_conflicts: [],
}

describe('applySlotPatch', () => {
  it('moves a slot into another room at the new time', () => {
    const next = applySlotPatch(schedule, 10, { room_id: 2, start_time: '10:30', end_time: '11:30' })
    expect(next.rooms[0].slots.map(item => item.id)).toEqual([11])
    expect(next.rooms[1].slots).toMatchObject([{ id: 10, room_id: 2, start_time: '10:30:00', end_time: '11:30:00' }])
  })

  it('resizes a slot in place', () => {
    const next = applySlotPatch(schedule, 11, { end_time: '13:15' })
    expect(next.rooms[0].slots.find(item => item.id === 11)).toMatchObject({ start_time: '12:00:00', end_time: '13:15:00' })
  })

  it('moves a shared session in time without giving it a room', () => {
    const next = applySlotPatch(schedule, 20, { room_id: null, start_time: '15:00', end_time: '16:00' })
    expect(next.shared_slots).toMatchObject([{ id: 20, room_id: null, start_time: '15:00:00' }])
  })

  it('leaves the schedule unchanged for unknown slots or rooms', () => {
    expect(applySlotPatch(schedule, 99, { start_time: '10:00' })).toBe(schedule)
    expect(applySlotPatch(schedule, 10, { room_id: 99 })).toBe(schedule)
  })
})

describe('duty updates', () => {
  const plan: HelperPlan = { duties: [duty(1), duty(2, { sort_order: 1 })], conflicts: [] }

  it('moves a duty into a room column', () => {
    expect(applyDutyPatch(plan, 1, { kind: 'room', room_id: 2, start_time: '11:00', end_time: '12:00' }).duties[0])
      .toMatchObject({ kind: 'room', room_id: 2, start_time: '11:00:00', end_time: '12:00:00' })
  })

  it('reorders duties side by side', () => {
    expect(applyDutyOrder(plan, [2, 1]).duties.map(item => [item.id, item.sort_order])).toEqual([[1, 1], [2, 0]])
  })
})
