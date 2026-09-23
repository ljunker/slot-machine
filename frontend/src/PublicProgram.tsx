import { useEffect, useState } from 'react'
import { request } from './api'
import PublicSchedule from './PublicSchedule'
import { defaultDay } from './publicDay'
import type { DaySchedule, Event, EventDay } from './types'

export default function PublicProgram({ eventId }: { eventId: number | null }) {
  const [event, setEvent] = useState<Event | null>(null)
  const [days, setDays] = useState<EventDay[]>([])
  const [dayId, setDayId] = useState<number | null>(null)
  const [schedule, setSchedule] = useState<DaySchedule | null>(null)
  const [loadingEvent, setLoadingEvent] = useState(true)
  const [loadingSchedule, setLoadingSchedule] = useState(false)
  const [eventError, setEventError] = useState('')
  const [scheduleError, setScheduleError] = useState('')
  const [retryEvent, setRetryEvent] = useState(0)
  const [retrySchedule, setRetrySchedule] = useState(0)

  useEffect(() => {
    if (eventId === null) {
      setEventError('Ungültiger Programmlink.')
      setLoadingEvent(false)
      return
    }
    let active = true
    setLoadingEvent(true)
    setEventError('')
    Promise.all([
      request<Event>(`/events/${eventId}`),
      request<EventDay[]>(`/events/${eventId}/days`),
    ]).then(([loadedEvent, loadedDays]) => {
      if (!active) return
      const ordered = [...loadedDays].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)
      setEvent(loadedEvent)
      setDays(ordered)
      setDayId(defaultDay(ordered)?.id ?? null)
    }).catch((cause: Error) => {
      if (active) setEventError(cause.message)
    }).finally(() => {
      if (active) setLoadingEvent(false)
    })
    return () => { active = false }
  }, [eventId, retryEvent])

  useEffect(() => {
    if (dayId === null) {
      setSchedule(null)
      return
    }
    let active = true
    setLoadingSchedule(true)
    setSchedule(null)
    setScheduleError('')
    request<DaySchedule>(`/schedule/days/${dayId}`).then(data => {
      if (active) setSchedule(data)
    }).catch((cause: Error) => {
      if (active) setScheduleError(cause.message)
    }).finally(() => {
      if (active) setLoadingSchedule(false)
    })
    return () => { active = false }
  }, [dayId, retrySchedule])

  const selectedDay = days.find(day => day.id === dayId)

  return <div className="public-page">
    <header className="public-header">
      <div className="public-container">
        <span className="eyebrow">VERANSTALTUNGSPROGRAMM</span>
        <h1>{event?.name ?? 'Programm'}</h1>
        {event && <p>{event.start_date === event.end_date ? event.start_date : `${event.start_date} bis ${event.end_date}`}</p>}
      </div>
    </header>
    <main className="public-container public-main">
      {loadingEvent && <p className="state-message" role="status">Lade Veranstaltung …</p>}
      {!loadingEvent && eventError && <div className="public-state" role="alert">
        <p>Programm konnte nicht geladen werden: {eventError}</p>
        {eventId !== null && <button type="button" onClick={() => setRetryEvent(value => value + 1)}>Erneut versuchen</button>}
      </div>}
      {!loadingEvent && event && !eventError && <>
        {days.length === 0 ? <p className="public-state">Für diese Veranstaltung sind noch keine Tage angelegt.</p> : <>
          <div className="public-day-heading">
            <div><span className="eyebrow">TAGESPROGRAMM</span><h2>{selectedDay?.date}</h2></div>
            <label>Veranstaltungstag
              <select value={dayId ?? ''} onChange={change => setDayId(Number(change.target.value))}>
                {days.map(day => <option key={day.id} value={day.id}>{day.date}</option>)}
              </select>
            </label>
          </div>
          {loadingSchedule && <p className="state-message" role="status">Lade Tagesplan …</p>}
          {!loadingSchedule && scheduleError && <div className="public-state" role="alert">
            <p>Tagesplan konnte nicht geladen werden: {scheduleError}</p>
            <button type="button" onClick={() => setRetrySchedule(value => value + 1)}>Erneut versuchen</button>
          </div>}
          {!loadingSchedule && schedule && <PublicSchedule key={schedule.day_id} schedule={schedule} />}
        </>}
      </>}
    </main>
  </div>
}
