import { useEffect, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import { request, uploadImage, write } from './api'
import Editor from './Editor'
import type { EditorKind } from './Editor'
import DutyEditor from './DutyEditor'
import HelperEditor from './HelperEditor'
import ConflictOverview from './ConflictOverview'
import Schedule from './Schedule'
import SpeakerEditor from './SpeakerEditor'
import ThemeControl from './ThemeControl'
import type { DaySchedule, Duty, Event, EventDay, Helper, HelperPlan, Room, Slot, Speaker, UnplannedSession } from './types'
import { PX_PER_MINUTE, SNAP_MINUTES, toMinutes, toTime } from './time'

type Panel = { kind: EditorKind | 'speaker' | 'helper' | 'duty'; id: number | null; createUnplanned?: boolean }
type BacklogPreview = { roomId: number; start: number; topic: string }

export default function App() {
  const [events, setEvents] = useState<Event[]>([])
  const [eventId, setEventId] = useState<number | null>(null)
  const [days, setDays] = useState<EventDay[]>([])
  const [dayId, setDayId] = useState<number | null>(null)
  const [rooms, setRooms] = useState<Room[]>([])
  const [speakers, setSpeakers] = useState<Speaker[]>([])
  const [helpers, setHelpers] = useState<Helper[]>([])
  const [helperPlan, setHelperPlan] = useState<HelperPlan>({ duties: [], conflicts: [] })
  const [schedule, setSchedule] = useState<DaySchedule | null>(null)
  const [view, setView] = useState<'schedule' | 'conflicts'>('schedule')
  const [overviewSchedules, setOverviewSchedules] = useState<DaySchedule[] | null>(null)
  const [overviewError, setOverviewError] = useState('')
  const [overviewRetry, setOverviewRetry] = useState(0)
  const [unplanned, setUnplanned] = useState<UnplannedSession[]>([])
  const [backlogPreview, setBacklogPreview] = useState<BacklogPreview | null>(null)
  const [panel, setPanel] = useState<Panel | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const loadNumber = useRef(0)

  async function loadAll(preferredEvent: number | null, preferredDay: number | null): Promise<boolean> {
    const number = ++loadNumber.current
    setLoading(true)
    try {
      const eventList = await request<Event[]>('/events')
      const selectedEvent = eventList.find(item => item.id === preferredEvent)?.id ?? eventList[0]?.id ?? null
      const [dayList, roomList, speakerList, unplannedList, helperList, loadedHelperPlan] = selectedEvent === null
        ? [[], [], [], [], [], { duties: [], conflicts: [] }] as [EventDay[], Room[], Speaker[], UnplannedSession[], Helper[], HelperPlan]
        : await Promise.all([
          request<EventDay[]>(`/events/${selectedEvent}/days`),
          request<Room[]>(`/events/${selectedEvent}/rooms`),
          request<Speaker[]>(`/events/${selectedEvent}/speakers`),
          request<UnplannedSession[]>(`/events/${selectedEvent}/unplanned-sessions`),
          request<Helper[]>(`/events/${selectedEvent}/helpers`),
          request<HelperPlan>(`/events/${selectedEvent}/helper-plan`),
        ])
      const selectedDay = dayList.find(item => item.id === preferredDay)?.id ?? dayList[0]?.id ?? null
      const daySchedule = selectedDay === null ? null : await request<DaySchedule>(`/schedule/days/${selectedDay}`)
      if (number !== loadNumber.current) return false
      setEvents(eventList)
      setEventId(selectedEvent)
      setDays(dayList)
      setDayId(selectedDay)
      setRooms(roomList)
      setSpeakers(speakerList)
      setHelpers(helperList)
      setHelperPlan(loadedHelperPlan)
      setSchedule(daySchedule)
      setUnplanned(unplannedList)
      setError('')
      return true
    } catch (cause) {
      if (number === loadNumber.current) setError((cause as Error).message)
      return false
    } finally {
      if (number === loadNumber.current) setLoading(false)
    }
  }

  useEffect(() => { void loadAll(null, null) }, [])

  useEffect(() => {
    if (view !== 'conflicts' || eventId === null) return
    let active = true
    setOverviewSchedules(null)
    setOverviewError('')
    Promise.all(days.map(day => request<DaySchedule>(`/schedule/days/${day.id}`)))
      .then(loaded => { if (active) setOverviewSchedules(loaded) })
      .catch((cause: Error) => { if (active) setOverviewError(cause.message) })
    return () => { active = false }
  }, [view, eventId, days, overviewRetry])

  async function openConflictEntry(targetDayId: number, kind: 'slot' | 'duty', id: number) {
    if (!await loadAll(eventId, targetDayId)) return
    setView('schedule')
    setPanel({ kind, id })
  }

  const selectedEvent = events.find(item => item.id === eventId)
  const selectedDay = days.find(item => item.id === dayId)
  const selectedRoom = panel?.kind === 'room' ? rooms.find(item => item.id === panel.id) : undefined
  const selectedSlot = panel?.kind === 'slot'
    ? schedule?.rooms.flatMap(item => item.slots).find(item => item.id === panel.id) ?? unplanned.find(item => item.id === panel.id)
    : undefined
  const selectedSpeaker = panel?.kind === 'speaker' ? speakers.find(item => item.id === panel.id) : undefined
  const selectedHelper = panel?.kind === 'helper' ? helpers.find(item => item.id === panel.id) : undefined
  const selectedDuty = panel?.kind === 'duty' ? helperPlan.duties.find(item => item.id === panel.id) : undefined

  async function save(body: Record<string, unknown>, logo?: File | null): Promise<boolean> {
    if (!panel) return false
    let savedEvent: Event | null = null
    try {
      if (panel.kind === 'event') {
        const saved = await write<Event>(panel.id === null ? 'POST' : 'PATCH', panel.id === null ? '/events' : `/events/${panel.id}`, body)
        savedEvent = saved
        if (logo) await uploadImage(`/events/${saved.id}/logo`, 'logo', logo)
        await loadAll(saved.id, dayId)
      } else if (panel.kind === 'day' && eventId !== null) {
        const saved = await write<EventDay>(panel.id === null ? 'POST' : 'PATCH', panel.id === null ? `/events/${eventId}/days` : `/days/${panel.id}`, panel.id === null ? { ...body, event_id: eventId } : body)
        await loadAll(eventId, saved.id)
      } else if (panel.kind === 'room' && eventId !== null) {
        await write<Room>(panel.id === null ? 'POST' : 'PATCH', panel.id === null ? '/rooms' : `/rooms/${panel.id}`, panel.id === null ? { ...body, event_id: eventId } : body)
        await loadAll(eventId, dayId)
      } else if (panel.kind === 'slot' && eventId !== null) {
        await write<Slot>(panel.id === null ? 'POST' : 'PATCH', panel.id === null ? '/slots' : `/slots/${panel.id}`, panel.id === null ? { ...body, event_id: eventId } : body)
        await loadAll(eventId, dayId)
      }
      return true
    } catch (cause) {
      if (savedEvent) {
        await loadAll(savedEvent.id, dayId)
        if (panel.kind === 'event' && panel.id === null) setPanel({ kind: 'event', id: savedEvent.id })
      }
      setError((cause as Error).message)
      return false
    }
  }

  async function remove(): Promise<boolean> {
    if (!panel || panel.id === null) return false
    const path = { event: `/events/${panel.id}`, day: `/days/${panel.id}`, room: `/rooms/${panel.id}`, slot: `/slots/${panel.id}`, speaker: `/speakers/${panel.id}`, helper: `/helpers/${panel.id}`, duty: `/duties/${panel.id}` }[panel.kind]
    try {
      await write<void>('DELETE', path)
      await loadAll(panel.kind === 'event' ? null : eventId, panel.kind === 'day' ? null : dayId)
      if (panel.kind === 'event') setView('schedule')
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
      if (photo) await uploadImage(`/speakers/${saved.id}/photo`, 'photo', photo)
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

  async function deleteEventLogo() {
    if (panel?.kind !== 'event' || panel.id === null) return
    try {
      await write<Event>('DELETE', `/events/${panel.id}/logo`)
      await loadAll(panel.id, dayId)
    } catch (cause) { setError((cause as Error).message) }
  }

  async function saveHelper(name: string): Promise<boolean> {
    if (panel?.kind !== 'helper' || eventId === null) return false
    try {
      await write<Helper>(panel.id === null ? 'POST' : 'PATCH', panel.id === null ? `/events/${eventId}/helpers` : `/helpers/${panel.id}`, { name })
      await loadAll(eventId, dayId)
      return true
    } catch (cause) { setError((cause as Error).message); return false }
  }

  async function saveDuty(body: Record<string, unknown>): Promise<boolean> {
    if (panel?.kind !== 'duty' || eventId === null) return false
    try {
      await write<Duty>(panel.id === null ? 'POST' : 'PATCH', panel.id === null ? `/events/${eventId}/duties` : `/duties/${panel.id}`, body)
      await loadAll(eventId, dayId)
      return true
    } catch (cause) { setError((cause as Error).message); return false }
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

  function beginBacklogDrag(event: PointerEvent, session: UnplannedSession) {
    if (event.button !== 0 || !schedule || dayId === null) return
    event.preventDefault()
    const dayStart = toMinutes(schedule.start_time)
    const dayEnd = toMinutes(schedule.end_time)

    function position(pointer: globalThis.PointerEvent): BacklogPreview | null {
      const scroll = document.querySelector<HTMLElement>('.schedule-scroll')
      if (!scroll) return null
      const visible = scroll.getBoundingClientRect()
      if (pointer.clientX < visible.left || pointer.clientX > visible.right || pointer.clientY < visible.top || pointer.clientY > visible.bottom) return null
      for (const column of document.querySelectorAll<HTMLElement>('[data-room-column]')) {
        const rect = column.getBoundingClientRect()
        if (pointer.clientX < rect.left || pointer.clientX > rect.right || pointer.clientY < rect.top || pointer.clientY > rect.bottom) continue
        const start = dayStart + Math.round((pointer.clientY - rect.top) / (SNAP_MINUTES * PX_PER_MINUTE)) * SNAP_MINUTES
        if (start < dayStart || start + 60 > dayEnd) return null
        return { roomId: Number(column.dataset.roomColumn), start, topic: session.topic }
      }
      return null
    }

    function move(pointer: globalThis.PointerEvent) { setBacklogPreview(position(pointer)) }
    function cleanup() {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', cancel)
      setBacklogPreview(null)
    }
    function finish(pointer: globalThis.PointerEvent) {
      const target = position(pointer)
      cleanup()
      if (target) void changeSlot(session.id, {
        day_id: dayId, room_id: target.roomId,
        start_time: toTime(target.start), end_time: toTime(target.start + 60),
      })
    }
    function cancel() { cleanup() }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', cancel)
  }

  return <div className="app-shell">
    <header className="app-header">
      <div><span className="eyebrow">EVENT SCHEDULER</span><h1>Programmplanung</h1><p>Veranstaltungen, Räume und Slots an einem Ort.</p></div>
      <div className="header-actions"><ThemeControl /><button className="primary" onClick={() => setPanel({ kind: 'event', id: null })}>+ Veranstaltung</button></div>
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
            <button type="button" onClick={() => { setPanel(null); setView('schedule'); void loadAll(eventId, day.id) }}>{day.date}<small>{day.start_time.slice(0, 5)}–{day.end_time.slice(0, 5)}</small></button>
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
          <div className="section-heading"><h2>Ungeplante Sessions ({unplanned.length})</h2><button className="text-button" onClick={() => setPanel({ kind: 'slot', id: null, createUnplanned: true })}>+ Session</button></div>
          {unplanned.length === 0 && <p className="muted">Keine ungeplanten Sessions</p>}
          <div className="unplanned-list">{unplanned.map(session => <div className="unplanned-row" key={session.id}>
            <button type="button" className="unplanned-grip" aria-label={`${session.topic} einplanen`} onPointerDown={event => beginBacklogDrag(event, session)}>⠿</button>
            <button type="button" className="unplanned-name" onClick={() => setPanel({ kind: 'slot', id: session.id })}>{session.topic}<small>{session.speakers.map(speaker => speaker.name).join(', ')}</small></button>
          </div>)}</div>
          {unplanned.length > 0 && <p className="muted">Zum Einplanen in einen Raum ziehen oder Session bearbeiten.</p>}
        </section>}
        {selectedEvent && <section>
          <div className="section-heading"><h2>Redner</h2><button className="text-button" onClick={() => setPanel({ kind: 'speaker', id: null })}>+ Redner</button></div>
          {speakers.length === 0 && <p className="muted">Noch keine Redner</p>}
          <div className="room-list">{speakers.map(person => <div className="room-row" key={person.id}>
            <button type="button" className="room-name" onClick={() => setPanel({ kind: 'speaker', id: person.id })}>{person.name}</button>
          </div>)}</div>
        </section>}
        {selectedEvent && <section>
          <div className="section-heading"><h2>Helfer</h2><button className="text-button" onClick={() => setPanel({ kind: 'helper', id: null })}>+ Helfer</button></div>
          {helpers.length === 0 && <p className="muted">Noch keine Helfer</p>}
          <div className="room-list">{helpers.map(person => <div className="room-row" key={person.id}>
            <button type="button" className="room-name" onClick={() => setPanel({ kind: 'helper', id: person.id })}>{person.name}</button>
          </div>)}</div>
        </section>}
        {selectedEvent && <section>
          <div className="section-heading"><h2>Dienste ({helperPlan.duties.length})</h2></div>
          {helperPlan.duties.length === 0 && <p className="muted">Noch keine Dienste</p>}
          <div className="duty-list">{helperPlan.duties.map(duty => <button type="button" key={duty.id} onClick={() => setPanel({ kind: 'duty', id: duty.id })}>
            <strong>{duty.title || duty.session_topic || (duty.kind === 'room' ? 'Raumdienst' : 'Allgemeiner Dienst')}{duty.title && duty.session_topic ? `: ${duty.session_topic}` : ''}</strong>
            <small>{duty.date ?? 'Ohne Tag'} · {duty.status === 'cancelled' ? 'Abgesagt' : duty.status === 'unplanned' ? 'Ungeplant' : duty.start_time?.slice(0, 5) + '–' + duty.end_time?.slice(0, 5)} · {duty.helpers.length ? duty.helpers.map(helper => helper.name).join(', ') : 'Offen'}</small>
          </button>)}</div>
        </section>}
      </nav>
      <main className="main-area">
        {selectedEvent && <div className="planning-views" role="group" aria-label="Planungsansicht">
          <button type="button" aria-pressed={view === 'schedule'} onClick={() => setView('schedule')}>Tagesplan</button>
          <button type="button" aria-pressed={view === 'conflicts'} onClick={() => { setPanel(null); setView('conflicts') }}>Konflikte</button>
        </div>}
        <div className="plan-heading"><div><span className="eyebrow">{view === 'conflicts' ? 'GESAMTE VERANSTALTUNG' : 'TAGESANSICHT'}</span><h2>{view === 'conflicts' ? 'Konfliktübersicht' : selectedDay?.date ?? 'Programm'}</h2><p>{view === 'conflicts' ? selectedEvent?.name : selectedDay ? `${selectedDay.start_time.slice(0, 5)}–${selectedDay.end_time.slice(0, 5)} Uhr · ${rooms.length} Räume` : 'Wähle oder erstelle einen Veranstaltungstag.'}</p></div>
          <div className="plan-actions">
            {selectedEvent && <a className="program-link" href={`/programm/${selectedEvent.id}`}>Besucherprogramm ansehen</a>}
            {selectedEvent && days.length > 0 && <a className="program-link" href={`/api/events/${selectedEvent.id}/program.pdf`} download>PDF-Programm herunterladen</a>}
            {selectedEvent && view === 'schedule' && <button className="primary" onClick={() => setPanel({ kind: 'duty', id: null })}>+ Dienst</button>}
            {selectedDay && rooms.length > 0 && view === 'schedule' && <button className="primary" onClick={() => setPanel({ kind: 'slot', id: null })}>+ Slot</button>}
          </div>
        </div>
        {view === 'schedule' && loading && <p className="state-message">Lade Programm …</p>}
        {view === 'schedule' && !loading && schedule && <Schedule schedule={schedule} helperPlan={helperPlan} backlogPreview={backlogPreview} onEdit={slot => setPanel({ kind: 'slot', id: slot.id })} onEditDuty={duty => setPanel({ kind: 'duty', id: duty.id })} onChange={changeSlot} />}
        {view === 'schedule' && !loading && !schedule && <div className="empty-state">{events.length === 0 ? 'Erstelle zuerst eine Veranstaltung.' : 'Lege einen Tag und mindestens einen Raum an.'}</div>}
        {view === 'schedule' && schedule && <p className="hint">Slot am Kopf ziehen, um ihn zu verschieben. Untere Kante ziehen, um die Dauer zu ändern. Rot: Raumkollision. Gelber Rahmen: Rednerkonflikt. Helferdienste stehen neben dem Raumprogramm.</p>}
        {view === 'conflicts' && (loading || (!overviewSchedules && !overviewError)) && <p className="state-message" role="status">Lade Konflikte …</p>}
        {view === 'conflicts' && !loading && overviewError && <div className="empty-state" role="alert">Konflikte konnten nicht geladen werden: {overviewError}<br /><button className="text-button" type="button" onClick={() => setOverviewRetry(value => value + 1)}>Erneut versuchen</button></div>}
        {view === 'conflicts' && !loading && overviewSchedules && !overviewError && <ConflictOverview schedules={overviewSchedules} helperPlan={helperPlan} onOpenSlot={(day, slot) => void openConflictEntry(day, 'slot', slot)} onOpenDuty={(day, duty) => void openConflictEntry(day, 'duty', duty)} />}
      </main>
      {panel?.kind === 'speaker' && <SpeakerEditor
        key={`speaker-${panel.id ?? 'new'}`}
        speaker={selectedSpeaker}
        onSave={saveSpeaker}
        onDelete={panel.id === null ? null : remove}
        onDeletePhoto={panel.id === null ? null : deleteSpeakerPhoto}
        onClose={() => setPanel(current => current === panel ? null : current)}
      />}
      {panel?.kind === 'helper' && <HelperEditor
        key={`helper-${panel.id ?? 'new'}`}
        helper={selectedHelper}
        duties={helperPlan.duties.filter(duty => duty.helper_ids.includes(panel.id ?? -1))}
        onSave={saveHelper}
        onDelete={panel.id === null ? null : remove}
        onEditDuty={duty => setPanel({ kind: 'duty', id: duty.id })}
        onClose={() => setPanel(current => current === panel ? null : current)}
      />}
      {panel?.kind === 'duty' && <DutyEditor
        key={`duty-${panel.id ?? 'new'}`}
        duty={selectedDuty}
        days={days}
        selectedDay={selectedDay}
        rooms={rooms}
        sessions={[...(schedule?.rooms.flatMap(room => room.slots) ?? []), ...unplanned]}
        helpers={helpers}
        onSave={saveDuty}
        onDelete={panel.id === null ? null : remove}
        onClose={() => setPanel(current => current === panel ? null : current)}
      />}
      {panel && panel.kind !== 'speaker' && panel.kind !== 'helper' && panel.kind !== 'duty' && <Editor
        key={`${panel.kind}-${panel.id ?? 'new'}-${panel.createUnplanned ? 'unplanned' : 'planned'}`}
        kind={panel.kind}
        event={panel.kind === 'event' ? events.find(item => item.id === panel.id) : selectedEvent}
        day={panel.kind === 'day' ? days.find(item => item.id === panel.id) : selectedDay}
        days={days}
        room={selectedRoom}
        slot={selectedSlot}
        rooms={rooms}
        speakers={speakers}
        createUnplanned={panel.createUnplanned}
        onSave={save}
        onDeleteLogo={panel.kind === 'event' && panel.id !== null ? deleteEventLogo : null}
        onDelete={panel.id === null ? null : remove}
        onClose={() => setPanel(current => current === panel ? null : current)}
      />}
    </div>
  </div>
}
