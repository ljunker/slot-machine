import { useEffect, useState } from 'react'
import { request } from './api'
import { programDesign } from './branding'
import { formatDate, formatShortDate } from './date'
import { pageTitle, usePageTitle } from './pageTitle'
import PublicSchedule from './PublicSchedule'
import { PublicFooter, PublicHeader } from './PublicChrome'
import { defaultDay } from './publicDay'
import type { Event, EventDay, PublicDaySchedule } from './types'

/** Bis zu so vielen Tagen erscheinen die Tage als Tabs, darüber als Auswahlliste. */
const MAX_DAY_TABS = 4

export default function PublicProgram({ eventId }: { eventId: number | null }) {
  const [event, setEvent] = useState<Event | null>(null)
  const [days, setDays] = useState<EventDay[]>([])
  const [dayId, setDayId] = useState<number | null>(null)
  const [schedule, setSchedule] = useState<PublicDaySchedule | null>(null)
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
    request<PublicDaySchedule>(`/public/events/${eventId}/days/${dayId}/schedule`).then(data => {
      if (active) setSchedule(data)
    }).catch((cause: Error) => {
      if (active) setScheduleError(cause.message)
    }).finally(() => {
      if (active) setLoadingSchedule(false)
    })
    return () => { active = false }
  }, [eventId, dayId, retrySchedule])

  const selectedDay = days.find(day => day.id === dayId)

  const design = programDesign(event)
  usePageTitle(event ? pageTitle('Programm', event.name) : null, event?.logo_url)

  function chooseDay(nextId: number) {
    setDayId(nextId)
    document.getElementById(`public-day-tab-${nextId}`)?.focus()
  }

  return <div className={`public-page${design.className}`} style={design.style}>
    <PublicHeader event={event} />
    <main className="public-container public-main">
      {loadingEvent && <p className="state-message" role="status">Lade Veranstaltung …</p>}
      {!loadingEvent && eventError && <div className="public-state" role="alert">
        <p>Programm konnte nicht geladen werden: {eventError}</p>
        {eventId !== null && <button type="button" onClick={() => setRetryEvent(value => value + 1)}>Erneut versuchen</button>}
      </div>}
      {!loadingEvent && event && !eventError && <>
        {days.length === 0 ? <p className="public-state">Für diese Veranstaltung sind noch keine Tage angelegt.</p> : <>
          <div className="public-day-heading">
            <div><span className="eyebrow">TAGESPROGRAMM</span><h2>{selectedDay && formatDate(selectedDay.date)}</h2></div>
            <a className="secondary public-pdf-link" href={`/api/events/${event.id}/program.pdf`} download>
              <svg aria-hidden="true" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M10 3v9.5M6 9l4 4 4-4M4 16.5h12" /></svg>
              PDF-Programm herunterladen
            </a>
          </div>
          {days.length > 1 && (days.length <= MAX_DAY_TABS
            ? <div className="public-day-tabs" role="tablist" aria-label="Veranstaltungstage">
              {days.map((day, index) => <button
                type="button" role="tab" key={day.id}
                id={`public-day-tab-${day.id}`}
                aria-controls="public-day-panel"
                aria-selected={day.id === dayId}
                aria-label={formatDate(day.date)}
                tabIndex={day.id === dayId ? 0 : -1}
                onClick={() => setDayId(day.id)}
                onKeyDown={keyEvent => {
                  const next = keyEvent.key === 'ArrowRight' ? index + 1 : keyEvent.key === 'ArrowLeft' ? index - 1 : keyEvent.key === 'Home' ? 0 : keyEvent.key === 'End' ? days.length - 1 : null
                  if (next === null) return
                  keyEvent.preventDefault()
                  chooseDay(days[(next + days.length) % days.length].id)
                }}
              >{formatShortDate(day.date)}</button>)}
            </div>
            : <label className="public-day-select">Veranstaltungstag
              <select value={dayId ?? ''} onChange={change => setDayId(Number(change.target.value))}>
                {days.map(day => <option key={day.id} value={day.id}>{formatDate(day.date)}</option>)}
              </select>
            </label>)}
          <div id="public-day-panel" {...(days.length > 1 && days.length <= MAX_DAY_TABS ? { role: 'tabpanel', 'aria-labelledby': `public-day-tab-${dayId}` } : {})}>
          {loadingSchedule && <p className="state-message" role="status">Lade Tagesplan …</p>}
          {!loadingSchedule && scheduleError && <div className="public-state" role="alert">
            <p>Tagesplan konnte nicht geladen werden: {scheduleError}</p>
            <button type="button" onClick={() => setRetrySchedule(value => value + 1)}>Erneut versuchen</button>
          </div>}
          {!loadingSchedule && schedule && <PublicSchedule key={schedule.day_id} schedule={schedule} />}
          </div>
        </>}
      </>}
    </main>
    <PublicFooter event={event} />
  </div>
}
