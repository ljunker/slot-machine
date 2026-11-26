import { useState } from 'react'
import { csrfHeaders } from './api'
import type { Event } from './types'
import Dialog, { useConfirm } from './Dialog'
import InlineMessage from './InlineMessage'
import Icon from './Icon'

type Preview = {
  name: string
  warnings?: string[]
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

/** Ein Ort für beides: Sicherung der gewählten Veranstaltung herunterladen und eine Sicherung wiederherstellen. */
export default function BackupRestore({ events, selectedEventId, downloadEvent, allowCreate = true, onComplete, onClose }: {
  events: Event[]
  selectedEventId: number | null
  /** Veranstaltung, deren Sicherung heruntergeladen werden darf. */
  downloadEvent?: Event
  allowCreate?: boolean
  onComplete: (eventId: number, warnings?: string[]) => Promise<void>
  onClose: () => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [targetId, setTargetId] = useState<number | null>(selectedEventId)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirm, confirmDialog] = useConfirm()
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
    const confirmed = await confirm(targetId === null ? {
      title: 'Als neue Veranstaltung wiederherstellen?',
      message: `Aus der Sicherung „${preview.name}“ entsteht eine neue Veranstaltung.`,
      confirmLabel: 'Wiederherstellung starten',
      danger: false,
    } : {
      title: 'Veranstaltung ersetzen?',
      message: `„${targetName}“ wird vollständig durch die Sicherung „${preview.name}“ ersetzt. Alle zugehörigen Daten und Bilder werden überschrieben.`,
      confirmLabel: 'Veranstaltung ersetzen',
      requireText: targetName,
    })
    if (!confirmed) return
    setBusy(true)
    setError('')
    try {
      const result = await sendBackup('restore', file, targetId)
      if (result.event_id === undefined) throw new Error('Die Wiederherstellung lieferte keine Veranstaltung')
      await onComplete(result.event_id, result.warnings ?? [])
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return <Dialog labelledBy="backup-title" closeDisabled={busy} onClose={onClose}>
      <div className="editor-heading"><h2 id="backup-title">Sicherung &amp; Wiederherstellung</h2><button type="button" className="text-button" onClick={onClose} disabled={busy}>Schließen</button></div>
      {downloadEvent && <section className="backup-section" aria-labelledby="backup-download-title">
        <h3 id="backup-download-title">Sicherung herunterladen</h3>
        <p className="muted">ZIP-Datei mit allen Daten und Bildern von „{downloadEvent.name}“.</p>
        <a className="secondary button-link" href={`/api/backups/events/${downloadEvent.id}`} download><Icon name="download" />Sicherung herunterladen</a>
      </section>}
      <h3 className="backup-section-title">Sicherung wiederherstellen</h3>
      <label>Sicherungsdatei (ZIP)
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
        {preview.warnings?.map(warning => <p role="status" key={warning}>{warning}</p>)}
        <strong>Sicherung: {preview.name}</strong>
        <p>{targetId === null ? 'Neue Veranstaltung' : `Ersetzt: ${targetName}`}</p>
        {targetId !== null && <p>Bestehende Session-Links können danach andere Inhalte zeigen.</p>}
        <p>{Object.entries(preview.counts).map(([name, count]) => `${name}: ${count}`).join(' · ')}</p>
        {(preview.remapped_session_ids > 0 || preview.removed_session_links > 0) && <p>Öffentliche Links: {preview.remapped_session_ids} Session-IDs werden neu vergeben; {preview.removed_session_links} bisherige Session-Links entfallen.</p>}
        <button type="button" className="danger" disabled={busy} onClick={() => void restore()}>Wiederherstellen</button>
      </div>}
      {busy && <InlineMessage>{preview ? 'Stelle Sicherung wieder her …' : 'Prüfe Sicherung …'}</InlineMessage>}
      {error && <InlineMessage tone="error">{error}</InlineMessage>}
      {confirmDialog}
  </Dialog>
}
