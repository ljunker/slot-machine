import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import PublicSchedule from './PublicSchedule'
import type { PublicDaySchedule, PublicSlot } from './types'

function slot(id: number, topic: string, start: string, end: string, extra: Partial<PublicSlot> = {}): PublicSlot {
  return { id, event_id: 7, room_id: 1, topic, speakers: [], description: null, start_time: `${start}:00`, end_time: `${end}:00`, is_cancelled: false, change_notice: null, ...extra }
}

function day(date: string): PublicDaySchedule {
  return {
    day_id: 11, date, start_time: '09:00:00', end_time: '18:00:00',
    rooms: [
      { id: 1, name: 'Saal A', slots: [
        slot(21, 'Eröffnung', '10:00', '11:00', { speakers: [{ id: 3, name: 'Ada', bio: 'Pionierin', website: null, photo_url: null }] }),
        slot(22, 'Keynote', '11:00', '12:00'),
        slot(23, 'Abschluss', '16:00', '17:00'),
      ] },
      { id: 2, name: 'Saal B', slots: [slot(31, 'Workshop', '10:00', '12:00', { room_id: 2 })] },
    ],
  }
}

afterEach(() => { cleanup(); vi.useRealTimers() })

it('opens details in a side panel, navigates within the room and returns focus on Escape', () => {
  render(<PublicSchedule schedule={day('2099-06-01')} />)
  const card = screen.getByRole('button', { name: /^Eröffnung,.*Details anzeigen/ })
  card.focus()
  fireEvent.click(card)
  let drawer = screen.getByRole('dialog', { name: 'Eröffnung' })
  expect(within(drawer).getByText('10:00–11:00 Uhr · Saal A', { exact: false })).toBeTruthy()
  expect(within(within(drawer).getByRole('region', { name: 'Redner' })).getByText('Pionierin')).toBeTruthy()
  expect(within(drawer).getByRole('link', { name: 'Zum Kalender hinzufügen' }).getAttribute('href')).toBe('/api/events/7/sessions/21.ics')
  expect(within(drawer).getByRole('button', { name: 'Keine vorherige Session' })).toHaveProperty('disabled', true)

  fireEvent.keyDown(within(drawer).getByRole('button', { name: 'Schließen' }), { key: 'ArrowRight' })
  drawer = screen.getByRole('dialog', { name: 'Keynote' })
  fireEvent.click(within(drawer).getByRole('button', { name: 'Nächste Session: Abschluss' }))
  drawer = screen.getByRole('dialog', { name: 'Abschluss' })
  expect(within(drawer).getByRole('button', { name: 'Keine nächste Session' })).toHaveProperty('disabled', true)

  fireEvent(drawer, new Event('cancel', { cancelable: true }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement?.getAttribute('data-slot-id')).toBe('23')
})

it('shows a now line and marks running sessions on the current day', () => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(new Date(2099, 5, 1, 10, 30))
  const { container } = render(<PublicSchedule schedule={day('2099-06-01')} />)
  const line = container.querySelector<HTMLElement>('[data-now-line]')!
  expect(line.textContent).toBe('Jetzt 10:30')
  expect(line.style.top).toBe(`${90 * 1.6}px`)
  expect(screen.getByRole('button', { name: /^Eröffnung,.*läuft gerade/ }).classList.contains('is-running')).toBe(true)
  expect(screen.getByRole('button', { name: /^Keynote,/ }).classList.contains('is-running')).toBe(false)
  expect(container.querySelector('.public-mobile-program [data-current]')?.textContent).toContain('Eröffnung')

  act(() => { vi.setSystemTime(new Date(2099, 5, 1, 11, 15)); vi.advanceTimersByTime(30_000) })
  expect(container.querySelector('[data-now-line]')?.textContent).toBe('Jetzt 11:15')
  expect(screen.getByRole('button', { name: /^Keynote,.*läuft gerade/ })).toBeTruthy()
})

it('shows no now line on other days', () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2099, 5, 2, 10, 30))
  const { container } = render(<PublicSchedule schedule={day('2099-06-01')} />)
  expect(container.querySelector('[data-now-line]')).toBeNull()
  expect(container.querySelector('.is-running')).toBeNull()
})
