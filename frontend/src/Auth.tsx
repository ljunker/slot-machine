import { useEffect, useState } from 'react'
import App from './App'
import { request, setCsrfToken, write } from './api'
import type { CurrentUser } from './types'

async function login(email: string, password: string): Promise<CurrentUser> {
  const user = await request<CurrentUser>('/auth/login', {
    method: 'POST', body: JSON.stringify({ email, password }),
  })
  setCsrfToken(user.csrf_token)
  return user
}

function LoginForm({ onLogin }: { onLogin: (user: CurrentUser) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try { onLogin(await login(email, password)) }
    catch (cause) { setError((cause as Error).message) }
    finally { setBusy(false) }
  }

  return <form onSubmit={event => void submit(event)}>
    <label>E-Mail<input type="email" required autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} /></label>
    <label>Passwort<input type="password" required autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} /></label>
    <button className="primary" type="submit" disabled={busy}>Anmelden</button>
    {error && <p role="alert">{error}</p>}
  </form>
}

export function NameForm({ onSave, onLogout }: { onSave: (user: CurrentUser) => void; onLogout: () => void }) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try { onSave(await write<CurrentUser>('PATCH', '/auth/me', { name })) }
    catch (cause) { setError((cause as Error).message) }
    finally { setBusy(false) }
  }
  return <main className="auth-page"><section className="auth-card">
    <h1>Namen festlegen</h1><p>Dein Name erscheint im Helferplan und gilt für alle Veranstaltungen.</p>
    <form onSubmit={event => void submit(event)}>
      <label>Name<input required maxLength={255} autoComplete="name" value={name} onChange={event => setName(event.target.value)} /></label>
      <button className="primary" type="submit" disabled={busy || !name.trim()}>Speichern</button>
      {error && <p role="alert">{error}</p>}
    </form>
    <button type="button" className="text-button" onClick={onLogout}>Abmelden</button>
  </section></main>
}

export function AuthGate() {
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')

  useEffect(() => {
    let active = true
    request<CurrentUser>('/auth/me').then(loaded => {
      if (active) { setCsrfToken(loaded.csrf_token); setUser(loaded) }
    }).catch(() => {
      if (active) { setCsrfToken(null); setUser(null) }
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  async function logout() {
    await write<void>('POST', '/auth/logout')
    endSession('')
  }

  function endSession(notice: string) {
    setCsrfToken(null)
    setUser(null)
    setMessage(notice)
  }

  if (loading) return <main className="auth-page"><p role="status">Prüfe Anmeldung …</p></main>
  if (user && !user.name) return <NameForm onSave={setUser} onLogout={() => void logout()} />
  if (user) return <App currentUser={user} onLogout={() => void logout()} onProfileChange={setUser} onPasswordChanged={() => endSession('Passwort geändert. Bitte erneut anmelden.')} />
  return <main className="auth-page"><section className="auth-card">
    <h1>Programmplanung</h1><p>Für die Planung anmelden.</p>
    {message && <p role="status">{message}</p>}
    <LoginForm onLogin={next => { setMessage(''); setUser(next) }} />
    <a href="/passwort-zuruecksetzen">Passwort vergessen?</a>
  </section></main>
}

type Invitation = { email: string; existing_account: boolean; event_name: string | null; role: string }

export function InvitationPage({ token }: { token: string }) {
  const [invitation, setInvitation] = useState<Invitation | null>(null)
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    request<Invitation>(`/auth/invitations/${token}`).then(setInvitation).catch(cause => setError(cause.message))
    request<CurrentUser>('/auth/me').then(loaded => { setCsrfToken(loaded.csrf_token); setUser(loaded) }).catch(() => setCsrfToken(null))
  }, [token])

  async function accept(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const accepted = await request<CurrentUser>('/auth/invitations/accept', {
        method: 'POST', body: JSON.stringify({ token, password: invitation?.existing_account ? null : password }),
      })
      setCsrfToken(accepted.csrf_token)
      window.location.assign('/')
    } catch (cause) { setError((cause as Error).message) }
    finally { setBusy(false) }
  }

  return <main className="auth-page"><section className="auth-card">
    <h1>Einladung annehmen</h1>
    {invitation && <p>{invitation.email} · {invitation.event_name ?? 'Superadmin'} · {{ admin: 'Veranstaltungsadmin', editor: 'Bearbeiter', helper: 'Helfer', superadmin: 'Superadmin' }[invitation.role] ?? invitation.role}</p>}
    {invitation?.existing_account && user?.email !== invitation.email && <><p>Mit dem eingeladenen Konto anmelden.</p><LoginForm onLogin={setUser} /></>}
    {invitation && (!invitation.existing_account || user?.email === invitation.email) && <form onSubmit={event => void accept(event)}>
      {!invitation.existing_account && <label>Passwort festlegen<input type="password" minLength={12} required autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} /></label>}
      <button className="primary" type="submit" disabled={busy}>Einladung annehmen</button>
    </form>}
    {error && <p role="alert">{error}</p>}
  </section></main>
}

export function PasswordResetPage({ token }: { token: string | null }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    try {
      if (token) {
        await write<void>('POST', '/auth/password-reset/confirm', { token, password })
        setMessage('Passwort geändert. Jetzt anmelden.')
      } else {
        await write<void>('POST', '/auth/password-reset/request', { email })
        setMessage('Falls das Konto besteht, wurde ein Link versendet.')
      }
    } catch (cause) { setError((cause as Error).message) }
  }

  return <main className="auth-page"><section className="auth-card">
    <h1>Passwort zurücksetzen</h1>
    {!message && <form onSubmit={event => void submit(event)}>
      {token ? <label>Neues Passwort<input type="password" minLength={12} required autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} /></label>
        : <label>E-Mail<input type="email" required value={email} onChange={event => setEmail(event.target.value)} /></label>}
      <button className="primary" type="submit">{token ? 'Passwort ändern' : 'Link anfordern'}</button>
    </form>}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
    <a href="/">Zur Anmeldung</a>
  </section></main>
}
