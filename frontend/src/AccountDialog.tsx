import { useRef, useState } from 'react'
import { write } from './api'
import type { CurrentUser } from './types'
import Dialog from './Dialog'
import InlineMessage from './InlineMessage'
import PasswordField from './PasswordField'

export default function AccountDialog({ currentUser, onProfileSaved, onPasswordChanged, onClose }: {
  currentUser: CurrentUser
  onProfileSaved: (user: CurrentUser) => Promise<boolean>
  onPasswordChanged: () => void
  onClose: () => void
}) {
  const nameInput = useRef<HTMLInputElement>(null)
  const pending = useRef(false)
  const [name, setName] = useState(currentUser.name ?? '')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState<'name' | 'password' | null>(null)
  const [nameMessage, setNameMessage] = useState('')
  const [nameError, setNameError] = useState('')
  const [passwordError, setPasswordError] = useState('')

  async function saveName(event: React.FormEvent) {
    event.preventDefault()
    if (pending.current) return
    pending.current = true
    setBusy('name')
    setNameError('')
    setNameMessage('')
    try {
      const updated = await write<CurrentUser>('PATCH', '/auth/me', { name })
      setName(updated.name ?? '')
      if (!await onProfileSaved(updated)) throw new Error('Name gespeichert. Planungsansicht konnte nicht aktualisiert werden.')
      setNameMessage('Name gespeichert.')
    } catch (cause) {
      setNameError((cause as Error).message)
    } finally {
      pending.current = false
      setBusy(null)
    }
  }

  async function savePassword(event: React.FormEvent) {
    event.preventDefault()
    if (pending.current) return
    setPasswordError('')
    if (newPassword !== confirmation) {
      setPasswordError('Die neuen Passwörter stimmen nicht überein.')
      return
    }
    pending.current = true
    setBusy('password')
    try {
      await write<void>('POST', '/auth/password-change', { current_password: currentPassword, new_password: newPassword })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmation('')
      onPasswordChanged()
    } catch (cause) {
      setPasswordError((cause as Error).message)
    } finally {
      pending.current = false
      setBusy(null)
    }
  }

  return <Dialog className="account-dialog" labelledBy="account-title" initialFocus={nameInput} closeOnBackdrop={false} closeDisabled={busy !== null} onClose={() => { if (!pending.current) onClose() }}>
    <div className="editor-heading"><h2 id="account-title">Mein Konto</h2><button type="button" className="text-button" disabled={busy !== null} onClick={onClose}>Schließen</button></div>
    <p className="account-email">{currentUser.email}</p>
    <form aria-labelledby="account-name-title" onSubmit={event => void saveName(event)}>
      <h3 id="account-name-title">Name ändern</h3>
      <p>Dein Name erscheint im Helferplan und gilt für alle Veranstaltungen.</p>
      <label>Name<input ref={nameInput} required maxLength={255} autoComplete="name" value={name} disabled={busy !== null} onChange={event => setName(event.target.value)} /></label>
      <button className="primary" type="submit" disabled={busy !== null || !name.trim()}>{busy === 'name' ? 'Speichere Namen …' : 'Namen speichern'}</button>
      {nameMessage && <InlineMessage tone="success">{nameMessage}</InlineMessage>}
      {nameError && <InlineMessage tone="error">{nameError}</InlineMessage>}
    </form>
    <form aria-labelledby="account-password-title" onSubmit={event => void savePassword(event)}>
      <h3 id="account-password-title">Passwort ändern</h3>
      <p>Nach der Änderung musst du dich auf allen Geräten erneut anmelden.</p>
      <PasswordField label="Aktuelles Passwort" autoComplete="current-password" value={currentPassword} disabled={busy !== null} onChange={setCurrentPassword} />
      <PasswordField label="Neues Passwort" autoComplete="new-password" minLength={12} hint="12 bis 1024 Zeichen." value={newPassword} disabled={busy !== null} onChange={setNewPassword} />
      <PasswordField label="Neues Passwort wiederholen" autoComplete="new-password" minLength={12} value={confirmation} disabled={busy !== null} onChange={setConfirmation} />
      <button className="primary" type="submit" disabled={busy !== null}>{busy === 'password' ? 'Ändere Passwort …' : 'Passwort ändern'}</button>
      {passwordError && <InlineMessage tone="error">{passwordError}</InlineMessage>}
    </form>
  </Dialog>
}
