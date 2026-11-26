import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { request } from './api'
import { formatDate } from './date'
import type { Speaker, SpeakerDetail } from './types'
import { UnsavedBadge, useUnsavedChanges } from './unsavedChanges'
import { useConfirm } from './Dialog'

export default function SpeakerEditor({ speaker, onSave, onDelete, onDeletePhoto, onClose, onRequestClose = onClose }: {
  speaker?: Speaker
  onSave: (body: { name: string; bio: string | null; website: string | null }, photo: File | null) => Promise<boolean>
  onDelete: (() => Promise<boolean>) | null
  onDeletePhoto: (() => Promise<void>) | null
  onClose: () => void
  onRequestClose?: () => void
}) {
  const [confirm, confirmDialog] = useConfirm()
  const [name, setName] = useState(speaker?.name ?? '')
  const [bio, setBio] = useState(speaker?.bio ?? '')
  const [website, setWebsite] = useState(speaker?.website ?? '')
  const [photo, setPhoto] = useState<File | null>(null)
  const [detail, setDetail] = useState<SpeakerDetail | null>(null)
  const [detailError, setDetailError] = useState('')

  useEffect(() => {
    if (!speaker) return
    setName(speaker.name)
    setBio(speaker.bio ?? '')
    setWebsite(speaker.website ?? '')
  }, [speaker?.id])

  useEffect(() => {
    if (!speaker) return
    let active = true
    request<SpeakerDetail>(`/speakers/${speaker.id}`).then(data => {
      if (active) setDetail(data)
    }).catch((cause: Error) => { if (active) setDetailError(cause.message) })
    return () => { active = false }
  }, [speaker])

  const form = useRef<HTMLFormElement>(null)
  const { dirty, save } = useUnsavedChanges(
    { name, bio, website, photo: photo?.name ?? null },
    { name: speaker?.name ?? '', bio: speaker?.bio ?? '', website: speaker?.website ?? '', photo: null },
    persist,
  )

  function submit(event: FormEvent) {
    event.preventDefault()
    void save()
  }

  async function persist(): Promise<boolean> {
    if (form.current && !form.current.reportValidity()) return false
    if (!await onSave({ name, bio: bio || null, website: website || null }, photo)) return false
    onClose()
    return true
  }

  async function remove() {
    if (onDelete && await confirm({ title: 'Rednerprofil löschen?', message: 'Zugeordnete Sessions verlieren diesen Redner.', confirmLabel: 'Rednerprofil löschen' })) {
      if (await onDelete()) onClose()
    }
  }

  return <aside className="editor" aria-label={`Redner ${speaker ? 'bearbeiten' : 'anlegen'}`}>
    <div className="editor-heading"><h2>Redner {speaker ? 'bearbeiten' : 'anlegen'}<UnsavedBadge dirty={dirty} /></h2><button type="button" className="text-button" onClick={onRequestClose}>Schließen</button></div>
    <form ref={form} onSubmit={submit}>
      <label>Name<input required maxLength={255} value={name} onChange={event => setName(event.target.value)} /></label>
      <label>Kurzbeschreibung<textarea value={bio} onChange={event => setBio(event.target.value)} /></label>
      <label>Website<input type="url" value={website} onChange={event => setWebsite(event.target.value)} /></label>
      <label>Foto (JPEG, PNG oder WebP; maximal 5 MB)<input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => setPhoto(event.target.files?.[0] ?? null)} /></label>
      {speaker?.photo_url && <div className="speaker-photo"><img src={speaker.photo_url} alt={`Foto von ${speaker.name}`} /><button type="button" className="text-button" onClick={() => void onDeletePhoto?.()}>Foto entfernen</button></div>}
      <div className="editor-actions"><button className="primary" type="submit">Speichern</button>{onDelete && <button className="danger" type="button" onClick={() => void remove()}>Löschen</button>}</div>
    </form>
    {speaker && <section className="speaker-sessions"><h3>Sessions</h3>
      {detailError && <p role="alert">{detailError}</p>}
      {detail && (detail.sessions.length ? <ul>{detail.sessions.map(session => <li key={session.id}>{session.day_id === null || session.date === null ? 'Ungeplant' : `${formatDate(session.date)} · ${session.start_time?.slice(0, 5)}–${session.end_time?.slice(0, 5)} · ${session.room_name}`}: {session.topic}</li>)}</ul> : <p className="muted">Noch keine Sessions</p>)}
    </section>}
    {confirmDialog}
  </aside>
}
