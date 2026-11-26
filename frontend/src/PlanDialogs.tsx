import { useId, useState } from 'react'
import Dialog from './Dialog'
import { formatDate } from './date'
import { SNAP_MINUTES, toMinutes, toTime } from './time'
import type { EventDay, Room, UnplannedSession } from './types'

export type PlanTarget = { day_id: number; room_id: number | null; start_time: string; end_time: string }

/**
 * Plant eine ungeplante Session ohne Ziehen ein: Tag, Raum und Startzeit wählen.
 * Die Dauer ist wie beim Ziehen eine Stunde und lässt sich danach ändern.
 */
export function PlanSessionDialog({ session, days, rooms, initialDayId, onPlan, onClose }: {
  session: UnplannedSession
  days: EventDay[]
  rooms: Room[]
  initialDayId: number | null
  onPlan: (target: PlanTarget) => Promise<boolean>
  onClose: () => void
}) {
  const titleId = useId()
  const shared = session.scope === 'all_rooms'
  const [dayId, setDayId] = useState(initialDayId ?? days[0]?.id ?? 0)
  const [roomId, setRoomId] = useState(rooms[0]?.id ?? 0)
  const day = days.find(item => item.id === dayId)
  const [start, setStart] = useState(day?.start_time.slice(0, 5) ?? '09:00')
  const [duration, setDuration] = useState(60)
  const [busy, setBusy] = useState(false)
  const end = toMinutes(start) + duration
  const problem = !day ? 'Lege zuerst einen Veranstaltungstag an.'
    : !shared && rooms.length === 0 ? 'Lege zuerst einen Raum an.'
      : toMinutes(start) < toMinutes(day.start_time) || end > toMinutes(day.end_time)
        ? `Die Session muss zwischen ${day.start_time.slice(0, 5)} und ${day.end_time.slice(0, 5)} Uhr liegen.` : ''

  async function submit() {
    if (problem || busy) return
    setBusy(true)
    const planned = await onPlan({ day_id: dayId, room_id: shared ? null : roomId, start_time: start, end_time: toTime(end) })
    setBusy(false)
    if (planned) onClose()
  }

  return <Dialog labelledBy={titleId} className="plan-session-dialog" onClose={onClose} closeDisabled={busy}>
    <h3 id={titleId}>„{session.topic}“ einplanen</h3>
    <form className="confirm-form" onSubmit={event => { event.preventDefault(); void submit() }}>
      <label>Tag<select value={dayId} onChange={event => {
        const next = Number(event.target.value)
        setDayId(next)
        const nextDay = days.find(item => item.id === next)
        if (nextDay && toMinutes(start) < toMinutes(nextDay.start_time)) setStart(nextDay.start_time.slice(0, 5))
      }}>
        {days.map(item => <option key={item.id} value={item.id}>{formatDate(item.date)}</option>)}
      </select></label>
      {shared ? <p className="muted">Diese Session gilt für alle Räume.</p>
        : <label>Raum<select value={roomId} onChange={event => setRoomId(Number(event.target.value))}>
          {rooms.map(room => <option key={room.id} value={room.id}>{room.name}</option>)}
        </select></label>}
      <label>Beginn<input type="time" step={SNAP_MINUTES * 60} value={start} required onChange={event => setStart(event.target.value)} /></label>
      <label>Dauer in Minuten<input type="number" min={SNAP_MINUTES} step={SNAP_MINUTES} value={duration} required
        onChange={event => setDuration(Math.max(SNAP_MINUTES, Number(event.target.value) || SNAP_MINUTES))} /></label>
      {problem ? <p className="form-error">{problem}</p> : <p className="muted">Bis {toTime(end)} Uhr</p>}
      <div className="dialog-actions dialog-actions-end">
        <button type="button" className="secondary" onClick={onClose} disabled={busy}>Abbrechen</button>
        <button type="submit" className="primary" disabled={Boolean(problem) || busy}>{busy ? 'Plane ein …' : 'Einplanen'}</button>
      </div>
    </form>
  </Dialog>
}

const SHORTCUTS: [string[], string][] = [
  [['Tab'], 'Zur nächsten Karte'],
  [['Enter'], 'Karte öffnen'],
  [['Alt', '↑'], '15 Minuten früher'],
  [['Alt', '↓'], '15 Minuten später'],
  [['Alt', '←'], 'Session in den Raum links davon'],
  [['Alt', '→'], 'Session in den Raum rechts davon'],
  [['Umschalt', 'Alt', '↑'], '15 Minuten kürzer'],
  [['Umschalt', 'Alt', '↓'], '15 Minuten länger'],
  [['?'], 'Diese Hilfe öffnen'],
]

/** Übersicht der Tastenkürzel im Plan. */
export function KeyboardHelp({ onClose }: { onClose: () => void }) {
  const titleId = useId()
  return <Dialog labelledBy={titleId} className="keyboard-help" onClose={onClose}>
    <h3 id={titleId}>Tastenkürzel im Plan</h3>
    <p className="muted">Gelten für die fokussierte Karte. Jede Änderung wird sofort gespeichert und lässt sich rückgängig machen.</p>
    <dl className="shortcut-list">{SHORTCUTS.map(([keys, text]) => <div key={text}>
      <dt>{keys.map((key, index) => <span key={key}>{index > 0 && ' + '}<kbd>{key}</kbd></span>)}</dt>
      <dd>{text}</dd>
    </div>)}</dl>
    <div className="dialog-actions dialog-actions-end"><button type="button" className="primary" onClick={onClose}>Schließen</button></div>
  </Dialog>
}
