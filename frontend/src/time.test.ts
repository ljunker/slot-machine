import { describe, expect, it } from 'vitest'
import type { Slot } from './types'
import { layoutSlots, movePatch, resizePatch, snappedDelta, toMinutes } from './time'

const slot = (id: number, start_time: string, end_time: string): Slot => ({
  id, day_id: 1, room_id: 1, topic: `Slot ${id}`, speaker_ids: [], speakers: [], description: null, start_time, end_time, is_cancelled: false, change_notice: null,
})

describe('timeline calculations', () => {
  it('places overlapping slots in separate lanes and touching slots in one lane', () => {
    const layout = layoutSlots([slot(1, '10:00', '11:00'), slot(2, '10:30', '11:30'), slot(3, '11:30', '12:00')])
    expect(layout.map(item => [item.slot.id, item.lane, item.lanes])).toEqual([[1, 0, 2], [2, 1, 2], [3, 0, 1]])
  })

  it('snaps drag, preserves duration and clamps to day bounds', () => {
    expect(snappedDelta(25)).toBe(15)
    expect(movePatch(slot(1, '10:00', '11:00'), 30, 2, 540, 1080)).toEqual({ room_id: 2, start_time: '10:30', end_time: '11:30' })
    expect(movePatch(slot(1, '10:00', '11:00'), -1000, 1, 540, 1080).start_time).toBe('09:00')
    expect(resizePatch(slot(1, '10:00', '11:00'), -1000, 1080).end_time).toBe('10:15')
    expect(toMinutes('13:45:00')).toBe(825)
  })
})
