import DutySignup from './DutySignup'
import Icon from './Icon'
import { formatWeekdayDate } from './date'
import type { Duty, HelperPlan, Room } from './types'

export function dutyTitle(duty: Duty): string {
  if (duty.title && duty.session_topic) return `${duty.title}: ${duty.session_topic}`
  return duty.title || duty.session_topic || (duty.kind === 'room' ? 'Raumdienst' : 'Allgemeiner Dienst')
}

function byTime(a: Duty, b: Duty): number {
  if (a.date === null && b.date !== null) return 1
  if (a.date !== null && b.date === null) return -1
  return (a.date ?? '').localeCompare(b.date ?? '') || (a.start_time ?? '').localeCompare(b.start_time ?? '') || a.id - b.id
}

/** Dienste nach Tag gruppiert; Dienste ohne Tag stehen am Ende. */
function groupByDay(duties: Duty[]): [string | null, Duty[]][] {
  const groups = new Map<string | null, Duty[]>()
  for (const duty of [...duties].sort(byTime)) groups.set(duty.date, [...groups.get(duty.date) ?? [], duty])
  return [...groups]
}

/**
 * Ansicht für Helfer: zuerst die eigenen Dienste chronologisch, darunter alle Dienste,
 * in denen noch Plätze frei sind. Eintragen und Austragen geht direkt in der Liste.
 */
export default function MyDuties({ eventId, helperPlan, rooms, currentUserId, onSignup, onOpenDuty }: {
  eventId: number
  helperPlan: HelperPlan
  rooms: Room[]
  currentUserId: number
  onSignup: (duty: Duty, leave: boolean) => Promise<void>
  onOpenDuty: (duty: Duty) => void
}) {
  const roomNames = new Map(rooms.map(room => [room.id, room.name]))
  const mine = helperPlan.duties.filter(duty => duty.user_ids.includes(currentUserId))
  const open = helperPlan.duties.filter(duty => duty.status === 'active' && !duty.user_ids.includes(currentUserId) && duty.user_ids.length < duty.capacity)
  const conflictIds = new Set(helperPlan.conflicts.filter(pair => pair.user_ids.includes(currentUserId))
    .flatMap(pair => [pair.first_duty_id, pair.second_duty_id]))

  function place(duty: Duty): string {
    if (duty.room_id !== null) return roomNames.get(duty.room_id) ?? 'Raum'
    return duty.kind === 'session' ? 'Alle Räume' : 'Allgemein'
  }

  function when(duty: Duty): string {
    if (duty.status === 'cancelled') return 'Abgesagt'
    if (duty.status === 'unplanned') return 'Noch ohne Termin'
    return `${duty.start_time?.slice(0, 5)}–${duty.end_time?.slice(0, 5)} Uhr`
  }

  function entry(duty: Duty, own: boolean) {
    const others = duty.users.filter(user => user.id !== currentUserId).map(user => user.name)
    const free = duty.capacity - duty.user_ids.length
    return <li key={duty.id} className={`my-duty${own ? ' my-duty-own' : ''}${duty.status !== 'active' ? ' my-duty-inactive' : ''}`}>
      <button type="button" className="my-duty-main" onClick={() => onOpenDuty(duty)} aria-label={`${dutyTitle(duty)}, ${when(duty)}, ${place(duty)}: Details`}>
        <strong>{dutyTitle(duty)}</strong>
        <span className="my-duty-meta"><Icon name="clock" size={14} />{when(duty)}<Icon name="location" size={14} />{place(duty)}</span>
        {own
          ? <small>{others.length ? `Mit ${others.join(', ')}` : 'Bisher allein eingeteilt'}{free > 0 && duty.status === 'active' ? ` · ${free} ${free === 1 ? 'Platz' : 'Plätze'} frei` : ''}</small>
          : <small>{free} von {duty.capacity} {duty.capacity === 1 ? 'Platz' : 'Plätzen'} frei{others.length ? ` · ${others.join(', ')}` : ''}</small>}
        {own && conflictIds.has(duty.id) && <span className="status-badge status-conflict"><Icon name="users" size={13} /><span className="status-label">Überschneidet sich mit einem anderen Dienst</span></span>}
      </button>
      <DutySignup duty={duty} currentUserId={currentUserId} onSignup={onSignup} />
    </li>
  }

  function list(duties: Duty[], own: boolean) {
    return groupByDay(duties).map(([date, items]) => <section key={date ?? 'none'} className="my-duty-day" aria-label={date ? formatWeekdayDate(date) : 'Ohne Termin'}>
      <h4>{date ? formatWeekdayDate(date) : 'Ohne Termin'}</h4>
      <ul>{items.map(duty => entry(duty, own))}</ul>
    </section>)
  }

  return <section className="my-duties" aria-label="Meine Dienste">
    <section className="dashboard-panel" aria-labelledby="my-duties-own">
      <div className="my-duties-head">
        <h3 id="my-duties-own">Wo bin ich eingeteilt? <span className="dashboard-count">{mine.length}</span></h3>
        {mine.some(duty => duty.status === 'active') && <a className="secondary small button-link" href={`/api/events/${eventId}/my-duties.ics`} download>
          <Icon name="download" />In den Kalender
        </a>}
      </div>
      {mine.length === 0 ? <p className="muted">Du bist noch für keinen Dienst eingetragen. Unten findest du Dienste, in denen noch Leute gebraucht werden.</p> : list(mine, true)}
    </section>
    <section className="dashboard-panel" aria-labelledby="my-duties-open">
      <h3 id="my-duties-open">Wo werden noch Leute gebraucht? <span className="dashboard-count">{open.length}</span></h3>
      {open.length === 0 ? <p className="muted">Alle Dienste sind besetzt.</p> : list(open, false)}
    </section>
  </section>
}
