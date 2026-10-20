import { useEffect, useState } from 'react'
import { request, write } from './api'

type Member = { user_id: number; email: string; role: 'admin' | 'editor'; is_active: boolean }
type User = { id: number; email: string; is_active: boolean; is_superadmin: boolean }

export function TeamManagement({ eventId, currentUserId, onClose }: { eventId: number; currentUserId: number; onClose: () => void }) {
  const [members, setMembers] = useState<Member[]>([])
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'editor'>('editor')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function load() { setMembers(await request<Member[]>(`/events/${eventId}/members`)) }
  useEffect(() => { void load().catch(cause => setError(cause.message)) }, [eventId])

  async function invite(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setMessage('')
    try {
      await write<void>('POST', `/events/${eventId}/members/invitations`, { email, role })
      setEmail('')
      setMessage('Einladung versendet.')
    } catch (cause) { setError((cause as Error).message) }
  }

  async function changeRole(member: Member, nextRole: 'admin' | 'editor') {
    setError('')
    try {
      await write<Member>('PATCH', `/events/${eventId}/members/${member.user_id}`, { role: nextRole })
      if (member.user_id === currentUserId) window.location.reload()
      else await load()
    } catch (cause) { setError((cause as Error).message) }
  }

  async function remove(member: Member) {
    if (!window.confirm(`${member.email} aus dem Team entfernen?`)) return
    setError('')
    try {
      await write<void>('DELETE', `/events/${eventId}/members/${member.user_id}`)
      if (member.user_id === currentUserId) window.location.reload()
      else await load()
    } catch (cause) { setError((cause as Error).message) }
  }

  return <div className="backup-backdrop" role="presentation"><section className="backup-dialog management-dialog" role="dialog" aria-modal="true" aria-label="Team verwalten">
    <div className="editor-heading"><h2>Team verwalten</h2><button type="button" className="text-button" onClick={onClose}>Schließen</button></div>
    <form onSubmit={event => void invite(event)} className="management-form">
      <label>E-Mail<input type="email" required value={email} onChange={event => setEmail(event.target.value)} /></label>
      <label>Rolle<select value={role} onChange={event => setRole(event.target.value as 'admin' | 'editor')}><option value="editor">Bearbeiter</option><option value="admin">Veranstaltungsadmin</option></select></label>
      <button type="submit" className="primary">Einladen</button>
    </form>
    <ul className="management-list">{members.map(member => <li key={member.user_id}>
      <span>{member.email}{!member.is_active && ' · gesperrt'}</span>
      <select aria-label={`Rolle von ${member.email}`} value={member.role} onChange={event => void changeRole(member, event.target.value as 'admin' | 'editor')}>
        <option value="editor">Bearbeiter</option><option value="admin">Veranstaltungsadmin</option>
      </select>
      <button type="button" className="text-button" onClick={() => void remove(member)}>Entfernen</button>
    </li>)}</ul>
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
  </section></div>
}

export function UserManagement({ currentUserId, onClose }: { currentUserId: number; onClose: () => void }) {
  const [users, setUsers] = useState<User[]>([])
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function load() { setUsers(await request<User[]>('/users')) }
  useEffect(() => { void load().catch(cause => setError(cause.message)) }, [])

  async function invite(event: React.FormEvent) {
    event.preventDefault()
    setMessage('')
    setError('')
    try {
      await write<void>('POST', '/users/superadmin-invitations', { email })
      setEmail('')
      setMessage('Einladung versendet.')
    } catch (cause) { setError((cause as Error).message) }
  }

  async function update(user: User, patch: { is_active?: boolean; is_superadmin?: boolean }) {
    setError('')
    try {
      await write<User>('PATCH', `/users/${user.id}`, patch)
      await load()
      if (user.id === currentUserId && (patch.is_superadmin === false || patch.is_active === false)) window.location.reload()
    } catch (cause) { setError((cause as Error).message) }
  }

  return <div className="backup-backdrop" role="presentation"><section className="backup-dialog management-dialog" role="dialog" aria-modal="true" aria-label="Benutzer verwalten">
    <div className="editor-heading"><h2>Benutzer verwalten</h2><button type="button" className="text-button" onClick={onClose}>Schließen</button></div>
    <form onSubmit={event => void invite(event)} className="management-form">
      <label>Neuen Superadmin einladen<input type="email" required value={email} onChange={event => setEmail(event.target.value)} /></label>
      <button type="submit" className="primary">Einladen</button>
    </form>
    <ul className="management-list">{users.map(user => <li key={user.id}>
      <span>{user.email}</span>
      <label><input type="checkbox" checked={user.is_superadmin} onChange={event => void update(user, { is_superadmin: event.target.checked })} /> Superadmin</label>
      <label><input type="checkbox" checked={user.is_active} onChange={event => void update(user, { is_active: event.target.checked })} /> Aktiv</label>
    </li>)}</ul>
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
  </section></div>
}
