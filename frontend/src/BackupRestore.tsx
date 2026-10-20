import { useState } from 'react'
import { csrfHeaders } from './api'
import type { Event } from './types'

type Preview = {
  name: string
  source_event_id: number
  target_event_id: number | null
  mode: 'create' | 'replace'
  counts: Record<string, number>
  remapped_session_ids: number
  removed_session_links: number
}

async function sendBackup(path: 'preview' | 'restore', file: File, targetId: number | null): Promise<Preview & { event_id?: number }> {
  const body = new FormData()
  body.append('backup', file)
  if (targetId !== null) body.append('target_event_id', String(targetId))
  const response = await fetch(`/api/backups/${path}`, { method: 'POST', headers: csrfHeaders(), body })
  if (!response.ok) {
    const data = await response.json().catch(() => null)
    throw new Error(typeof data?.detail === 'string' ? data.detail : `HTTP ${response.status}`)
  }
  return response.json()
}

export default function BackupRestore({ events, selectedEventId, allowCreate = true, onComplete, onClose }: {
  events: Event[]
  selectedEventId: number | null
  allowCreate?: boolean
  onComplete: (eventId: number) => Promise<void>
  onClose: () => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [targetId, setTargetId] = useState<number | null>(selectedEventId)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const targetName = events.find(event => event.id === targetId)?.name

  async function inspect() {
    if (!file) return
    setBusy(true)
    setError('')
    setPreview(null)
    try {
      setPreview(await sendBackup('preview', file, targetId))
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function restore() {
    if (!file || !preview) return
    const message = targetId === null
      ? `„${preview.name}“ als neue Veranstaltung wiederherstellen?`
      : `„${targetName}“ vollständig durch Backup „${preview.name}“ ersetzen? Diese Aktion überschreibt alle zugehörigen Daten und Bilder.`
    if (!window.confirm(message)) return
    setBusy(true)
    setError('')
    try {
      const result = await sendBackup('restore', file, targetId)
      if (result.event_id === undefined) throw new Error('Restore lieferte keine Veranstaltung')
      await onComplete(result.event_id)
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return <div className="backup-backdrop" role="presentation">
    <section className="backup-dialog" role="dialog" aria-modal="true" aria-labelledby="backup-title">
      <div className="editor-heading"><h2 id="backup-title">Backup wiederherstellen</h2><button type="button" className="text-button" onClick={onClose} disabled={busy}>Schließen</button></div>
      <label>ZIP-Backup
        <input type="file" accept=".zip,application/zip" disabled={busy} onChange={event => { setFile(event.target.files?.[0] ?? null); setPreview(null); setError('') }} />
      </label>
      <label>Ziel
        <select value={targetId ?? ''} disabled={busy} onChange={event => { setTargetId(event.target.value ? Number(event.target.value) : null); setPreview(null); setError('') }}>
          {allowCreate && <option value="">Als neue Veranstaltung anlegen</option>}
          {events.map(event => <option key={event.id} value={event.id}>{event.name} ersetzen</option>)}
        </select>
      </label>
      <button type="button" className="primary" disabled={!file || busy} onClick={() => void inspect()}>Vorschau prüfen</button>
      {preview && <div className="backup-preview">
        <strong>Backup: {preview.name}</strong>
        <p>{targetId === null ? 'Neue Veranstaltung' : `Ersetzt: ${targetName}`}</p>
        {targetId !== null && <p>Bestehende Session-Links können danach andere Inhalte zeigen.</p>}
        <p>{Object.entries(preview.counts).map(([name, count]) => `${name}: ${count}`).join(' · ')}</p>
        {(preview.remapped_session_ids > 0 || preview.removed_session_links > 0) && <p>Öffentliche Links: {preview.remapped_session_ids} Session-IDs werden neu vergeben; {preview.removed_session_links} bisherige Session-Links entfallen.</p>}
        <button type="button" className="danger" disabled={busy} onClick={() => void restore()}>Wiederherstellen</button>
      </div>}
      {error && <p className="backup-error" role="alert">{error}</p>}
    </section>
  </div>
}
