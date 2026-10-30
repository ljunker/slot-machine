import { useState } from 'react'
import type { Duty } from './types'

export default function DutySignup({ duty, currentUserId, onSignup }: {
  duty: Duty
  currentUserId: number
  onSignup: (duty: Duty, leave: boolean) => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const assigned = duty.user_ids.includes(currentUserId)
  const full = duty.user_ids.length >= duty.capacity
  async function toggle() {
    setBusy(true)
    try { await onSignup(duty, assigned) }
    finally { setBusy(false) }
  }
  return <div className="duty-signup">
    <small>{duty.user_ids.length} / {duty.capacity} Plätze belegt</small>
    <button type="button" className="text-button" onKeyDown={event => event.stopPropagation()} disabled={busy || !assigned && (full || duty.status !== 'active')}
      aria-label={`${assigned ? 'Austragen aus' : 'Eintragen in'} ${duty.title || duty.session_topic || 'Dienst'}`}
      onClick={event => { event.stopPropagation(); void toggle() }}>{busy ? 'Speichere …' : assigned ? 'Austragen' : full ? 'Voll' : 'Eintragen'}</button>
  </div>
}
