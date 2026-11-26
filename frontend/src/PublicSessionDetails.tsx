import { useState } from 'react'
import { activeNotice, noticeLabel, previousPlanning } from './changeNotice'
import CategoryLabels from './CategoryLabels'
import { formatDate } from './date'
import { displayUrl } from './PublicChrome'
import type { PublicSlot, PublicSpeaker } from './types'
import { NoticeIcon } from './NoticeBadge'

export function sessionPath(slot: Pick<PublicSlot, 'event_id' | 'id'>): string {
  return `/programm/${slot.event_id}/sessions/${slot.id}`
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase()
}

export function SpeakerCards({ speakers }: { speakers: PublicSpeaker[] }) {
  if (!speakers.length) return null
  return <section className="public-speakers" aria-label="Redner">
    <h3>Redner</h3>
    <ul>
      {speakers.map((speaker, index) => <li className="public-speaker" key={speaker.id ?? index}>
        {speaker.photo_url
          ? <img className="public-speaker-photo" src={speaker.photo_url} alt="" loading="lazy" />
          : <span className="public-speaker-photo public-speaker-initials" aria-hidden="true">{initials(speaker.name)}</span>}
        <div>
          <strong>{speaker.name}</strong>
          {speaker.bio && <p>{speaker.bio}</p>}
          {speaker.website && <a href={speaker.website} target="_blank" rel="noopener noreferrer">{displayUrl(speaker.website)}</a>}
        </div>
      </li>)}
    </ul>
  </section>
}

const calendarIcon = <svg aria-hidden="true" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4.5" width="14" height="12.5" rx="2" /><path d="M3 8.5h14M7 2.5v4M13 2.5v4M10 11v4M8 13h4" /></svg>
const shareIcon = <svg aria-hidden="true" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M10 12.5V3M6.5 6.5 10 3l3.5 3.5M4 10.5V16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-5.5" /></svg>

/** „Zum Kalender hinzufügen“ (.ics) und „Link teilen“ (Web Share API, sonst Zwischenablage). */
export function SessionActions({ slot }: { slot: PublicSlot }) {
  const [status, setStatus] = useState('')
  const path = sessionPath(slot)

  async function share() {
    const url = new URL(path, window.location.origin).href
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: slot.topic, url })
        return
      } catch (error) {
        if ((error as Error).name === 'AbortError') return
      }
    }
    try {
      await navigator.clipboard.writeText(url)
      setStatus('Link in die Zwischenablage kopiert.')
    } catch {
      setStatus(`Link: ${url}`)
    }
  }

  return <div className="public-session-actions">
    <a className="secondary" href={`/api/events/${slot.event_id}/sessions/${slot.id}.ics`} download>{calendarIcon}Zum Kalender hinzufügen</a>
    <button type="button" className="secondary" onClick={() => void share()}>{shareIcon}Link teilen</button>
    <p className="public-share-status" role="status">{status}</p>
  </div>
}

/** Inhalt einer Session für Seitenpanel und Session-Seite. */
export default function PublicSessionDetails({ slot, roomName, date, now, titleId, running = false }: {
  slot: PublicSlot
  roomName: string | undefined
  date?: string
  now: number
  titleId?: string
  running?: boolean
}) {
  const notice = activeNotice(slot, now)
  const previous = notice && previousPlanning(notice)
  return <>
    <h2 id={titleId} className="public-session-title">{slot.topic}</h2>
    <CategoryLabels categories={slot.categories} />
    {notice && <p className={`public-change-notice notice-${notice.type}`}><strong><NoticeIcon notice={notice} />{noticeLabel(notice)}</strong>{previous && <span>Vorher: {previous}</span>}</p>}
    <p className="public-session-when">
      {running && <span className="public-running-badge">Läuft gerade</span>}
      {date ? `${formatDate(date)} · ` : ''}{slot.start_time.slice(0, 5)}–{slot.end_time.slice(0, 5)} Uhr · {slot.scope === 'all_rooms' ? 'Alle Räume' : roomName}
    </p>
    {slot.description && <p className="public-description">{slot.description}</p>}
    <SpeakerCards speakers={slot.speakers} />
    <SessionActions slot={slot} />
  </>
}
