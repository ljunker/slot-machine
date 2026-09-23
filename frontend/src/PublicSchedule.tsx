import { useEffect, useRef, useState } from 'react'
import { layoutSlots, PX_PER_MINUTE, toMinutes, toTime } from './time'
import type { DaySchedule, Slot } from './types'

export default function PublicSchedule({ schedule }: { schedule: DaySchedule }) {
  const [roomId, setRoomId] = useState<number | null>(schedule.rooms[0]?.id ?? null)
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null)
  const detailRef = useRef<HTMLElement>(null)
  const room = schedule.rooms.find(item => item.id === roomId) ?? schedule.rooms[0]
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
      <p>{selectedSlot.start_time.slice(0, 5)}–{selectedSlot.end_time.slice(0, 5)} Uhr · {schedule.rooms.find(item => item.id === selectedSlot.room_id)?.name}</p>
      {selectedSlot.speaker && <p>{selectedSlot.speaker}</p>}
      {selectedSlot.description && <p className="public-description">{selectedSlot.description}</p>}
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
          {layoutSlots(item.slots).map(({ slot, lane, lanes }) => <button
            type="button"
            key={slot.id}
            className="public-slot"
            style={{ top: (toMinutes(slot.start_time) - start) * PX_PER_MINUTE, height: (toMinutes(slot.end_time) - toMinutes(slot.start_time)) * PX_PER_MINUTE, left: `${lane * 100 / lanes}%`, width: `${100 / lanes}%` }}
            onClick={() => setSelectedSlot(slot)}
            aria-label={`${slot.topic}, ${slot.start_time.slice(0, 5)} bis ${slot.end_time.slice(0, 5)} Uhr, Details anzeigen`}
          >
            <strong>{slot.topic}</strong>
            <span>{slot.start_time.slice(0, 5)}–{slot.end_time.slice(0, 5)}</span>
            {slot.speaker && <small>{slot.speaker}</small>}
          </button>)}
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
          [...room.slots].sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time) || a.id - b.id).map(slot => <article className="public-mobile-slot" key={slot.id}>
            {slot.description ? <details>
              <summary><span className="public-mobile-time">{slot.start_time.slice(0, 5)}–{slot.end_time.slice(0, 5)}</span><strong>{slot.topic}</strong>{slot.speaker && <span>{slot.speaker}</span>}</summary>
              <p className="public-description">{slot.description}</p>
            </details> : <div className="public-mobile-summary"><span className="public-mobile-time">{slot.start_time.slice(0, 5)}–{slot.end_time.slice(0, 5)}</span><strong>{slot.topic}</strong>{slot.speaker && <span>{slot.speaker}</span>}</div>}
          </article>)}
      </section>}
    </div>
  </>
}
