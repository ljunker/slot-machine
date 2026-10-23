import { useState } from 'react'
import type { FormEvent } from 'react'
import type { Category } from './types'

export default function CategoryEditor({ category, onSave, onDelete, onClose }: {
  category?: Category
  onSave: (body: { name: string; color: string }) => Promise<boolean>
  onDelete: (() => Promise<boolean>) | null
  onClose: () => void
}) {
  const [name, setName] = useState(category?.name ?? '')
  const [color, setColor] = useState(category?.color ?? '#4569DD')

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (await onSave({ name, color })) onClose()
  }

  async function remove() {
    if (!onDelete || !window.confirm('Kategorie löschen? Alle Zuordnungen zu Sessions werden entfernt.')) return
    if (await onDelete()) onClose()
  }

  return <aside className="editor" aria-label={`Kategorie ${category ? 'bearbeiten' : 'anlegen'}`}>
    <div className="editor-heading"><h2>Kategorie {category ? 'bearbeiten' : 'anlegen'}</h2><button type="button" className="text-button" onClick={onClose}>Schließen</button></div>
    <form onSubmit={submit}>
      <label>Name<input required maxLength={255} value={name} onChange={event => setName(event.target.value)} /></label>
      <label>Farbe<input required type="color" value={color} onChange={event => setColor(event.target.value)} /></label>
      <div className="editor-actions"><button className="primary" type="submit">Speichern</button>{onDelete && <button className="danger" type="button" onClick={() => void remove()}>Löschen</button>}</div>
    </form>
  </aside>
}
