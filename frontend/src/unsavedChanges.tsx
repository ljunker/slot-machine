import { createContext, useContext, useEffect, useRef, useState } from 'react'

export type UnsavedEditor = { dirty: boolean; save: () => Promise<boolean> }
type Register = (editor: UnsavedEditor | null) => void

const UnsavedChangesContext = createContext<Register | null>(null)

export const UnsavedChangesProvider = UnsavedChangesContext.Provider

/**
 * Reports whether an editor differs from its saved state and how to save it,
 * so the app can ask before the editor is replaced or closed. Editors submit
 * through the returned `save`; input that is being saved does not count as unsaved.
 */
export function useUnsavedChanges<T>(values: T, baseline: T, persist: () => Promise<boolean>): { dirty: boolean; save: () => Promise<boolean> } {
  const register = useContext(UnsavedChangesContext)
  const [saving, setSaving] = useState(false)
  const dirty = JSON.stringify(values) !== JSON.stringify(baseline)
  const persistRef = useRef(persist)
  persistRef.current = persist
  const mounted = useRef(true)

  async function save(): Promise<boolean> {
    setSaving(true)
    try { return await persistRef.current() } finally { if (mounted.current) setSaving(false) }
  }
  const saveRef = useRef(save)
  saveRef.current = save

  const pending = dirty && !saving
  useEffect(() => { register?.({ dirty: pending, save: () => saveRef.current() }) }, [pending, register])
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      register?.(null)
    }
  }, [register])
  return { dirty, save }
}

export function UnsavedBadge({ dirty }: { dirty: boolean }) {
  return dirty ? <span className="unsaved-badge">Ungespeichert</span> : null
}
