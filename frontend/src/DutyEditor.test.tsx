import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import DutyEditor from './DutyEditor'

afterEach(cleanup)

it('creates an open duty and then allows multiple helpers on a room duty', async () => {
  const onSave = vi.fn(async () => true)
  const props = {
    days: [{ id: 1, event_id: 1, date: '2026-10-01', start_time: '09:00:00', end_time: '18:00:00' }],
    rooms: [{ id: 2, event_id: 1, name: 'Saal A', sort_order: 0 }],
    sessions: [],
    helpers: [{ id: 3, is_active: true, email: 'person@example.invalid', name: 'Ada' }, { id: 4, is_active: true, email: 'person@example.invalid', name: 'Ben' }],
    currentUserId: 1, onSignup: vi.fn(async () => {}),
    onSave, onDelete: null, onClose: vi.fn(),
  }
  const { unmount } = render(<DutyEditor {...props} />)
  fireEvent.submit(screen.getByRole('button', { name: 'Speichern' }).closest('form')!)
  await vi.waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
    kind: 'general', user_ids: [], day_id: 1,
  })))
  unmount()
  onSave.mockClear()
  render(<DutyEditor {...props} />)
  fireEvent.change(screen.getByLabelText('Dienstart'), { target: { value: 'room' } })
  fireEvent.change(screen.getByLabelText('Höchstzahl Helfer'), { target: { value: '2' } })
  fireEvent.click(screen.getByRole('checkbox', { name: /Ada/ }))
  fireEvent.click(screen.getByRole('checkbox', { name: /Ben/ }))
  fireEvent.submit(screen.getByRole('button', { name: 'Speichern' }).closest('form')!)
  await vi.waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
    kind: 'room', room_id: 2, user_ids: [3, 4],
  })))
})
