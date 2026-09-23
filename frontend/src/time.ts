import type { Slot } from './types'

export const PX_PER_MINUTE = 1.6
export const SNAP_MINUTES = 15

export function toMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number)
  return hours * 60 + minutes
}

export function toTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

export function snappedDelta(pixels: number): number {
  return Math.round(pixels / (SNAP_MINUTES * PX_PER_MINUTE)) * SNAP_MINUTES
}

export function movePatch(slot: Slot, delta: number, roomId: number, dayStart: number, dayEnd: number) {
  const duration = toMinutes(slot.end_time) - toMinutes(slot.start_time)
  const start = Math.max(dayStart, Math.min(dayEnd - duration, toMinutes(slot.start_time) + delta))
  return { room_id: roomId, start_time: toTime(start), end_time: toTime(start + duration) }
}

export function resizePatch(slot: Slot, delta: number, dayEnd: number) {
  const minimum = Math.min(SNAP_MINUTES, toMinutes(slot.end_time) - toMinutes(slot.start_time))
  const end = Math.max(toMinutes(slot.start_time) + minimum, Math.min(dayEnd, toMinutes(slot.end_time) + delta))
  return { end_time: toTime(end) }
}

export type SlotLayout = { slot: Slot; lane: number; lanes: number }

export function layoutSlots(slots: Slot[]): SlotLayout[] {
  const sorted = [...slots].sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time) || a.id - b.id)
  const groups: Slot[][] = []
  let groupEnd = -1
  for (const slot of sorted) {
    if (groups.length === 0 || toMinutes(slot.start_time) >= groupEnd) {
      groups.push([])
      groupEnd = -1
    }
    groups[groups.length - 1].push(slot)
    groupEnd = Math.max(groupEnd, toMinutes(slot.end_time))
  }
  return groups.flatMap(group => {
    const laneEnds: number[] = []
    const entries = group.map(slot => {
      const start = toMinutes(slot.start_time)
      let lane = laneEnds.findIndex(end => end <= start)
      if (lane === -1) lane = laneEnds.length
      laneEnds[lane] = toMinutes(slot.end_time)
      return { slot, lane }
    })
    return entries.map(entry => ({ ...entry, lanes: laneEnds.length }))
  })
}
