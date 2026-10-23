import type { PublicSlot } from './types'
import { toMinutes } from './time'

export function sharedPresentation<T extends Pick<PublicSlot, 'id' | 'start_time' | 'end_time'>>(
  roomSlots: T[], sharedSlots: T[],
) {
  const all = [...roomSlots, ...sharedSlots]
  const overlapping = sharedSlots.filter(slot => all.some(other => other.id !== slot.id
    && toMinutes(slot.start_time) < toMinutes(other.end_time)
    && toMinutes(other.start_time) < toMinutes(slot.end_time)))
  const ids = new Set(overlapping.map(slot => slot.id))
  return { spanning: sharedSlots.filter(slot => !ids.has(slot.id)), repeated: overlapping }
}
