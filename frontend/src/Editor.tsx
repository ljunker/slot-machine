import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { Category, Event, EventDay, Room, Slot, Speaker, UnplannedSession } from './types'
import { toMinutes, toTime } from './time'
import { activeNotice, noticeLabel, previousPlanning, useNoticeNow } from './changeNotice'
import { formatDate } from './date'
import { UnsavedBadge, useUnsavedChanges } from './unsavedChanges'
import { useConfirm } from './Dialog'
import { NoticeIcon } from './NoticeBadge'

export type EditorKind = 'event' | 'day' | 'room' | 'slot'

type EditorValues = {
  name: string; startDate: string; endDate: string; published: boolean; date: string; start: string; end: string
  topic: string; speakerIds: number[]; speakerRequired: boolean; categoryIds: number[]; description: string
  roomId: number; scope: 'room' | 'all_rooms'; dayId: number; planned: boolean; slotCancelled: boolean
}

/** Form values of the saved object; also the reference for detecting unsaved input. */
function initialValues(kind: EditorKind, { event, day, days, room, slot, rooms, createUnplanned }: {
  event?: Event; day?: EventDay; days: EventDay[]; room?: Room; slot?: Slot | UnplannedSession; rooms: Room[]; createUnplanned: boolean
}): EditorValues {
  return {
    name: kind === 'event' ? event?.name ?? '' : room?.name ?? '',
    startDate: event?.start_date ?? '',
    endDate: event?.end_date ?? '',
    published: event?.program_published ?? false,
    date: day?.date ?? event?.start_date ?? '',
    start: kind === 'slot' ? slot?.start_time?.slice(0, 5) ?? day?.start_time.slice(0, 5) ?? '09:00' : day?.start_time.slice(0, 5) ?? '09:00',
    end: kind === 'slot'
      ? slot?.end_time?.slice(0, 5) ?? (day ? toTime(Math.min(toMinutes(day.end_time), toMinutes(day.start_time) + 60)) : '10:00')
      : day?.end_time.slice(0, 5) ?? '18:00',
    topic: slot?.topic ?? '',
    speakerIds: slot?.speaker_ids ?? [],
    speakerRequired: slot?.speaker_required ?? true,
    categoryIds: slot?.category_ids ?? [],
    description: slot?.description ?? '',
    roomId: slot?.room_id ?? rooms[0]?.id ?? 0,
    scope: slot?.scope ?? 'room',
    dayId: slot?.day_id ?? day?.id ?? days[0]?.id ?? 0,
    planned: slot ? slot.day_id !== null : !createUnplanned,
    slotCancelled: slot?.is_cancelled ?? false,
  }
}

/** Only the fields this editor saves; hidden fields must not count as unsaved input. */
function savedFields(kind: EditorKind, values: EditorValues): Partial<EditorValues> {
  const { name, startDate, endDate, published, date, start, end, topic, speakerIds, speakerRequired, categoryIds, description, roomId, scope, dayId, planned, slotCancelled } = values
  if (kind === 'event') return { name, startDate, endDate, published }
  if (kind === 'day') return { date, start, end }
  if (kind === 'room') return { name }
  const content = { topic, speakerIds, speakerRequired, categoryIds, description, scope, planned }
  if (!planned) return content
  return { ...content, dayId, start, end, slotCancelled, ...(scope === 'room' ? { roomId } : {}) }
}

export default function Editor({ kind, event, day, days, room, slot, rooms, speakers, categories = [], createUnplanned = false, onSave, onClearRescheduledNotice, onDelete, onClose, onRequestClose = onClose }: {
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
  onRequestClose?: () => void
}) {
  const [confirm, confirmDialog] = useConfirm()
  const initial = initialValues(kind, { event, day, days, room, slot, rooms, createUnplanned })
  const [name, setName] = useState(initial.name)
  const [startDate, setStartDate] = useState(initial.startDate)
  const [endDate, setEndDate] = useState(initial.endDate)
  const [published, setPublished] = useState(initial.published)
  const [date, setDate] = useState(initial.date)
  const [start, setStart] = useState(initial.start)
  const [end, setEnd] = useState(initial.end)
  const [topic, setTopic] = useState(initial.topic)
  const [speakerIds, setSpeakerIds] = useState<number[]>(initial.speakerIds)
  const [speakerRequired, setSpeakerRequired] = useState(initial.speakerRequired)
  const [categoryIds, setCategoryIds] = useState<number[]>(initial.categoryIds)
  const [description, setDescription] = useState(initial.description)
  const [roomId, setRoomId] = useState(initial.roomId)
  const [scope, setScope] = useState<'room' | 'all_rooms'>(initial.scope)
  const [dayId, setDayId] = useState(initial.dayId)
  const [planned, setPlanned] = useState(initial.planned)
  const [slotCancelled, setSlotCancelled] = useState(initial.slotCancelled)
  const [clearingNotice, setClearingNotice] = useState(false)
  const now = useNoticeNow(slot ? [slot] : [])
  const notice = slot ? activeNotice(slot, now) : null
  const existing = kind === 'event' ? !!event : kind === 'day' ? !!day : kind === 'room' ? !!room : !!slot
  const title = { event: 'Veranstaltung', day: 'Tag', room: 'Raum', slot: 'Session' }[kind]

  const form = useRef<HTMLFormElement>(null)
  const { dirty, save } = useUnsavedChanges(savedFields(kind, {
    name, startDate, endDate, published, date, start, end, topic, speakerIds, speakerRequired, categoryIds,
    description, roomId, scope, dayId, planned, slotCancelled,
  }), savedFields(kind, initial), persist)

  function submit(e: FormEvent) {
    e.preventDefault()
    void save()
  }

  async function persist(): Promise<boolean> {
    if (form.current && !form.current.reportValidity()) return false
    let body: Record<string, unknown>
    if (kind === 'event') body = { name, start_date: startDate, end_date: endDate, program_published: published }
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
    if (!await onSave(body)) return false
    onClose()
    return true
  }

  async function remove() {
    if (!onDelete) return
    const name = kind === 'event' ? event?.name : kind === 'room' ? room?.name : kind === 'slot' ? slot?.topic : day ? formatDate(day.date) : undefined
    if (!await confirm({
      title: `${title} löschen?`,
      message: kind === 'event'
        ? `„${name}“ wird mit allen Tagen, Räumen, Sessions, Diensten und Bildern endgültig gelöscht.`
        : `${name ? `„${name}“` : title} und zugehörige Daten werden endgültig gelöscht.`,
      confirmLabel: `${title} löschen`,
      requireText: kind === 'event' ? name : undefined,
    })) return
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
    <div className="editor-heading"><h2>{title} {existing ? 'bearbeiten' : 'anlegen'}<UnsavedBadge dirty={dirty} /></h2><button type="button" className="text-button" onClick={onRequestClose}>Schließen</button></div>
    <form ref={form} onSubmit={submit}>
      {kind === 'slot' && notice && <p className={`editor-notice notice-${notice.type}`}><strong><NoticeIcon notice={notice} />{noticeLabel(notice)}</strong>{previousPlanning(notice) && <span>Vorher: {previousPlanning(notice)}</span>}{notice.type === 'rescheduled' && onClearRescheduledNotice && <button type="button" className="text-button" disabled={clearingNotice} onClick={() => void clearRescheduledNotice()}>Verschoben entfernen</button>}</p>}
      {(kind === 'event' || kind === 'room') && <label>Name<input required maxLength={255} value={name} onChange={e => setName(e.target.value)} /></label>}
      {kind === 'event' && <>
        <label>Startdatum<input required type="date" value={startDate} onChange={e => setStartDate(e.target.value)} /></label>
        <label>Enddatum<input required type="date" value={endDate} onChange={e => setEndDate(e.target.value)} /></label>
        <label className="cancel-checkbox"><input type="checkbox" checked={published} onChange={e => setPublished(e.target.checked)} />Programm veröffentlicht</label>
        <p className="muted">Erst nach der Veröffentlichung markieren Besucherprogramm und PDF verschobene und geänderte Sessions 24 Stunden lang. Vorher entstehen beim Planen keine Markierungen.</p>
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
      <div className="editor-actions"><button className="primary" type="submit">Speichern</button>{onDelete && <button className="danger" type="button" onClick={() => void remove()}>Löschen</button>}</div>
    </form>
    {confirmDialog}
  </aside>
}
