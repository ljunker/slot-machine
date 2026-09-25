import { useEffect, useState } from 'react'
import { request } from './api'
import { brandingStyle } from './branding'
import { activeNotice, noticeLabel, previousPlanning, useNoticeNow } from './changeNotice'
import ThemeControl from './ThemeControl'
import type { Event, PublicSession } from './types'

export default function PublicSessionPage({ eventId, sessionId }: { eventId: number; sessionId: number }) {
  const [event, setEvent] = useState<Event | null>(null)
  const [session, setSession] = useState<PublicSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const now = useNoticeNow(session ? [session] : [])
  const notice = session ? activeNotice(session, now) : null

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    Promise.all([
      request<Event>(`/events/${eventId}`),
      request<PublicSession>(`/events/${eventId}/sessions/${sessionId}`),
    ]).then(([loadedEvent, loadedSession]) => {
      if (!active) return
      setEvent(loadedEvent)
      setSession(loadedSession)
    }).catch((cause: Error) => {
      if (active) setError(cause.message)
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [eventId, sessionId, retry])

  return <div className={`public-page${event?.accent_color ? ' branding-active' : ''}`} style={brandingStyle(event?.accent_color)}>
    <header className="public-header">
      <div className="public-container public-header-content">
        <div className="public-title">
          {event?.logo_url && <span className="public-logo"><img src={event.logo_url} alt={`Logo von ${event.name}`} /></span>}
          <div><span className="eyebrow">VERANSTALTUNGSPROGRAMM</span><h1>{event?.name ?? 'Programm'}</h1></div>
        </div>
        <ThemeControl />
      </div>
    </header>
    <main className="public-container public-main">
      <a className="program-link" href={`/programm/${eventId}`}>Zum Veranstaltungsprogramm</a>
      {loading && <p className="state-message" role="status">Lade Session …</p>}
      {!loading && error && <div className="public-state" role="alert">
        <p>Session konnte nicht geladen werden: {error}</p>
        <button type="button" onClick={() => setRetry(value => value + 1)}>Erneut versuchen</button>
      </div>}
      {!loading && !error && session && <article className="public-session-page">
        <span className="eyebrow">SESSION</span>
        <h2>{session.topic}</h2>
        {notice && <p className={`public-change-notice notice-${notice.type}`}><strong>{noticeLabel(notice)}</strong>{previousPlanning(notice) && <span>Vorher: {previousPlanning(notice)}</span>}</p>}
        <p>{session.date} · {session.start_time.slice(0, 5)}–{session.end_time.slice(0, 5)} Uhr · {session.room_name}</p>
        {session.speakers.length > 0 && <p>Redner: {session.speakers.map(speaker => speaker.name).join(', ')}</p>}
        {session.description && <p className="public-description">{session.description}</p>}
      </article>}
    </main>
  </div>
}
