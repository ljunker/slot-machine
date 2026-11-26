import { Fragment, useEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react'
import type { DaySchedule, Duty, HelperPlan, Slot } from './types'
import { layoutSlots, movePatch, PX_PER_MINUTE, resizePatch, SNAP_MINUTES, snappedDelta, toMinutes, toTime } from './time'
import { activeNotice, noticeLabel, useNoticeNow } from './changeNotice'
import Icon from './Icon'
import type { IconName } from './Icon'
import DutySignup from './DutySignup'
import CategoryLabels, { CategoryStripe } from './CategoryLabels'
import { sharedPresentation } from './sharedSessions'

type SlotPatch = { room_id?: number | null; start_time?: string; end_time?: string }
type Drag = { slot: Slot; mode: 'move' | 'resize'; originX: number; originY: number; delta: number; roomId: number | null; overProgram: boolean; moved: boolean }
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

/** Wie viel eine Karte zeigt, abhängig von der Dauer: ab 60 Minuten alles, ab 30 Minuten das Wichtigste, darunter eine Zeile. */
export type CardDensity = 'full' | 'medium' | 'compact'
export function cardDensity(minutes: number): CardDensity {
  return minutes >= 60 ? 'full' : minutes >= 30 ? 'medium' : 'compact'
}

/** Zustände einer Karte mit Farbe (Klasse), Icon und Kurzlabel. Bedeutung siehe docs/designsystem.md. */
export type CardStatus = { key: string; tone: 'conflict' | 'action' | 'change' | 'inactive' | 'mine'; icon: IconName; label: string }

export function StatusBadges({ statuses }: { statuses: CardStatus[] }) {
  if (!statuses.length) return null
  return <span className="status-badges">
    {statuses.map(status => <span key={status.key} className={`status-badge status-${status.tone}`}>
      <Icon name={status.icon} size={13} /><span className="status-label">{status.label}</span>
    </span>)}
  </span>
}

/** Tastenkürzel einer Karte im Plan, für `aria-keyshortcuts`. */
const SLOT_SHORTCUTS = 'Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight Shift+Alt+ArrowUp Shift+Alt+ArrowDown'
const DUTY_SHORTCUTS = 'Alt+ArrowUp Alt+ArrowDown Shift+Alt+ArrowUp Shift+Alt+ArrowDown'

/** Welche Änderung ein Tastendruck auf einer Karte auslöst, oder null für andere Tasten. */
export function keyboardAction(event: Pick<KeyboardEvent, 'key' | 'altKey' | 'shiftKey' | 'ctrlKey' | 'metaKey'>):
  { kind: 'move' | 'resize'; delta: number } | { kind: 'room'; direction: -1 | 1 } | null {
  if (!event.altKey || event.ctrlKey || event.metaKey) return null
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    return { kind: event.shiftKey ? 'resize' : 'move', delta: event.key === 'ArrowUp' ? -SNAP_MINUTES : SNAP_MINUTES }
  }
  if (!event.shiftKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) return { kind: 'room', direction: event.key === 'ArrowLeft' ? -1 : 1 }
  return null
}

function dutyTitle(duty: Duty): string {
  if (duty.kind === 'session' && duty.title && duty.session_topic) return `${duty.title}: ${duty.session_topic}`
  return duty.title || duty.session_topic || (duty.kind === 'room' ? 'Raumdienst' : 'Allgemeiner Dienst')
}

export default function Schedule({ schedule, helperPlan = { duties: [], conflicts: [] }, focus = 'program', backlogPreview, hasSharedBacklog = false, onEdit, onEditDuty, onChange, onChangeDuty, onReorderDuties, readOnly = false, currentUserId, onSignup, pxPerMinute = PX_PER_MINUTE, showDuties = true }: {
  readOnly?: boolean
  /** Höhe einer Minute im Raster (Zoomstufe). */
  pxPerMinute?: number
  currentUserId?: number
  onSignup?: (duty: Duty, leave: boolean) => Promise<void>
  schedule: DaySchedule
  helperPlan?: HelperPlan
  focus?: 'program' | 'helpers'
  /** Nur im Programmfokus: Dienstspalten zeigen. Ohne sie markieren Programmkarten fehlende Helfer. */
  showDuties?: boolean
  backlogPreview?: { roomId: number | null; start: number; topic: string } | null
  hasSharedBacklog?: boolean
  onEdit: (slot: Slot) => void
  onEditDuty?: (duty: Duty) => void
  onChange: (slotId: number, patch: SlotPatch) => Promise<unknown>
  onChangeDuty?: (duty: Duty, patch: DutyPatch) => Promise<unknown>
  onReorderDuties?: (dayId: number, roomId: number | null, dutyIds: number[]) => Promise<unknown>
}) {
  const [drag, setDrag] = useState<Drag | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const [dutyDrag, setDutyDrag] = useState<DutyDrag | null>(null)
  const dutyDragRef = useRef<DutyDrag | null>(null)
  const suppressDutyClick = useRef<number | null>(null)
  const suppressSlotClick = useRef<number | null>(null)
  /** Ansage für Screenreader nach einer Änderung per Tastatur. */
  const [announcement, setAnnouncement] = useState('')
  /** Karte, die nach einer Änderung per Tastatur den Fokus zurückbekommt (sie kann in eine andere Spalte gewandert sein). */
  const pendingFocus = useRef<{ kind: 'slot' | 'duty'; id: number } | null>(null)
  useEffect(() => {
    const target = pendingFocus.current
    if (!target) return
    const element = document.querySelector<HTMLElement>(target.kind === 'slot'
      ? `[data-slot-id="${target.id}"]:not(.ghost) .slot-title` : `[data-duty-id="${target.id}"]:not(.ghost)`)
    if (!element) return
    pendingFocus.current = null
    if (document.activeElement !== element) element.focus()
  })
  const shared = schedule.shared_slots ?? []
  const rooms = schedule.rooms.length || shared.length === 0 && !hasSharedBacklog ? schedule.rooms : [{ id: 0, event_id: 0, name: 'Alle Räume', sort_order: 0, slots: [] }]
  const helpersFocus = focus === 'helpers'
  const dutyColumns = helpersFocus || showDuties
  /** Rasterspalte des Programms bzw. der Dienste eines Raums (1 = Zeit, 2 = allgemeine Dienste). */
  const programColumn = (index: number) => dutyColumns ? (helpersFocus ? 4 : 3) + index * 2 : 2 + index
  const dutyColumnIndex = (index: number) => (helpersFocus ? 3 : 4) + index * 2
  const sharedLabelWidth = helpersFocus ? '165px'
    : dutyColumns ? `calc((100% - ${180 * (rooms.length - 1)}px) / ${rooms.length || 1} - 18px)`
    : `calc(100% / ${rooms.length || 1} - 18px)`
  const presentation = sharedPresentation(schedule.rooms.flatMap(room => room.slots), shared)
  const start = toMinutes(schedule.start_time)
  const end = toMinutes(schedule.end_time)
  const height = (end - start) * pxPerMinute
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
  const openPlacesBySlot = new Map<number, number>()
  if (!dutyColumns) for (const duty of activeDuties) {
    if (duty.slot_id === null || duty.user_ids.length >= duty.capacity) continue
    openPlacesBySlot.set(duty.slot_id, (openPlacesBySlot.get(duty.slot_id) ?? 0) + duty.capacity - duty.user_ids.length)
  }
  const helperById = new Map(helperPlan.duties.flatMap(duty => duty.users).map(helper => [helper.id, helper.name]))
  const slots = [...schedule.rooms.flatMap(room => room.slots), ...shared]
  const now = useNoticeNow(slots)
  const slotById = new Map(slots.map(slot => [slot.id, slot]))
  const roomById = new Map(schedule.rooms.map(room => [room.id, room.name]))
  const speakerById = new Map(slots.flatMap(slot => slot.speakers).map(speaker => [speaker.id, speaker.name]))
  function roomName(slot: Slot) { return slot.scope === 'all_rooms' ? 'Alle Räume' : roomById.get(slot.room_id!) }
  const hours: number[] = []
  for (let minute = Math.ceil(start / 60) * 60; minute <= end; minute += 60) hours.push(minute)
  const halfHours: number[] = []
  for (let minute = Math.ceil(start / 30) * 30; minute <= end; minute += 30) if (minute % 60 !== 0) halfHours.push(minute)
  const gridLines = <>
    {hours.map(minute => <div className="hour-line" key={minute} style={{ top: (minute - start) * pxPerMinute }} />)}
    {halfHours.map(minute => <div className="half-hour-line" key={`half-${minute}`} style={{ top: (minute - start) * pxPerMinute }} />)}
  </>

  function begin(event: PointerEvent, slot: Slot, mode: 'move' | 'resize') {
    if (readOnly || event.button !== 0) return
    event.preventDefault()
    const initial: Drag = { slot, mode, originX: event.clientX, originY: event.clientY, delta: 0, roomId: slot.room_id, overProgram: true, moved: false }
    dragRef.current = initial

    function move(pointer: globalThis.PointerEvent) {
      const current = dragRef.current
      if (!current) return
      const delta = snappedDelta(pointer.clientY - current.originY, pxPerMinute)
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
      const next = { ...current, delta, roomId, overProgram, moved: current.moved || Math.abs(pointer.clientX - current.originX) > 3 || Math.abs(pointer.clientY - current.originY) > 3 }
      dragRef.current = next
      if (next.moved) setDrag(next)
    }

    function finish() {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', cancel)
      const current = dragRef.current
      dragRef.current = null
      setDrag(null)
      if (!current?.moved) return
      suppressSlotClick.current = current.slot.id
      window.setTimeout(() => { if (suppressSlotClick.current === current.slot.id) suppressSlotClick.current = null }, 0)
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
      const next = { ...current, delta: reordering ? 0 : snappedDelta(dy, pxPerMinute), target, reordering, reorderIds,
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

  function slotKeyDown(event: KeyboardEvent, slot: Slot) {
    const action = readOnly ? null : keyboardAction(event)
    if (!action) return
    event.preventDefault()
    event.stopPropagation()
    const current = { start_time: slot.start_time.slice(0, 5), end_time: slot.end_time.slice(0, 5) }
    let patch: SlotPatch = {}
    if (action.kind === 'move') {
      const moved = movePatch(slot, action.delta, 0, start, end)
      patch = { room_id: slot.room_id, start_time: moved.start_time, end_time: moved.end_time }
    } else if (action.kind === 'resize') {
      patch = resizePatch(slot, action.delta, end)
    } else if (action.kind === 'room' && slot.scope !== 'all_rooms') {
      const next = schedule.rooms[schedule.rooms.findIndex(room => room.id === slot.room_id) + action.direction]
      if (next) patch = { room_id: next.id, ...current }
    }
    const next = { room_id: patch.room_id ?? slot.room_id, start_time: patch.start_time ?? current.start_time, end_time: patch.end_time ?? current.end_time }
    if (next.room_id === slot.room_id && next.start_time === current.start_time && next.end_time === current.end_time) {
      setAnnouncement(`${slot.topic}: ${action.kind === 'room' ? 'kein weiterer Raum in dieser Richtung' : 'Grenze des Tages erreicht'}`)
      return
    }
    const place = slot.scope === 'all_rooms' ? 'Alle Räume' : roomById.get(next.room_id!) ?? 'Raum'
    setAnnouncement(`${slot.topic}, ${next.start_time}–${next.end_time}, ${place}`)
    pendingFocus.current = { kind: 'slot', id: slot.id }
    void onChange(slot.id, patch)
  }

  function dutyKeyDown(event: KeyboardEvent, duty: ActiveDuty): boolean {
    const action = readOnly || !onChangeDuty ? null : keyboardAction(event)
    if (!action || action.kind === 'room') return false
    event.preventDefault()
    const patch: DutyPatch = action.kind === 'move'
      ? (({ start_time, end_time }) => ({ start_time, end_time }))(movePatch(duty, action.delta, 0, start, end))
      : resizePatch(duty, action.delta, end)
    const startTime = patch.start_time ?? duty.start_time.slice(0, 5)
    const endTime = patch.end_time ?? duty.end_time.slice(0, 5)
    if (startTime === duty.start_time.slice(0, 5) && endTime === duty.end_time.slice(0, 5)) {
      setAnnouncement(`${dutyTitle(duty)}: Grenze des Tages erreicht`)
      return true
    }
    setAnnouncement(`${dutyTitle(duty)}, ${startTime}–${endTime}`)
    pendingFocus.current = { kind: 'duty', id: duty.id }
    void onChangeDuty?.(duty, patch)
    return true
  }

  function slotStatuses(slot: Slot, notice: ReturnType<typeof activeNotice>): CardStatus[] {
    const statuses: CardStatus[] = []
    if (collisionIds.has(slot.id)) statuses.push({ key: 'room', tone: 'conflict', icon: 'conflict', label: 'Raumkonflikt' })
    if (speakerConflictIds.has(slot.id)) statuses.push({ key: 'speaker', tone: 'conflict', icon: 'user', label: 'Rednerkonflikt' })
    const openPlaces = openPlacesBySlot.get(slot.id) ?? 0
    if (openPlaces > 0) statuses.push({ key: 'helpers', tone: 'action', icon: 'users',
      label: openPlaces === 1 ? '1 Helfer fehlt' : `${openPlaces} Helfer fehlen` })
    if (notice) statuses.push({ key: 'notice', tone: notice.type === 'cancelled' ? 'inactive' : 'change',
      icon: notice.type === 'rescheduled' ? 'moved' : notice.type === 'cancelled' ? 'cancelled' : 'changed', label: noticeLabel(notice) })
    return statuses
  }

  function card(slot: Slot, top: number, cardHeight: number, lane: number, lanes: number, ghost = false) {
    const notice = activeNotice(slot, now)
    const statuses = ghost ? [] : slotStatuses(slot, notice)
    const time = `${slot.start_time.slice(0, 5)}–${slot.end_time.slice(0, 5)}`
    const title = `${slot.topic}${slot.scope === 'all_rooms' ? ' · Alle Räume' : ''}`
    const density = cardDensity(toMinutes(slot.end_time) - toMinutes(slot.start_time))
    const tooltip = [title, `${time} Uhr`, slot.speakers.length ? `Redner: ${slot.speakers.map(speaker => speaker.name).join(', ')}` : '',
      slot.categories?.length ? `Kategorien: ${slot.categories.map(category => category.name).join(', ')}` : '',
      ...statuses.map(status => status.label), readOnly ? 'Klicken für Details' : 'Ziehen zum Verschieben, Klicken zum Bearbeiten'].filter(Boolean).join('\n')
    return <article
      key={slot.id}
      data-slot-id={slot.id}
      className={`slot-card density-${density}${collisionIds.has(slot.id) ? ' collision' : ''}${speakerConflictIds.has(slot.id) ? ' speaker-conflict' : ''}${notice ? ` notice-${notice.type}` : ''}${ghost ? ' ghost' : ''}`}
      style={{ top, height: cardHeight, left: `${lane * 100 / lanes}%`, width: `${100 / lanes}%`, '--status-count': statuses.length } as CSSProperties}
      title={ghost ? undefined : tooltip}
      aria-hidden={ghost ? true : undefined}
      onClick={ghost ? undefined : () => {
        if (suppressSlotClick.current === slot.id) return
        onEdit(slot)
      }}
      onKeyDown={ghost ? undefined : event => slotKeyDown(event, slot)}
    >
      <CategoryStripe categories={slot.categories} />
      <div className="slot-grip" onPointerDown={ghost || readOnly ? undefined : event => begin(event, slot, 'move')}>
        {ghost ? <strong className="slot-title">{title}</strong>
          : <button type="button" className="slot-title" aria-label={`${slot.topic} ${readOnly ? 'ansehen' : 'bearbeiten'}`}
            aria-keyshortcuts={readOnly ? undefined : SLOT_SHORTCUTS}>{title}</button>}
        <time className="slot-time">{time}</time>
      </div>
      <StatusBadges statuses={statuses} />
      {density === 'full' && slot.speakers.length > 0 && <small className="slot-speakers">{slot.speakers.map(speaker => speaker.name).join(', ')}</small>}
      {density === 'full' && <CategoryLabels categories={slot.categories} />}
      {!ghost && !readOnly && <div className="slot-resize" title="Ziehen, um die Dauer zu ändern (Tastatur: Umschalt + Alt + Pfeil)" onPointerDown={event => begin(event, slot, 'resize')}
        onClick={event => event.stopPropagation()} aria-hidden="true" />}
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
    const density = cardDensity(toMinutes(duty.end_time) - toMinutes(duty.start_time))
    const mine = !ghost && currentUserId !== undefined && duty.user_ids.includes(currentUserId)
    const statuses: CardStatus[] = []
    if (mine) statuses.push({ key: 'mine', tone: 'mine', icon: 'user', label: 'Du' })
    if (!ghost && conflictingHelpers.length) statuses.push({ key: 'helper', tone: 'conflict', icon: 'users', label: 'Helferkonflikt' })
    // Bei großen Karten steht „Offen“ schon in der Helferzeile; das Badge braucht es dann nur für Restplätze.
    if (!ghost && duty.user_ids.length < duty.capacity && (density !== 'full' || duty.user_ids.length > 0)) statuses.push({ key: 'open', tone: 'action', icon: 'warning',
      label: duty.user_ids.length === 0 ? 'Offen' : `${duty.capacity - duty.user_ids.length} frei` })
    return <article
      key={duty.id}
      data-duty-id={duty.id}
      className={`duty-card density-${density}${mine ? ' duty-mine' : ''}${duty.user_ids.length === 0 ? ' duty-open' : ''}${conflictingHelpers.length ? ' helper-conflict' : ''}${ghost ? ' ghost' : ''}`}
      style={{ top: (toMinutes(duty.start_time) - start) * pxPerMinute, height: (toMinutes(duty.end_time) - toMinutes(duty.start_time)) * pxPerMinute,
        left: `${lane * 100 / lanes}%`, width: `${100 / lanes}%`, '--status-count': statuses.length } as CSSProperties}
      role={ghost ? undefined : 'button'}
      tabIndex={ghost ? undefined : 0}
      aria-hidden={ghost ? true : undefined}
      aria-label={ghost ? undefined : `${dutyTitle(duty)}, ${duty.start_time.slice(0, 5)} bis ${duty.end_time.slice(0, 5)}${mine ? ', du bist eingeteilt' : ''}, ${duty.user_ids.length ? duty.users.map(helper => helper.name).join(', ') : 'Offen'}${conflictingHelpers.length ? `, Helferkonflikt: ${conflictingHelpers.map(helper => helper.name).join(', ')}` : ''}`}
      onClick={ghost ? undefined : () => {
        if (suppressDutyClick.current === duty.id) return
        onEditDuty?.(duty)
      }}
      aria-keyshortcuts={ghost || readOnly || !onChangeDuty ? undefined : DUTY_SHORTCUTS}
      onKeyDown={ghost ? undefined : event => {
        if (event.target !== event.currentTarget) return
        if (dutyKeyDown(event, duty)) return
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onEditDuty?.(duty) }
      }}
    >
      <div className="duty-grip" onPointerDown={ghost || readOnly ? undefined : event => beginDuty(event, duty, 'move')}>
        <strong>{dutyTitle(duty)}</strong><time className="slot-time">{duty.start_time.slice(0, 5)}–{duty.end_time.slice(0, 5)}</time>
        <small className="duty-helpers">{duty.users.length ? duty.users.map((helper, index) => <Fragment key={helper.id}>
          {index > 0 && ', '}
          <span className={conflictingHelperIds?.has(helper.id) ? 'helper-conflict-name' : undefined}
            title={conflictingHelperIds?.has(helper.id) ? 'Helferkonflikt' : undefined}>{helper.name}</span>
        </Fragment>) : 'Offen'}</small>
      </div>
      <StatusBadges statuses={statuses} />
      {!ghost && currentUserId !== undefined && onSignup && <DutySignup duty={duty} currentUserId={currentUserId} onSignup={onSignup} />}
      {!ghost && !readOnly && <div className="duty-resize" title="Ziehen, um die Dauer zu ändern (Tastatur: Umschalt + Alt + Pfeil)" onPointerDown={event => beginDuty(event, duty, 'resize')}
        onClick={event => event.stopPropagation()} aria-hidden="true" />}
    </article>
  }

  function dutyColumn(duties: ActiveDuty[], label: string, column: number, roomId: number | null) {
    const reorderIds = dutyDrag?.reordering && dutyDrag.duty.room_id === roomId ? dutyDrag.reorderIds : null
    const ordered = reorderIds ? duties.map(duty => ({ ...duty, sort_order: reorderIds.indexOf(duty.id) })) : duties
    return <div key={label} className={`duty-column${dutyDrag?.mode === 'move' && dutyDrag.target?.roomId === roomId ? ' drop-target' : ''}`}
      data-duty-column={roomId === 0 ? undefined : roomId ?? 'general'} aria-label={label} style={{ gridColumn: column, gridRow: 3, height }}>
      {gridLines}
      {duties.length === 0 && <span className="empty-room">Keine Dienste</span>}
      {layoutDuties(ordered).filter(({ duty }) => duty.id !== dutyDrag?.duty.id || !dutyPreview).map(({ duty, lane, lanes }) =>
        dutyCard(duty, lane, lanes, Boolean(reorderIds && duty.id === dutyDrag?.duty.id)))}
      {dutyPreview?.room_id === roomId && dutyCard(dutyPreview, 0, 1, true)}
    </div>
  }

  return <div className={`schedule-scroll${readOnly ? ' schedule-readonly' : ''}`} aria-label={helpersFocus ? 'Helferplan' : 'Tagesplan'}>
    <p className="visually-hidden" aria-live="polite" aria-atomic="true">{announcement}</p>
    {schedule.speaker_conflicts.length > 0 && <section className="conflict-list-banner" aria-label="Rednerkonflikte">
      <h3><Icon name="user" />Rednerkonflikte</h3>
      <ul>{schedule.speaker_conflicts.map(conflict => {
        const first = slotById.get(conflict.first_slot_id)
        const second = slotById.get(conflict.second_slot_id)
        if (!first || !second) return null
        return <li key={`${first.id}-${second.id}`}>{conflict.speaker_ids.map(id => speakerById.get(id)).filter(Boolean).join(', ')}: {first.topic} ({roomName(first)}, {first.start_time.slice(0, 5)}–{first.end_time.slice(0, 5)}) und {second.topic} ({roomName(second)}, {second.start_time.slice(0, 5)}–{second.end_time.slice(0, 5)})</li>
      })}</ul>
    </section>}
    {dutyConflicts.length > 0 && <section className="conflict-list-banner" aria-label="Helferkonflikte">
      <h3><Icon name="users" />Helferkonflikte</h3><ul>{dutyConflicts.flatMap(pair => pair.user_ids.map(id => <li key={`${pair.first_duty_id}-${pair.second_duty_id}-${id}`}>
        {helperById.get(id) ?? `Helfer ${id}`}: {dutyTitle(dutyById.get(pair.first_duty_id)!)} und {dutyTitle(dutyById.get(pair.second_duty_id)!)}
      </li>))}</ul>
    </section>}
    <div className={`schedule-grid helper-schedule-grid${helpersFocus ? ' helper-focus-grid' : ''}${dutyColumns ? '' : ' program-only-grid'}`} style={{ gridTemplateColumns: helpersFocus
      ? `72px ${helperColumnWidth(generalDuties)}px ${roomDuties.map(duties => `${helperColumnWidth(duties)}px 180px`).join(' ')}`
      : dutyColumns ? `72px 180px ${rooms.map(() => 'minmax(240px, 1fr) 180px').join(' ')}`
      : `72px ${rooms.map(() => 'minmax(240px, 1fr)').join(' ')}` }}>
      <div className="time-head" style={{ gridColumn: 1, gridRow: '1 / span 2' }}>Zeit</div>
      {dutyColumns && <div className="duty-head general-head" style={{ gridColumn: 2, gridRow: '1 / span 2' }}>Allgemeine Dienste</div>}
      {rooms.map((room, index) => <div className="room-head" key={`head-${room.id}`} style={dutyColumns
        ? { gridColumn: `${3 + index * 2} / span 2`, gridRow: 1 } : { gridColumn: programColumn(index), gridRow: '1 / span 2' }}>{room.name}</div>)}
      {dutyColumns && rooms.map((room, index) => <div className="room-subhead" key={`program-${room.id}`} style={{ gridColumn: programColumn(index), gridRow: 2 }}>Programm</div>)}
      {dutyColumns && rooms.map((room, index) => <div className="room-subhead duty-subhead" key={`duty-${room.id}`} style={{ gridColumn: dutyColumnIndex(index), gridRow: 2 }}>Helferdienste</div>)}
      <div className="time-axis" style={{ gridColumn: 1, gridRow: 3, height }}>
        {hours.map(minute => <div className="hour-label" key={minute} style={{ top: Math.max(9, Math.min(height - 9, (minute - start) * pxPerMinute)) }}>{toTime(minute)}</div>)}
      </div>
      {dutyColumns && dutyColumn(generalDuties, 'Allgemeine Dienste', 2, null)}
      {rooms.map((room, index) => <div
        className={`room-column${drag?.roomId === room.id || backlogPreview?.roomId === room.id ? ' drop-target' : ''}`}
        data-room-column={room.id || undefined}
        data-program-column={room.id}
        key={room.id}
        style={{ gridColumn: programColumn(index), gridRow: 3, height }}
      >
        {gridLines}
        {room.slots.length === 0 && shared.length === 0 && !drag && <span className="empty-room">Noch keine Sessions</span>}
        {layoutSlots([...room.slots, ...presentation.repeated]).filter(({ slot }) => slot.id !== drag?.slot.id || (drag.mode === 'move' && !drag.overProgram)).map(({ slot, lane, lanes }) =>
          card(slot, (toMinutes(slot.start_time) - start) * pxPerMinute, (toMinutes(slot.end_time) - toMinutes(slot.start_time)) * pxPerMinute, lane, lanes))}
        {drag && (drag.mode === 'resize' || drag.overProgram) && drag.roomId === room.id && previewStart !== null && previewEnd !== null && card(
          { ...drag.slot, room_id: room.id, start_time: toTime(previewStart), end_time: toTime(previewEnd) },
          (previewStart - start) * pxPerMinute,
          (previewEnd - previewStart) * pxPerMinute,
          0, 1, true,
        )}
        {backlogPreview?.roomId === room.id && <article className="slot-card ghost backlog-ghost" style={{ top: (backlogPreview.start - start) * pxPerMinute, height: 60 * pxPerMinute }}><strong>{backlogPreview.topic}</strong><span>{toTime(backlogPreview.start)}–{toTime(backlogPreview.start + 60)}</span></article>}
      </div>)}
      {dutyColumns && rooms.map((room, index) => dutyColumn(roomDuties[index], `Helferdienste ${room.name}`, dutyColumnIndex(index), room.id))}
      {rooms.length > 0 && <div className="shared-slot-layer" data-shared-layer style={{ gridColumn: `${programColumn(0)} / ${programColumn(rooms.length - 1) + 1}`, gridRow: 3, height, '--shared-label-width': sharedLabelWidth } as CSSProperties}>
        {presentation.spanning.filter(slot => slot.id !== drag?.slot.id || drag.mode === 'move' && !drag.overProgram).map(slot =>
          card(slot, (toMinutes(slot.start_time) - start) * pxPerMinute, (toMinutes(slot.end_time) - toMinutes(slot.start_time)) * pxPerMinute, 0, 1))}
        {drag?.slot.scope === 'all_rooms' && (drag.mode === 'resize' || drag.overProgram) && previewStart !== null && previewEnd !== null && card(
          { ...drag.slot, start_time: toTime(previewStart), end_time: toTime(previewEnd) },
          (previewStart - start) * pxPerMinute, (previewEnd - previewStart) * pxPerMinute, 0, 1, true)}
        {backlogPreview?.roomId === null && <article className="slot-card ghost backlog-ghost" style={{ top: (backlogPreview.start - start) * pxPerMinute, height: 60 * pxPerMinute }}><strong>{backlogPreview.topic} · Alle Räume</strong><span>{toTime(backlogPreview.start)}–{toTime(backlogPreview.start + 60)}</span></article>}
      </div>}
    </div>
  </div>
}
