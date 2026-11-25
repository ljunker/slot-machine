import type { DaySchedule, Duty, HelperPlan, Slot } from './types'

export type SlotPositionPatch = { room_id?: number | null; start_time?: string; end_time?: string }
export type DutyPositionPatch = { kind?: Duty['kind']; room_id?: number | null; start_time?: string; end_time?: string }

/** Server times carry seconds ("10:00:00"); drag patches do not ("10:00"). */
function serverTime(value: string): string {
  return value.length === 5 ? `${value}:00` : value
}

function positioned<T extends { start_time: string | null; end_time: string | null; room_id: number | null }>(item: T, patch: SlotPositionPatch): T {
  return {
    ...item,
    ...(patch.room_id !== undefined ? { room_id: patch.room_id } : {}),
    ...(patch.start_time !== undefined ? { start_time: serverTime(patch.start_time) } : {}),
    ...(patch.end_time !== undefined ? { end_time: serverTime(patch.end_time) } : {}),
  }
}

/** Shows a moved or resized slot at its target position before the server confirms it. */
export function applySlotPatch(schedule: DaySchedule, slotId: number, patch: SlotPositionPatch): DaySchedule {
  const shared = schedule.shared_slots ?? []
  const sharedSlot = shared.find(slot => slot.id === slotId)
  if (sharedSlot) {
    const moved = positioned(sharedSlot, { start_time: patch.start_time, end_time: patch.end_time })
    return { ...schedule, shared_slots: shared.map(slot => slot.id === slotId ? moved : slot) }
  }
  const source = schedule.rooms.find(room => room.slots.some(slot => slot.id === slotId))
  if (!source) return schedule
  const moved: Slot = positioned(source.slots.find(slot => slot.id === slotId)!, patch)
  const targetRoomId = moved.room_id
  if (!schedule.rooms.some(room => room.id === targetRoomId)) return schedule
  return {
    ...schedule,
    rooms: schedule.rooms.map(room => {
      const slots = room.slots.filter(slot => slot.id !== slotId)
      return room.id === targetRoomId ? { ...room, slots: [...slots, moved] } : room.id === source.id ? { ...room, slots } : room
    }),
  }
}

/** Shows a moved or resized duty at its target position before the server confirms it. */
export function applyDutyPatch(plan: HelperPlan, dutyId: number, patch: DutyPositionPatch): HelperPlan {
  return {
    ...plan,
    duties: plan.duties.map(duty => duty.id === dutyId
      ? { ...positioned(duty, patch), ...(patch.kind !== undefined ? { kind: patch.kind } : {}) }
      : duty),
  }
}

/** Applies a new side-by-side order to the given duties. */
export function applyDutyOrder(plan: HelperPlan, dutyIds: number[]): HelperPlan {
  return {
    ...plan,
    duties: plan.duties.map(duty => dutyIds.includes(duty.id) ? { ...duty, sort_order: dutyIds.indexOf(duty.id) } : duty),
  }
}
