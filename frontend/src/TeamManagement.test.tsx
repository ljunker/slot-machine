import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { TeamManagement, UserManagement, splitEmails } from './TeamManagement'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const members = [
  { user_id: 1, email: 'ich@example.org', name: 'Ich', role: 'admin', is_active: true },
  { user_id: 2, email: 'ada@example.org', name: 'Ada', role: 'editor', is_active: true },
]

function mockTeam(invitations = [{ id: 30, email: 'neu@example.org', role: 'helper', expires_at: 4102444800, expired: false }]) {
  const fetch = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
    const path = String(input).replace('/api', '')
    const body = options?.body ? JSON.parse(String(options.body)) : null
    if (options?.method === 'POST' && body?.email === 'vergeben@example.org') return new Response(JSON.stringify({ detail: 'Benutzer gehört bereits zum Team' }), { status: 409 })
    if (options?.method && options.method !== 'GET') return new Response(null, { status: 204 })
    if (path === '/events/5/members') return new Response(JSON.stringify(members))
    if (path === '/events/5/members/invitations') return new Response(JSON.stringify(invitations))
    throw new Error(`Unexpected ${path}`)
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

const calls = (fetch: ReturnType<typeof vi.fn>, method: string) => fetch.mock.calls
  .filter(([, options]) => (options as RequestInit | undefined)?.method === method)
  .map(([url, options]) => [url, (options as RequestInit).body ? JSON.parse(String((options as RequestInit).body)) : null])

it('splits several addresses and removes duplicates', () => {
  expect(splitEmails(' a@x.de, b@x.de;a@x.de\nc@x.de ')).toEqual(['a@x.de', 'b@x.de', 'c@x.de'])
})

it('lists members as a table and pending invitations with resend and revoke', async () => {
  const fetch = mockTeam()
  render(<TeamManagement eventId={5} currentUserId={1} onClose={() => {}} />)
  const dialog = screen.getByRole('dialog', { name: 'Team verwalten' })
  const ada = (await within(dialog).findByRole('cell', { name: 'ada@example.org' })).closest('tr')!
  expect(within(ada).getByText('Bearbeiter', { selector: '.badge' })).toBeTruthy()
  const pending = within(dialog).getByRole('region', { name: 'Ausstehende Einladungen (1)' })
  expect(pending.textContent).toContain('neu@example.org')
  expect(pending.textContent).toContain('Helfer · gültig bis')

  fireEvent.click(within(pending).getByRole('button', { name: 'Erneut senden' }))
  await within(dialog).findByText('Einladung an neu@example.org erneut versendet.')
  expect(calls(fetch, 'POST')).toEqual([['/api/events/5/members/invitations', { email: 'neu@example.org', role: 'helper' }]])

  fireEvent.click(within(pending).getByRole('button', { name: 'Zurückziehen' }))
  const confirm = await screen.findByRole('alertdialog', { name: 'Einladung zurückziehen?' })
  fireEvent.click(within(confirm).getByRole('button', { name: 'Einladung zurückziehen' }))
  await within(dialog).findByText('Einladung zurückgezogen.')
  expect(calls(fetch, 'DELETE')).toEqual([['/api/events/5/members/invitations/30', null]])
})

it('invites helpers by default, several at once, and keeps addresses that failed', async () => {
  const fetch = mockTeam([])
  render(<TeamManagement eventId={5} currentUserId={1} onClose={() => {}} />)
  await screen.findByText('Keine offenen Einladungen.')
  expect((screen.getByLabelText('Rolle') as HTMLSelectElement).value).toBe('helper')
  fireEvent.change(screen.getByLabelText('E-Mail-Adressen'), { target: { value: 'eins@example.org, vergeben@example.org; zwei@example.org' } })
  fireEvent.submit(screen.getByRole('form', { name: 'Einladen' }))
  expect((await screen.findByRole('alert')).textContent).toBe('2 versendet. Nicht versendet: vergeben@example.org: Benutzer gehört bereits zum Team')
  expect((screen.getByLabelText('E-Mail-Adressen') as HTMLInputElement).value).toBe('vergeben@example.org')
  expect(calls(fetch, 'POST').map(([, body]) => body)).toEqual([
    { email: 'eins@example.org', role: 'helper' },
    { email: 'vergeben@example.org', role: 'helper' },
    { email: 'zwei@example.org', role: 'helper' },
  ])
})

it('asks before admins demote themselves and changes other roles through a menu', async () => {
  const fetch = mockTeam([])
  render(<TeamManagement eventId={5} currentUserId={1} onClose={() => {}} />)
  const own = (await screen.findByRole('cell', { name: 'ich@example.org' })).closest('tr')!
  fireEvent.click(within(own).getByRole('button', { name: 'Rolle ändern' }))
  expect((within(own).getByRole('button', { name: 'Veranstaltungsadmin' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(within(own).getByRole('button', { name: 'Helfer' }))
  const confirm = await screen.findByRole('alertdialog', { name: 'Eigene Rolle herabstufen?' })
  fireEvent.click(within(confirm).getByRole('button', { name: 'Abbrechen' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  expect(calls(fetch, 'PATCH')).toEqual([])

  const ada = screen.getByRole('cell', { name: 'ada@example.org' }).closest('tr')!
  fireEvent.click(within(ada).getByRole('button', { name: 'Rolle ändern' }))
  fireEvent.click(within(ada).getByRole('button', { name: 'Helfer' }))
  await screen.findByText('Ada ist jetzt Helfer.')
  expect(screen.queryByRole('alertdialog')).toBeNull()
  expect(calls(fetch, 'PATCH')).toEqual([['/api/events/5/members/2', { role: 'helper' }]])
})

it('shows names in the user list and confirms before locking an account', async () => {
  const fetch = vi.fn(async (_input: RequestInfo | URL, options?: RequestInit) => options?.method === 'PATCH'
    ? new Response(JSON.stringify({}))
    : new Response(JSON.stringify([{ id: 1, email: 'ich@example.org', name: 'Ich', is_active: true, is_superadmin: true }, { id: 2, email: 'ada@example.org', name: 'Ada Lovelace', is_active: true, is_superadmin: false }])))
  vi.stubGlobal('fetch', fetch)
  render(<UserManagement currentUserId={1} onClose={() => {}} />)
  expect(await screen.findByRole('cell', { name: 'Ada Lovelace' })).toBeTruthy()
  fireEvent.click(screen.getByRole('checkbox', { name: 'ada@example.org ist aktiv' }))
  const confirm = await screen.findByRole('alertdialog', { name: 'Konto sperren?' })
  expect(confirm.textContent).toContain('Ada Lovelace wird abgemeldet')
  fireEvent.click(within(confirm).getByRole('button', { name: 'Konto sperren' }))
  await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/users/2', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ is_active: false }) })))
})
