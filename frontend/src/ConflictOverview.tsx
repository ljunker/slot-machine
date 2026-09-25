import type { DaySchedule, Duty, HelperPlan, Slot } from './types'

type ConflictEntry = {
  key: string
  kind: 'room' | 'speaker' | 'helper'
  date: string
  dayId: number
  startTime: string
  endTime: string
  people: string[]
  first: { id: number; label: string; detail: string }
  second: { id: number; label: string; detail: string }
}

function dutyTitle(duty: Duty): string {
  if (duty.kind === 'session' && duty.title && duty.session_topic) return `${duty.title}: ${duty.session_topic}`
  return duty.title || duty.session_topic || (duty.kind === 'room' ? 'Raumdienst' : 'Allgemeiner Dienst')
}

function slotDetail(slot: Slot, roomNames: Map<number, string>): string {
  return `${roomNames.get(slot.room_id) ?? 'Raum'} · ${slot.start_time.slice(0, 5)}–${slot.end_time.slice(0, 5)}`
}

function dutyDetail(duty: Duty, roomNames: Map<number, string>): string {
  const place = duty.room_id === null ? 'Allgemein' : roomNames.get(duty.room_id) ?? 'Raum'
  return `${place} · ${duty.start_time?.slice(0, 5)}–${duty.end_time?.slice(0, 5)}`
}

export function collectConflicts(schedules: DaySchedule[], helperPlan: HelperPlan): ConflictEntry[] {
  const entries: ConflictEntry[] = []
  const dayById = new Map(schedules.map(day => [day.day_id, day]))
  const dutyById = new Map(helperPlan.duties.map(duty => [duty.id, duty]))
  const helperNames = new Map(helperPlan.duties.flatMap(duty => duty.helpers).map(helper => [helper.id, helper.name]))

  for (const day of schedules) {
    const slots = day.rooms.flatMap(room => room.slots)
    const slotById = new Map(slots.map(slot => [slot.id, slot]))
    const roomNames = new Map(day.rooms.map(room => [room.id, room.name]))
    const speakerNames = new Map(slots.flatMap(slot => slot.speakers).map(speaker => [speaker.id, speaker.name]))

    for (const [kind, pairs] of [['room', day.collisions], ['speaker', day.speaker_conflicts]] as const) {
      for (const pair of pairs) {
        const first = slotById.get(pair.first_slot_id)
        const second = slotById.get(pair.second_slot_id)
        if (!first || !second || first.is_cancelled || second.is_cancelled) continue
        entries.push({
          key: `${kind}-${day.day_id}-${first.id}-${second.id}`,
          kind, date: day.date, dayId: day.day_id,
          startTime: first.start_time > second.start_time ? first.start_time : second.start_time,
          endTime: first.end_time < second.end_time ? first.end_time : second.end_time,
          people: 'speaker_ids' in pair ? pair.speaker_ids.map(id => speakerNames.get(id)).filter((name): name is string => Boolean(name)) : [],
          first: { id: first.id, label: first.topic, detail: slotDetail(first, roomNames) },
          second: { id: second.id, label: second.topic, detail: slotDetail(second, roomNames) },
        })
      }
    }
  }

  for (const pair of helperPlan.conflicts) {
    const first = dutyById.get(pair.first_duty_id)
    const second = dutyById.get(pair.second_duty_id)
    if (!first || !second || first.status !== 'active' || second.status !== 'active' || first.day_id === null || first.day_id !== second.day_id || !first.start_time || !first.end_time || !second.start_time || !second.end_time) continue
    const day = dayById.get(first.day_id)
    if (!day) continue
    const roomNames = new Map(day.rooms.map(room => [room.id, room.name]))
    entries.push({
      key: `helper-${day.day_id}-${first.id}-${second.id}`,
      kind: 'helper', date: day.date, dayId: day.day_id,
      startTime: first.start_time > second.start_time ? first.start_time : second.start_time,
      endTime: first.end_time < second.end_time ? first.end_time : second.end_time,
      people: pair.helper_ids.map(id => helperNames.get(id)).filter((name): name is string => Boolean(name)),
      first: { id: first.id, label: dutyTitle(first), detail: dutyDetail(first, roomNames) },
      second: { id: second.id, label: dutyTitle(second), detail: dutyDetail(second, roomNames) },
    })
  }

  return entries.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime) || a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key))
}

export default function ConflictOverview({ schedules, helperPlan, onOpenSlot, onOpenDuty }: {
  schedules: DaySchedule[]
  helperPlan: HelperPlan
  onOpenSlot: (dayId: number, slotId: number) => void
  onOpenDuty: (dayId: number, dutyId: number) => void
}) {
  const entries = collectConflicts(schedules, helperPlan)
  if (entries.length === 0) return <div className="empty-state">Keine Konflikte in dieser Veranstaltung.</div>

  return <section className="conflict-overview" aria-label="Konfliktübersicht">
    <p className="conflict-count">{entries.length} {entries.length === 1 ? 'Konflikt' : 'Konflikte'} in dieser Veranstaltung</p>
    <ol className="conflict-list">{entries.map(entry => <li key={entry.key} className={`conflict-item conflict-${entry.kind}`}>
      <div className="conflict-heading">
        <strong>{entry.kind === 'room' ? 'Raumkonflikt' : entry.kind === 'speaker' ? 'Rednerkonflikt' : 'Helferkonflikt'}</strong>
        <span>{entry.date} · {entry.startTime.slice(0, 5)}–{entry.endTime.slice(0, 5)}</span>
      </div>
      {entry.people.length > 0 && <p>Betroffen: {entry.people.join(', ')}</p>}
      <div className="conflict-participants">{[entry.first, entry.second].map(participant => <button
        key={participant.id}
        type="button"
        onClick={() => entry.kind === 'helper' ? onOpenDuty(entry.dayId, participant.id) : onOpenSlot(entry.dayId, participant.id)}
        aria-label={`${participant.label} am ${entry.date} bearbeiten`}
      ><strong>{participant.label}</strong><small>{participant.detail}</small></button>)}</div>
    </li>)}</ol>
  </section>
}
