import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Schedule from './Schedule'
import type { DaySchedule } from './types'

const schedule: DaySchedule = {
  day_id: 1, date: '2026-10-01', start_time: '09:00:00', end_time: '18:00:00',
  collisions: [{ first_slot_id: 1, second_slot_id: 2 }],
  rooms: [
    { id: 1, event_id: 1, name: 'A', sort_order: 0, slots: [
      { id: 1, day_id: 1, room_id: 1, topic: 'Erster', speaker: null, description: null, start_time: '10:00:00', end_time: '11:00:00' },
      { id: 2, day_id: 1, room_id: 1, topic: 'Zweiter', speaker: null, description: null, start_time: '10:30:00', end_time: '11:30:00' },
    ] },
    { id: 2, event_id: 1, name: 'B', sort_order: 1, slots: [] },
  ],
}

afterEach(cleanup)

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
})
