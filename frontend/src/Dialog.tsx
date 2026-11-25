import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent, PointerEvent, ReactNode, RefObject } from 'react'

const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

/** Controls of this dialog only, without those of a dialog opened on top of it. */
function focusableIn(dialog: HTMLDialogElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(element => element.closest('dialog') === dialog)
}

/**
 * Modal dialog on the native `<dialog>` element: moves focus in, keeps Tab inside,
 * closes on Escape (and on a backdrop click, if allowed) and returns focus to the opener.
 */
export default function Dialog({ label, labelledBy, describedBy, className, alert = false, initialFocus, closeOnBackdrop = true, closeDisabled = false, onClose, children }: {
  label?: string
  labelledBy?: string
  describedBy?: string
  className?: string
  alert?: boolean
  initialFocus?: RefObject<HTMLElement | null>
  closeOnBackdrop?: boolean
  closeDisabled?: boolean
  onClose: () => void
  children: ReactNode
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  const blocked = useRef(closeDisabled)
  blocked.current = closeDisabled
  const pressedOnBackdrop = useRef(false)

  useEffect(() => {
    const element = dialog.current!
    const opener = document.activeElement
    if (typeof element.showModal === 'function') element.showModal()
    else element.setAttribute('open', '')
    ;(initialFocus?.current ?? focusableIn(element)[0])?.focus()
    return () => {
      if (typeof element.close === 'function' && element.open) element.close()
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [])

  function trapFocus(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== 'Tab' || (event.target as Element).closest('dialog') !== event.currentTarget) return
    const controls = focusableIn(event.currentTarget)
    const first = controls[0]
    const last = controls.at(-1)
    if (!first) event.preventDefault()
    else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }

  function outside(event: PointerEvent | MouseEvent) {
    if (event.target !== event.currentTarget) return false
    const box = event.currentTarget.getBoundingClientRect()
    return event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom
  }

  return <dialog ref={dialog} className={`dialog${className ? ` ${className}` : ''}`} role={alert ? 'alertdialog' : undefined}
    aria-label={label} aria-labelledby={labelledBy} aria-describedby={describedBy}
    onKeyDown={trapFocus}
    onCancel={event => { event.preventDefault(); if (!blocked.current) close.current() }}
    onPointerDown={event => { pressedOnBackdrop.current = closeOnBackdrop && outside(event) }}
    onClick={event => {
      const backdrop = pressedOnBackdrop.current && outside(event)
      pressedOnBackdrop.current = false
      if (backdrop && !blocked.current) close.current()
    }}>
    {children}
  </dialog>
}

export type ConfirmOptions = {
  title: string
  message?: ReactNode
  /** Names the action, e.g. „Session löschen“ instead of „OK“. */
  confirmLabel: string
  cancelLabel?: string
  danger?: boolean
  /** Text the person must type before confirming, e.g. the event name. */
  requireText?: string
}

export function ConfirmDialog({ title, message, confirmLabel, cancelLabel = 'Abbrechen', danger = true, requireText, onConfirm, onCancel }: ConfirmOptions & {
  onConfirm: () => void
  onCancel: () => void
}) {
  const titleId = useId()
  const textId = useId()
  const cancel = useRef<HTMLButtonElement>(null)
  const [typed, setTyped] = useState('')
  const ready = !requireText || typed.trim() === requireText.trim()
  return <Dialog alert className="confirm-dialog" labelledBy={titleId} describedBy={message ? textId : undefined} initialFocus={cancel} onClose={onCancel}>
    <h3 id={titleId}>{title}</h3>
    {message && <div id={textId} className="confirm-message">{message}</div>}
    <form className="confirm-form" onSubmit={event => { event.preventDefault(); if (ready) onConfirm() }}>
      {requireText && <label>Zur Bestätigung „{requireText}“ eingeben<input value={typed} autoComplete="off" onChange={event => setTyped(event.target.value)} /></label>}
      <div className="dialog-actions dialog-actions-end">
        <button type="button" className="secondary" ref={cancel} onClick={onCancel}>{cancelLabel}</button>
        <button type="submit" className={danger ? 'danger-solid' : 'primary'} disabled={!ready}>{confirmLabel}</button>
      </div>
    </form>
  </Dialog>
}

/**
 * Promise-based replacement for `window.confirm`. Render the returned element
 * somewhere in the component; `confirm()` resolves once the person decides.
 */
export function useConfirm(): [(options: ConfirmOptions) => Promise<boolean>, ReactNode] {
  const [pending, setPending] = useState<{ options: ConfirmOptions; resolve: (value: boolean) => void } | null>(null)
  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>(resolve => setPending({ options, resolve })), [])
  const finish = (value: boolean) => {
    pending?.resolve(value)
    setPending(null)
  }
  const element = pending ? <ConfirmDialog {...pending.options} onConfirm={() => finish(true)} onCancel={() => finish(false)} /> : null
  return [confirm, element]
}
