import { useEffect, useRef, useState } from 'react'
import { request, uploadPhoto, write } from './api'
import Editor from './Editor'
import type { EditorKind } from './Editor'
import Schedule from './Schedule'
import SpeakerEditor from './SpeakerEditor'
import type { DaySchedule, Event, EventDay, Room, Slot, Speaker } from './types'

type Panel = { kind: EditorKind | 'speaker'; id: number | null }

export default function App() {
  const [events, setEvents] = useState<Event[]>([])
  const [eventId, setEventId] = useState<number | null>(null)
  const [days, setDays] = useState<EventDay[]>([])
  const [dayId, setDayId] = useState<number | null>(null)
  const [rooms, setRooms] = useState<Room[]>([])
  const [speakers, setSpeakers] = useState<Speaker[]>([])
  const [schedule, setSchedule] = useState<DaySchedule | null>(null)
  const [panel, setPanel] = useState<Panel | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const loadNumber = useRef(0)

  async function loadAll(preferredEvent: number | null, preferredDay: number | null) {
    const number = ++loadNumber.current
    setLoading(true)
    try {
      const eventList = await request<Event[]>('/events')
      const selectedEvent = eventList.find(item => item.id === preferredEvent)?.id ?? eventList[0]?.id ?? null
      const [dayList, roomList, speakerList] = selectedEvent === null
        ? [[], [], []] as [EventDay[], Room[], Speaker[]]
        : await Promise.all([
          request<EventDay[]>(`/events/${selectedEvent}/days`),
          request<Room[]>(`/events/${selectedEvent}/rooms`),
          request<Speaker[]>(`/events/${selectedEvent}/speakers`),
        ])
      const selectedDay = dayList.find(item => item.id === preferredDay)?.id ?? dayList[0]?.id ?? null
      const daySchedule = selectedDay === null ? null : await request<DaySchedule>(`/schedule/days/${selectedDay}`)
      if (number !== loadNumber.current) return
      setEvents(eventList)
      setEventId(selectedEvent)
      setDays(dayList)
      setDayId(selectedDay)
      setRooms(roomList)
      setSpeakers(speakerList)
      setSchedule(daySchedule)
      setError('')
    } catch (cause) {
      if (number === loadNumber.current) setError((cause as Error).message)
    } finally {
      if (number === loadNumber.current) setLoading(false)
    }
  }

  useEffect(() => { void loadAll(null, null) }, [])

  const selectedEvent = events.find(item => item.id === eventId)
  const selectedDay = days.find(item => item.id === dayId)
  const selectedRoom = panel?.kind === 'room' ? rooms.find(item => item.id === panel.id) : undefined
  const selectedSlot = panel?.kind === 'slot' ? schedule?.rooms.flatMap(item => item.slots).find(item => item.id === panel.id) : undefined
  const selectedSpeaker = panel?.kind === 'speaker' ? speakers.find(item => item.id === panel.id) : undefined

  async function save(body: Record<string, unknown>): Promise<boolean> {
    if (!panel) return false
    try {
      if (panel.kind === 'event') {
        const saved = await write<Event>(panel.id === null ? 'POST' : 'PATCH', panel.id === null ? '/events' : `/events/${panel.id}`, body)
        await loadAll(saved.id, null)
      } else if (panel.kind === 'day' && eventId !== null) {
        const saved = await write<EventDay>(panel.id === null ? 'POST' : 'PATCH', panel.id === null ? `/events/${eventId}/days` : `/days/${panel.id}`, panel.id === null ? { ...body, event_id: eventId } : body)
        await loadAll(eventId, saved.id)
      } else if (panel.kind === 'room' && eventId !== null) {
        await write<Room>(panel.id === null ? 'POST' : 'PATCH', panel.id === null ? '/rooms' : `/rooms/${panel.id}`, panel.id === null ? { ...body, event_id: eventId } : body)
        await loadAll(eventId, dayId)
      } else if (panel.kind === 'slot' && dayId !== null) {
        await write<Slot>(panel.id === null ? 'POST' : 'PATCH', panel.id === null ? '/slots' : `/slots/${panel.id}`, panel.id === null ? { ...body, day_id: dayId } : body)
        await loadAll(eventId, dayId)
      }
      return true
    } catch (cause) {
      setError((cause as Error).message)
      return false
    }
  }

  async function remove(): Promise<boolean> {
    if (!panel || panel.id === null) return false
    const path = { event: `/events/${panel.id}`, day: `/days/${panel.id}`, room: `/rooms/${panel.id}`, slot: `/slots/${panel.id}`, speaker: `/speakers/${panel.id}` }[panel.kind]
    try {
      await write<void>('DELETE', path)
      await loadAll(panel.kind === 'event' ? null : eventId, panel.kind === 'day' ? null : dayId)
      return true
    } catch (cause) {
      setError((cause as Error).message)
      return false
    }
  }

  async function saveSpeaker(body: { name: string; bio: string | null; website: string | null }, photo: File | null): Promise<boolean> {
    if (!panel || panel.kind !== 'speaker' || eventId === null) return false
    let saved: Speaker | null = null
    try {
      saved = await write<Speaker>(panel.id === null ? 'POST' : 'PATCH', panel.id === null ? `/events/${eventId}/speakers` : `/speakers/${panel.id}`, body)
      if (photo) await uploadPhoto(`/speakers/${saved.id}/photo`, photo)
      await loadAll(eventId, dayId)
      return true
    } catch (cause) {
      if (saved) await loadAll(eventId, dayId)
      if (saved && panel.id === null) setPanel({ kind: 'speaker', id: saved.id })
      setError((cause as Error).message)
      return false
    }
  }

  async function deleteSpeakerPhoto() {
    if (panel?.kind !== 'speaker' || panel.id === null) return
    try {
      await write<Speaker>('DELETE', `/speakers/${panel.id}/photo`)
      await loadAll(eventId, dayId)
    } catch (cause) { setError((cause as Error).message) }
  }

  async function reorder(roomId: number, direction: -1 | 1) {
    if (eventId === null) return
    const ids = rooms.map(room => room.id)
    const index = ids.indexOf(roomId)
    const other = index + direction
    if (other < 0 || other >= ids.length) return
    ;[ids[index], ids[other]] = [ids[other], ids[index]]
    try {
      await write<Room[]>('PATCH', `/events/${eventId}/rooms/order`, { room_ids: ids })
      await loadAll(eventId, dayId)
    } catch (cause) { setError((cause as Error).message) }
  }

  async function changeSlot(slotId: number, patch: Record<string, unknown>) {
    try {
      await write<Slot>('PATCH', `/slots/${slotId}`, patch)
      await loadAll(eventId, dayId)
    } catch (cause) { setError((cause as Error).message) }
  }

  return <div className="app-shell">
    <header className="app-header">
      <div><span className="eyebrow">EVENT SCHEDULER</span><h1>Programmplanung</h1><p>Veranstaltungen, Räume und Slots an einem Ort.</p></div>
      <button className="primary" onClick={() => setPanel({ kind: 'event', id: null })}>+ Veranstaltung</button>
    </header>
    {error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={() => setError('')}>Schließen</button></div>}
    <div className="workspace">
      <nav className="sidebar" aria-label="Planung">
        <section>
          <div className="section-heading"><h2>Veranstaltung</h2>{selectedEvent && <button className="text-button" onClick={() => setPanel({ kind: 'event', id: selectedEvent.id })}>Bearbeiten</button>}</div>
          <select aria-label="Veranstaltung wählen" value={eventId ?? ''} onChange={e => { setPanel(null); void loadAll(Number(e.target.value), null) }}>
            {events.length === 0 && <option value="">Keine Veranstaltung</option>}
            {events.map(event => <option key={event.id} value={event.id}>{event.name}</option>)}
          </select>
          {selectedEvent && <p className="muted">{selectedEvent.start_date} bis {selectedEvent.end_date}</p>}
        </section>
        {selectedEvent && <section>
          <div className="section-heading"><h2>Tage</h2><button className="text-button" onClick={() => setPanel({ kind: 'day', id: null })}>+ Tag</button></div>
          {days.length === 0 && <p className="muted">Noch keine Tage</p>}
          <div className="day-list">{days.map(day => <div className={`day-row${day.id === dayId ? ' active' : ''}`} key={day.id}>
            <button type="button" onClick={() => { setPanel(null); void loadAll(eventId, day.id) }}>{day.date}<small>{day.start_time.slice(0, 5)}–{day.end_time.slice(0, 5)}</small></button>
            <button type="button" className="icon-button" aria-label={`${day.date} bearbeiten`} onClick={() => setPanel({ kind: 'day', id: day.id })}>✎</button>
          </div>)}</div>
        </section>}
        {selectedEvent && <section>
          <div className="section-heading"><h2>Räume</h2><button className="text-button" onClick={() => setPanel({ kind: 'room', id: null })}>+ Raum</button></div>
          {rooms.length === 0 && <p className="muted">Noch keine Räume</p>}
          <div className="room-list">{rooms.map((room, index) => <div className="room-row" key={room.id}>
            <button type="button" className="room-name" onClick={() => setPanel({ kind: 'room', id: room.id })}>{room.name}</button>
            <button type="button" className="icon-button" aria-label={`${room.name} nach oben`} disabled={index === 0} onClick={() => void reorder(room.id, -1)}>↑</button>
            <button type="button" className="icon-button" aria-label={`${room.name} nach unten`} disabled={index === rooms.length - 1} onClick={() => void reorder(room.id, 1)}>↓</button>
          </div>)}</div>
        </section>}
        {selectedEvent && <section>
          <div className="section-heading"><h2>Redner</h2><button className="text-button" onClick={() => setPanel({ kind: 'speaker', id: null })}>+ Redner</button></div>
          {speakers.length === 0 && <p className="muted">Noch keine Redner</p>}
          <div className="room-list">{speakers.map(person => <div className="room-row" key={person.id}>
            <button type="button" className="room-name" onClick={() => setPanel({ kind: 'speaker', id: person.id })}>{person.name}</button>
          </div>)}</div>
        </section>}
      </nav>
      <main className="main-area">
        <div className="plan-heading"><div><span className="eyebrow">TAGESANSICHT</span><h2>{selectedDay?.date ?? 'Programm'}</h2><p>{selectedDay ? `${selectedDay.start_time.slice(0, 5)}–${selectedDay.end_time.slice(0, 5)} Uhr · ${rooms.length} Räume` : 'Wähle oder erstelle einen Veranstaltungstag.'}</p></div>
          <div className="plan-actions">
            {selectedEvent && <a className="program-link" href={`/programm/${selectedEvent.id}`}>Besucherprogramm ansehen</a>}
            {selectedDay && rooms.length > 0 && <button className="primary" onClick={() => setPanel({ kind: 'slot', id: null })}>+ Slot</button>}
          </div>
        </div>
        {loading && <p className="state-message">Lade Programm …</p>}
        {!loading && schedule && <Schedule schedule={schedule} onEdit={slot => setPanel({ kind: 'slot', id: slot.id })} onChange={changeSlot} />}
        {!loading && !schedule && <div className="empty-state">{events.length === 0 ? 'Erstelle zuerst eine Veranstaltung.' : 'Lege einen Tag und mindestens einen Raum an.'}</div>}
        {schedule && <p className="hint">Slot am Kopf ziehen, um ihn zu verschieben. Untere Kante ziehen, um die Dauer zu ändern. Rot: Raumkollision. Gelb: Rednerkonflikt.</p>}
      </main>
      {panel?.kind === 'speaker' && <SpeakerEditor
        key={`speaker-${panel.id ?? 'new'}`}
        speaker={selectedSpeaker}
        onSave={saveSpeaker}
        onDelete={panel.id === null ? null : remove}
        onDeletePhoto={panel.id === null ? null : deleteSpeakerPhoto}
        onClose={() => setPanel(null)}
      />}
      {panel && panel.kind !== 'speaker' && <Editor
        key={`${panel.kind}-${panel.id ?? 'new'}`}
        kind={panel.kind}
        event={panel.kind === 'event' ? events.find(item => item.id === panel.id) : selectedEvent}
        day={panel.kind === 'day' ? days.find(item => item.id === panel.id) : selectedDay}
        room={selectedRoom}
        slot={selectedSlot}
        rooms={rooms}
        speakers={speakers}
        onSave={save}
        onDelete={panel.id === null ? null : remove}
        onClose={() => setPanel(null)}
      />}
    </div>
  </div>
}
