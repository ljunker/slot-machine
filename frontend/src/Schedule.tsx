import { Fragment, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent } from 'react'
import type { DaySchedule, Duty, HelperPlan, Slot } from './types'
import { layoutSlots, movePatch, PX_PER_MINUTE, resizePatch, snappedDelta, toMinutes, toTime } from './time'
import { activeNotice, noticeLabel, useNoticeNow } from './changeNotice'
import DutySignup from './DutySignup'
import CategoryLabels, { CategoryStripe } from './CategoryLabels'
import { sharedPresentation } from './sharedSessions'

type SlotPatch = { room_id?: number | null; start_time?: string; end_time?: string }
type Drag = { slot: Slot; mode: 'move' | 'resize'; originY: number; delta: number; roomId: number | null; overProgram: boolean }
type ActiveDuty = Duty & { day_id: number; start_time: string; end_time: string }
export type DutyPatch = { kind?: 'general' | 'room'; room_id?: number | null; start_time?: string; end_time?: string }
type DutyTarget = { roomId: number | null }
type DutyDrag = { duty: ActiveDuty; mode: 'move' | 'resize'; originX: number; originY: number; delta: number;
  target: DutyTarget | null; moved: boolean; reordering: boolean; reorderIds: number[] | null }

function dutyGroups(duties: ActiveDuty[]) {
  const sorted = [...duties].sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time) || a.id - b.id)
  const groups: ActiveDuty[][] = []
  let groupEnd = -1
  for (const duty of sorted) {
    if (groups.length === 0 || toMinutes(duty.start_time) >= groupEnd) {
      groups.push([])
      groupEnd = -1
    }
    groups[groups.length - 1].push(duty)
    groupEnd = Math.max(groupEnd, toMinutes(duty.end_time))
  }
  return groups
}

function layoutDuties(duties: ActiveDuty[]) {
  const groups = dutyGroups(duties)
  return groups.flatMap(group => {
    const lanes: ActiveDuty[][] = []
    const entries = [...group].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id).map(duty => {
      const overlaps = (other: ActiveDuty) => toMinutes(duty.start_time) < toMinutes(other.end_time)
        && toMinutes(other.start_time) < toMinutes(duty.end_time)
      let lane = lanes.findIndex(items => items.every(item => !overlaps(item)))
      if (lane === -1) lane = lanes.length
      if (!lanes[lane]) lanes[lane] = []
      lanes[lane].push(duty)
      return { duty, lane }
    })
    return entries.map(entry => ({ ...entry, lanes: lanes.length }))
  })
}

function reorderedDutyIds(duties: ActiveDuty[], source: ActiveDuty, pointerX: number, rect: DOMRect) {
  const group = dutyGroups(duties).find(items => items.some(item => item.id === source.id))
  if (!group || group.length < 2) return null
  const layout = layoutDuties(group)
  const sourceLayout = layout.find(item => item.duty.id === source.id)!
  const lane = Math.max(0, Math.min(sourceLayout.lanes - 1,
    Math.floor((pointerX - rect.left) / rect.width * sourceLayout.lanes)))
  const target = layout.filter(item => item.lane === lane).find(item =>
    toMinutes(item.duty.start_time) < toMinutes(source.end_time)
    && toMinutes(source.start_time) < toMinutes(item.duty.end_time)) ?? layout.find(item => item.lane === lane)
  if (!target || target.duty.id === source.id) return null
  const ordered = [...duties].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id).map(duty => duty.id)
  const sourceIndex = ordered.indexOf(source.id)
  const targetIndex = ordered.indexOf(target.duty.id)
  ordered.splice(sourceIndex, 1)
  ordered.splice(ordered.indexOf(target.duty.id) + (sourceIndex < targetIndex ? 1 : 0), 0, source.id)
  return ordered
}

function helperColumnWidth(duties: ActiveDuty[]) {
  const lanes = layoutDuties(duties).reduce((max, entry) => Math.max(max, entry.lanes), 1)
  return Math.max(320, lanes * 220)
}

function dutyTitle(duty: Duty): string {
  if (duty.kind === 'session' && duty.title && duty.session_topic) return `${duty.title}: ${duty.session_topic}`
  return duty.title || duty.session_topic || (duty.kind === 'room' ? 'Raumdienst' : 'Allgemeiner Dienst')
}

export default function Schedule({ schedule, helperPlan = { duties: [], conflicts: [] }, focus = 'program', backlogPreview, hasSharedBacklog = false, onEdit, onEditDuty, onChange, onChangeDuty, onReorderDuties, readOnly = false, currentUserId, onSignup }: {
  readOnly?: boolean
  currentUserId?: number
  onSignup?: (duty: Duty, leave: boolean) => Promise<void>
  schedule: DaySchedule
  helperPlan?: HelperPlan
  focus?: 'program' | 'helpers'
  backlogPreview?: { roomId: number | null; start: number; topic: string } | null
  hasSharedBacklog?: boolean
  onEdit: (slot: Slot) => void
  onEditDuty?: (duty: Duty) => void
  onChange: (slotId: number, patch: SlotPatch) => Promise<void>
  onChangeDuty?: (duty: Duty, patch: DutyPatch) => Promise<void>
  onReorderDuties?: (dayId: number, roomId: number | null, dutyIds: number[]) => Promise<void>
}) {
  const [drag, setDrag] = useState<Drag | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const [dutyDrag, setDutyDrag] = useState<DutyDrag | null>(null)
  const dutyDragRef = useRef<DutyDrag | null>(null)
  const suppressDutyClick = useRef<number | null>(null)
  const shared = schedule.shared_slots ?? []
  const rooms = schedule.rooms.length || shared.length === 0 && !hasSharedBacklog ? schedule.rooms : [{ id: 0, event_id: 0, name: 'Alle Räume', sort_order: 0, slots: [] }]
  const sharedLabelWidth = focus === 'helpers' ? '165px' : `calc((100% - ${180 * (rooms.length - 1)}px) / ${rooms.length || 1} - 18px)`
  const presentation = sharedPresentation(schedule.rooms.flatMap(room => room.slots), shared)
  const start = toMinutes(schedule.start_time)
  const end = toMinutes(schedule.end_time)
  const height = (end - start) * PX_PER_MINUTE
  const collisionIds = new Set(schedule.collisions.flatMap(pair => [pair.first_slot_id, pair.second_slot_id]))
  const speakerConflictIds = new Set(schedule.speaker_conflicts.flatMap(pair => [pair.first_slot_id, pair.second_slot_id]))
  const activeDuties = helperPlan.duties.filter((duty): duty is ActiveDuty =>
    duty.status === 'active' && duty.day_id === schedule.day_id && duty.start_time !== null && duty.end_time !== null)
  const generalDuties = activeDuties.filter(duty => duty.room_id === null)
  const roomDuties = rooms.map(room => activeDuties.filter(duty => duty.room_id === room.id))
  function columnDuties(roomId: number | null) {
    return roomId === null ? generalDuties : roomDuties[rooms.findIndex(room => room.id === roomId)] ?? []
  }
  const activeDutyIds = new Set(activeDuties.map(duty => duty.id))
  const dutyConflicts = helperPlan.conflicts.filter(pair => activeDutyIds.has(pair.first_duty_id) && activeDutyIds.has(pair.second_duty_id))
  const dutyConflictHelperIds = new Map<number, Set<number>>()
  for (const pair of dutyConflicts) {
    for (const dutyId of [pair.first_duty_id, pair.second_duty_id]) {
      const helperIds = dutyConflictHelperIds.get(dutyId) ?? new Set<number>()
      pair.user_ids.forEach(id => helperIds.add(id))
      dutyConflictHelperIds.set(dutyId, helperIds)
    }
  }
  const dutyById = new Map(activeDuties.map(duty => [duty.id, duty]))
  const helperById = new Map(helperPlan.duties.flatMap(duty => duty.users).map(helper => [helper.id, helper.name]))
  const slots = [...schedule.rooms.flatMap(room => room.slots), ...shared]
  const now = useNoticeNow(slots)
  const slotById = new Map(slots.map(slot => [slot.id, slot]))
  const roomById = new Map(schedule.rooms.map(room => [room.id, room.name]))
  const speakerById = new Map(slots.flatMap(slot => slot.speakers).map(speaker => [speaker.id, speaker.name]))
  function roomName(slot: Slot) { return slot.scope === 'all_rooms' ? 'Alle Räume' : roomById.get(slot.room_id!) }
  const hours: number[] = []
  for (let minute = Math.ceil(start / 60) * 60; minute <= end; minute += 60) hours.push(minute)

  function begin(event: PointerEvent, slot: Slot, mode: 'move' | 'resize') {
    if (readOnly || event.button !== 0) return
    event.preventDefault()
    const initial: Drag = { slot, mode, originY: event.clientY, delta: 0, roomId: slot.room_id, overProgram: true }
    dragRef.current = initial
    setDrag(initial)

    function move(pointer: globalThis.PointerEvent) {
      const current = dragRef.current
      if (!current) return
      const delta = snappedDelta(pointer.clientY - current.originY)
      let roomId = current.roomId
      let overProgram = current.overProgram
      if (current.mode === 'move') {
        overProgram = false
        const columns = document.querySelectorAll<HTMLElement>(slot.scope === 'all_rooms' ? '[data-program-column]' : '[data-room-column]')
        for (const column of columns) {
          const rect = column.getBoundingClientRect()
          if (pointer.clientX >= rect.left && pointer.clientX <= rect.right) {
            roomId = slot.scope === 'all_rooms' ? null : Number(column.dataset.roomColumn)
            overProgram = true
            break
          }
        }
      }
      const next = { ...current, delta, roomId, overProgram }
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
        if (!current.overProgram) return
        const patch = { ...movePatch(current.slot, current.delta, current.roomId ?? 0, start, end), room_id: current.roomId }
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

  function beginDuty(event: PointerEvent, duty: ActiveDuty, mode: 'move' | 'resize') {
    if (event.button !== 0 || !onChangeDuty) return
    event.preventDefault()
    const initial: DutyDrag = { duty, mode, originX: event.clientX, originY: event.clientY, delta: 0,
      target: { roomId: duty.room_id }, moved: false, reordering: false, reorderIds: null }
    dutyDragRef.current = initial

    function move(pointer: globalThis.PointerEvent) {
      const current = dutyDragRef.current
      if (!current) return
      let target = current.target
      let targetRect: DOMRect | null = null
      if (current.mode === 'move') {
        target = null
        for (const column of document.querySelectorAll<HTMLElement>('[data-duty-column]')) {
          const rect = column.getBoundingClientRect()
          if (pointer.clientX < rect.left || pointer.clientX > rect.right) continue
          const roomId = column.dataset.dutyColumn === 'general' ? null : Number(column.dataset.dutyColumn)
          if (current.duty.kind !== 'session' || (current.duty.room_id === null ? roomId === null : roomId !== null)) {
            target = { roomId }
            targetRect = rect
          }
          break
        }
      }
      const dx = pointer.clientX - current.originX
      const dy = pointer.clientY - current.originY
      const reordering = current.mode === 'move' && target?.roomId === current.duty.room_id
        && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)
      const reorderIds = reordering && targetRect
        ? reorderedDutyIds(columnDuties(current.duty.room_id), current.duty, pointer.clientX, targetRect)
        : null
      const next = { ...current, delta: reordering ? 0 : snappedDelta(dy), target, reordering, reorderIds,
        moved: current.moved || Math.abs(pointer.clientX - current.originX) > 3 || Math.abs(pointer.clientY - current.originY) > 3 }
      dutyDragRef.current = next
      if (next.moved) setDutyDrag(next)
    }

    function cleanup() {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', cancel)
      const current = dutyDragRef.current
      dutyDragRef.current = null
      setDutyDrag(null)
      return current
    }

    function finish() {
      const current = cleanup()
      if (!current) return
      if (current.moved) {
        suppressDutyClick.current = current.duty.id
        window.setTimeout(() => { if (suppressDutyClick.current === current.duty.id) suppressDutyClick.current = null }, 0)
      }
      if (current.mode === 'resize') {
        const patch = resizePatch(current.duty, current.delta, end)
        if (patch.end_time !== current.duty.end_time.slice(0, 5)) void onChangeDuty?.(current.duty, patch)
        return
      }
      if (current.reordering) {
        if (current.reorderIds) void onReorderDuties?.(current.duty.day_id, current.duty.room_id, current.reorderIds)
        return
      }
      if (!current.target) return
      const moved = movePatch(current.duty, current.delta, current.target.roomId ?? 0, start, end)
      const newKind = current.target.roomId === null ? 'general' : 'room'
      if (moved.start_time === current.duty.start_time.slice(0, 5) && current.target.roomId === current.duty.room_id &&
        (current.duty.kind === 'session' || newKind === current.duty.kind)) return
      const patch: DutyPatch = { start_time: moved.start_time, end_time: moved.end_time }
      if (current.target.roomId !== current.duty.room_id) patch.room_id = current.target.roomId
      if (current.duty.kind !== 'session' && newKind !== current.duty.kind) patch.kind = newKind
      void onChangeDuty?.(current.duty, patch)
    }

    function cancel() { cleanup() }

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
      <CategoryStripe categories={slot.categories} />
      <div className="slot-grip" onPointerDown={ghost || readOnly ? undefined : event => begin(event, slot, 'move')} aria-label={readOnly ? undefined : `${slot.topic} verschieben`}>
        <strong>{compactNotice ? `${noticeLabel(notice)}: ` : ''}{slot.topic}{slot.scope === 'all_rooms' ? ' · Alle Räume' : ''}</strong>
        <span>{slot.start_time.slice(0, 5)}–{slot.end_time.slice(0, 5)}</span>
      </div>
      {slot.speakers.length > 0 && <small>{slot.speakers.map(speaker => speaker.name).join(', ')}</small>}
      <CategoryLabels categories={slot.categories} />
      {!ghost && notice && !compactNotice && <span className="change-badge">{noticeLabel(notice)}</span>}
      {!ghost && speakerConflictIds.has(slot.id) && <span className="slot-conflict-badge">Rednerkonflikt</span>}
      {!ghost && <button className="slot-edit" type="button" onClick={() => onEdit(slot)} aria-label={`${slot.topic} ${readOnly ? 'ansehen' : 'bearbeiten'}`}>{readOnly ? 'Details' : 'Bearbeiten'}</button>}
      {!ghost && !readOnly && <div className="slot-resize" onPointerDown={event => begin(event, slot, 'resize')} aria-label={`${slot.topic} verlängern oder verkürzen`} />}
    </article>
  }

  const preview = drag && (drag.mode === 'move'
    ? movePatch(drag.slot, drag.delta, drag.roomId ?? 0, start, end)
    : resizePatch(drag.slot, drag.delta, end))
  const previewStart = drag && (drag.mode === 'move' ? toMinutes((preview as ReturnType<typeof movePatch>).start_time) : toMinutes(drag.slot.start_time))
  const previewEnd = drag && toMinutes(preview!.end_time)

  const dutyPreview = dutyDrag && !dutyDrag.reordering && (dutyDrag.mode === 'resize' || dutyDrag.target)
    ? (() => {
      const patch = dutyDrag.mode === 'resize'
        ? resizePatch(dutyDrag.duty, dutyDrag.delta, end)
        : movePatch(dutyDrag.duty, dutyDrag.delta, dutyDrag.target!.roomId ?? 0, start, end)
      const roomId = dutyDrag.mode === 'resize' ? dutyDrag.duty.room_id : dutyDrag.target!.roomId
      const kind = dutyDrag.duty.kind === 'session' ? 'session' : roomId === null ? 'general' : 'room'
      return { ...dutyDrag.duty, ...patch, room_id: roomId, kind } as ActiveDuty
    })()
    : null

  function dutyCard(duty: ActiveDuty, lane: number, lanes: number, ghost = false) {
    const conflictingHelperIds = ghost ? undefined : dutyConflictHelperIds.get(duty.id)
    const conflictingHelpers = duty.users.filter(helper => conflictingHelperIds?.has(helper.id))
    return <article
      key={duty.id}
      data-duty-id={duty.id}
      className={`duty-card${duty.user_ids.length === 0 ? ' duty-open' : ''}${ghost ? ' ghost' : ''}`}
      style={{ top: (toMinutes(duty.start_time) - start) * PX_PER_MINUTE, height: (toMinutes(duty.end_time) - toMinutes(duty.start_time)) * PX_PER_MINUTE,
        left: `${lane * 100 / lanes}%`, width: `${100 / lanes}%` }}
      role={ghost ? undefined : 'button'}
      tabIndex={ghost ? undefined : 0}
      aria-hidden={ghost ? true : undefined}
      aria-label={ghost ? undefined : `${dutyTitle(duty)}, ${duty.start_time.slice(0, 5)} bis ${duty.end_time.slice(0, 5)}, ${duty.user_ids.length ? duty.users.map(helper => helper.name).join(', ') : 'Offen'}${conflictingHelpers.length ? `, Helferkonflikt: ${conflictingHelpers.map(helper => helper.name).join(', ')}` : ''}`}
      onClick={ghost ? undefined : () => {
        if (suppressDutyClick.current === duty.id) return
        onEditDuty?.(duty)
      }}
      onKeyDown={ghost ? undefined : event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onEditDuty?.(duty) }
      }}
    >
      <div className="duty-grip" onPointerDown={ghost || readOnly ? undefined : event => beginDuty(event, duty, 'move')}>
        <strong>{dutyTitle(duty)}</strong><span>{duty.start_time.slice(0, 5)}–{duty.end_time.slice(0, 5)}</span>
        <small>{duty.users.length ? duty.users.map((helper, index) => <Fragment key={helper.id}>
          {index > 0 && ', '}
          <span className={conflictingHelperIds?.has(helper.id) ? 'helper-conflict-name' : undefined}
            title={conflictingHelperIds?.has(helper.id) ? 'Helferkonflikt' : undefined}>{helper.name}</span>
        </Fragment>) : 'Offen'}</small>
      </div>
      {!ghost && currentUserId !== undefined && onSignup && <DutySignup duty={duty} currentUserId={currentUserId} onSignup={onSignup} />}
      {!ghost && !readOnly && <div className="duty-resize" onPointerDown={event => beginDuty(event, duty, 'resize')}
        onClick={event => event.stopPropagation()} aria-label={`${dutyTitle(duty)} verlängern oder verkürzen`} />}
    </article>
  }

  function dutyColumn(duties: ActiveDuty[], label: string, column: number, roomId: number | null) {
    const reorderIds = dutyDrag?.reordering && dutyDrag.duty.room_id === roomId ? dutyDrag.reorderIds : null
    const ordered = reorderIds ? duties.map(duty => ({ ...duty, sort_order: reorderIds.indexOf(duty.id) })) : duties
    return <div key={label} className={`duty-column${dutyDrag?.mode === 'move' && dutyDrag.target?.roomId === roomId ? ' drop-target' : ''}`}
      data-duty-column={roomId === 0 ? undefined : roomId ?? 'general'} aria-label={label} style={{ gridColumn: column, gridRow: 3, height }}>
      {hours.map(minute => <div className="hour-line" key={minute} style={{ top: (minute - start) * PX_PER_MINUTE }} />)}
      {duties.length === 0 && <span className="empty-room">Keine Dienste</span>}
      {layoutDuties(ordered).filter(({ duty }) => duty.id !== dutyDrag?.duty.id || !dutyPreview).map(({ duty, lane, lanes }) =>
        dutyCard(duty, lane, lanes, Boolean(reorderIds && duty.id === dutyDrag?.duty.id)))}
      {dutyPreview?.room_id === roomId && dutyCard(dutyPreview, 0, 1, true)}
    </div>
  }

  return <div className={`schedule-scroll${readOnly ? ' schedule-readonly' : ''}`} aria-label={focus === 'helpers' ? 'Helferplan' : 'Tagesplan'}>
    {schedule.speaker_conflicts.length > 0 && <section className="speaker-conflict-list" aria-label="Rednerkonflikte">
      <h3>Rednerkonflikte</h3>
      <ul>{schedule.speaker_conflicts.map(conflict => {
        const first = slotById.get(conflict.first_slot_id)
        const second = slotById.get(conflict.second_slot_id)
        if (!first || !second) return null
        return <li key={`${first.id}-${second.id}`}>{conflict.speaker_ids.map(id => speakerById.get(id)).filter(Boolean).join(', ')}: {first.topic} ({roomName(first)}, {first.start_time.slice(0, 5)}–{first.end_time.slice(0, 5)}) und {second.topic} ({roomName(second)}, {second.start_time.slice(0, 5)}–{second.end_time.slice(0, 5)})</li>
      })}</ul>
    </section>}
    {dutyConflicts.length > 0 && <section className="speaker-conflict-list" aria-label="Helferkonflikte">
      <h3>Helferkonflikte</h3><ul>{dutyConflicts.flatMap(pair => pair.user_ids.map(id => <li key={`${pair.first_duty_id}-${pair.second_duty_id}-${id}`}>
        {helperById.get(id) ?? `Helfer ${id}`}: {dutyTitle(dutyById.get(pair.first_duty_id)!)} und {dutyTitle(dutyById.get(pair.second_duty_id)!)}
      </li>))}</ul>
    </section>}
    <div className={`schedule-grid helper-schedule-grid${focus === 'helpers' ? ' helper-focus-grid' : ''}`} style={{ gridTemplateColumns: focus === 'helpers'
      ? `72px ${helperColumnWidth(generalDuties)}px ${roomDuties.map(duties => `${helperColumnWidth(duties)}px 180px`).join(' ')}`
      : `72px 180px ${rooms.map(() => 'minmax(240px, 1fr) 180px').join(' ')}` }}>
      <div className="time-head" style={{ gridColumn: 1, gridRow: '1 / span 2' }}>Zeit</div>
      <div className="duty-head general-head" style={{ gridColumn: 2, gridRow: '1 / span 2' }}>Allgemeine Dienste</div>
      {rooms.map((room, index) => <div className="room-head" key={`head-${room.id}`} style={{ gridColumn: `${3 + index * 2} / span 2`, gridRow: 1 }}>{room.name}</div>)}
      {rooms.map((room, index) => <div className="room-subhead" key={`program-${room.id}`} style={{ gridColumn: (focus === 'helpers' ? 4 : 3) + index * 2, gridRow: 2 }}>Programm</div>)}
      {rooms.map((room, index) => <div className="room-subhead duty-subhead" key={`duty-${room.id}`} style={{ gridColumn: (focus === 'helpers' ? 3 : 4) + index * 2, gridRow: 2 }}>Helferdienste</div>)}
      <div className="time-axis" style={{ gridColumn: 1, gridRow: 3, height }}>
        {hours.map(minute => <div className="hour-label" key={minute} style={{ top: Math.max(9, Math.min(height - 9, (minute - start) * PX_PER_MINUTE)) }}>{toTime(minute)}</div>)}
      </div>
      {dutyColumn(generalDuties, 'Allgemeine Dienste', 2, null)}
      {rooms.map((room, index) => <div
        className={`room-column${drag?.roomId === room.id || backlogPreview?.roomId === room.id ? ' drop-target' : ''}`}
        data-room-column={room.id || undefined}
        data-program-column={room.id}
        key={room.id}
        style={{ gridColumn: (focus === 'helpers' ? 4 : 3) + index * 2, gridRow: 3, height }}
      >
        {hours.map(minute => <div className="hour-line" key={minute} style={{ top: (minute - start) * PX_PER_MINUTE }} />)}
        {room.slots.length === 0 && shared.length === 0 && !drag && <span className="empty-room">Noch keine Slots</span>}
        {layoutSlots([...room.slots, ...presentation.repeated]).filter(({ slot }) => slot.id !== drag?.slot.id || (drag.mode === 'move' && !drag.overProgram)).map(({ slot, lane, lanes }) =>
          card(slot, (toMinutes(slot.start_time) - start) * PX_PER_MINUTE, (toMinutes(slot.end_time) - toMinutes(slot.start_time)) * PX_PER_MINUTE, lane, lanes))}
        {drag && (drag.mode === 'resize' || drag.overProgram) && drag.roomId === room.id && previewStart !== null && previewEnd !== null && card(
          { ...drag.slot, room_id: room.id, start_time: toTime(previewStart), end_time: toTime(previewEnd) },
          (previewStart - start) * PX_PER_MINUTE,
          (previewEnd - previewStart) * PX_PER_MINUTE,
          0, 1, true,
        )}
        {backlogPreview?.roomId === room.id && <article className="slot-card ghost backlog-ghost" style={{ top: (backlogPreview.start - start) * PX_PER_MINUTE, height: 60 * PX_PER_MINUTE }}><strong>{backlogPreview.topic}</strong><span>{toTime(backlogPreview.start)}–{toTime(backlogPreview.start + 60)}</span></article>}
      </div>)}
      {rooms.map((room, index) => dutyColumn(roomDuties[index], `Helferdienste ${room.name}`, (focus === 'helpers' ? 3 : 4) + index * 2, room.id))}
      {rooms.length > 0 && <div className="shared-slot-layer" data-shared-layer style={{ gridColumn: `${focus === 'helpers' ? 4 : 3} / ${(focus === 'helpers' ? 5 : 4) + (rooms.length - 1) * 2}`, gridRow: 3, height, '--shared-label-width': sharedLabelWidth } as CSSProperties}>
        {presentation.spanning.filter(slot => slot.id !== drag?.slot.id || drag.mode === 'move' && !drag.overProgram).map(slot =>
          card(slot, (toMinutes(slot.start_time) - start) * PX_PER_MINUTE, (toMinutes(slot.end_time) - toMinutes(slot.start_time)) * PX_PER_MINUTE, 0, 1))}
        {drag?.slot.scope === 'all_rooms' && (drag.mode === 'resize' || drag.overProgram) && previewStart !== null && previewEnd !== null && card(
          { ...drag.slot, start_time: toTime(previewStart), end_time: toTime(previewEnd) },
          (previewStart - start) * PX_PER_MINUTE, (previewEnd - previewStart) * PX_PER_MINUTE, 0, 1, true)}
        {backlogPreview?.roomId === null && <article className="slot-card ghost backlog-ghost" style={{ top: (backlogPreview.start - start) * PX_PER_MINUTE, height: 60 * PX_PER_MINUTE }}><strong>{backlogPreview.topic} · Alle Räume</strong><span>{toTime(backlogPreview.start)}–{toTime(backlogPreview.start + 60)}</span></article>}
      </div>}
    </div>
  </div>
}
