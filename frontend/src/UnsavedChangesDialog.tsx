import { useRef, useState } from 'react'
import Dialog from './Dialog'

/** Asks what should happen to unsaved editor input before the panel changes. */
export default function UnsavedChangesDialog({ onSave, onDiscard, onCancel }: {
  onSave: () => Promise<void>
  onDiscard: () => void
  onCancel: () => void
}) {
  const cancelButton = useRef<HTMLButtonElement>(null)
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try { await onSave() } finally { setSaving(false) }
  }

  return <Dialog alert className="unsaved-dialog" labelledBy="unsaved-title" describedBy="unsaved-text" initialFocus={cancelButton} closeDisabled={saving} onClose={onCancel}>
    <h3 id="unsaved-title">Änderungen verwerfen?</h3>
    <p id="unsaved-text">Im Bearbeitungsbereich gibt es ungespeicherte Eingaben.</p>
    <div className="dialog-actions">
      <button type="button" className="primary" disabled={saving} onClick={() => void save()}>Speichern</button>
      <button type="button" className="danger" disabled={saving} onClick={onDiscard}>Verwerfen</button>
      <button type="button" className="secondary" ref={cancelButton} disabled={saving} onClick={onCancel}>Abbrechen</button>
    </div>
  </Dialog>
}
