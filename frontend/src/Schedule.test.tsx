import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Schedule, { cardDensity } from './Schedule'
import type { DaySchedule } from './types'

const schedule: DaySchedule = {
  day_id: 1, date: '2026-10-01', start_time: '09:00:00', end_time: '18:00:00',
  collisions: [{ first_slot_id: 1, second_slot_id: 2 }],
  speaker_conflicts: [],
  rooms: [
    { id: 1, event_id: 1, name: 'A', sort_order: 0, slots: [
      { id: 1, event_id: 1, day_id: 1, room_id: 1, topic: 'Erster', speaker_required: true, speaker_ids: [], speakers: [], description: null, start_time: '10:00:00', end_time: '11:00:00', is_cancelled: false, change_notice: null },
      { id: 2, event_id: 1, day_id: 1, room_id: 1, topic: 'Zweiter', speaker_required: true, speaker_ids: [], speakers: [], description: null, start_time: '10:30:00', end_time: '11:30:00', is_cancelled: false, change_notice: null },
    ] },
    { id: 2, event_id: 1, name: 'B', sort_order: 1, slots: [] },
  ],
}

afterEach(() => { cleanup(); vi.useRealTimers() })

function resizeHandle(name: string): HTMLElement {
  return screen.getByRole('button', { name }).closest('.slot-card')!.querySelector<HTMLElement>('.slot-resize')!
}

describe('schedule interactions', () => {
  it('shows empty room and collision marks', () => {
    const { container } = render(<Schedule schedule={schedule} onEdit={() => {}} onChange={async () => {}} />)
    expect(screen.getByText('Noch keine Sessions')).toBeTruthy()
    expect(container.querySelectorAll('.slot-card.collision')).toHaveLength(2)
    const first = container.querySelector('[data-slot-id="1"]') as HTMLElement
    const second = container.querySelector('[data-slot-id="2"]') as HTMLElement
    expect(first.style.top).toBe('96px')
    expect(first.style.height).toBe('96px')
    expect(second.style.left).toBe('50%')
  })

  it.each(['program', 'helpers'] as const)('sends drag and resize patches in %s view', focus => {
    const onChange = vi.fn(async () => {})
    const original = Element.prototype.getBoundingClientRect
    Element.prototype.getBoundingClientRect = function () {
      const room = (this as HTMLElement).dataset.roomColumn
      return { left: room === '2' ? 300 : 0, right: room === '2' ? 600 : 299 } as DOMRect
    }
    try {
      const onEdit = vi.fn()
      const { container } = render(<Schedule schedule={schedule} focus={focus} onEdit={onEdit} onChange={onChange} />)
      fireEvent.click(screen.getByRole('button', { name: 'Erster bearbeiten' }))
      expect(onEdit).toHaveBeenCalledWith(schedule.rooms[0].slots[0])
      fireEvent.pointerDown(screen.getByRole('button', { name: 'Erster bearbeiten' }), { button: 0, clientY: 100 })
      fireEvent.pointerMove(window, { clientY: 148, clientX: 350 })
      fireEvent.pointerUp(window)
      expect(onChange).toHaveBeenCalledWith(1, { room_id: 2, start_time: '10:30', end_time: '11:30' })
      fireEvent.pointerDown(resizeHandle('Erster bearbeiten'), { button: 0, clientY: 100 })
      fireEvent.pointerMove(window, { clientY: 124, clientX: 100 })
      fireEvent.pointerUp(window)
      expect(onChange).toHaveBeenCalledWith(1, { end_time: '11:15' })
      fireEvent.pointerDown(screen.getByRole('button', { name: 'Erster bearbeiten' }), { button: 0, clientY: 100 })
      fireEvent.pointerMove(window, { clientY: 148, clientX: 700 })
      fireEvent.pointerUp(window)
      expect(onChange).toHaveBeenCalledTimes(2)
    } finally { Element.prototype.getBoundingClientRect = original }
  })

  it('opens a card with a single click anywhere on it, but not after dragging', () => {
    const onEdit = vi.fn()
    const onChange = vi.fn(async () => {})
    const { container } = render(<Schedule schedule={schedule} onEdit={onEdit} onChange={onChange} />)
    const card = container.querySelector('[data-slot-id="1"]') as HTMLElement
    fireEvent.click(card)
    expect(onEdit).toHaveBeenCalledTimes(1)
    const grip = screen.getByRole('button', { name: 'Erster bearbeiten' })
    fireEvent.pointerDown(grip, { button: 0, clientY: 100 })
    fireEvent.pointerUp(window)
    fireEvent.click(grip)
    expect(onChange).not.toHaveBeenCalled()
    expect(onEdit).toHaveBeenCalledTimes(2)
    const resize = resizeHandle('Erster bearbeiten')
    fireEvent.pointerDown(resize, { button: 0, clientY: 100 })
    fireEvent.pointerMove(window, { clientY: 148, clientX: 10 })
    fireEvent.pointerUp(window)
    fireEvent.click(container.querySelector('[data-slot-id="1"]')!)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onEdit).toHaveBeenCalledTimes(2)
  })

  it('labels room conflicts with text and icon, not only with colour', () => {
    const { container } = render(<Schedule schedule={schedule} onEdit={() => {}} onChange={async () => {}} />)
    const first = container.querySelector('[data-slot-id="1"]') as HTMLElement
    expect(first.querySelector('.status-conflict')?.textContent).toBe('Raumkonflikt')
    expect(first.querySelector('.status-conflict svg')).not.toBeNull()
    expect(first.title).toContain('Raumkonflikt')
  })

  it('chooses the card density from the duration and shows details only on large cards', () => {
    expect([cardDensity(15), cardDensity(29), cardDensity(30), cardDensity(59), cardDensity(60)])
      .toEqual(['compact', 'compact', 'medium', 'medium', 'full'])
    const withSpeakers: DaySchedule = { ...schedule, collisions: [], rooms: [{ ...schedule.rooms[0], slots: [
      { ...schedule.rooms[0].slots[0], speakers: [{ id: 1, name: 'Ada' }] },
      { ...schedule.rooms[0].slots[1], start_time: '12:00:00', end_time: '12:15:00', speakers: [{ id: 1, name: 'Ada' }] },
    ] }] }
    const { container } = render(<Schedule schedule={withSpeakers} onEdit={() => {}} onChange={async () => {}} />)
    const long = container.querySelector('[data-slot-id="1"]') as HTMLElement
    const short = container.querySelector('[data-slot-id="2"]') as HTMLElement
    expect(long.className).toContain('density-full')
    expect(long.querySelector('.slot-speakers')?.textContent).toBe('Ada')
    expect(short.className).toContain('density-compact')
    expect(short.querySelector('.slot-speakers')).toBeNull()
    expect(short.title).toContain('Redner: Ada')
  })

  it('scales the grid with the zoom level and draws half-hour lines', () => {
    const { container } = render(<Schedule schedule={schedule} pxPerMinute={3.2} onEdit={() => {}} onChange={async () => {}} />)
    const first = container.querySelector('[data-slot-id="1"]') as HTMLElement
    expect(first.style.top).toBe('192px')
    expect(first.style.height).toBe('192px')
    expect(container.querySelectorAll('.room-column .half-hour-line').length).toBeGreaterThan(0)
  })

  it('names speaker conflicts across rooms', () => {
    const other = { ...schedule.rooms[0].slots[1], room_id: 2, speaker_required: true, speaker_ids: [5], speakers: [{ id: 5, name: 'Ada' }] }
    const first = { ...schedule.rooms[0].slots[0], speaker_required: true, speaker_ids: [5], speakers: [{ id: 5, name: 'Ada' }] }
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
