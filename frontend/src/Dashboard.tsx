import ConflictOverview, { collectConflicts } from './ConflictOverview'
import { formatDate } from './date'
import type { DaySchedule, Duty, EventDay, HelperPlan, Room, Slot, UnplannedSession } from './types'

type Session = Slot | UnplannedSession

function dutyTitle(duty: Duty): string {
  if (duty.title && duty.session_topic) return `${duty.title}: ${duty.session_topic}`
  return duty.title || duty.session_topic || (duty.kind === 'room' ? 'Raumdienst' : 'Allgemeiner Dienst')
}

export default function Dashboard({ days, rooms, speakerCount, schedules, helperPlan, unplanned, dayId, onDayChange, loading, error, onRefresh, onOpenSlot, onOpenDuty }: {
  days: EventDay[]
  rooms: Room[]
  speakerCount: number
  schedules: DaySchedule[] | null
  helperPlan: HelperPlan
  unplanned: UnplannedSession[]
  dayId: number | null
  onDayChange: (dayId: number | null) => void
  loading: boolean
  error: string
  onRefresh: () => void
  onOpenSlot: (dayId: number | null, id: number) => void
  onOpenDuty: (dayId: number, id: number) => void
}) {
  const dates = new Map(days.map(day => [day.id, day.date]))
  const roomNames = new Map(rooms.map(room => [room.id, room.name]))
  const filteredSchedules = (schedules ?? []).filter(day => dayId === null || day.day_id === dayId)
  const sessions = [...new Map([
    ...filteredSchedules.flatMap(day => [...day.rooms.flatMap(room => room.slots), ...(day.shared_slots ?? [])]),
    ...(dayId === null ? unplanned : []),
  ].map(slot => [slot.id, slot] as const)).values()].sort((a, b) => {
    if (a.day_id === null && b.day_id !== null) return 1
    if (a.day_id !== null && b.day_id === null) return -1
    return (dates.get(a.day_id!) ?? '').localeCompare(dates.get(b.day_id!) ?? '')
      || (a.start_time ?? '').localeCompare(b.start_time ?? '')
      || a.topic.localeCompare(b.topic, 'de') || a.id - b.id
  })
  const openDuties = helperPlan.duties.filter(duty => duty.status === 'active'
    && duty.user_ids.length < duty.capacity && (dayId === null || duty.day_id === dayId))
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '')
      || (a.start_time ?? '').localeCompare(b.start_time ?? '') || a.id - b.id)
  const missingSpeakers = sessions.filter(slot => !slot.is_cancelled && slot.speaker_required !== false && slot.speaker_ids.length === 0)
  const backlog = sessions.filter(slot => slot.day_id === null)
  const cancelled = sessions.filter(slot => slot.is_cancelled)
  const conflicts = collectConflicts(filteredSchedules, helperPlan)
  const metrics = [
    ['Geplante aktive Sessions', sessions.filter(slot => slot.day_id !== null && !slot.is_cancelled).length],
    ['Ungeplante Sessions', backlog.length],
    ['Absagen', cancelled.length],
    ['Offene Helferplätze', openDuties.reduce((sum, duty) => sum + duty.capacity - duty.user_ids.length, 0)],
    ['Redner fehlen', missingSpeakers.length],
    ['Konflikte', conflicts.length],
  ] as const

  function sessionDetail(slot: Session): string {
    if (slot.day_id === null) return 'Ungeplant · Ohne Tag und Uhrzeit'
    const place = slot.scope === 'all_rooms' ? 'Alle Räume' : roomNames.get(slot.room_id!) ?? 'Raum'
    return `${formatDate(dates.get(slot.day_id)!)} · ${slot.start_time.slice(0, 5)}–${slot.end_time.slice(0, 5)} · ${place}`
  }

  function sessionList(title: string, entries: Session[], empty: string) {
    return <section className="dashboard-panel" aria-label={title}>
      <h3>{title} <span className="dashboard-count">{entries.length}</span></h3>
      {entries.length === 0 ? <p className="muted">{empty}</p> : <ul className="dashboard-list">{entries.map(slot => <li key={slot.id}>
        <button type="button" onClick={() => onOpenSlot(slot.day_id, slot.id)} aria-label={`${slot.topic} ${slot.day_id === null ? 'ungeplant' : 'am ' + formatDate(dates.get(slot.day_id)!)} bearbeiten`}>
          <strong>{slot.topic}</strong><small>{sessionDetail(slot)}</small>
        </button>
      </li>)}</ul>}
    </section>
  }

  return <section className="dashboard" aria-label="Veranstaltungsdashboard">
    <div className="dashboard-toolbar">
      <label>Zeitraum<select value={dayId ?? ''} disabled={loading} onChange={event => onDayChange(event.target.value ? Number(event.target.value) : null)}>
        <option value="">Alle Tage</option>
        {days.map(day => <option key={day.id} value={day.id}>{formatDate(day.date)}</option>)}
      </select></label>
      <button type="button" className="text-button" disabled={loading} onClick={onRefresh}>Aktualisieren</button>
    </div>
    {loading ? <p className="state-message" role="status">Lade Dashboard …</p> : error ? <div className="empty-state" role="alert">
      Dashboard konnte nicht geladen werden: {error}<br /><button type="button" className="text-button" onClick={onRefresh}>Erneut versuchen</button>
    </div> : schedules !== null && <>
      <p className="muted">Veranstaltung gesamt: {days.length} {days.length === 1 ? 'Tag' : 'Tage'} · {rooms.length} {rooms.length === 1 ? 'Raum' : 'Räume'} · {speakerCount} {speakerCount === 1 ? 'Rednerprofil' : 'Rednerprofile'}</p>
      {dayId !== null && <p className="dashboard-filter-note">Ungeplante Sessions haben keinen Tag. Unter <button type="button" className="text-button" onClick={() => onDayChange(null)}>Alle Tage</button> anzeigen.</p>}
      <dl className="dashboard-metrics">{metrics.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <div className="dashboard-panels">
        <section className="dashboard-panel" aria-label="Offene Helferplätze">
          <h3>Offene Helferplätze <span className="dashboard-count">{metrics[3][1]}</span></h3>
          {openDuties.length === 0 ? <p className="muted">Keine Dienste mit offenen Helferplätzen.</p> : <ul className="dashboard-list">{openDuties.map(duty => <li key={duty.id}>
            <button type="button" onClick={() => onOpenDuty(duty.day_id!, duty.id)} aria-label={`${dutyTitle(duty)} am ${formatDate(duty.date!)} bearbeiten`}>
              <strong>{dutyTitle(duty)}</strong>
              <small>{formatDate(duty.date!)} · {duty.start_time?.slice(0, 5)}–{duty.end_time?.slice(0, 5)} · {duty.room_id === null ? duty.kind === 'session' ? 'Alle Räume' : 'Allgemein' : roomNames.get(duty.room_id) ?? 'Raum'}</small>
              <span>{duty.user_ids.length}/{duty.capacity} belegt · {duty.capacity - duty.user_ids.length} {duty.capacity - duty.user_ids.length === 1 ? 'Platz fehlt' : 'Plätze fehlen'}</span>
            </button>
          </li>)}</ul>}
        </section>
        {sessionList('Redner fehlen', missingSpeakers, 'Keine Sessions mit fehlenden Rednern.')}
        {sessionList('Ungeplante Sessions', backlog, dayId === null ? 'Keine ungeplanten Sessions.' : 'Ungeplante Sessions unter „Alle Tage“ anzeigen.')}
        {sessionList('Absagen', cancelled, 'Keine abgesagten Sessions.')}
      </div>
      <section className="dashboard-panel" aria-label="Konflikte">
        <h3>Konflikte <span className="dashboard-count">{conflicts.length}</span></h3>
        <p className="muted">{conflicts.filter(entry => entry.kind === 'room').length} Raumkonflikte · {conflicts.filter(entry => entry.kind === 'speaker').length} Rednerkonflikte · {conflicts.filter(entry => entry.kind === 'helper').length} Helferkonflikte</p>
        <ConflictOverview schedules={filteredSchedules} helperPlan={helperPlan} scopeLabel={dayId === null ? 'dieser Veranstaltung' : 'diesem Veranstaltungstag'} onOpenSlot={onOpenSlot} onOpenDuty={onOpenDuty} />
      </section>
    </>}
  </section>
}
