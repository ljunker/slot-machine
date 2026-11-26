import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import App from './App'
import { request, setCsrfToken, write } from './api'
import InlineMessage from './InlineMessage'
import PasswordField from './PasswordField'
import type { CurrentUser } from './types'
import { APP_TITLE, pageTitle, usePageTitle } from './pageTitle'

const PASSWORD_HINT = 'Mindestens 12 Zeichen.'
const INVALID_LINK = 'Link ungültig oder abgelaufen'

async function login(email: string, password: string): Promise<CurrentUser> {
  const user = await request<CurrentUser>('/auth/login', {
    method: 'POST', body: JSON.stringify({ email, password }),
  })
  setCsrfToken(user.csrf_token)
  return user
}

/** Card layout shared by all sign-in pages, with the product name above the title. */
function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  usePageTitle(pageTitle(title, APP_TITLE))
  return <main className="auth-page"><section className="auth-card">
    <div className="auth-brand" aria-hidden="true"><span className="auth-brand-mark" />Event Scheduler</div>
    <h1>{title}</h1>
    {children}
  </section></main>
}

/**
 * Keeps a form from being sent twice: the ref blocks a second submit before React
 * re-renders, the returned flag drives the disabled state of the controls.
 */
function useSubmit() {
  const pending = useRef(false)
  const [busy, setBusy] = useState(false)
  async function submit(action: () => Promise<void>) {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    try { await action() }
    finally {
      pending.current = false
      setBusy(false)
    }
  }
  return { busy, submit }
}

function LoginForm({ onLogin }: { onLogin: (user: CurrentUser) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const { busy, submit } = useSubmit()

  function send(event: React.FormEvent) {
    event.preventDefault()
    void submit(async () => {
      setError('')
      try { onLogin(await login(email, password)) }
      catch (cause) { setError((cause as Error).message) }
    })
  }

  return <form onSubmit={send}>
    <label>E-Mail<input type="email" required autoComplete="username" value={email} disabled={busy} onChange={event => setEmail(event.target.value)} /></label>
    <PasswordField label="Passwort" autoComplete="current-password" value={password} disabled={busy} onChange={setPassword} />
    <button className="primary" type="submit" disabled={busy}>{busy ? 'Melde an …' : 'Anmelden'}</button>
    {error && <InlineMessage tone="error">{error}</InlineMessage>}
  </form>
}

/** New password with repetition; reports a mismatch before anything is sent. */
function NewPasswordFields({ password, confirmation, onPassword, onConfirmation, disabled, label = 'Passwort festlegen' }: {
  password: string
  confirmation: string
  onPassword: (value: string) => void
  onConfirmation: (value: string) => void
  disabled: boolean
  label?: string
}) {
  return <>
    <PasswordField label={label} autoComplete="new-password" minLength={12} hint={PASSWORD_HINT} value={password} disabled={disabled} onChange={onPassword} />
    <PasswordField label="Passwort wiederholen" autoComplete="new-password" minLength={12} value={confirmation} disabled={disabled} onChange={onConfirmation} />
  </>
}

export function NameForm({ onSave, onLogout }: { onSave: (user: CurrentUser) => void; onLogout: () => void }) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const { busy, submit } = useSubmit()
  function send(event: React.FormEvent) {
    event.preventDefault()
    void submit(async () => {
      setError('')
      try { onSave(await write<CurrentUser>('PATCH', '/auth/me', { name })) }
      catch (cause) { setError((cause as Error).message) }
    })
  }
  return <AuthCard title="Namen festlegen">
    <p>Dein Name erscheint im Helferplan und gilt für alle Veranstaltungen.</p>
    <form onSubmit={send}>
      <label>Name<input required maxLength={255} autoComplete="name" value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label>
      <button className="primary" type="submit" disabled={busy || !name.trim()}>{busy ? 'Speichere …' : 'Speichern'}</button>
      {error && <InlineMessage tone="error">{error}</InlineMessage>}
    </form>
    <button type="button" className="text-button" onClick={onLogout}>Abmelden</button>
  </AuthCard>
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
  return <AuthCard title="Programmplanung">
    <p>Für die Planung anmelden.</p>
    {message && <InlineMessage tone="success">{message}</InlineMessage>}
    <LoginForm onLogin={next => { setMessage(''); setUser(next) }} />
    <a href="/passwort-zuruecksetzen">Passwort vergessen?</a>
  </AuthCard>
}

type Invitation = { email: string; existing_account: boolean; event_name: string | null; role: string }

const ROLE_NAMES: Record<string, string> = { admin: 'Veranstaltungsadmin', editor: 'Bearbeiter', helper: 'Helfer', superadmin: 'Superadmin' }

export function InvitationPage({ token }: { token: string }) {
  const [invitation, setInvitation] = useState<Invitation | null>(null)
  const [loadError, setLoadError] = useState('')
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const { busy, submit } = useSubmit()

  useEffect(() => {
    request<Invitation>(`/auth/invitations/${token}`).then(setInvitation).catch(cause => setLoadError(cause.message))
    request<CurrentUser>('/auth/me').then(loaded => { setCsrfToken(loaded.csrf_token); setUser(loaded) }).catch(() => setCsrfToken(null))
  }, [token])

  function accept(event: React.FormEvent) {
    event.preventDefault()
    if (!invitation?.existing_account && password !== confirmation) {
      setError('Die Passwörter stimmen nicht überein.')
      return
    }
    void submit(async () => {
      setError('')
      try {
        const accepted = await request<CurrentUser>('/auth/invitations/accept', {
          method: 'POST', body: JSON.stringify({ token, password: invitation?.existing_account ? null : password }),
        })
        setCsrfToken(accepted.csrf_token)
        window.location.assign('/')
      } catch (cause) { setError((cause as Error).message) }
    })
  }

  if (loadError) return <AuthCard title="Einladung nicht mehr gültig">
    <InlineMessage tone="error">{loadError === INVALID_LINK ? 'Dieser Einladungslink ist ungültig, wurde schon verwendet oder ist abgelaufen. Einladungen gelten 48 Stunden.' : loadError}</InlineMessage>
    <p>Bitte bei der Veranstaltungsleitung eine neue Einladung anfordern.</p>
    <a className="button-link secondary" href="/">Zur Anmeldung</a>
  </AuthCard>

  if (!invitation) return <AuthCard title="Einladung annehmen"><p role="status">Lade Einladung …</p></AuthCard>

  const needsLogin = invitation.existing_account && user?.email !== invitation.email
  return <AuthCard title="Einladung annehmen">
    <dl className="auth-facts">
      <div><dt>E-Mail</dt><dd>{invitation.email}</dd></div>
      <div><dt>{invitation.event_name ? 'Veranstaltung' : 'Zugang'}</dt><dd>{invitation.event_name ?? 'Alle Veranstaltungen'}</dd></div>
      <div><dt>Rolle</dt><dd>{ROLE_NAMES[invitation.role] ?? invitation.role}</dd></div>
    </dl>
    {needsLogin && <><p>Für diese Adresse gibt es schon ein Konto. Bitte damit anmelden.</p><LoginForm onLogin={setUser} /></>}
    {!needsLogin && <form onSubmit={accept}>
      {!invitation.existing_account && <NewPasswordFields password={password} confirmation={confirmation} onPassword={setPassword} onConfirmation={setConfirmation} disabled={busy} />}
      <button className="primary" type="submit" disabled={busy}>{busy ? 'Nehme Einladung an …' : 'Einladung annehmen'}</button>
    </form>}
    {error && <InlineMessage tone="error">{error}</InlineMessage>}
  </AuthCard>
}

export function PasswordResetPage({ token }: { token: string | null }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const { busy, submit } = useSubmit()

  function send(event: React.FormEvent) {
    event.preventDefault()
    if (token && password !== confirmation) {
      setError('Die Passwörter stimmen nicht überein.')
      return
    }
    void submit(async () => {
      setError('')
      try {
        if (token) await write<void>('POST', '/auth/password-reset/confirm', { token, password })
        else await write<void>('POST', '/auth/password-reset/request', { email })
        setDone(true)
      } catch (cause) {
        const message = (cause as Error).message
        setError(message === INVALID_LINK ? 'Dieser Link ist ungültig, wurde schon verwendet oder ist abgelaufen. Bitte einen neuen Link anfordern.' : message)
      }
    })
  }

  if (done) return <AuthCard title={token ? 'Passwort geändert' : 'Link angefordert'}>
    <InlineMessage tone="success">{token ? 'Dein neues Passwort ist gespeichert. Du kannst dich jetzt anmelden.' : 'Falls das Konto besteht, wurde ein Link versendet. Bitte auch im Spam-Ordner nachsehen.'}</InlineMessage>
    {token ? <a className="button-link primary" href="/">Zur Anmeldung</a> : <a href="/">Zur Anmeldung</a>}
  </AuthCard>

  return <AuthCard title="Passwort zurücksetzen">
    {!token && <p>Wir schicken dir einen Link, mit dem du ein neues Passwort festlegen kannst.</p>}
    <form onSubmit={send}>
      {token
        ? <NewPasswordFields label="Neues Passwort" password={password} confirmation={confirmation} onPassword={setPassword} onConfirmation={setConfirmation} disabled={busy} />
        : <label>E-Mail<input type="email" required autoComplete="username" value={email} disabled={busy} onChange={event => setEmail(event.target.value)} /></label>}
      <button className="primary" type="submit" disabled={busy}>{busy ? 'Bitte warten …' : token ? 'Passwort ändern' : 'Link anfordern'}</button>
    </form>
    {error && <InlineMessage tone="error">{error}</InlineMessage>}
    {token && error && <a href="/passwort-zuruecksetzen">Neuen Link anfordern</a>}
    <a href="/">Zur Anmeldung</a>
  </AuthCard>
}
