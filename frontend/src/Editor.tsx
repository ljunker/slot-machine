import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { Category, Event, EventDay, Room, Slot, Speaker, UnplannedSession } from './types'
import { toMinutes, toTime } from './time'
import { activeNotice, noticeLabel, previousPlanning, useNoticeNow } from './changeNotice'
import { formatDate } from './date'

export type EditorKind = 'event' | 'day' | 'room' | 'slot'

export default function Editor({ kind, event, day, days, room, slot, rooms, speakers, categories = [], createUnplanned = false, onSave, onClearRescheduledNotice, onDelete, onClose }: {
  kind: EditorKind
  event?: Event
  day?: EventDay
  days: EventDay[]
  room?: Room
  slot?: Slot | UnplannedSession
  rooms: Room[]
  speakers: Speaker[]
  categories?: Category[]
  createUnplanned?: boolean
  onSave: (body: Record<string, unknown>) => Promise<boolean>
  onClearRescheduledNotice?: (() => Promise<void>) | null
  onDelete: (() => Promise<boolean>) | null
  onClose: () => void
}) {
  const [name, setName] = useState(kind === 'event' ? event?.name ?? '' : room?.name ?? '')
  const [startDate, setStartDate] = useState(event?.start_date ?? '')
  const [endDate, setEndDate] = useState(event?.end_date ?? '')
  const [date, setDate] = useState(day?.date ?? event?.start_date ?? '')
  const [start, setStart] = useState(kind === 'slot' ? slot?.start_time?.slice(0, 5) ?? day?.start_time.slice(0, 5) ?? '09:00' : day?.start_time.slice(0, 5) ?? '09:00')
  const [end, setEnd] = useState(kind === 'slot'
    ? slot?.end_time?.slice(0, 5) ?? (day ? toTime(Math.min(toMinutes(day.end_time), toMinutes(day.start_time) + 60)) : '10:00')
    : day?.end_time.slice(0, 5) ?? '18:00')
  const [topic, setTopic] = useState(slot?.topic ?? '')
  const [speakerIds, setSpeakerIds] = useState<number[]>(slot?.speaker_ids ?? [])
  const [speakerRequired, setSpeakerRequired] = useState(slot?.speaker_required ?? true)
  const [categoryIds, setCategoryIds] = useState<number[]>(slot?.category_ids ?? [])
  const [description, setDescription] = useState(slot?.description ?? '')
  const [roomId, setRoomId] = useState(slot?.room_id ?? rooms[0]?.id ?? 0)
  const [scope, setScope] = useState<'room' | 'all_rooms'>(slot?.scope ?? 'room')
  const [dayId, setDayId] = useState(slot?.day_id ?? day?.id ?? days[0]?.id ?? 0)
  const [planned, setPlanned] = useState(slot ? slot.day_id !== null : !createUnplanned)
  const [slotCancelled, setSlotCancelled] = useState(slot?.is_cancelled ?? false)
  const [clearingNotice, setClearingNotice] = useState(false)
  const now = useNoticeNow(slot ? [slot] : [])
  const notice = slot ? activeNotice(slot, now) : null
  const existing = kind === 'event' ? !!event : kind === 'day' ? !!day : kind === 'room' ? !!room : !!slot
  const title = kind === 'slot' && (createUnplanned || slot?.day_id === null) ? 'Session' : { event: 'Veranstaltung', day: 'Tag', room: 'Raum', slot: 'Slot' }[kind]

  async function submit(e: FormEvent) {
    e.preventDefault()
    let body: Record<string, unknown>
    if (kind === 'event') body = { name, start_date: startDate, end_date: endDate }
    else if (kind === 'day') body = { date, start_time: start, end_time: end }
    else if (kind === 'room') body = { name }
    else body = {
      topic, speaker_ids: speakerIds, speaker_required: speakerRequired, category_ids: categoryIds, description: description || null,
      day_id: planned ? dayId : null,
      scope,
      room_id: planned && scope === 'room' ? roomId : null,
      start_time: planned ? start : null,
      end_time: planned ? end : null,
    }
    if (kind === 'slot' && existing && planned) body.is_cancelled = slotCancelled
    if (await onSave(body)) onClose()
  }

  async function remove() {
    if (!onDelete || !window.confirm(`${title} und zugehörige Daten löschen?`)) return
    if (await onDelete()) onClose()
  }

  async function clearRescheduledNotice() {
    if (!onClearRescheduledNotice) return
    setClearingNotice(true)
    try {
      await onClearRescheduledNotice()
    } finally {
      setClearingNotice(false)
    }
  }

  return <aside className="editor" aria-label={`${title} ${existing ? 'bearbeiten' : 'anlegen'}`}>
    <div className="editor-heading"><h2>{title} {existing ? 'bearbeiten' : 'anlegen'}</h2><button type="button" className="text-button" onClick={onClose}>Schließen</button></div>
    <form onSubmit={submit}>
      {kind === 'slot' && notice && <p className={`editor-notice notice-${notice.type}`}><strong>{noticeLabel(notice)}</strong>{previousPlanning(notice) && <span>Vorher: {previousPlanning(notice)}</span>}{notice.type === 'rescheduled' && onClearRescheduledNotice && <button type="button" className="text-button" disabled={clearingNotice} onClick={() => void clearRescheduledNotice()}>Verschoben entfernen</button>}</p>}
      {(kind === 'event' || kind === 'room') && <label>Name<input required maxLength={255} value={name} onChange={e => setName(e.target.value)} /></label>}
      {kind === 'event' && <>
        <label>Startdatum<input required type="date" value={startDate} onChange={e => setStartDate(e.target.value)} /></label>
        <label>Enddatum<input required type="date" value={endDate} onChange={e => setEndDate(e.target.value)} /></label>
        <p className="muted">Farben, Logo, Grafiken, Partnerlogos und Infoblöcke für Besucherprogramm und PDF unter „Besucherprogramm gestalten“ in der Seitenleiste.</p>
      </>}
      {kind === 'day' && <label>Datum<input required type="date" value={date} min={event?.start_date} max={event?.end_date} onChange={e => setDate(e.target.value)} /></label>}
      {kind === 'slot' && <>
        <label>Thema<input required maxLength={255} value={topic} onChange={e => setTopic(e.target.value)} /></label>
        <fieldset className="speaker-picker"><legend>Redner</legend>
          <label><input type="checkbox" checked={speakerRequired} onChange={e => setSpeakerRequired(e.target.checked)} />Redner erforderlich</label>
          {speakers.length === 0 && <p className="muted">Lege zuerst ein Rednerprofil an.</p>}
          {speakers.map(person => <label key={person.id}><input type="checkbox" checked={speakerIds.includes(person.id)} onChange={e => setSpeakerIds(current => e.target.checked ? [...current, person.id] : current.filter(id => id !== person.id))} />{person.name}</label>)}
        </fieldset>
        <fieldset className="speaker-picker"><legend>Kategorien</legend>
          {categories.length === 0 && <p className="muted">Noch keine Kategorien angelegt.</p>}
          {categories.map(category => <label key={category.id}><input type="checkbox" checked={categoryIds.includes(category.id)} onChange={event => setCategoryIds(current => event.target.checked ? [...current, category.id] : current.filter(id => id !== category.id))} /><span className="category-dot" style={{ backgroundColor: category.color }} />{category.name}</label>)}
        </fieldset>
        <label>Beschreibung<textarea value={description} onChange={e => setDescription(e.target.value)} /></label>
        <label>Geltungsbereich<select value={scope} onChange={e => setScope(e.target.value as 'room' | 'all_rooms')}>
          <option value="room">Einzelner Raum</option><option value="all_rooms">Alle Räume</option>
        </select></label>
        {planned && <>
          <label>Veranstaltungstag<select value={dayId} onChange={e => setDayId(Number(e.target.value))}>{days.map(item => <option key={item.id} value={item.id}>{formatDate(item.date)}</option>)}</select></label>
          {scope === 'room' && <label>Raum<select aria-label="Raum" required value={roomId || ''} onChange={e => setRoomId(Number(e.target.value))}>
            {rooms.length === 0 && <option value="">Zuerst einen Raum anlegen</option>}
            {rooms.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
        </>}
        {!planned && days.length > 0 && (scope === 'all_rooms' || rooms.length > 0) && <button type="button" className="text-button planning-toggle" onClick={() => setPlanned(true)}>Einplanen</button>}
        {planned && <button type="button" className="text-button planning-toggle" onClick={() => setPlanned(false)}>{slot ? 'Planung entfernen' : 'Nicht einplanen'}</button>}
        {!planned && (days.length === 0 || scope === 'room' && rooms.length === 0) && <p className="muted">Zum Einplanen zuerst Tag{scope === 'room' ? ' und Raum' : ''} anlegen.</p>}
      </>}
      {(kind === 'day' || (kind === 'slot' && planned)) && <div className="two-fields"><label>Beginn<input required type="time" value={start} onChange={e => setStart(e.target.value)} /></label><label>Ende<input required type="time" value={end} onChange={e => setEnd(e.target.value)} /></label></div>}
      {kind === 'slot' && existing && planned && <label className="cancel-checkbox"><input type="checkbox" checked={slotCancelled} onChange={e => setSlotCancelled(e.target.checked)} />Session abgesagt</label>}
      <div className="editor-actions"><button className="primary" type="submit">Speichern</button>{onDelete && <button className="danger" type="button" onClick={remove}>Löschen</button>}</div>
    </form>
  </aside>
}
