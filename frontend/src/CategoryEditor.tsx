import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { Category } from './types'
import { UnsavedBadge, useUnsavedChanges } from './unsavedChanges'
import { useConfirm } from './Dialog'

const DEFAULT_COLOR = '#4569DD'

export default function CategoryEditor({ category, onSave, onDelete, onClose, onRequestClose = onClose }: {
  category?: Category
  onSave: (body: { name: string; color: string }) => Promise<boolean>
  onDelete: (() => Promise<boolean>) | null
  onClose: () => void
  onRequestClose?: () => void
}) {
  const [confirm, confirmDialog] = useConfirm()
  const [name, setName] = useState(category?.name ?? '')
  const [color, setColor] = useState(category?.color ?? DEFAULT_COLOR)
  const form = useRef<HTMLFormElement>(null)
  const { dirty, save } = useUnsavedChanges(
    { name, color: color.toLowerCase() },
    { name: category?.name ?? '', color: (category?.color ?? DEFAULT_COLOR).toLowerCase() },
    persist,
  )

  function submit(event: FormEvent) {
    event.preventDefault()
    void save()
  }

  async function persist(): Promise<boolean> {
    if (form.current && !form.current.reportValidity()) return false
    if (!await onSave({ name, color })) return false
    onClose()
    return true
  }

  async function remove() {
    if (!onDelete || !await confirm({ title: 'Kategorie löschen?', message: 'Alle Zuordnungen zu Sessions werden entfernt.', confirmLabel: 'Kategorie löschen' })) return
    if (await onDelete()) onClose()
  }

  return <aside className="editor" aria-label={`Kategorie ${category ? 'bearbeiten' : 'anlegen'}`}>
    <div className="editor-heading"><h2>Kategorie {category ? 'bearbeiten' : 'anlegen'}<UnsavedBadge dirty={dirty} /></h2><button type="button" className="text-button" onClick={onRequestClose}>Schließen</button></div>
    <form ref={form} onSubmit={submit}>
      <label>Name<input required maxLength={255} value={name} onChange={event => setName(event.target.value)} /></label>
      <label>Farbe<input required type="color" value={color} onChange={event => setColor(event.target.value)} /></label>
      <div className="editor-actions"><button className="primary" type="submit">Speichern</button>{onDelete && <button className="danger" type="button" onClick={() => void remove()}>Löschen</button>}</div>
    </form>
    {confirmDialog}
  </aside>
}
