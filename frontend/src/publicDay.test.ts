import { describe, expect, it } from 'vitest'
import { defaultDay } from './publicDay'
import type { EventDay } from './types'

const days: EventDay[] = [
  { id: 3, event_id: 1, date: '2026-10-03', start_time: '09:00:00', end_time: '18:00:00' },
  { id: 1, event_id: 1, date: '2026-10-01', start_time: '09:00:00', end_time: '18:00:00' },
  { id: 2, event_id: 1, date: '2026-10-02', start_time: '09:00:00', end_time: '18:00:00' },
]

describe('default public day', () => {
  it('chooses today, next future day, or last past day', () => {
    expect(defaultDay(days, '2026-10-02')?.id).toBe(2)
    expect(defaultDay(days, '2026-09-30')?.id).toBe(1)
    expect(defaultDay(days, '2026-10-04')?.id).toBe(3)
  })

  it('handles an event without days', () => {
    expect(defaultDay([], '2026-10-02')).toBeNull()
  })
})
