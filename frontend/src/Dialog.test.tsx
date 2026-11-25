import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import Dialog, { useConfirm } from './Dialog'
import type { ConfirmOptions } from './Dialog'

afterEach(cleanup)

function ConfirmHarness({ options, onResult }: { options: ConfirmOptions; onResult: (value: boolean) => void }) {
  const [confirm, element] = useConfirm()
  return <>
    <button type="button" onClick={() => void confirm(options).then(onResult)}>Löschen</button>
    {element}
  </>
}

it('resolves with the decision, names the action and returns focus to the trigger', async () => {
  const onResult = vi.fn()
  render(<ConfirmHarness options={{ title: 'Session löschen?', message: 'Das lässt sich nicht rückgängig machen.', confirmLabel: 'Session löschen' }} onResult={onResult} />)
  const trigger = screen.getByRole('button', { name: 'Löschen' })
  trigger.focus()
  fireEvent.click(trigger)
  const dialog = screen.getByRole('alertdialog', { name: 'Session löschen?' })
  expect(dialog.getAttribute('aria-describedby')).toBeTruthy()
  expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Abbrechen' }))
  expect(within(dialog).getByRole('button', { name: 'Session löschen' }).className).toBe('danger-solid')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Session löschen' }))
  await waitFor(() => expect(onResult).toHaveBeenCalledWith(true))
  expect(screen.queryByRole('alertdialog')).toBeNull()
  expect(document.activeElement).toBe(trigger)
})

it('treats Escape as cancel', async () => {
  const onResult = vi.fn()
  render(<ConfirmHarness options={{ title: 'Entfernen?', confirmLabel: 'Entfernen' }} onResult={onResult} />)
  fireEvent.click(screen.getByRole('button', { name: 'Löschen' }))
  fireEvent(screen.getByRole('alertdialog'), new Event('cancel', { cancelable: true }))
  await waitFor(() => expect(onResult).toHaveBeenCalledWith(false))
})

it('only confirms after the required text was typed', async () => {
  const onResult = vi.fn()
  render(<ConfirmHarness options={{ title: 'Veranstaltung löschen?', confirmLabel: 'Veranstaltung löschen', requireText: 'Sommerfest' }} onResult={onResult} />)
  fireEvent.click(screen.getByRole('button', { name: 'Löschen' }))
  const confirm = screen.getByRole('button', { name: 'Veranstaltung löschen' }) as HTMLButtonElement
  expect(confirm.disabled).toBe(true)
  const input = screen.getByLabelText('Zur Bestätigung „Sommerfest“ eingeben')
  fireEvent.change(input, { target: { value: 'Sommer' } })
  fireEvent.submit(input.closest('form')!)
  expect(onResult).not.toHaveBeenCalled()
  fireEvent.change(input, { target: { value: 'Sommerfest' } })
  expect(confirm.disabled).toBe(false)
  fireEvent.click(confirm)
  await waitFor(() => expect(onResult).toHaveBeenCalledWith(true))
})

it('keeps Tab inside the dialog and ignores Escape while closing is blocked', async () => {
  const onClose = vi.fn()
  function Harness() {
    const [blocked, setBlocked] = useState(false)
    return <Dialog label="Test" closeDisabled={blocked} onClose={onClose}>
      <button type="button">Erster</button>
      <button type="button" onClick={() => setBlocked(true)}>Letzter</button>
    </Dialog>
  }
  render(<Harness />)
  const user = userEvent.setup()
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Erster' }))
  await user.tab({ shift: true })
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Letzter' }))
  await user.tab()
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Erster' }))
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }))
  expect(onClose).toHaveBeenCalledTimes(1)
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Letzter' })))
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }))
  expect(onClose).toHaveBeenCalledTimes(1)
})
