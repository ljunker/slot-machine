import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PublicProgram from './PublicProgram'
import PublicSchedule from './PublicSchedule'
import type { DaySchedule } from './types'

const event = { id: 7, name: 'Konferenz', start_date: '2099-06-01', end_date: '2099-06-02' }
const days = [
  { id: 11, event_id: 7, date: '2099-06-01', start_time: '09:00:00', end_time: '18:00:00' },
  { id: 12, event_id: 7, date: '2099-06-02', start_time: '09:00:00', end_time: '18:00:00' },
]
const schedule: DaySchedule = {
  day_id: 11, date: '2099-06-01', start_time: '09:00:00', end_time: '18:00:00', collisions: [], speaker_conflicts: [],
  rooms: [
    { id: 1, event_id: 7, name: 'Saal A', sort_order: 0, slots: [{ id: 21, event_id: 7, day_id: 11, room_id: 1, topic: 'Eröffnung', speaker_ids: [1], speakers: [{ id: 1, name: 'Ada' }], description: 'Willkommen zur Konferenz.', start_time: '10:00:00', end_time: '11:00:00', is_cancelled: false, change_notice: null }] },
    { id: 2, event_id: 7, name: 'Saal B', sort_order: 1, slots: [] },
  ],
}

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('public program', () => {
  it('loads selected event and changes day without write requests', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _options?: RequestInit) => {
      const path = String(input)
      const body = path.endsWith('/events/7') ? event : path.endsWith('/events/7/days') ? days : { ...schedule, day_id: path.endsWith('/12') ? 12 : 11 }
      return new Response(JSON.stringify(body), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<PublicProgram eventId={7} />)
    const picker = await screen.findByRole('combobox', { name: 'Veranstaltungstag' })
    expect(screen.getByRole('link', { name: 'PDF-Programm herunterladen' }).getAttribute('href')).toBe('/api/events/7/program.pdf')
    expect((picker as HTMLSelectElement).value).toBe('11')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/schedule/days/11', expect.any(Object)))
    fireEvent.change(picker, { target: { value: '12' } })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/schedule/days/12', expect.any(Object)))
    expect((picker as HTMLSelectElement).value).toBe('12')
    expect(fetchMock.mock.calls.every(call => !call[1]?.method)).toBe(true)
  })

  it('shows mobile room tabs and expands slot description', () => {
    render(<PublicSchedule schedule={schedule} />)
    const tabs = screen.getByRole('tablist', { name: 'Räume' })
    expect(within(tabs).getByRole('tab', { name: 'Saal A' }).getAttribute('aria-selected')).toBe('true')
    const panel = screen.getByRole('tabpanel', { name: 'Saal A' })
    const details = within(panel).getByText('Eröffnung').closest('details')!
    expect(details.open).toBe(false)
    fireEvent.click(details.querySelector('summary')!)
    expect(details.open).toBe(true)
    expect(within(details).getByText('Willkommen zur Konferenz.')).toBeTruthy()
    fireEvent.click(within(tabs).getByRole('tab', { name: 'Saal B' }))
    expect(screen.getByRole('tabpanel', { name: 'Saal B' }).textContent).toContain('keine Programmpunkte')
  })

  it('shows invalid link, empty event, and load error states', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify(String(input).endsWith('/events/7') ? event : []), { status: 200 })))
    const { rerender } = render(<PublicProgram eventId={null} />)
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('Ungültiger Programmlink'))
    rerender(<PublicProgram eventId={7} />)
    expect(await screen.findByText('Für diese Veranstaltung sind noch keine Tage angelegt.')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'PDF-Programm herunterladen' })).toBeNull()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ detail: 'Nicht gefunden' }), { status: 404 })))
    rerender(<PublicProgram eventId={8} />)
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('Programm konnte nicht geladen werden'))
  })

  it('shows previous planning and cancellation in public views', () => {
    const changed: DaySchedule = {
      ...schedule,
      rooms: [{ ...schedule.rooms[0], slots: [
        { ...schedule.rooms[0].slots[0], change_notice: { type: 'rescheduled', expires_at: Math.floor(Date.now() / 1000) + 3600, previous_start_time: '09:00:00', previous_end_time: '10:00:00', previous_room_name: 'Saal B' } },
        { ...schedule.rooms[0].slots[0], id: 22, topic: 'Pause', is_cancelled: true, change_notice: { type: 'cancelled', expires_at: null, previous_start_time: null, previous_end_time: null, previous_room_name: null } },
      ] }, schedule.rooms[1]],
    }
    render(<PublicSchedule schedule={changed} />)
    const panel = screen.getByRole('tabpanel', { name: 'Saal A' })
    expect(within(panel).getByText('Vorher: 09:00–10:00 Uhr · Saal B')).toBeTruthy()
    expect(within(panel).getByText('Abgesagt')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Eröffnung.*Verschoben.*Details anzeigen/ }))
    expect(screen.getByRole('region', { name: 'Session-Details' }).textContent).toContain('Vorher: 09:00–10:00 Uhr · Saal B')
    expect(screen.getAllByRole('link', { name: 'Session-Seite öffnen' })[0].getAttribute('href')).toBe('/programm/7/sessions/21')
  })
})
