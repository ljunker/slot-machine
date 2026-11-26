import { useEffect, useId, useRef, useState } from 'react'
import { isRunning, layoutSlots, minutesOfDay, PX_PER_MINUTE, toMinutes, toTime } from './time'
import type { PublicDaySchedule, PublicSlot } from './types'
import { activeNotice, noticeLabel, previousPlanning, useNoticeNow } from './changeNotice'
import CategoryLabels, { CategoryStripe } from './CategoryLabels'
import Dialog from './Dialog'
import PublicSessionDetails, { sessionPath } from './PublicSessionDetails'
import { localDate } from './publicDay'
import { sharedPresentation } from './sharedSessions'

function speakerNames(slot: PublicSlot): string {
  return slot.speakers.map(speaker => speaker.name).join(', ')
}

function byStart(a: PublicSlot, b: PublicSlot): number {
  return toMinutes(a.start_time) - toMinutes(b.start_time) || a.id - b.id
}

/** Aktuelle Minute des Tages, solange der angezeigte Tag heute ist; sonst null. */
function useCurrentMinute(date: string): number | null {
  const today = () => localDate() === date ? minutesOfDay(new Date()) : null
  const [minute, setMinute] = useState(today)
  useEffect(() => {
    setMinute(today())
    const timer = window.setInterval(() => setMinute(today()), 30_000)
    return () => window.clearInterval(timer)
  }, [date])
  return minute
}

export default function PublicSchedule({ schedule }: { schedule: PublicDaySchedule }) {
  const [roomId, setRoomId] = useState<number | null>(schedule.rooms[0]?.id ?? null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const lastSelected = useRef<number | null>(null)
  const headRef = useRef<HTMLDivElement>(null)
  const mobileRef = useRef<HTMLElement>(null)
  const titleId = useId()
  const shared = schedule.shared_slots ?? []
  const rooms = schedule.rooms.length ? schedule.rooms : [{ id: 0, name: 'Alle Räume', slots: [] }]
  const room = rooms.find(item => item.id === roomId) ?? rooms[0]
  const mobileSlots = [...room.slots, ...shared].sort(byStart)
  const allSlots = [...schedule.rooms.flatMap(item => item.slots), ...shared]
  const presentation = sharedPresentation(schedule.rooms.flatMap(item => item.slots), shared)
  const now = useNoticeNow(allSlots)
  const currentMinute = useCurrentMinute(schedule.date)
  const selectedSlot = allSlots.find(slot => slot.id === selectedId) ?? null
  const start = toMinutes(schedule.start_time)
  const end = toMinutes(schedule.end_time)
  const height = (end - start) * PX_PER_MINUTE
  const columns = `72px repeat(${rooms.length}, minmax(240px, 1fr))`
  const hours: number[] = []
  for (let minute = Math.ceil(start / 60) * 60; minute <= end; minute += 60) hours.push(minute)
  const showNow = currentMinute !== null && currentMinute >= start && currentMinute <= end

  // Reihenfolge für „Vorherige/Nächste“: im selben Raum, bei Sessions für alle Räume der ganze Tag.
  const sequence = selectedSlot
    ? (selectedSlot.scope === 'all_rooms' ? allSlots : [...allSlots.filter(slot => slot.room_id === selectedSlot.room_id), ...shared]).sort(byStart)
    : []
  const position = selectedSlot ? sequence.findIndex(slot => slot.id === selectedSlot.id) : -1
  const previousSlot = position > 0 ? sequence[position - 1] : null
  const nextSlot = position >= 0 && position < sequence.length - 1 ? sequence[position + 1] : null

  useEffect(() => {
    if (selectedId !== null || lastSelected.current === null) return
    document.querySelector<HTMLElement>(`.public-desktop-program [data-slot-id="${lastSelected.current}"]`)?.focus()
    lastSelected.current = null
  }, [selectedId])

  // Mobil am Veranstaltungstag zur laufenden bzw. nächsten Session springen.
  useEffect(() => {
    if (currentMinute === null || !window.matchMedia?.('(max-width: 700px)').matches) return
    const target = mobileRef.current?.querySelector<HTMLElement>('[data-current], [data-upcoming]')
    target?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
    // Nur beim Öffnen des Tages bzw. Raumwechsel, nicht bei jedem Minutentakt.
  }, [schedule.day_id, room?.id, currentMinute === null])

  function chooseRoom(nextId: number) {
    setRoomId(nextId)
    document.getElementById(`public-room-tab-${nextId}`)?.focus()
  }

  function closeDetails() {
    lastSelected.current = selectedId
    setSelectedId(null)
  }

  function card(slot: PublicSlot, lane: number, lanes: number) {
    const notice = activeNotice(slot, now)
    const compactNotice = notice && (toMinutes(slot.end_time) - toMinutes(slot.start_time)) * PX_PER_MINUTE < 45
    const running = currentMinute !== null && isRunning(slot, currentMinute)
    return <button
      type="button" key={slot.id} data-slot-id={slot.id}
      className={`public-slot${notice ? ` notice-${notice.type}` : ''}${running ? ' is-running' : ''}`}
      style={{ top: (toMinutes(slot.start_time) - start) * PX_PER_MINUTE, height: (toMinutes(slot.end_time) - toMinutes(slot.start_time)) * PX_PER_MINUTE, left: `${lane * 100 / lanes}%`, width: `${100 / lanes}%` }}
      onClick={() => setSelectedId(slot.id)}
      aria-haspopup="dialog"
      aria-label={`${slot.topic}, ${slot.start_time.slice(0, 5)} bis ${slot.end_time.slice(0, 5)} Uhr${slot.scope === 'all_rooms' ? ', Alle Räume' : ''}${running ? ', läuft gerade' : ''}${notice ? `, ${noticeLabel(notice)}` : ''}, Details anzeigen`}
    >
      <CategoryStripe categories={slot.categories} />
      <strong>{compactNotice ? `${noticeLabel(notice)}: ` : ''}{slot.topic}{slot.scope === 'all_rooms' ? ' · Alle Räume' : ''}</strong>
      <span className="public-slot-time">{running && <span className="public-running-dot" aria-hidden="true" />}{slot.start_time.slice(0, 5)}–{slot.end_time.slice(0, 5)}</span>
      {slot.speakers.length > 0 && <small>{speakerNames(slot)}</small>}
      {(slot.categories?.length || notice && !compactNotice) && <span className="public-slot-meta">
        {notice && !compactNotice && <span className="change-badge">{noticeLabel(notice)}</span>}
        <CategoryLabels categories={slot.categories} />
      </span>}
    </button>
  }

  if (schedule.rooms.length === 0 && shared.length === 0) return <p className="public-state">Für diesen Tag sind noch keine Räume angelegt.</p>

  let upcomingMarked = false
  return <>
    <p className="public-time-range">{schedule.start_time.slice(0, 5)}–{schedule.end_time.slice(0, 5)} Uhr · {schedule.rooms.length} Räume</p>
    {selectedSlot && <Dialog className="public-drawer" labelledBy={titleId} onClose={closeDetails}>
      <div className="public-drawer-content" onKeyDown={event => {
        if ((event.target as HTMLElement).closest('input, textarea, select')) return
        if (event.key === 'ArrowLeft' && previousSlot) { event.preventDefault(); setSelectedId(previousSlot.id) }
        if (event.key === 'ArrowRight' && nextSlot) { event.preventDefault(); setSelectedId(nextSlot.id) }
      }}>
      <div className="public-drawer-bar">
        <div className="public-drawer-nav">
          <button type="button" className="secondary" disabled={!previousSlot} onClick={() => previousSlot && setSelectedId(previousSlot.id)} aria-label={previousSlot ? `Vorherige Session: ${previousSlot.topic}` : 'Keine vorherige Session'}>‹ Vorherige</button>
          <button type="button" className="secondary" disabled={!nextSlot} onClick={() => nextSlot && setSelectedId(nextSlot.id)} aria-label={nextSlot ? `Nächste Session: ${nextSlot.topic}` : 'Keine nächste Session'}>Nächste ›</button>
        </div>
        <button type="button" className="public-drawer-close" onClick={closeDetails}>Schließen</button>
      </div>
      <div className="public-drawer-body">
        <PublicSessionDetails
          key={selectedSlot.id}
          slot={selectedSlot}
          roomName={schedule.rooms.find(item => item.id === selectedSlot.room_id)?.name}
          now={now}
          titleId={titleId}
          running={currentMinute !== null && isRunning(selectedSlot, currentMinute)}
        />
        <a className="program-link" href={sessionPath(selectedSlot)}>Session-Seite öffnen</a>
      </div>
      </div>
    </Dialog>}
    <div className="public-desktop-program" aria-label="Tagesplan" role="region">
      <div className="public-grid-head" ref={headRef}>
        <div className="schedule-grid" style={{ gridTemplateColumns: columns }}>
          <div className="time-head">Zeit</div>
          {rooms.map(item => <div className="room-head" key={item.id}>{item.name}</div>)}
        </div>
      </div>
      <div className="public-grid-body" onScroll={event => { if (headRef.current) headRef.current.scrollLeft = event.currentTarget.scrollLeft }}>
        <div className="schedule-grid" style={{ gridTemplateColumns: columns }}>
          <div className="time-axis" style={{ height, gridColumn: 1, gridRow: 1 }}>
            {hours.map(minute => <div className="hour-label" key={minute} style={{ top: Math.max(9, Math.min(height - 9, (minute - start) * PX_PER_MINUTE)) }}>{toTime(minute)}</div>)}
          </div>
          {rooms.map((item, index) => <div className="room-column" key={item.id} style={{ height, gridColumn: index + 2, gridRow: 1 }}>
            {hours.map(minute => <div className="hour-line" key={minute} style={{ top: (minute - start) * PX_PER_MINUTE }} />)}
            {item.slots.length === 0 && shared.length === 0 && <span className="empty-room">Keine Programmpunkte</span>}
            {layoutSlots([...item.slots, ...presentation.repeated]).map(({ slot, lane, lanes }) => card(slot, lane, lanes))}
          </div>)}
          <div className="shared-slot-layer" data-shared-layer style={{ gridColumn: `2 / ${rooms.length + 2}`, gridRow: 1, height }}>
            {presentation.spanning.map(slot => card(slot, 0, 1))}
          </div>
          {showNow && <div className="public-now-line" data-now-line style={{ top: (currentMinute - start) * PX_PER_MINUTE }}>
            <span>Jetzt {toTime(currentMinute)}</span>
          </div>}
        </div>
      </div>
    </div>
    <div className="public-mobile-program">
      <div className="public-room-tabs" role="tablist" aria-label="Räume">
        {rooms.map((item, index) => <button
          type="button"
          role="tab"
          id={`public-room-tab-${item.id}`}
          aria-controls="public-room-panel"
          aria-selected={room?.id === item.id}
          tabIndex={room?.id === item.id ? 0 : -1}
          key={item.id}
          onClick={() => chooseRoom(item.id)}
          onKeyDown={event => {
            const next = event.key === 'ArrowRight' ? index + 1 : event.key === 'ArrowLeft' ? index - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? rooms.length - 1 : null
            if (next === null) return
            event.preventDefault()
            chooseRoom(rooms[(next + rooms.length) % rooms.length].id)
          }}
        >{item.name}</button>)}
      </div>
      {room && <section role="tabpanel" id="public-room-panel" aria-labelledby={`public-room-tab-${room.id}`} className="public-room-panel" ref={mobileRef}>
        {mobileSlots.length === 0 ? <p className="public-state">In diesem Raum sind keine Programmpunkte geplant.</p> :
          mobileSlots.map(slot => {
            const notice = activeNotice(slot, now)
            const previous = notice && previousPlanning(notice)
            const running = currentMinute !== null && isRunning(slot, currentMinute)
            const upcoming = !running && !upcomingMarked && currentMinute !== null && !slot.is_cancelled && toMinutes(slot.start_time) > currentMinute
            if (running || upcoming) upcomingMarked = true
            const summary = <>
              <span className="public-mobile-time">{slot.start_time.slice(0, 5)}–{slot.end_time.slice(0, 5)}{running && <span className="public-running-badge">Läuft gerade</span>}</span>
              <strong>{slot.topic}</strong><CategoryLabels categories={slot.categories} />
              {slot.speakers.length > 0 && <span>{speakerNames(slot)}</span>}
              {notice && <span className="change-badge">{noticeLabel(notice)}</span>}
              {previous && <span className="previous-planning">Vorher: {previous}</span>}
            </>
            return <article className={`public-mobile-slot${notice ? ` notice-${notice.type}` : ''}${running ? ' is-running' : ''}`} key={slot.id}
              data-current={running || undefined} data-upcoming={upcoming || undefined}>
              <CategoryStripe categories={slot.categories} />
              {slot.scope === 'all_rooms' && <span className="public-slot-time">Alle Räume</span>}
              {slot.description ? <details>
                <summary>{summary}</summary>
                <p className="public-description">{slot.description}</p>
              </details> : <div className="public-mobile-summary">{summary}</div>}
              <a className="program-link public-session-link" href={sessionPath(slot)}>Session-Seite öffnen</a>
            </article>
          })}
      </section>}
    </div>
  </>
}
