import { useEffect, useRef, useState } from 'react'
import { write } from './api'
import type { CurrentUser } from './types'

export default function AccountDialog({ currentUser, onProfileSaved, onPasswordChanged, onClose }: {
  currentUser: CurrentUser
  onProfileSaved: (user: CurrentUser) => Promise<boolean>
  onPasswordChanged: () => void
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
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

  useEffect(() => {
    const element = dialog.current!
    const opener = document.activeElement
    element.showModal()
    nameInput.current?.focus()
    return () => {
      element.close()
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [])

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

  return <dialog ref={dialog} className="backup-dialog account-dialog" aria-labelledby="account-title" onKeyDown={event => {
    if (event.key !== 'Tab') return
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)'))
    const first = controls[0]
    const last = controls.at(-1)
    if (!first) event.preventDefault()
    else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }} onCancel={event => {
    event.preventDefault()
    if (!pending.current) onClose()
  }}>
    <div className="editor-heading"><h2 id="account-title">Mein Konto</h2><button type="button" className="text-button" disabled={busy !== null} onClick={onClose}>Schließen</button></div>
    <p className="account-email">{currentUser.email}</p>
    <form aria-labelledby="account-name-title" onSubmit={event => void saveName(event)}>
      <h3 id="account-name-title">Name ändern</h3>
      <p>Dein Name erscheint im Helferplan und gilt für alle Veranstaltungen.</p>
      <label>Name<input ref={nameInput} required maxLength={255} autoComplete="name" value={name} disabled={busy !== null} onChange={event => setName(event.target.value)} /></label>
      <button className="primary" type="submit" disabled={busy !== null || !name.trim()}>{busy === 'name' ? 'Speichere Namen …' : 'Namen speichern'}</button>
      {nameMessage && <p role="status">{nameMessage}</p>}
      {nameError && <p role="alert">{nameError}</p>}
    </form>
    <form aria-labelledby="account-password-title" onSubmit={event => void savePassword(event)}>
      <h3 id="account-password-title">Passwort ändern</h3>
      <p>Nach der Änderung musst du dich auf allen Geräten erneut anmelden.</p>
      <label>Aktuelles Passwort<input type="password" required maxLength={1024} autoComplete="current-password" value={currentPassword} disabled={busy !== null} onChange={event => setCurrentPassword(event.target.value)} /></label>
      <label>Neues Passwort<input type="password" required minLength={12} maxLength={1024} autoComplete="new-password" aria-describedby="account-password-help" value={newPassword} disabled={busy !== null} onChange={event => setNewPassword(event.target.value)} /></label>
      <p id="account-password-help">12 bis 1024 Zeichen.</p>
      <label>Neues Passwort wiederholen<input type="password" required minLength={12} maxLength={1024} autoComplete="new-password" value={confirmation} disabled={busy !== null} onChange={event => setConfirmation(event.target.value)} /></label>
      <button className="primary" type="submit" disabled={busy !== null}>{busy === 'password' ? 'Ändere Passwort …' : 'Passwort ändern'}</button>
      {passwordError && <p role="alert">{passwordError}</p>}
    </form>
  </dialog>
}
