import { useEffect, useRef, useState } from 'react'
import { layoutSlots, PX_PER_MINUTE, toMinutes, toTime } from './time'
import type { PublicDaySchedule, PublicSlot } from './types'
import { activeNotice, noticeLabel, previousPlanning, useNoticeNow } from './changeNotice'
import CategoryLabels, { CategoryStripe } from './CategoryLabels'
import { sharedPresentation } from './sharedSessions'

function speakerNames(slot: PublicSlot): string {
  return slot.speakers.map(speaker => speaker.name).join(', ')
}

export default function PublicSchedule({ schedule }: { schedule: PublicDaySchedule }) {
  const [roomId, setRoomId] = useState<number | null>(schedule.rooms[0]?.id ?? null)
  const [selectedSlot, setSelectedSlot] = useState<PublicSlot | null>(null)
  const detailRef = useRef<HTMLElement>(null)
  const shared = schedule.shared_slots ?? []
  const rooms = schedule.rooms.length ? schedule.rooms : [{ id: 0, name: 'Alle Räume', slots: [] }]
  const room = rooms.find(item => item.id === roomId) ?? rooms[0]
  const mobileSlots = [...room.slots, ...shared]
  const presentation = sharedPresentation(schedule.rooms.flatMap(item => item.slots), shared)
  const now = useNoticeNow([...schedule.rooms.flatMap(item => item.slots), ...shared])
  const selectedNotice = selectedSlot ? activeNotice(selectedSlot, now) : null
  const start = toMinutes(schedule.start_time)
  const end = toMinutes(schedule.end_time)
  const height = (end - start) * PX_PER_MINUTE
  const hours: number[] = []
  for (let minute = Math.ceil(start / 60) * 60; minute <= end; minute += 60) hours.push(minute)

  useEffect(() => {
    if (selectedSlot) detailRef.current?.focus()
  }, [selectedSlot])

  function chooseRoom(nextId: number) {
    setRoomId(nextId)
    document.getElementById(`public-room-tab-${nextId}`)?.focus()
  }

  function card(slot: PublicSlot, lane: number, lanes: number) {
    const notice = activeNotice(slot, now)
    const compactNotice = notice && (toMinutes(slot.end_time) - toMinutes(slot.start_time)) * PX_PER_MINUTE < 45
    return <button
      type="button" key={slot.id} data-slot-id={slot.id}
      className={`public-slot${notice ? ` notice-${notice.type}` : ''}`}
      style={{ top: (toMinutes(slot.start_time) - start) * PX_PER_MINUTE, height: (toMinutes(slot.end_time) - toMinutes(slot.start_time)) * PX_PER_MINUTE, left: `${lane * 100 / lanes}%`, width: `${100 / lanes}%` }}
      onClick={() => setSelectedSlot(slot)}
      aria-label={`${slot.topic}, ${slot.start_time.slice(0, 5)} bis ${slot.end_time.slice(0, 5)} Uhr${slot.scope === 'all_rooms' ? ', Alle Räume' : ''}${notice ? `, ${noticeLabel(notice)}` : ''}, Details anzeigen`}
    >
      <CategoryStripe categories={slot.categories} />
      <strong>{compactNotice ? `${noticeLabel(notice)}: ` : ''}{slot.topic}{slot.scope === 'all_rooms' ? ' · Alle Räume' : ''}</strong>
      <span className="public-slot-time">{slot.start_time.slice(0, 5)}–{slot.end_time.slice(0, 5)}</span>
      {slot.speakers.length > 0 && <small>{speakerNames(slot)}</small>}
      {(slot.categories?.length || notice && !compactNotice) && <span className="public-slot-meta">
        {notice && !compactNotice && <span className="change-badge">{noticeLabel(notice)}</span>}
        <CategoryLabels categories={slot.categories} />
      </span>}
    </button>
  }

  if (schedule.rooms.length === 0 && shared.length === 0) return <p className="public-state">Für diesen Tag sind noch keine Räume angelegt.</p>

  return <>
    <p className="public-time-range">{schedule.start_time.slice(0, 5)}–{schedule.end_time.slice(0, 5)} Uhr · {schedule.rooms.length} Räume</p>
    {selectedSlot && <section className="public-detail" aria-label="Session-Details" ref={detailRef} tabIndex={-1}>
      <button type="button" className="public-detail-close" onClick={() => setSelectedSlot(null)}>Schließen</button>
      <h3>{selectedSlot.topic}</h3>
      <CategoryLabels categories={selectedSlot.categories} />
      {selectedNotice && <p className={`public-change-notice notice-${selectedNotice.type}`}><strong>{noticeLabel(selectedNotice)}</strong>{previousPlanning(selectedNotice) && <span>Vorher: {previousPlanning(selectedNotice)}</span>}</p>}
      <p>{selectedSlot.start_time.slice(0, 5)}–{selectedSlot.end_time.slice(0, 5)} Uhr · {selectedSlot.scope === 'all_rooms' ? 'Alle Räume' : schedule.rooms.find(item => item.id === selectedSlot.room_id)?.name}</p>
      {selectedSlot.speakers.length > 0 && <p>{speakerNames(selectedSlot)}</p>}
      {selectedSlot.description && <p className="public-description">{selectedSlot.description}</p>}
      <a className="program-link" href={`/programm/${selectedSlot.event_id}/sessions/${selectedSlot.id}`}>Session-Seite öffnen</a>
    </section>}
    <div className="public-desktop-program schedule-scroll" aria-label="Tagesplan">
      <div className="schedule-grid" style={{ gridTemplateColumns: `72px repeat(${rooms.length}, minmax(240px, 1fr))` }}>
        <div className="time-head" style={{ gridColumn: 1, gridRow: 1 }}>Zeit</div>
        {rooms.map((item, index) => <div className="room-head" key={item.id} style={{ gridColumn: index + 2, gridRow: 1 }}>{item.name}</div>)}
        <div className="time-axis" style={{ height, gridColumn: 1, gridRow: 2 }}>
          {hours.map(minute => <div className="hour-label" key={minute} style={{ top: Math.max(9, Math.min(height - 9, (minute - start) * PX_PER_MINUTE)) }}>{toTime(minute)}</div>)}
        </div>
        {rooms.map((item, index) => <div className="room-column" key={item.id} style={{ height, gridColumn: index + 2, gridRow: 2 }}>
          {hours.map(minute => <div className="hour-line" key={minute} style={{ top: (minute - start) * PX_PER_MINUTE }} />)}
          {item.slots.length === 0 && shared.length === 0 && <span className="empty-room">Keine Programmpunkte</span>}
          {layoutSlots([...item.slots, ...presentation.repeated]).map(({ slot, lane, lanes }) => card(slot, lane, lanes))}
        </div>)}
        <div className="shared-slot-layer" data-shared-layer style={{ gridColumn: `2 / ${rooms.length + 2}`, gridRow: 2, height }}>
          {presentation.spanning.map(slot => card(slot, 0, 1))}
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
      {room && <section role="tabpanel" id="public-room-panel" aria-labelledby={`public-room-tab-${room.id}`} className="public-room-panel">
        {mobileSlots.length === 0 ? <p className="public-state">In diesem Raum sind keine Programmpunkte geplant.</p> :
          mobileSlots.sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time) || a.id - b.id).map(slot => {
            const notice = activeNotice(slot, now)
            const previous = notice && previousPlanning(notice)
            return <article className={`public-mobile-slot${notice ? ` notice-${notice.type}` : ''}`} key={slot.id}>
            <CategoryStripe categories={slot.categories} />
            {slot.scope === 'all_rooms' && <span className="public-slot-time">Alle Räume</span>}
            {slot.description ? <details>
              <summary><span className="public-mobile-time">{slot.start_time.slice(0, 5)}–{slot.end_time.slice(0, 5)}</span><strong>{slot.topic}</strong><CategoryLabels categories={slot.categories} />{slot.speakers.length > 0 && <span>{speakerNames(slot)}</span>}{notice && <span className="change-badge">{noticeLabel(notice)}</span>}{previous && <span className="previous-planning">Vorher: {previous}</span>}</summary>
              <p className="public-description">{slot.description}</p>
            </details> : <div className="public-mobile-summary"><span className="public-mobile-time">{slot.start_time.slice(0, 5)}–{slot.end_time.slice(0, 5)}</span><strong>{slot.topic}</strong><CategoryLabels categories={slot.categories} />{slot.speakers.length > 0 && <span>{speakerNames(slot)}</span>}{notice && <span className="change-badge">{noticeLabel(notice)}</span>}{previous && <span className="previous-planning">Vorher: {previous}</span>}</div>}
            <a className="program-link public-session-link" href={`/programm/${slot.event_id}/sessions/${slot.id}`}>Session-Seite öffnen</a>
          </article>})}
      </section>}
    </div>
  </>
}
