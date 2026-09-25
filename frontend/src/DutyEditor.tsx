import { useState } from 'react'
import type { FormEvent } from 'react'
import type { Duty, DutyKind, EventDay, Helper, Room, Slot, UnplannedSession } from './types'

export default function DutyEditor({ duty, days, selectedDay, rooms, sessions, helpers, onSave, onDelete, onClose }: {
  duty?: Duty
  days: EventDay[]
  selectedDay?: EventDay
  rooms: Room[]
  sessions: (Slot | UnplannedSession)[]
  helpers: Helper[]
  onSave: (body: Record<string, unknown>) => Promise<boolean>
  onDelete: (() => Promise<boolean>) | null
  onClose: () => void
}) {
  const [kind, setKind] = useState<DutyKind>(duty?.kind ?? 'general')
  const [title, setTitle] = useState(duty?.title ?? '')
  const [helperIds, setHelperIds] = useState<number[]>(duty?.helper_ids ?? [])
  const [dayId, setDayId] = useState(duty?.day_id ?? selectedDay?.id ?? days[0]?.id ?? 0)
  const [roomId, setRoomId] = useState(duty?.room_id ?? rooms[0]?.id ?? 0)
  const [slotId, setSlotId] = useState(duty?.slot_id ?? sessions[0]?.id ?? 0)
  const initialDay = days.find(day => day.id === dayId)
  const [start, setStart] = useState(duty?.start_time?.slice(0, 5) ?? initialDay?.start_time.slice(0, 5) ?? '09:00')
  const [end, setEnd] = useState(duty?.end_time?.slice(0, 5) ?? initialDay?.end_time.slice(0, 5) ?? '18:00')
  const availableSessions = duty?.slot_id && !sessions.some(session => session.id === duty.slot_id)
    ? [{ id: duty.slot_id, topic: duty.session_topic ?? 'Session' }, ...sessions]
    : sessions

  async function submit(event: FormEvent) {
    event.preventDefault()
    const body = {
      kind, title: title.trim() || null, helper_ids: helperIds,
      day_id: kind === 'session' ? null : dayId,
      room_id: kind === 'room' ? roomId : null,
      slot_id: kind === 'session' ? slotId : null,
      start_time: kind === 'session' ? null : start,
      end_time: kind === 'session' ? null : end,
    }
    if (await onSave(body)) onClose()
  }

  async function remove() {
    if (onDelete && window.confirm('Dienst löschen?')) {
      if (await onDelete()) onClose()
    }
  }

  return <aside className="editor" aria-label={`Dienst ${duty ? 'bearbeiten' : 'anlegen'}`}>
    <div className="editor-heading"><h2>Dienst {duty ? 'bearbeiten' : 'anlegen'}</h2><button type="button" className="text-button" onClick={onClose}>Schließen</button></div>
    <form onSubmit={submit}>
      <label>Dienstart<select aria-label="Dienstart" value={kind} onChange={event => setKind(event.target.value as DutyKind)}>
        <option value="general">Allgemeiner Dienst</option><option value="room">Raumdienst</option><option value="session">Session-Dienst</option>
      </select></label>
      <label>Titel (optional)<input maxLength={255} value={title} onChange={event => setTitle(event.target.value)} /></label>
      <fieldset className="speaker-picker"><legend>Helfer</legend>
        {helpers.length === 0 && <p className="muted">Noch keine Helfer angelegt. Dienst bleibt offen.</p>}
        {helpers.map(person => <label key={person.id}><input type="checkbox" checked={helperIds.includes(person.id)} onChange={event => setHelperIds(current => event.target.checked ? [...current, person.id] : current.filter(id => id !== person.id))} />{person.name}</label>)}
      </fieldset>
      {kind === 'session' ? <label>Session<select aria-label="Session" required value={slotId || ''} onChange={event => setSlotId(Number(event.target.value))}>
        {availableSessions.length === 0 && <option value="">Keine Session vorhanden</option>}
        {availableSessions.map(session => <option key={session.id} value={session.id}>{session.topic}</option>)}
      </select></label> : <>
        <label>Veranstaltungstag<select aria-label="Veranstaltungstag" required value={dayId || ''} onChange={event => {
          const selected = days.find(day => day.id === Number(event.target.value))
          setDayId(Number(event.target.value))
          if (selected) { setStart(selected.start_time.slice(0, 5)); setEnd(selected.end_time.slice(0, 5)) }
        }}>{days.map(day => <option key={day.id} value={day.id}>{day.date}</option>)}</select></label>
        {kind === 'room' && <label>Raum<select aria-label="Raum" required value={roomId || ''} onChange={event => setRoomId(Number(event.target.value))}>
          {rooms.map(room => <option key={room.id} value={room.id}>{room.name}</option>)}
        </select></label>}
        <div className="two-fields"><label>Beginn<input required type="time" value={start} onChange={event => setStart(event.target.value)} /></label><label>Ende<input required type="time" value={end} onChange={event => setEnd(event.target.value)} /></label></div>
      </>}
      <div className="editor-actions"><button className="primary" type="submit">Speichern</button>{onDelete && <button className="danger" type="button" onClick={remove}>Löschen</button>}</div>
    </form>
  </aside>
}
