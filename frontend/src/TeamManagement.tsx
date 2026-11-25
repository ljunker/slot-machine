import { useEffect, useState } from 'react'
import { request, write } from './api'
import Dialog, { useConfirm } from './Dialog'
import HeaderMenu from './HeaderMenu'
import InlineMessage from './InlineMessage'

type Role = 'admin' | 'editor' | 'helper'
type Member = { user_id: number; email: string; name: string | null; role: Role; is_active: boolean }
type Invitation = { id: number; email: string; role: Role; expires_at: number; expired: boolean }
type User = { id: number; email: string; name: string | null; is_active: boolean; is_superadmin: boolean }

const ROLES: { value: Role; label: string }[] = [
  { value: 'helper', label: 'Helfer' },
  { value: 'editor', label: 'Bearbeiter' },
  { value: 'admin', label: 'Veranstaltungsadmin' },
]
const roleLabel = (role: Role) => ROLES.find(item => item.value === role)?.label ?? role

/** Splits „a@x.de, b@x.de; c@x.de“ into single addresses. */
export function splitEmails(text: string): string[] {
  return [...new Set(text.split(/[\s,;]+/).map(item => item.trim()).filter(Boolean))]
}

function formatExpiry(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString('de-DE', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
}

/** Sends one invitation per address and reports which ones worked. */
async function inviteAll(emails: string[], send: (email: string) => Promise<unknown>): Promise<{ sent: string[]; failed: string[] }> {
  const sent: string[] = []
  const failed: string[] = []
  for (const email of emails) {
    try {
      await send(email)
      sent.push(email)
    } catch (cause) { failed.push(`${email}: ${(cause as Error).message}`) }
  }
  return { sent, failed }
}

export function TeamManagement({ eventId, currentUserId, onClose }: { eventId: number; currentUserId: number; onClose: () => void }) {
  const [members, setMembers] = useState<Member[]>([])
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [emails, setEmails] = useState('')
  const [role, setRole] = useState<Role>('helper')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [confirm, confirmDialog] = useConfirm()

  async function load() {
    const [memberList, invitationList] = await Promise.all([
      request<Member[]>(`/events/${eventId}/members`),
      request<Invitation[]>(`/events/${eventId}/members/invitations`),
    ])
    setMembers(memberList)
    setInvitations(invitationList)
  }
  useEffect(() => { void load().catch(cause => setError(cause.message)) }, [eventId])

  async function run(action: () => Promise<string | void>) {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const done = await action()
      if (done) setMessage(done)
    } catch (cause) { setError((cause as Error).message) }
    finally { setBusy(false) }
  }

  function invite(event: React.FormEvent) {
    event.preventDefault()
    const addresses = splitEmails(emails)
    if (addresses.length === 0) return
    void run(async () => {
      const { sent, failed } = await inviteAll(addresses, email => write<void>('POST', `/events/${eventId}/members/invitations`, { email, role }))
      setEmails(failed.length ? addresses.filter(email => !sent.includes(email)).join(', ') : '')
      await load()
      if (failed.length) throw new Error(`${sent.length ? `${sent.length} versendet. ` : ''}Nicht versendet: ${failed.join(' · ')}`)
      return sent.length === 1 ? 'Einladung versendet.' : `${sent.length} Einladungen versendet.`
    })
  }

  function resend(invitation: Invitation) {
    void run(async () => {
      await write<void>('POST', `/events/${eventId}/members/invitations`, { email: invitation.email, role: invitation.role })
      await load()
      return `Einladung an ${invitation.email} erneut versendet.`
    })
  }

  async function revoke(invitation: Invitation) {
    if (!await confirm({ title: 'Einladung zurückziehen?', message: `Der Link für ${invitation.email} wird ungültig.`, confirmLabel: 'Einladung zurückziehen' })) return
    void run(async () => {
      await write<void>('DELETE', `/events/${eventId}/members/invitations/${invitation.id}`)
      await load()
      return 'Einladung zurückgezogen.'
    })
  }

  async function changeRole(member: Member, nextRole: Role) {
    if (nextRole === member.role) return
    const self = member.user_id === currentUserId
    if (self && member.role === 'admin' && !await confirm({
      title: 'Eigene Rolle herabstufen?',
      message: `Du wirst ${roleLabel(nextRole)} und kannst das Team danach nicht mehr verwalten. Die Seite lädt neu.`,
      confirmLabel: `Zu ${roleLabel(nextRole)} herabstufen`,
    })) return
    void run(async () => {
      await write<Member>('PATCH', `/events/${eventId}/members/${member.user_id}`, { role: nextRole })
      if (self) window.location.reload()
      else await load()
      return `${member.name ?? member.email} ist jetzt ${roleLabel(nextRole)}.`
    })
  }

  async function remove(member: Member) {
    const self = member.user_id === currentUserId
    if (!await confirm({
      title: self ? 'Dich selbst aus dem Team entfernen?' : 'Aus dem Team entfernen?',
      message: self
        ? 'Du verlierst sofort den Zugriff auf diese Veranstaltung.'
        : `${member.name ?? member.email} verliert den Zugriff auf diese Veranstaltung. Eintragungen in Dienste werden entfernt.`,
      confirmLabel: 'Entfernen',
    })) return
    void run(async () => {
      await write<void>('DELETE', `/events/${eventId}/members/${member.user_id}`)
      if (self) window.location.reload()
      else await load()
      return `${member.name ?? member.email} entfernt.`
    })
  }

  return <Dialog className="management-dialog" labelledBy="team-title" onClose={onClose}>
    <div className="editor-heading"><h2 id="team-title">Team verwalten</h2><button type="button" className="text-button" onClick={onClose}>Schließen</button></div>
    <form onSubmit={invite} className="management-form" aria-label="Einladen">
      <label>E-Mail-Adressen<input type="text" inputMode="email" autoComplete="off" required placeholder="name@example.org, …" aria-describedby="team-invite-hint" value={emails} disabled={busy} onChange={event => setEmails(event.target.value)} /></label>
      <label>Rolle<select value={role} disabled={busy} onChange={event => setRole(event.target.value as Role)}>{ROLES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      <button type="submit" className="primary" disabled={busy || !emails.trim()}>{busy ? 'Bitte warten …' : 'Einladen'}</button>
      <small id="team-invite-hint" className="field-hint">Mehrere Adressen mit Komma trennen. Einladungen gelten 48 Stunden.</small>
    </form>
    {message && <InlineMessage tone="success">{message}</InlineMessage>}
    {error && <InlineMessage tone="error">{error}</InlineMessage>}
    <section aria-labelledby="team-members-title">
      <h3 id="team-members-title" className="management-heading">Mitglieder ({members.length})</h3>
      <table className="management-table">
        <thead><tr><th scope="col">Name</th><th scope="col">E-Mail</th><th scope="col">Rolle</th><th scope="col"><span className="visually-hidden">Aktionen</span></th></tr></thead>
        <tbody>{members.map(member => <tr key={member.user_id}>
          <td>{member.name ?? '–'}{member.user_id === currentUserId && <span className="muted-inline"> (du)</span>}{!member.is_active && <span className="badge badge-neutral">gesperrt</span>}</td>
          <td className="cell-wrap">{member.email}</td>
          <td><span className={`badge badge-role-${member.role}`}>{roleLabel(member.role)}</span></td>
          <td><div className="row-actions">
            <HeaderMenu label="Rolle ändern" panelLabel={`Rolle von ${member.email}`} triggerClassName="secondary small menu-trigger"
              actions={ROLES.map(item => ({ label: item.label, disabled: busy || item.value === member.role, onClick: () => void changeRole(member, item.value) }))} />
            <button type="button" className="danger small" disabled={busy} onClick={() => void remove(member)}>Entfernen</button>
          </div></td>
        </tr>)}</tbody>
      </table>
    </section>
    <section aria-labelledby="team-invitations-title">
      <h3 id="team-invitations-title" className="management-heading">Ausstehende Einladungen ({invitations.length})</h3>
      {invitations.length === 0 ? <p className="muted">Keine offenen Einladungen.</p> : <ul className="management-list">{invitations.map(invitation => <li key={invitation.id}>
        <span><strong>{invitation.email}</strong><small>{roleLabel(invitation.role)} · {invitation.expired ? <span className="badge badge-warning">abgelaufen</span> : `gültig bis ${formatExpiry(invitation.expires_at)}`}</small></span>
        <div className="row-actions">
          <button type="button" className="secondary small" disabled={busy} onClick={() => resend(invitation)}>Erneut senden</button>
          <button type="button" className="danger small" disabled={busy} onClick={() => void revoke(invitation)}>Zurückziehen</button>
        </div>
      </li>)}</ul>}
    </section>
    {confirmDialog}
  </Dialog>
}

export function UserManagement({ currentUserId, onClose }: { currentUserId: number; onClose: () => void }) {
  const [users, setUsers] = useState<User[]>([])
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [confirm, confirmDialog] = useConfirm()

  async function load() { setUsers(await request<User[]>('/users')) }
  useEffect(() => { void load().catch(cause => setError(cause.message)) }, [])

  async function invite(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setMessage('')
    setError('')
    try {
      await write<void>('POST', '/users/superadmin-invitations', { email })
      setEmail('')
      setMessage('Einladung versendet.')
    } catch (cause) { setError((cause as Error).message) }
    finally { setBusy(false) }
  }

  async function update(user: User, patch: { is_active?: boolean; is_superadmin?: boolean }) {
    const self = user.id === currentUserId
    const person = user.name ?? user.email
    if (patch.is_superadmin === false && !await confirm({
      title: self ? 'Eigene Superadmin-Rechte entfernen?' : 'Superadmin-Rechte entfernen?',
      message: self ? 'Du verlierst sofort den Zugriff auf die Benutzerverwaltung. Die Seite lädt neu.' : `${person} kann danach keine Veranstaltungen und Benutzer mehr verwalten.`,
      confirmLabel: 'Rechte entfernen',
    })) return
    if (patch.is_active === false && !await confirm({
      title: self ? 'Eigenes Konto sperren?' : 'Konto sperren?',
      message: self ? 'Du wirst sofort abgemeldet und kannst dich nicht mehr anmelden.' : `${person} wird abgemeldet und kann sich nicht mehr anmelden.`,
      confirmLabel: 'Konto sperren',
    })) return
    setBusy(true)
    setMessage('')
    setError('')
    try {
      await write<User>('PATCH', `/users/${user.id}`, patch)
      await load()
      if (self && (patch.is_superadmin === false || patch.is_active === false)) window.location.reload()
    } catch (cause) { setError((cause as Error).message) }
    finally { setBusy(false) }
  }

  return <Dialog className="management-dialog" labelledBy="users-title" onClose={onClose}>
    <div className="editor-heading"><h2 id="users-title">Benutzer verwalten</h2><button type="button" className="text-button" onClick={onClose}>Schließen</button></div>
    <form onSubmit={event => void invite(event)} className="management-form">
      <label>Neuen Superadmin einladen<input type="email" required value={email} disabled={busy} onChange={event => setEmail(event.target.value)} /></label>
      <button type="submit" className="primary" disabled={busy}>Einladen</button>
    </form>
    {message && <InlineMessage tone="success">{message}</InlineMessage>}
    {error && <InlineMessage tone="error">{error}</InlineMessage>}
    <div className="table-scroll"><table className="management-table">
      <thead><tr><th scope="col">Name</th><th scope="col">E-Mail</th><th scope="col">Superadmin</th><th scope="col">Aktiv</th></tr></thead>
      <tbody>{users.map(user => <tr key={user.id}>
        <td>{user.name ?? '–'}{user.id === currentUserId && <span className="muted-inline"> (du)</span>}</td>
        <td className="cell-wrap">{user.email}</td>
        <td><input type="checkbox" aria-label={`${user.email} ist Superadmin`} checked={user.is_superadmin} disabled={busy} onChange={event => void update(user, { is_superadmin: event.target.checked })} /></td>
        <td><input type="checkbox" aria-label={`${user.email} ist aktiv`} checked={user.is_active} disabled={busy} onChange={event => void update(user, { is_active: event.target.checked })} /></td>
      </tr>)}</tbody>
    </table></div>
    {confirmDialog}
  </Dialog>
}
