import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import UndoToast, { UNDO_TIMEOUT_MS } from './UndoToast'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { cleanup(); vi.useRealTimers() })

it('disappears after the timeout unless hovered', () => {
  const onDismiss = vi.fn()
  render(<UndoToast entry={{ id: 1, message: '„Eröffnung“ verschoben.', undo: vi.fn() }} onDismiss={onDismiss} />)
  const toast = screen.getByRole('status')
  act(() => { vi.advanceTimersByTime(UNDO_TIMEOUT_MS / 2) })
  fireEvent.mouseEnter(toast)
  act(() => { vi.advanceTimersByTime(UNDO_TIMEOUT_MS) })
  expect(onDismiss).not.toHaveBeenCalled()
  fireEvent.mouseLeave(toast)
  act(() => { vi.advanceTimersByTime(UNDO_TIMEOUT_MS / 2 - 10) })
  expect(onDismiss).not.toHaveBeenCalled()
  act(() => { vi.advanceTimersByTime(20) })
  expect(onDismiss).toHaveBeenCalledTimes(1)
})

it('runs the undo action and closes', async () => {
  const undo = vi.fn(async () => true)
  const onDismiss = vi.fn()
  render(<UndoToast entry={{ id: 1, message: 'Verschoben.', undo }} onDismiss={onDismiss} />)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Rückgängig' })) })
  expect(undo).toHaveBeenCalledTimes(1)
  expect(onDismiss).toHaveBeenCalledTimes(1)
})
