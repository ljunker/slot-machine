import { useEffect, useState } from 'react'
import { request } from './api'
import { programDesign } from './branding'
import { useNoticeNow } from './changeNotice'
import { pageTitle, usePageTitle } from './pageTitle'
import { PublicFooter, PublicHeader } from './PublicChrome'
import PublicSessionDetails from './PublicSessionDetails'
import type { Event, PublicSession } from './types'

export default function PublicSessionPage({ eventId, sessionId }: { eventId: number; sessionId: number }) {
  const [event, setEvent] = useState<Event | null>(null)
  const [session, setSession] = useState<PublicSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const now = useNoticeNow(session ? [session] : [])
  usePageTitle(session ? pageTitle(session.topic, event?.name) : event ? pageTitle('Programm', event.name) : null, event?.logo_url)

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

  const design = programDesign(event)

  return <div className={`public-page${design.className}`} style={design.style}>
    <PublicHeader event={event} showSubtitle={false} />
    <main className="public-container public-main">
      <a className="program-link" href={`/programm/${eventId}`}>Zum Veranstaltungsprogramm</a>
      {loading && <p className="state-message" role="status">Lade Session …</p>}
      {!loading && error && <div className="public-state" role="alert">
        <p>Session konnte nicht geladen werden: {error}</p>
        <button type="button" onClick={() => setRetry(value => value + 1)}>Erneut versuchen</button>
      </div>}
      {!loading && !error && session && <article className="public-session-page">
        <span className="eyebrow">SESSION</span>
        <PublicSessionDetails slot={session} roomName={session.room_name} date={session.date} now={now} />
      </article>}
    </main>
    <PublicFooter event={event} showInfo={false} />
  </div>
}
