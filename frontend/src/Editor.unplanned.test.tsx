import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Editor from './Editor'
import type { EventDay, Room, UnplannedSession } from './types'

const days: EventDay[] = [{ id: 2, event_id: 1, date: '2026-10-01', start_time: '09:00:00', end_time: '18:00:00' }]
const rooms: Room[] = [{ id: 3, event_id: 1, name: 'Saal', sort_order: 0 }]
const session: UnplannedSession = {
  id: 4, event_id: 1, day_id: null, room_id: null, start_time: null, end_time: null,
  topic: 'Vortrag', speaker_ids: [], speakers: [], description: null,
  is_cancelled: false, change_notice: null,
}

afterEach(cleanup)

describe('ungeplante Session im Editor', () => {
  it('speichert sie ohne Planungsdaten', async () => {
    const onSave = vi.fn(async () => true)
    render(<Editor kind="slot" createUnplanned days={days} rooms={rooms} speakers={[]} onSave={onSave} onDelete={null} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Thema'), { target: { value: 'Vortrag' } })
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      day_id: null, room_id: null, start_time: null, end_time: null,
    })))
  })

  it('setzt beim Einplanen Tag, Raum und Zeiten gemeinsam', async () => {
    const onSave = vi.fn(async () => true)
    render(<Editor kind="slot" slot={session} day={days[0]} days={days} rooms={rooms} speakers={[]} onSave={onSave} onDelete={null} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Einplanen' }))
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      day_id: 2, room_id: 3, start_time: '09:00', end_time: '10:00',
    })))
  })
})
