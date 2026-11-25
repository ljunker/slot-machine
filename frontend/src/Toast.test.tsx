import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TOAST_TIMEOUT_MS, ToastRegion, useToasts } from './Toast'
import type { ToastTone } from './Toast'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { cleanup(); vi.useRealTimers() })

let show: (tone: ToastTone, message: string) => void

function Harness() {
  const toasts = useToasts()
  show = toasts.show
  return <ToastRegion toasts={toasts.toasts} onDismiss={toasts.dismiss} />
}

it('hides success messages after a while but keeps errors until closed', () => {
  render(<Harness />)
  act(() => { show('success', 'Slot gespeichert.'); show('error', 'Raum ist belegt') })
  expect(screen.getByRole('status').textContent).toContain('Slot gespeichert.')
  expect(screen.getByRole('alert').textContent).toContain('Raum ist belegt')
  act(() => { vi.advanceTimersByTime(TOAST_TIMEOUT_MS + 10) })
  expect(screen.queryByRole('status')).toBeNull()
  expect(screen.getByRole('alert')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Meldung schließen' }))
  expect(screen.queryByRole('alert')).toBeNull()
})

it('pauses while hovered, shows each message once and keeps at most three', () => {
  render(<Harness />)
  act(() => { show('success', 'Gespeichert.') })
  fireEvent.mouseEnter(screen.getByRole('status'))
  act(() => { vi.advanceTimersByTime(TOAST_TIMEOUT_MS * 2) })
  expect(screen.getByRole('status')).toBeTruthy()
  act(() => { for (const message of ['A', 'B', 'A', 'C', 'D']) show('error', message) })
  expect(screen.getAllByRole('alert').map(item => item.textContent?.replace('×', ''))).toEqual(['A', 'C', 'D'])
  act(() => { show('info', '') })
  expect(screen.getAllByRole('alert')).toHaveLength(3)
})
