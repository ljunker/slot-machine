import { useEffect, useRef, useState } from 'react'

export type UndoEntry = { id: number; message: string; undo: () => Promise<unknown> }

export const UNDO_TIMEOUT_MS = 8000

/** Short confirmation after a change, with a way to take it back. Hovering or focusing pauses the timer. */
export default function UndoToast({ entry, onDismiss }: { entry: UndoEntry; onDismiss: () => void }) {
  const [paused, setPaused] = useState(false)
  const [busy, setBusy] = useState(false)
  const remaining = useRef(UNDO_TIMEOUT_MS)
  const dismiss = useRef(onDismiss)
  dismiss.current = onDismiss

  useEffect(() => { remaining.current = UNDO_TIMEOUT_MS }, [entry.id])

  useEffect(() => {
    if (paused || busy) return
    const started = Date.now()
    const timer = window.setTimeout(() => dismiss.current(), remaining.current)
    return () => {
      window.clearTimeout(timer)
      remaining.current = Math.max(0, remaining.current - (Date.now() - started))
    }
  }, [entry.id, paused, busy])

  async function undo() {
    setBusy(true)
    try { await entry.undo() } finally { dismiss.current() }
  }

  return <div className="undo-toast" role="status"
    onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
    onFocus={() => setPaused(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false) }}>
    <span>{entry.message}</span>
    <button type="button" className="undo-action" disabled={busy} onClick={() => void undo()}>Rückgängig</button>
    <button type="button" className="icon-button" aria-label="Hinweis schließen" onClick={() => dismiss.current()}>×</button>
  </div>
}
