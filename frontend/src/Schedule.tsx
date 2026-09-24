import { useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import type { DaySchedule, Slot } from './types'
import { layoutSlots, movePatch, PX_PER_MINUTE, resizePatch, snappedDelta, toMinutes, toTime } from './time'
import { activeNotice, noticeLabel, useNoticeNow } from './changeNotice'

type SlotPatch = { room_id?: number; start_time?: string; end_time?: string }
type Drag = { slot: Slot; mode: 'move' | 'resize'; originY: number; delta: number; roomId: number }

export default function Schedule({ schedule, backlogPreview, onEdit, onChange }: {
  schedule: DaySchedule
  backlogPreview?: { roomId: number; start: number; topic: string } | null
  onEdit: (slot: Slot) => void
  onChange: (slotId: number, patch: SlotPatch) => Promise<void>
}) {
  const [drag, setDrag] = useState<Drag | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const start = toMinutes(schedule.start_time)
  const end = toMinutes(schedule.end_time)
  const height = (end - start) * PX_PER_MINUTE
  const collisionIds = new Set(schedule.collisions.flatMap(pair => [pair.first_slot_id, pair.second_slot_id]))
  const speakerConflictIds = new Set(schedule.speaker_conflicts.flatMap(pair => [pair.first_slot_id, pair.second_slot_id]))
  const slots = schedule.rooms.flatMap(room => room.slots)
  const now = useNoticeNow(slots)
  const slotById = new Map(slots.map(slot => [slot.id, slot]))
  const roomById = new Map(schedule.rooms.map(room => [room.id, room.name]))
  const speakerById = new Map(slots.flatMap(slot => slot.speakers).map(speaker => [speaker.id, speaker.name]))
  const hours: number[] = []
  for (let minute = Math.ceil(start / 60) * 60; minute <= end; minute += 60) hours.push(minute)

  function begin(event: PointerEvent, slot: Slot, mode: 'move' | 'resize') {
    if (event.button !== 0) return
    event.preventDefault()
    const initial: Drag = { slot, mode, originY: event.clientY, delta: 0, roomId: slot.room_id }
    dragRef.current = initial
    setDrag(initial)

    function move(pointer: globalThis.PointerEvent) {
      const current = dragRef.current
      if (!current) return
      const delta = snappedDelta(pointer.clientY - current.originY)
      let roomId = current.roomId
      if (current.mode === 'move') {
        const columns = document.querySelectorAll<HTMLElement>('[data-room-column]')
        for (const column of columns) {
          const rect = column.getBoundingClientRect()
          if (pointer.clientX >= rect.left && pointer.clientX <= rect.right) {
            roomId = Number(column.dataset.roomColumn)
            break
          }
        }
      }
      const next = { ...current, delta, roomId }
      dragRef.current = next
      setDrag(next)
    }

    function finish() {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', cancel)
      const current = dragRef.current
      dragRef.current = null
      setDrag(null)
      if (!current) return
      if (current.mode === 'move') {
        const patch = movePatch(current.slot, current.delta, current.roomId, start, end)
        if (patch.room_id !== current.slot.room_id || patch.start_time !== current.slot.start_time.slice(0, 5)) void onChange(current.slot.id, patch)
      } else {
        const patch = resizePatch(current.slot, current.delta, end)
        if (patch.end_time !== current.slot.end_time.slice(0, 5)) void onChange(current.slot.id, patch)
      }
    }

    function cancel() {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', cancel)
      dragRef.current = null
      setDrag(null)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', cancel)
  }

  function card(slot: Slot, top: number, cardHeight: number, lane: number, lanes: number, ghost = false) {
    const notice = activeNotice(slot, now)
    const compactNotice = notice && cardHeight < 45
    return <article
      key={slot.id}
      data-slot-id={slot.id}
      className={`slot-card${collisionIds.has(slot.id) ? ' collision' : ''}${speakerConflictIds.has(slot.id) ? ' speaker-conflict' : ''}${notice ? ` notice-${notice.type}` : ''}${ghost ? ' ghost' : ''}`}
      style={{ top, height: cardHeight, left: `${lane * 100 / lanes}%`, width: `${100 / lanes}%` }}
      tabIndex={ghost ? undefined : 0}
      onDoubleClick={ghost ? undefined : () => onEdit(slot)}
      onKeyDown={ghost ? undefined : event => { if (event.key === 'Enter') onEdit(slot) }}
    >
      <div className="slot-grip" onPointerDown={ghost ? undefined : event => begin(event, slot, 'move')} aria-label={`${slot.topic} verschieben`}>
        <strong>{compactNotice ? `${noticeLabel(notice)}: ` : ''}{slot.topic}</strong>
        <span>{slot.start_time.slice(0, 5)}–{slot.end_time.slice(0, 5)}</span>
      </div>
      {slot.speakers.length > 0 && <small>{slot.speakers.map(speaker => speaker.name).join(', ')}</small>}
      {!ghost && notice && !compactNotice && <span className="change-badge">{noticeLabel(notice)}</span>}
      {!ghost && speakerConflictIds.has(slot.id) && <span className="slot-conflict-badge">Rednerkonflikt</span>}
      {!ghost && <button className="slot-edit" type="button" onClick={() => onEdit(slot)} aria-label={`${slot.topic} bearbeiten`}>Bearbeiten</button>}
      {!ghost && <div className="slot-resize" onPointerDown={event => begin(event, slot, 'resize')} aria-label={`${slot.topic} verlängern oder verkürzen`} />}
    </article>
  }

  const preview = drag && (drag.mode === 'move'
    ? movePatch(drag.slot, drag.delta, drag.roomId, start, end)
    : resizePatch(drag.slot, drag.delta, end))
  const previewStart = drag && (drag.mode === 'move' ? toMinutes((preview as ReturnType<typeof movePatch>).start_time) : toMinutes(drag.slot.start_time))
  const previewEnd = drag && toMinutes(preview!.end_time)

  return <div className="schedule-scroll" aria-label="Tagesplan">
    {schedule.speaker_conflicts.length > 0 && <section className="speaker-conflict-list" aria-label="Rednerkonflikte">
      <h3>Rednerkonflikte</h3>
      <ul>{schedule.speaker_conflicts.map(conflict => {
        const first = slotById.get(conflict.first_slot_id)
        const second = slotById.get(conflict.second_slot_id)
        if (!first || !second) return null
        return <li key={`${first.id}-${second.id}`}>{conflict.speaker_ids.map(id => speakerById.get(id)).filter(Boolean).join(', ')}: {first.topic} ({roomById.get(first.room_id)}, {first.start_time.slice(0, 5)}–{first.end_time.slice(0, 5)}) und {second.topic} ({roomById.get(second.room_id)}, {second.start_time.slice(0, 5)}–{second.end_time.slice(0, 5)})</li>
      })}</ul>
    </section>}
    <div className="schedule-grid" style={{ gridTemplateColumns: `72px repeat(${schedule.rooms.length}, minmax(240px, 1fr))` }}>
      <div className="time-head">Zeit</div>
      {schedule.rooms.map(room => <div className="room-head" key={room.id}>{room.name}</div>)}
      <div className="time-axis" style={{ height }}>
        {hours.map(minute => <div className="hour-label" key={minute} style={{ top: Math.max(9, Math.min(height - 9, (minute - start) * PX_PER_MINUTE)) }}>{toTime(minute)}</div>)}
      </div>
      {schedule.rooms.map(room => <div
        className={`room-column${drag?.roomId === room.id || backlogPreview?.roomId === room.id ? ' drop-target' : ''}`}
        data-room-column={room.id}
        key={room.id}
        style={{ height }}
      >
        {hours.map(minute => <div className="hour-line" key={minute} style={{ top: (minute - start) * PX_PER_MINUTE }} />)}
        {room.slots.length === 0 && !drag && <span className="empty-room">Noch keine Slots</span>}
        {layoutSlots(room.slots).filter(({ slot }) => slot.id !== drag?.slot.id).map(({ slot, lane, lanes }) =>
          card(slot, (toMinutes(slot.start_time) - start) * PX_PER_MINUTE, (toMinutes(slot.end_time) - toMinutes(slot.start_time)) * PX_PER_MINUTE, lane, lanes))}
        {drag && drag.roomId === room.id && previewStart !== null && previewEnd !== null && card(
          { ...drag.slot, room_id: room.id, start_time: toTime(previewStart), end_time: toTime(previewEnd) },
          (previewStart - start) * PX_PER_MINUTE,
          (previewEnd - previewStart) * PX_PER_MINUTE,
          0, 1, true,
        )}
        {backlogPreview?.roomId === room.id && <article className="slot-card ghost backlog-ghost" style={{ top: (backlogPreview.start - start) * PX_PER_MINUTE, height: 60 * PX_PER_MINUTE }}><strong>{backlogPreview.topic}</strong><span>{toTime(backlogPreview.start)}–{toTime(backlogPreview.start + 60)}</span></article>}
      </div>)}
    </div>
  </div>
}
