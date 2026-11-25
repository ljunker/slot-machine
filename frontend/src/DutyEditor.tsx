import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import DutySignup from './DutySignup'
import { formatDate } from './date'
import type { Duty, DutyKind, EventDay, DutyParticipant, Room, Slot, UnplannedSession } from './types'
import { UnsavedBadge, useUnsavedChanges } from './unsavedChanges'

/** Form values of the saved duty; also the reference for detecting unsaved input. */
function initialValues(duty: Duty | undefined, days: EventDay[], selectedDay: EventDay | undefined, rooms: Room[], sessions: (Slot | UnplannedSession)[]) {
  const dayId = duty?.day_id ?? selectedDay?.id ?? days[0]?.id ?? 0
  const day = days.find(item => item.id === dayId)
  return {
    kind: duty?.kind ?? 'general' as DutyKind,
    capacity: duty?.capacity ?? 1,
    title: duty?.title ?? '',
    helperIds: duty?.user_ids ?? [],
    dayId,
    roomId: duty?.room_id ?? rooms[0]?.id ?? 0,
    slotId: duty?.slot_id ?? sessions[0]?.id ?? 0,
    start: duty?.start_time?.slice(0, 5) ?? day?.start_time.slice(0, 5) ?? '09:00',
    end: duty?.end_time?.slice(0, 5) ?? day?.end_time.slice(0, 5) ?? '18:00',
  }
}

/** Only the fields a duty of this kind saves; hidden fields must not count as unsaved input. */
function savedFields({ kind, capacity, title, helperIds, dayId, roomId, slotId, start, end }: ReturnType<typeof initialValues>) {
  const base = { kind, capacity, title: title.trim(), helperIds: [...helperIds].sort((a, b) => a - b) }
  if (kind === 'session') return { ...base, slotId }
  return { ...base, dayId, start, end, ...(kind === 'room' ? { roomId } : {}) }
}

export default function DutyEditor({ duty, days, selectedDay, rooms, sessions, helpers, onSave, onDelete, onClose, onRequestClose = onClose, currentUserId, onSignup }: {
  currentUserId: number
  onSignup: (duty: Duty, leave: boolean) => Promise<void>
  duty?: Duty
  days: EventDay[]
  selectedDay?: EventDay
  rooms: Room[]
  sessions: (Slot | UnplannedSession)[]
  helpers: DutyParticipant[]
  onSave: (body: Record<string, unknown>) => Promise<boolean>
  onDelete: (() => Promise<boolean>) | null
  onClose: () => void
  onRequestClose?: () => void
}) {
  const initial = initialValues(duty, days, selectedDay, rooms, sessions)
  const [kind, setKind] = useState<DutyKind>(initial.kind)
  const [capacity, setCapacity] = useState(initial.capacity)
  const [title, setTitle] = useState(initial.title)
  const [helperIds, setHelperIds] = useState<number[]>(initial.helperIds)
  useEffect(() => { setHelperIds(duty?.user_ids ?? []) }, [duty])
  const availableHelpers = [...helpers, ...(duty?.users ?? []).filter(user => !helpers.some(person => person.id === user.id)).map(user => ({ ...user, email: user.is_active ? '' : 'gesperrt' }))]
  const [dayId, setDayId] = useState(initial.dayId)
  const [roomId, setRoomId] = useState(initial.roomId)
  const [slotId, setSlotId] = useState(initial.slotId)
  const [start, setStart] = useState(initial.start)
  const [end, setEnd] = useState(initial.end)
  const form = useRef<HTMLFormElement>(null)
  const { dirty, save } = useUnsavedChanges(
    savedFields({ kind, capacity, title, helperIds, dayId, roomId, slotId, start, end }),
    savedFields(initial),
    persist,
  )
  const availableSessions = duty?.slot_id && !sessions.some(session => session.id === duty.slot_id)
    ? [{ id: duty.slot_id, topic: duty.session_topic ?? 'Session' }, ...sessions]
    : sessions

  function submit(event: FormEvent) {
    event.preventDefault()
    void save()
  }

  async function persist(): Promise<boolean> {
    if (form.current && !form.current.reportValidity()) return false
    const body = {
      kind, capacity, title: title.trim() || null, user_ids: helperIds,
      day_id: kind === 'session' ? null : dayId,
      room_id: kind === 'room' ? roomId : null,
      slot_id: kind === 'session' ? slotId : null,
      start_time: kind === 'session' ? null : start,
      end_time: kind === 'session' ? null : end,
    }
    if (!await onSave(body)) return false
    onClose()
    return true
  }

  async function remove() {
    if (onDelete && window.confirm('Dienst löschen?')) {
      if (await onDelete()) onClose()
    }
  }

  return <aside className="editor" aria-label={`Dienst ${duty ? 'bearbeiten' : 'anlegen'}`}>
    <div className="editor-heading"><h2>Dienst {duty ? 'bearbeiten' : 'anlegen'}<UnsavedBadge dirty={dirty} /></h2><button type="button" className="text-button" onClick={onRequestClose}>Schließen</button></div>
    {duty && <DutySignup duty={duty} currentUserId={currentUserId} onSignup={onSignup} />}
    <form ref={form} onSubmit={submit}>
      <label>Höchstzahl Helfer<input type="number" required min={1} max={2147483647} step={1} value={capacity} onChange={event => setCapacity(Number(event.target.value))} /></label>
      <label>Dienstart<select aria-label="Dienstart" value={kind} onChange={event => setKind(event.target.value as DutyKind)}>
        <option value="general">Allgemeiner Dienst</option><option value="room">Raumdienst</option><option value="session">Session-Dienst</option>
      </select></label>
      <label>Titel (optional)<input maxLength={255} value={title} onChange={event => setTitle(event.target.value)} /></label>
      <fieldset className="speaker-picker"><legend>Helfer</legend>
        {availableHelpers.length === 0 && <p className="muted">Noch keine aktiven Teamkonten mit Namen vorhanden. Dienst bleibt offen.</p>}
        {availableHelpers.map(person => <label key={person.id}><input type="checkbox" checked={helperIds.includes(person.id)} onChange={event => setHelperIds(current => event.target.checked ? [...current, person.id] : current.filter(id => id !== person.id))} />{person.name} · {person.email}</label>)}
      </fieldset>
      {kind === 'session' ? <label>Session<select aria-label="Session" required value={slotId || ''} onChange={event => setSlotId(Number(event.target.value))}>
        {availableSessions.length === 0 && <option value="">Keine Session vorhanden</option>}
        {availableSessions.map(session => <option key={session.id} value={session.id}>{session.topic}</option>)}
      </select></label> : <>
        <label>Veranstaltungstag<select aria-label="Veranstaltungstag" required value={dayId || ''} onChange={event => {
          const selected = days.find(day => day.id === Number(event.target.value))
          setDayId(Number(event.target.value))
          if (selected) { setStart(selected.start_time.slice(0, 5)); setEnd(selected.end_time.slice(0, 5)) }
        }}>{days.map(day => <option key={day.id} value={day.id}>{formatDate(day.date)}</option>)}</select></label>
        {kind === 'room' && <label>Raum<select aria-label="Raum" required value={roomId || ''} onChange={event => setRoomId(Number(event.target.value))}>
          {rooms.map(room => <option key={room.id} value={room.id}>{room.name}</option>)}
        </select></label>}
        <div className="two-fields"><label>Beginn<input required type="time" value={start} onChange={event => setStart(event.target.value)} /></label><label>Ende<input required type="time" value={end} onChange={event => setEnd(event.target.value)} /></label></div>
      </>}
      <div className="editor-actions"><button className="primary" type="submit">Speichern</button>{onDelete && <button className="danger" type="button" onClick={remove}>Löschen</button>}</div>
    </form>
  </aside>
}
