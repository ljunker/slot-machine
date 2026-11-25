import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

export type ToastTone = 'success' | 'info' | 'error'
export type ToastEntry = { id: number; tone: ToastTone; message: string }

export const TOAST_TIMEOUT_MS = 5000
const MAX_TOASTS = 3

/** Short feedback after an action. Errors stay until closed; the rest disappears on its own. */
export function useToasts() {
  const [toasts, setToasts] = useState<ToastEntry[]>([])
  const number = useRef(0)
  const dismiss = useCallback((id: number) => setToasts(current => current.filter(toast => toast.id !== id)), [])
  const show = useCallback((tone: ToastTone, message: string) => {
    if (!message) return
    const entry = { id: ++number.current, tone, message }
    setToasts(current => [...current.filter(toast => toast.message !== message || toast.tone !== tone), entry].slice(-MAX_TOASTS))
  }, [])
  return { toasts, show, dismiss }
}

function Toast({ toast, onDismiss }: { toast: ToastEntry; onDismiss: (id: number) => void }) {
  const [paused, setPaused] = useState(false)
  const remaining = useRef(TOAST_TIMEOUT_MS)
  const dismiss = useRef(onDismiss)
  dismiss.current = onDismiss

  useEffect(() => {
    if (toast.tone === 'error' || paused) return
    const started = Date.now()
    const timer = window.setTimeout(() => dismiss.current(toast.id), remaining.current)
    return () => {
      window.clearTimeout(timer)
      remaining.current = Math.max(0, remaining.current - (Date.now() - started))
    }
  }, [toast.id, toast.tone, paused])

  return <div className={`toast toast-${toast.tone}`} role={toast.tone === 'error' ? 'alert' : 'status'}
    onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
    onFocus={() => setPaused(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false) }}>
    <span className="toast-icon" aria-hidden="true" />
    <span className="toast-message">{toast.message}</span>
    <button type="button" className="icon-button" aria-label="Meldung schließen" onClick={() => dismiss.current(toast.id)}>×</button>
  </div>
}

/** Fixed stack at the bottom right; also hosts the undo toast. */
export function ToastRegion({ toasts, onDismiss, children }: { toasts: ToastEntry[]; onDismiss: (id: number) => void; children?: ReactNode }) {
  return <div className="toast-region">
    {toasts.map(toast => <Toast key={toast.id} toast={toast} onDismiss={onDismiss} />)}
    {children}
  </div>
}
