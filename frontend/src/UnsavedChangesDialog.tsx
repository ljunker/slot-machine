import { useEffect, useRef, useState } from 'react'

/** Asks what should happen to unsaved editor input before the panel changes. */
export default function UnsavedChangesDialog({ onSave, onDiscard, onCancel }: {
  onSave: () => Promise<void>
  onDiscard: () => void
  onCancel: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const cancelButton = useRef<HTMLButtonElement>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const element = dialog.current
    if (!element) return
    const previousFocus = document.activeElement as HTMLElement | null
    if (typeof element.showModal === 'function') element.showModal()
    else element.setAttribute('open', '')
    cancelButton.current?.focus()
    return () => {
      if (typeof element.close === 'function' && element.open) element.close()
      previousFocus?.focus?.()
    }
  }, [])

  async function save() {
    setSaving(true)
    try { await onSave() } finally { setSaving(false) }
  }

  return <dialog ref={dialog} className="backup-dialog account-dialog unsaved-dialog" role="alertdialog"
    aria-labelledby="unsaved-title" aria-describedby="unsaved-text"
    onCancel={event => { event.preventDefault(); onCancel() }}>
    <h3 id="unsaved-title">Änderungen verwerfen?</h3>
    <p id="unsaved-text">Im Bearbeitungsbereich gibt es ungespeicherte Eingaben.</p>
    <div className="dialog-actions">
      <button type="button" className="primary" disabled={saving} onClick={() => void save()}>Speichern</button>
      <button type="button" className="danger" disabled={saving} onClick={onDiscard}>Verwerfen</button>
      <button type="button" className="text-button" ref={cancelButton} disabled={saving} onClick={onCancel}>Abbrechen</button>
    </div>
  </dialog>
}
