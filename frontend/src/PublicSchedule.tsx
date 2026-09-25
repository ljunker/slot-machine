import { useEffect, useRef, useState } from 'react'
import { layoutSlots, PX_PER_MINUTE, toMinutes, toTime } from './time'
import type { DaySchedule, Slot } from './types'
import { activeNotice, noticeLabel, previousPlanning, useNoticeNow } from './changeNotice'

function speakerNames(slot: Slot): string {
  return slot.speakers.map(speaker => speaker.name).join(', ')
}

export default function PublicSchedule({ schedule }: { schedule: DaySchedule }) {
  const [roomId, setRoomId] = useState<number | null>(schedule.rooms[0]?.id ?? null)
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null)
  const detailRef = useRef<HTMLElement>(null)
  const room = schedule.rooms.find(item => item.id === roomId) ?? schedule.rooms[0]
  const now = useNoticeNow(schedule.rooms.flatMap(item => item.slots))
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

  if (schedule.rooms.length === 0) return <p className="public-state">Für diesen Tag sind noch keine Räume angelegt.</p>

  return <>
    <p className="public-time-range">{schedule.start_time.slice(0, 5)}–{schedule.end_time.slice(0, 5)} Uhr · {schedule.rooms.length} Räume</p>
    {selectedSlot && <section className="public-detail" aria-label="Session-Details" ref={detailRef} tabIndex={-1}>
      <button type="button" className="public-detail-close" onClick={() => setSelectedSlot(null)}>Schließen</button>
      <h3>{selectedSlot.topic}</h3>
      {selectedNotice && <p className={`public-change-notice notice-${selectedNotice.type}`}><strong>{noticeLabel(selectedNotice)}</strong>{previousPlanning(selectedNotice) && <span>Vorher: {previousPlanning(selectedNotice)}</span>}</p>}
      <p>{selectedSlot.start_time.slice(0, 5)}–{selectedSlot.end_time.slice(0, 5)} Uhr · {schedule.rooms.find(item => item.id === selectedSlot.room_id)?.name}</p>
      {selectedSlot.speakers.length > 0 && <p>{speakerNames(selectedSlot)}</p>}
      {selectedSlot.description && <p className="public-description">{selectedSlot.description}</p>}
      <a className="program-link" href={`/programm/${selectedSlot.event_id}/sessions/${selectedSlot.id}`}>Session-Seite öffnen</a>
    </section>}
    <div className="public-desktop-program schedule-scroll" aria-label="Tagesplan">
      <div className="schedule-grid" style={{ gridTemplateColumns: `72px repeat(${schedule.rooms.length}, minmax(240px, 1fr))` }}>
        <div className="time-head">Zeit</div>
        {schedule.rooms.map(item => <div className="room-head" key={item.id}>{item.name}</div>)}
        <div className="time-axis" style={{ height }}>
          {hours.map(minute => <div className="hour-label" key={minute} style={{ top: Math.max(9, Math.min(height - 9, (minute - start) * PX_PER_MINUTE)) }}>{toTime(minute)}</div>)}
        </div>
        {schedule.rooms.map(item => <div className="room-column" key={item.id} style={{ height }}>
          {hours.map(minute => <div className="hour-line" key={minute} style={{ top: (minute - start) * PX_PER_MINUTE }} />)}
          {item.slots.length === 0 && <span className="empty-room">Keine Programmpunkte</span>}
          {layoutSlots(item.slots).map(({ slot, lane, lanes }) => {
            const notice = activeNotice(slot, now)
            const compactNotice = notice && (toMinutes(slot.end_time) - toMinutes(slot.start_time)) * PX_PER_MINUTE < 45
            return <button
            type="button"
            key={slot.id}
            className={`public-slot${notice ? ` notice-${notice.type}` : ''}`}
            style={{ top: (toMinutes(slot.start_time) - start) * PX_PER_MINUTE, height: (toMinutes(slot.end_time) - toMinutes(slot.start_time)) * PX_PER_MINUTE, left: `${lane * 100 / lanes}%`, width: `${100 / lanes}%` }}
            onClick={() => setSelectedSlot(slot)}
            aria-label={`${slot.topic}, ${slot.start_time.slice(0, 5)} bis ${slot.end_time.slice(0, 5)} Uhr${notice ? `, ${noticeLabel(notice)}` : ''}, Details anzeigen`}
          >
            <strong>{compactNotice ? `${noticeLabel(notice)}: ` : ''}{slot.topic}</strong>
            <span>{slot.start_time.slice(0, 5)}–{slot.end_time.slice(0, 5)}</span>
            {slot.speakers.length > 0 && <small>{speakerNames(slot)}</small>}
            {notice && !compactNotice && <span className="change-badge">{noticeLabel(notice)}</span>}
          </button>})}
        </div>)}
      </div>
    </div>
    <div className="public-mobile-program">
      <div className="public-room-tabs" role="tablist" aria-label="Räume">
        {schedule.rooms.map((item, index) => <button
          type="button"
          role="tab"
          id={`public-room-tab-${item.id}`}
          aria-controls="public-room-panel"
          aria-selected={room?.id === item.id}
          tabIndex={room?.id === item.id ? 0 : -1}
          key={item.id}
          onClick={() => chooseRoom(item.id)}
          onKeyDown={event => {
            const next = event.key === 'ArrowRight' ? index + 1 : event.key === 'ArrowLeft' ? index - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? schedule.rooms.length - 1 : null
            if (next === null) return
            event.preventDefault()
            chooseRoom(schedule.rooms[(next + schedule.rooms.length) % schedule.rooms.length].id)
          }}
        >{item.name}</button>)}
      </div>
      {room && <section role="tabpanel" id="public-room-panel" aria-labelledby={`public-room-tab-${room.id}`} className="public-room-panel">
        {room.slots.length === 0 ? <p className="public-state">In diesem Raum sind keine Programmpunkte geplant.</p> :
          [...room.slots].sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time) || a.id - b.id).map(slot => {
            const notice = activeNotice(slot, now)
            const previous = notice && previousPlanning(notice)
            return <article className={`public-mobile-slot${notice ? ` notice-${notice.type}` : ''}`} key={slot.id}>
            {slot.description ? <details>
              <summary><span className="public-mobile-time">{slot.start_time.slice(0, 5)}–{slot.end_time.slice(0, 5)}</span><strong>{slot.topic}</strong>{slot.speakers.length > 0 && <span>{speakerNames(slot)}</span>}{notice && <span className="change-badge">{noticeLabel(notice)}</span>}{previous && <span className="previous-planning">Vorher: {previous}</span>}</summary>
              <p className="public-description">{slot.description}</p>
            </details> : <div className="public-mobile-summary"><span className="public-mobile-time">{slot.start_time.slice(0, 5)}–{slot.end_time.slice(0, 5)}</span><strong>{slot.topic}</strong>{slot.speakers.length > 0 && <span>{speakerNames(slot)}</span>}{notice && <span className="change-badge">{noticeLabel(notice)}</span>}{previous && <span className="previous-planning">Vorher: {previous}</span>}</div>}
            <a className="program-link public-session-link" href={`/programm/${slot.event_id}/sessions/${slot.id}`}>Session-Seite öffnen</a>
          </article>})}
      </section>}
    </div>
  </>
}
