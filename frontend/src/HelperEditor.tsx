import { useState } from 'react'
import type { FormEvent } from 'react'
import type { Duty, Helper } from './types'

export default function HelperEditor({ helper, duties, onSave, onDelete, onEditDuty, onClose }: {
  helper?: Helper
  duties: Duty[]
  onSave: (name: string) => Promise<boolean>
  onDelete: (() => Promise<boolean>) | null
  onEditDuty: (duty: Duty) => void
  onClose: () => void
}) {
  const [name, setName] = useState(helper?.name ?? '')

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (await onSave(name)) onClose()
  }

  async function remove() {
    if (onDelete && window.confirm('Helfer löschen? Seine Dienste bleiben bestehen und können offen werden.')) {
      if (await onDelete()) onClose()
    }
  }

  return <aside className="editor" aria-label={`Helfer ${helper ? 'bearbeiten' : 'anlegen'}`}>
    <div className="editor-heading"><h2>Helfer {helper ? 'bearbeiten' : 'anlegen'}</h2><button type="button" className="text-button" onClick={onClose}>Schließen</button></div>
    <form onSubmit={submit}>
      <label>Name<input required maxLength={255} value={name} onChange={event => setName(event.target.value)} /></label>
      <div className="editor-actions"><button className="primary" type="submit">Speichern</button>{onDelete && <button className="danger" type="button" onClick={remove}>Löschen</button>}</div>
    </form>
    {helper && <section className="helper-duties"><h3>Dienste</h3>
      {duties.length === 0 ? <p className="muted">Noch keine Dienste</p> : <ul>{duties.map(duty => <li key={duty.id}>
        <button type="button" onClick={() => onEditDuty(duty)}>
          {duty.date ?? 'Ohne Tag'} · {duty.status === 'active' ? `${duty.start_time?.slice(0, 5)}–${duty.end_time?.slice(0, 5)}` : duty.status === 'cancelled' ? 'Abgesagt' : 'Ungeplant'} · {duty.title || duty.session_topic || (duty.kind === 'room' ? 'Raumdienst' : 'Allgemeiner Dienst')}{duty.title && duty.session_topic ? `: ${duty.session_topic}` : ''}
          {duty.status !== 'active' && <small>{duty.status === 'cancelled' ? 'Abgesagt' : 'Ungeplant'}</small>}
        </button>
      </li>)}</ul>}
    </section>}
  </aside>
}
