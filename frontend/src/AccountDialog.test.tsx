import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import AccountDialog from './AccountDialog'
import { AuthGate } from './Auth'
import { csrfHeaders, setCsrfToken } from './api'
import type { CurrentUser, Duty, EventDay } from './types'

const currentUser: CurrentUser = { id: 9, name: 'Ada', email: 'ada@example.invalid', is_superadmin: false, event_roles: { '1': 'helper', '2': 'editor' }, csrf_token: 'test-csrf' }
const dialogMethods = ['showModal', 'close'] as const
const originalMethods = dialogMethods.map(method => Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, method))

beforeAll(() => {
  for (const method of dialogMethods) Object.defineProperty(HTMLDialogElement.prototype, method, {
    configurable: true,
    value(this: HTMLDialogElement) { this.open = method === 'showModal' },
  })
})
afterAll(() => {
  dialogMethods.forEach((method, index) => {
    const original = originalMethods[index]
    if (original) Object.defineProperty(HTMLDialogElement.prototype, method, original)
    else Reflect.deleteProperty(HTMLDialogElement.prototype, method)
  })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); setCsrfToken(null) })

function renderDialog(overrides: Partial<Parameters<typeof AccountDialog>[0]> = {}) {
  const props = { currentUser, onProfileSaved: vi.fn(async () => true), onPasswordChanged: vi.fn(), onClose: vi.fn(), ...overrides }
  render(<AccountDialog {...props} />)
  return props
}

function fillPasswords(confirmation = 'Changedpassword123!') {
  fireEvent.change(screen.getByLabelText('Aktuelles Passwort'), { target: { value: 'Testpassword123!' } })
  fireEvent.change(screen.getByLabelText('Neues Passwort', { exact: true }), { target: { value: 'Changedpassword123!' } })
  fireEvent.change(screen.getByLabelText('Neues Passwort wiederholen'), { target: { value: confirmation } })
}

it('prefills the account, focuses the name and saves the normalized server value with CSRF', async () => {
  const updated = { ...currentUser, name: 'Ada Müller' }
  const fetch = vi.fn(async () => new Response(JSON.stringify(updated)))
  vi.stubGlobal('fetch', fetch)
  setCsrfToken(currentUser.csrf_token)
  const { onProfileSaved } = renderDialog()
  expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Ada')
  expect(document.activeElement).toBe(screen.getByLabelText('Name'))
  expect(screen.getByText(currentUser.email)).toBeTruthy()
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  Ada  Müller  ' } })
  fireEvent.submit(screen.getByRole('form', { name: 'Name ändern' }))
  await screen.findByText('Name gespeichert.')
  expect(onProfileSaved).toHaveBeenCalledWith(updated)
  expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Ada Müller')
  expect(fetch).toHaveBeenCalledWith('/api/auth/me', expect.objectContaining({
    method: 'PATCH', body: JSON.stringify({ name: '  Ada  Müller  ' }), headers: expect.objectContaining({ 'X-CSRF-Token': 'test-csrf' }),
  }))
})

it('rejects mismatched passwords before calling the server', () => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  renderDialog()
  fillPasswords('Differentpassword123!')
  fireEvent.submit(screen.getByRole('form', { name: 'Passwort ändern' }))
  expect(screen.getByRole('alert').textContent).toBe('Die neuen Passwörter stimmen nicht überein.')
  expect(fetch).not.toHaveBeenCalled()
  expect((screen.getByLabelText('Neues Passwort', { exact: true }) as HTMLInputElement).minLength).toBe(12)
  expect((screen.getByLabelText('Neues Passwort', { exact: true }) as HTMLInputElement).maxLength).toBe(1024)
})

it.each([
  [400, 'Aktuelles Passwort ist falsch'],
  [429, 'Zu viele Versuche. Später erneut versuchen'],
  [503, 'Speichern fehlgeschlagen'],
])('keeps the dialog and name draft after password error %s', async (status, message) => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ detail: message }), { status })))
  const { onPasswordChanged } = renderDialog()
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Noch nicht gespeichert' } })
  fillPasswords()
  fireEvent.submit(screen.getByRole('form', { name: 'Passwort ändern' }))
  expect((await screen.findByRole('alert')).textContent).toBe(message)
  expect(onPasswordChanged).not.toHaveBeenCalled()
  expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Noch nicht gespeichert')
  expect((screen.getByRole('button', { name: 'Passwort ändern' }) as HTMLButtonElement).disabled).toBe(false)
})

it('reports name validation and refresh failures without losing a saved name', async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'Name muss 1 bis 255 Zeichen haben' }), { status: 422 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ ...currentUser, name: 'Ada Müller' })))
  vi.stubGlobal('fetch', fetch)
  const { onProfileSaved } = renderDialog({ onProfileSaved: vi.fn(async () => false) })
  fireEvent.submit(screen.getByRole('form', { name: 'Name ändern' }))
  expect((await screen.findByRole('alert')).textContent).toBe('Name muss 1 bis 255 Zeichen haben')
  expect(onProfileSaved).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ada Müller' } })
  fireEvent.submit(screen.getByRole('form', { name: 'Name ändern' }))
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Name gespeichert. Planungsansicht konnte nicht aktualisiert werden.'))
  expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Ada Müller')
})

it('blocks duplicate submissions and closing while saving, then clears password fields', async () => {
  let finish!: (response: Response) => void
  const fetch = vi.fn(() => new Promise<Response>(resolve => { finish = resolve }))
  vi.stubGlobal('fetch', fetch)
  const { onClose, onPasswordChanged } = renderDialog()
  fillPasswords()
  const form = screen.getByRole('form', { name: 'Passwort ändern' })
  fireEvent.submit(form)
  fireEvent.submit(form)
  fireEvent.submit(screen.getByRole('form', { name: 'Name ändern' }))
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }))
  expect(fetch).toHaveBeenCalledTimes(1)
  expect((screen.getByRole('button', { name: 'Schließen' }) as HTMLButtonElement).disabled).toBe(true)
  expect(onClose).not.toHaveBeenCalled()
  finish(new Response(null, { status: 204 }))
  await waitFor(() => expect(onPasswordChanged).toHaveBeenCalledOnce())
  for (const input of screen.getByRole('dialog').querySelectorAll<HTMLInputElement>('input[type="password"]')) expect(input.value).toBe('')
  expect(fetch).toHaveBeenCalledWith('/api/auth/password-change', expect.objectContaining({
    method: 'POST', body: JSON.stringify({ current_password: 'Testpassword123!', new_password: 'Changedpassword123!' }),
  }))
})

function mockApplication() {
  let user = { ...currentUser }
  const fetch = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
    const path = String(input).replace('/api', '')
    if (path === '/auth/password-change') return new Response(null, { status: 204 })
    if (path === '/auth/me' && options?.method === 'PATCH') user = { ...user, name: 'Ada Müller' }
    const eventId = Number(path.match(/^\/events\/(\d+)/)?.[1] ?? 1)
    const days: EventDay[] = [1, 2].map(day => ({ id: eventId * 10 + day, event_id: eventId, date: `2099-06-0${day}`, start_time: '09:00:00', end_time: '18:00:00' }))
    const duty: Duty = { id: 6, event_id: eventId, day_id: eventId * 10 + 2, date: '2099-06-02', kind: 'general', title: 'Einlass', user_ids: [9], users: [{ id: 9, name: user.name!, is_active: true }], capacity: 1, room_id: null, slot_id: null, session_topic: null, start_time: '10:00:00', end_time: '11:00:00', sort_order: 0, status: 'active' }
    const body = path === '/auth/me' || path === '/auth/login' ? user
      : path === '/events' ? [1, 2].map(id => ({ id, name: `Veranstaltung ${id}`, start_date: '2099-06-01', end_date: '2099-06-02', accent_color: null, logo_url: null }))
        : path.endsWith('/days') ? days
          : path.endsWith('/rooms') ? [{ id: 5, event_id: eventId, name: 'Saal', sort_order: 0 }]
            : path.endsWith('/helper-plan') ? { duties: [duty], conflicts: [] }
              : path.endsWith('/duty-participants') ? [{ id: 9, name: user.name, is_active: true, email: user.email }]
                : path.startsWith('/schedule/days/') ? { day_id: Number(path.split('/').at(-1)), date: '2099-06-02', start_time: '09:00:00', end_time: '18:00:00', rooms: [{ id: 5, event_id: eventId, name: 'Saal', sort_order: 0, slots: [] }], collisions: [], speaker_conflicts: [] }
                  : []
    return new Response(JSON.stringify(body))
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

it('updates the auth state and helper plan while retaining the event, day and view', async () => {
  const fetch = mockApplication()
  render(<AuthGate />)
  await screen.findByRole('button', { name: /^1\. Juni 2099/ })
  fireEvent.change(screen.getByLabelText('Veranstaltung wählen'), { target: { value: '2' } })
  await screen.findByRole('button', { name: '+ Dienst' })
  fireEvent.click(screen.getByRole('button', { name: /^2\. Juni 2099/ }))
  await waitFor(() => expect(document.querySelector('.day-row.active')?.textContent).toContain('2. Juni 2099'))
  fireEvent.click(screen.getByRole('button', { name: 'Helferplan' }))
  await waitFor(() => expect(document.querySelector('[data-duty-id="6"]')?.textContent).toContain('Ada'))
  fireEvent.click(screen.getByRole('button', { name: 'Mein Konto' }))
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ada Müller' } })
  fireEvent.submit(screen.getByRole('form', { name: 'Name ändern' }))
  await screen.findByText('Name gespeichert.')
  expect(document.querySelector('.account-name')?.textContent).toContain('Ada Müller')
  expect(document.querySelector('[data-duty-id="6"]')?.textContent).toContain('Ada Müller')
  expect((screen.getByLabelText('Veranstaltung wählen') as HTMLSelectElement).value).toBe('2')
  expect(document.querySelector('.day-row.active')?.textContent).toContain('2. Juni 2099')
  expect(screen.getByRole('button', { name: 'Helferplan' }).getAttribute('aria-pressed')).toBe('true')
  expect(fetch.mock.calls.filter(([url]) => url === '/api/events/2/duty-participants').length).toBeGreaterThan(1)
})

it('closes on Escape and restores focus to the account button', async () => {
  mockApplication()
  const user = userEvent.setup()
  render(<AuthGate />)
  const opener = await screen.findByRole('button', { name: 'Mein Konto' })
  await user.click(opener)
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(opener)
})

it('wraps keyboard focus between the first and last dialog controls', async () => {
  renderDialog()
  const user = userEvent.setup()
  await user.tab({ shift: true })
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Schließen' }))
  await user.tab({ shift: true })
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Passwort ändern' }))
  await user.tab()
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Schließen' }))
})

it('ends local authentication after changing the password without requesting logout', async () => {
  const fetch = mockApplication()
  render(<AuthGate />)
  fireEvent.click(await screen.findByRole('button', { name: 'Mein Konto' }))
  fillPasswords()
  fireEvent.submit(screen.getByRole('form', { name: 'Passwort ändern' }))
  await screen.findByText('Passwort geändert. Bitte erneut anmelden.')
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Mein Konto' })).toBeNull()
  expect(csrfHeaders()).toEqual({})
  expect(fetch.mock.calls.some(([url]) => url === '/api/auth/logout')).toBe(false)
  const login = screen.getByRole('button', { name: 'Anmelden' }).closest('form')!
  fireEvent.change(within(login).getByLabelText('E-Mail'), { target: { value: currentUser.email } })
  fireEvent.change(within(login).getByLabelText('Passwort'), { target: { value: 'Changedpassword123!' } })
  fireEvent.submit(login)
  await screen.findByRole('button', { name: 'Mein Konto' })
  expect(screen.queryByText('Passwort geändert. Bitte erneut anmelden.')).toBeNull()
})
