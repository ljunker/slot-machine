import { useState, useSyncExternalStore } from 'react'
import type { KeyboardEvent } from 'react'
import CategoryLabels, { CategoryStripe } from './CategoryLabels'
import DutySignup from './DutySignup'
import { activeNotice, noticeLabel, useNoticeNow } from './changeNotice'
import { dutyTitle } from './MyDuties'
import { StatusBadges } from './Schedule'
import type { CardStatus } from './Schedule'
import { toMinutes } from './time'
import type { DaySchedule, Duty, HelperPlan, Slot } from './types'

/** Ob eine CSS-Media-Query zutrifft; ohne `matchMedia` (z. B. in Tests) immer false. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    notify => {
      const media = window.matchMedia?.(query)
      media?.addEventListener?.('change', notify)
      return () => media?.removeEventListener?.('change', notify)
    },
    () => window.matchMedia?.(query).matches ?? false,
    () => false,
  )
}

type Entry = { kind: 'slot'; slot: Slot; start: number } | { kind: 'duty'; duty: Duty & { start_time: string; end_time: string }; start: number }

/**
 * Tagesplan für schmale Bildschirme: ein Raum pro Tab, Sessions und Dienste als
 * chronologische Liste statt des breiten Rasters.
 */
export default function ScheduleList({ schedule, helperPlan, focus, readOnly, currentUserId, onSignup, onEdit, onEditDuty }: {
  schedule: DaySchedule
  helperPlan: HelperPlan
  focus: 'program' | 'helpers'
  readOnly: boolean
  currentUserId: number
  onSignup: (duty: Duty, leave: boolean) => Promise<void>
  onEdit: (slot: Slot) => void
  onEditDuty: (duty: Duty) => void
}) {
  const shared = schedule.shared_slots ?? []
  const generalTab = { id: 0, name: 'Allgemein' }
  const tabs = focus === 'helpers' ? [generalTab, ...schedule.rooms] : schedule.rooms.length ? schedule.rooms : [{ id: 0, name: 'Alle Räume' }]
  const [roomId, setRoomId] = useState(tabs[0]?.id ?? 0)
  const room = tabs.find(item => item.id === roomId) ?? tabs[0]
  const slots = [...schedule.rooms.flatMap(item => item.slots), ...shared]
  const now = useNoticeNow(slots)
  const collisionIds = new Set(schedule.collisions.flatMap(pair => [pair.first_slot_id, pair.second_slot_id]))
  const speakerConflictIds = new Set(schedule.speaker_conflicts.flatMap(pair => [pair.first_slot_id, pair.second_slot_id]))
  const dutyConflictIds = new Set(helperPlan.conflicts.flatMap(pair => [pair.first_duty_id, pair.second_duty_id]))
  const duties = helperPlan.duties.filter((duty): duty is Duty & { start_time: string; end_time: string } =>
    duty.status === 'active' && duty.day_id === schedule.day_id && duty.start_time !== null && duty.end_time !== null)

  const entries: Entry[] = !room ? [] : [
    ...(focus === 'program' ? [...(schedule.rooms.find(item => item.id === room.id)?.slots ?? []), ...shared]
      .filter((slot, index, all) => all.findIndex(other => other.id === slot.id) === index)
      .map(slot => ({ kind: 'slot' as const, slot, start: toMinutes(slot.start_time) })) : []),
    ...(focus === 'helpers' ? duties.filter(duty => (room.id === 0 ? duty.room_id === null : duty.room_id === room.id))
      .map(duty => ({ kind: 'duty' as const, duty, start: toMinutes(duty.start_time) })) : []),
  ].sort((a, b) => a.start - b.start || (a.kind === 'slot' ? a.slot.id : a.duty.sort_order) - (b.kind === 'slot' ? b.slot.id : b.duty.sort_order))

  function chooseRoom(nextId: number) {
    setRoomId(nextId)
    document.getElementById(`plan-room-tab-${nextId}`)?.focus()
  }

  function tabKey(event: KeyboardEvent, index: number) {
    const next = event.key === 'ArrowRight' ? index + 1 : event.key === 'ArrowLeft' ? index - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null
    if (next === null) return
    event.preventDefault()
    chooseRoom(tabs[(next + tabs.length) % tabs.length].id)
  }

  function slotItem(slot: Slot) {
    const notice = activeNotice(slot, now)
    const statuses: CardStatus[] = []
    if (collisionIds.has(slot.id)) statuses.push({ key: 'room', tone: 'conflict', icon: 'conflict', label: 'Raumkonflikt' })
    if (speakerConflictIds.has(slot.id)) statuses.push({ key: 'speaker', tone: 'conflict', icon: 'user', label: 'Rednerkonflikt' })
    if (notice) statuses.push({ key: 'notice', tone: notice.type === 'cancelled' ? 'inactive' : 'change',
      icon: notice.type === 'rescheduled' ? 'moved' : notice.type === 'cancelled' ? 'cancelled' : 'changed', label: noticeLabel(notice) })
    return <li key={`slot-${slot.id}`} data-slot-id={slot.id} className={`plan-list-item${notice ? ` notice-${notice.type}` : ''}${collisionIds.has(slot.id) ? ' collision' : ''}`}>
      <CategoryStripe categories={slot.categories} />
      <button type="button" className="plan-list-main" onClick={() => onEdit(slot)} aria-label={`${slot.topic} ${readOnly ? 'ansehen' : 'bearbeiten'}`}>
        <time>{slot.start_time.slice(0, 5)}–{slot.end_time.slice(0, 5)}</time>
        <strong>{slot.topic}{slot.scope === 'all_rooms' ? ' · Alle Räume' : ''}</strong>
        {slot.speakers.length > 0 && <small>{slot.speakers.map(speaker => speaker.name).join(', ')}</small>}
        <CategoryLabels categories={slot.categories} />
        <StatusBadges statuses={statuses} />
      </button>
    </li>
  }

  function dutyItem(duty: Duty & { start_time: string; end_time: string }) {
    const mine = duty.user_ids.includes(currentUserId)
    const statuses: CardStatus[] = []
    if (mine) statuses.push({ key: 'mine', tone: 'mine', icon: 'user', label: 'Du' })
    if (dutyConflictIds.has(duty.id)) statuses.push({ key: 'helper', tone: 'conflict', icon: 'users', label: 'Helferkonflikt' })
    if (duty.user_ids.length < duty.capacity) statuses.push({ key: 'open', tone: 'action', icon: 'warning',
      label: duty.user_ids.length === 0 ? 'Offen' : `${duty.capacity - duty.user_ids.length} frei` })
    return <li key={`duty-${duty.id}`} data-duty-id={duty.id} className={`plan-list-item plan-list-duty${mine ? ' duty-mine' : ''}`}>
      <button type="button" className="plan-list-main" onClick={() => onEditDuty(duty)} aria-label={`${dutyTitle(duty)} ${readOnly ? 'ansehen' : 'bearbeiten'}`}>
        <time>{duty.start_time.slice(0, 5)}–{duty.end_time.slice(0, 5)}</time>
        <strong>{dutyTitle(duty)}</strong>
        <small>{duty.users.length ? duty.users.map(user => user.name).join(', ') : 'Noch niemand eingeteilt'}</small>
        <StatusBadges statuses={statuses} />
      </button>
      <DutySignup duty={duty} currentUserId={currentUserId} onSignup={onSignup} />
    </li>
  }

  return <div className="plan-list" aria-label={focus === 'helpers' ? 'Helferplan als Liste' : 'Tagesplan als Liste'}>
    <div className="plan-room-tabs" role="tablist" aria-label="Räume">
      {tabs.map((item, index) => <button type="button" role="tab" key={item.id} id={`plan-room-tab-${item.id}`}
        aria-controls="plan-room-panel" aria-selected={room?.id === item.id} tabIndex={room?.id === item.id ? 0 : -1}
        onClick={() => chooseRoom(item.id)} onKeyDown={event => tabKey(event, index)}>{item.name}</button>)}
    </div>
    {room && <section role="tabpanel" id="plan-room-panel" aria-labelledby={`plan-room-tab-${room.id}`}>
      {entries.length === 0 ? <p className="empty-state">{focus === 'helpers' ? 'Keine Dienste' : 'Noch keine Sessions'} in {room.id === 0 && focus === 'helpers' ? 'den allgemeinen Diensten' : `„${room.name}“`}.</p>
        : <ul className="plan-list-items">{entries.map(entry => entry.kind === 'slot' ? slotItem(entry.slot) : dutyItem(entry.duty))}</ul>}
    </section>}
  </div>
}
