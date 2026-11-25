import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { InvitationPage, PasswordResetPage } from './Auth'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('sends a reset request only once and confirms it', async () => {
  let finish!: (response: Response) => void
  const fetch = vi.fn(() => new Promise<Response>(resolve => { finish = resolve }))
  vi.stubGlobal('fetch', fetch)
  render(<PasswordResetPage token={null} />)
  expect(screen.getByText('Event Scheduler')).toBeTruthy()
  fireEvent.change(screen.getByLabelText('E-Mail'), { target: { value: 'ada@example.org' } })
  const form = screen.getByRole('button', { name: 'Link anfordern' }).closest('form')!
  fireEvent.submit(form)
  fireEvent.submit(form)
  expect(fetch).toHaveBeenCalledTimes(1)
  expect((screen.getByRole('button', { name: 'Bitte warten …' }) as HTMLButtonElement).disabled).toBe(true)
  finish(new Response(null, { status: 204 }))
  expect((await screen.findByRole('status')).textContent).toContain('Falls das Konto besteht, wurde ein Link versendet.')
})

it('checks the repeated password, can show it and ends with a button to sign in', async () => {
  const fetch = vi.fn(async () => new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetch)
  render(<PasswordResetPage token="abc" />)
  const password = screen.getByLabelText('Neues Passwort') as HTMLInputElement
  expect(password.type).toBe('password')
  expect(document.getElementById(password.getAttribute('aria-describedby')!)?.textContent).toBe('Mindestens 12 Zeichen.')
  const toggle = document.querySelector(`[aria-controls="${password.id}"]`)!
  expect(toggle.getAttribute('aria-label')).toBe('Klartext anzeigen')
  fireEvent.click(toggle)
  expect(password.type).toBe('text')
  expect(toggle.getAttribute('aria-pressed')).toBe('true')
  fireEvent.change(password, { target: { value: 'Newpassword12345!' } })
  fireEvent.change(screen.getByLabelText('Passwort wiederholen'), { target: { value: 'Otherpassword123!' } })
  fireEvent.submit(password.closest('form')!)
  expect(screen.getByRole('alert').textContent).toBe('Die Passwörter stimmen nicht überein.')
  expect(fetch).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('Passwort wiederholen'), { target: { value: 'Newpassword12345!' } })
  fireEvent.submit(password.closest('form')!)
  expect(await screen.findByRole('heading', { name: 'Passwort geändert' })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Zur Anmeldung' }).className).toContain('primary')
})

it('explains an expired reset link and offers a new one', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ detail: 'Link ungültig oder abgelaufen' }), { status: 404 })))
  render(<PasswordResetPage token="old" />)
  fireEvent.change(screen.getByLabelText('Neues Passwort'), { target: { value: 'Newpassword12345!' } })
  fireEvent.change(screen.getByLabelText('Passwort wiederholen'), { target: { value: 'Newpassword12345!' } })
  fireEvent.submit(screen.getByLabelText('Neues Passwort').closest('form')!)
  expect((await screen.findByRole('alert')).textContent).toContain('Bitte einen neuen Link anfordern.')
  expect(screen.getByRole('link', { name: 'Neuen Link anfordern' }).getAttribute('href')).toBe('/passwort-zuruecksetzen')
})

it('shows a loading state and a next step for invalid invitations', async () => {
  let finish!: (response: Response) => void
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => String(input).endsWith('/auth/me')
    ? Promise.resolve(new Response(null, { status: 401 }))
    : new Promise<Response>(resolve => { finish = resolve })))
  render(<InvitationPage token="expired" />)
  expect(screen.getByRole('status').textContent).toBe('Lade Einladung …')
  finish(new Response(JSON.stringify({ detail: 'Link ungültig oder abgelaufen' }), { status: 404 }))
  expect(await screen.findByRole('heading', { name: 'Einladung nicht mehr gültig' })).toBeTruthy()
  expect(screen.getByRole('alert').textContent).toContain('Einladungen gelten 48 Stunden.')
  expect(screen.getByText('Bitte bei der Veranstaltungsleitung eine neue Einladung anfordern.')).toBeTruthy()
})

it('asks new accounts for a repeated password before accepting', async () => {
  const fetch = vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/auth/me')
    ? new Response(null, { status: 401 })
    : new Response(JSON.stringify({ email: 'neu@example.org', existing_account: false, event_name: 'Sommerfest', role: 'helper' })))
  vi.stubGlobal('fetch', fetch)
  render(<InvitationPage token="t" />)
  expect(await screen.findByText('Sommerfest')).toBeTruthy()
  expect(screen.getByText('Helfer')).toBeTruthy()
  fireEvent.change(screen.getByLabelText('Passwort festlegen'), { target: { value: 'Newpassword12345!' } })
  fireEvent.change(screen.getByLabelText('Passwort wiederholen'), { target: { value: 'Tippfehler12345!' } })
  fireEvent.submit(screen.getByRole('button', { name: 'Einladung annehmen' }).closest('form')!)
  expect(screen.getByRole('alert').textContent).toBe('Die Passwörter stimmen nicht überein.')
  expect(fetch.mock.calls.some(([url]) => String(url).endsWith('/accept'))).toBe(false)
})
