import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Schedule from './Schedule'
import type { DaySchedule } from './types'

const schedule: DaySchedule = {
  day_id: 1, date: '2026-10-01', start_time: '09:00:00', end_time: '18:00:00',
  collisions: [{ first_slot_id: 1, second_slot_id: 2 }],
  speaker_conflicts: [],
  rooms: [
    { id: 1, event_id: 1, name: 'A', sort_order: 0, slots: [
      { id: 1, event_id: 1, day_id: 1, room_id: 1, topic: 'Erster', speaker_ids: [], speakers: [], description: null, start_time: '10:00:00', end_time: '11:00:00', is_cancelled: false, change_notice: null },
      { id: 2, event_id: 1, day_id: 1, room_id: 1, topic: 'Zweiter', speaker_ids: [], speakers: [], description: null, start_time: '10:30:00', end_time: '11:30:00', is_cancelled: false, change_notice: null },
    ] },
    { id: 2, event_id: 1, name: 'B', sort_order: 1, slots: [] },
  ],
}

afterEach(() => { cleanup(); vi.useRealTimers() })

describe('schedule interactions', () => {
  it('shows empty room and collision marks', () => {
    const { container } = render(<Schedule schedule={schedule} onEdit={() => {}} onChange={async () => {}} />)
    expect(screen.getByText('Noch keine Slots')).toBeTruthy()
    expect(container.querySelectorAll('.slot-card.collision')).toHaveLength(2)
    const first = container.querySelector('[data-slot-id="1"]') as HTMLElement
    const second = container.querySelector('[data-slot-id="2"]') as HTMLElement
    expect(first.style.top).toBe('96px')
    expect(first.style.height).toBe('96px')
    expect(second.style.left).toBe('50%')
  })

  it('sends drag and resize patches', () => {
    const onChange = vi.fn(async () => {})
    const original = Element.prototype.getBoundingClientRect
    Element.prototype.getBoundingClientRect = function () {
      const room = (this as HTMLElement).dataset.roomColumn
      return { left: room === '2' ? 300 : 0, right: room === '2' ? 600 : 299 } as DOMRect
    }
    try {
      const { container } = render(<Schedule schedule={schedule} onEdit={() => {}} onChange={onChange} />)
      fireEvent.pointerDown(screen.getByLabelText('Erster verschieben'), { button: 0, clientY: 100 })
      fireEvent.pointerMove(window, { clientY: 148, clientX: 350 })
      fireEvent.pointerUp(window)
      expect(onChange).toHaveBeenCalledWith(1, { room_id: 2, start_time: '10:30', end_time: '11:30' })
      fireEvent.pointerDown(container.querySelector('[aria-label="Erster verlängern oder verkürzen"]')!, { button: 0, clientY: 100 })
      fireEvent.pointerMove(window, { clientY: 124, clientX: 100 })
      fireEvent.pointerUp(window)
      expect(onChange).toHaveBeenCalledWith(1, { end_time: '11:15' })
    } finally { Element.prototype.getBoundingClientRect = original }
  })

  it('names speaker conflicts across rooms', () => {
    const other = { ...schedule.rooms[0].slots[1], room_id: 2, speaker_ids: [5], speakers: [{ id: 5, name: 'Ada' }] }
    const first = { ...schedule.rooms[0].slots[0], speaker_ids: [5], speakers: [{ id: 5, name: 'Ada' }] }
    const changed: DaySchedule = {
      ...schedule,
      collisions: [],
      speaker_conflicts: [{ first_slot_id: 1, second_slot_id: 2, speaker_ids: [5] }],
      rooms: [{ ...schedule.rooms[0], slots: [first] }, { ...schedule.rooms[1], slots: [other] }],
    }
    const { container } = render(<Schedule schedule={changed} onEdit={() => {}} onChange={async () => {}} />)
    expect(screen.getByRole('region', { name: 'Rednerkonflikte' }).textContent).toContain('Ada: Erster (A, 10:00–11:00) und Zweiter (B, 10:30–11:30)')
    expect(container.querySelectorAll('.slot-card.speaker-conflict')).toHaveLength(2)
  })

  it('marks a rescheduled slot and cancelled slot', () => {
    const changed: DaySchedule = {
      ...schedule,
      rooms: [{ ...schedule.rooms[0], slots: [
        { ...schedule.rooms[0].slots[0], change_notice: { type: 'rescheduled', expires_at: Math.floor(Date.now() / 1000) + 3600, previous_start_time: '09:00:00', previous_end_time: '10:00:00', previous_room_name: 'B' } },
        { ...schedule.rooms[0].slots[1], is_cancelled: true, change_notice: { type: 'cancelled', expires_at: null, previous_start_time: null, previous_end_time: null, previous_room_name: null } },
      ] }],
    }
    const { container } = render(<Schedule schedule={changed} onEdit={() => {}} onChange={async () => {}} />)
    expect(container.querySelector('.slot-card.notice-rescheduled')?.textContent).toContain('Verschoben')
    expect(container.querySelector('.slot-card.notice-cancelled')?.textContent).toContain('Abgesagt')
  })

  it('removes an expired notice without reloading', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_800_000_000_000)
    const changed: DaySchedule = {
      ...schedule,
      rooms: [{ ...schedule.rooms[0], slots: [{
        ...schedule.rooms[0].slots[0],
        change_notice: { type: 'updated', expires_at: 1_800_000_001, previous_start_time: null, previous_end_time: null, previous_room_name: null },
      }] }],
    }
    const { container } = render(<Schedule schedule={changed} onEdit={() => {}} onChange={async () => {}} />)
    expect(container.querySelector('.slot-card.notice-updated')).not.toBeNull()
    act(() => vi.advanceTimersByTime(1001))
    expect(container.querySelector('.slot-card.notice-updated')).toBeNull()
  })
})
