import DutySignup from './DutySignup'
import { formatDate } from './date'
import type { Duty, Room, Slot, UnplannedSession } from './types'

export function DutyDetails({ duty, rooms, currentUserId, onSignup, onClose }: {
  duty: Duty; rooms: Room[]; currentUserId: number
  onSignup: (duty: Duty, leave: boolean) => Promise<void>; onClose: () => void
}) {
  return <aside className="editor" aria-label="Dienstdetails">
    <div className="editor-heading"><h2>{duty.title || duty.session_topic || 'Dienst'}</h2><button type="button" className="text-button" onClick={onClose}>Schließen</button></div>
    <p>{duty.date ? formatDate(duty.date) : 'Ohne Tag'} · {duty.status === 'active' ? `${duty.start_time?.slice(0, 5)}–${duty.end_time?.slice(0, 5)}` : duty.status === 'cancelled' ? 'Abgesagt' : 'Ungeplant'}</p>
    <p>{duty.room_id === null ? 'Allgemein' : rooms.find(room => room.id === duty.room_id)?.name}</p>
    {duty.session_topic && <p>Session: {duty.session_topic}</p>}
    <p>{duty.users.map(user => user.name + (user.is_active ? '' : ' (gesperrt)')).join(', ') || 'Offen'}</p>
    <DutySignup duty={duty} currentUserId={currentUserId} onSignup={onSignup} />
  </aside>
}

export function SlotDetails({ slot, onClose }: { slot: Slot | UnplannedSession; onClose: () => void }) {
  return <aside className="editor" aria-label="Sessiondetails">
    <div className="editor-heading"><h2>{slot.topic}</h2><button type="button" className="text-button" onClick={onClose}>Schließen</button></div>
    <p>{slot.start_time?.slice(0, 5)}–{slot.end_time?.slice(0, 5)}{slot.is_cancelled ? ' · Abgesagt' : ''}</p>
    <p>{slot.speakers.map(speaker => speaker.name).join(', ')}</p>
    <p className="session-description">{slot.description}</p>
  </aside>
}
