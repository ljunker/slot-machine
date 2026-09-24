import { useState } from 'react'
import type { FormEvent } from 'react'
import type { Event, EventDay, Room, Slot, Speaker } from './types'
import { toMinutes, toTime } from './time'
import { activeNotice, noticeLabel, previousPlanning, useNoticeNow } from './changeNotice'

export type EditorKind = 'event' | 'day' | 'room' | 'slot'

export default function Editor({ kind, event, day, room, slot, rooms, speakers, onSave, onDelete, onClose }: {
  kind: EditorKind
  event?: Event
  day?: EventDay
  room?: Room
  slot?: Slot
  rooms: Room[]
  speakers: Speaker[]
  onSave: (body: Record<string, unknown>) => Promise<boolean>
  onDelete: (() => Promise<boolean>) | null
  onClose: () => void
}) {
  const [name, setName] = useState(kind === 'event' ? event?.name ?? '' : room?.name ?? '')
  const [startDate, setStartDate] = useState(event?.start_date ?? '')
  const [endDate, setEndDate] = useState(event?.end_date ?? '')
  const [date, setDate] = useState(day?.date ?? event?.start_date ?? '')
  const [start, setStart] = useState(kind === 'slot' ? slot?.start_time.slice(0, 5) ?? day?.start_time.slice(0, 5) ?? '09:00' : day?.start_time.slice(0, 5) ?? '09:00')
  const [end, setEnd] = useState(kind === 'slot'
    ? slot?.end_time.slice(0, 5) ?? (day ? toTime(Math.min(toMinutes(day.end_time), toMinutes(day.start_time) + 60)) : '10:00')
    : day?.end_time.slice(0, 5) ?? '18:00')
  const [topic, setTopic] = useState(slot?.topic ?? '')
  const [speakerIds, setSpeakerIds] = useState<number[]>(slot?.speaker_ids ?? [])
  const [description, setDescription] = useState(slot?.description ?? '')
  const [roomId, setRoomId] = useState(slot?.room_id ?? rooms[0]?.id ?? 0)
  const [slotCancelled, setSlotCancelled] = useState(slot?.is_cancelled ?? false)
  const now = useNoticeNow(slot ? [slot] : [])
  const notice = slot ? activeNotice(slot, now) : null
  const existing = kind === 'event' ? !!event : kind === 'day' ? !!day : kind === 'room' ? !!room : !!slot
  const title = { event: 'Veranstaltung', day: 'Tag', room: 'Raum', slot: 'Slot' }[kind]

  async function submit(e: FormEvent) {
    e.preventDefault()
    let body: Record<string, unknown>
    if (kind === 'event') body = { name, start_date: startDate, end_date: endDate }
    else if (kind === 'day') body = { date, start_time: start, end_time: end }
    else if (kind === 'room') body = { name }
    else body = { topic, speaker_ids: speakerIds, description: description || null, start_time: start, end_time: end, room_id: roomId }
    if (kind === 'slot' && existing) body.is_cancelled = slotCancelled
    if (await onSave(body)) onClose()
  }

  async function remove() {
    if (!onDelete || !window.confirm(`${title} und zugehörige Daten löschen?`)) return
    if (await onDelete()) onClose()
  }

  return <aside className="editor" aria-label={`${title} ${existing ? 'bearbeiten' : 'anlegen'}`}>
    <div className="editor-heading"><h2>{title} {existing ? 'bearbeiten' : 'anlegen'}</h2><button type="button" className="text-button" onClick={onClose}>Schließen</button></div>
    <form onSubmit={submit}>
      {kind === 'slot' && notice && <p className={`editor-notice notice-${notice.type}`}><strong>{noticeLabel(notice)}</strong>{previousPlanning(notice) && <span>Vorher: {previousPlanning(notice)}</span>}</p>}
      {(kind === 'event' || kind === 'room') && <label>Name<input required maxLength={255} value={name} onChange={e => setName(e.target.value)} /></label>}
      {kind === 'event' && <><label>Startdatum<input required type="date" value={startDate} onChange={e => setStartDate(e.target.value)} /></label><label>Enddatum<input required type="date" value={endDate} onChange={e => setEndDate(e.target.value)} /></label></>}
      {kind === 'day' && <label>Datum<input required type="date" value={date} min={event?.start_date} max={event?.end_date} onChange={e => setDate(e.target.value)} /></label>}
      {kind === 'slot' && <>
        <label>Thema<input required maxLength={255} value={topic} onChange={e => setTopic(e.target.value)} /></label>
        <fieldset className="speaker-picker"><legend>Redner</legend>
          {speakers.length === 0 && <p className="muted">Lege zuerst ein Rednerprofil an.</p>}
          {speakers.map(person => <label key={person.id}><input type="checkbox" checked={speakerIds.includes(person.id)} onChange={e => setSpeakerIds(current => e.target.checked ? [...current, person.id] : current.filter(id => id !== person.id))} />{person.name}</label>)}
        </fieldset>
        <label>Beschreibung<textarea value={description} onChange={e => setDescription(e.target.value)} /></label>
        <label>Raum<select value={roomId} onChange={e => setRoomId(Number(e.target.value))}>{rooms.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      </>}
      {(kind === 'day' || kind === 'slot') && <div className="two-fields"><label>Beginn<input required type="time" value={start} onChange={e => setStart(e.target.value)} /></label><label>Ende<input required type="time" value={end} onChange={e => setEnd(e.target.value)} /></label></div>}
      {kind === 'slot' && existing && <label className="cancel-checkbox"><input type="checkbox" checked={slotCancelled} onChange={e => setSlotCancelled(e.target.checked)} />Session abgesagt</label>}
      <div className="editor-actions"><button className="primary" type="submit">Speichern</button>{onDelete && <button className="danger" type="button" onClick={remove}>Löschen</button>}</div>
    </form>
  </aside>
}
