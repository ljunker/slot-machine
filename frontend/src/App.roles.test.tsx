import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import App from './App'
import type { CurrentUser } from './types'

const user = (role: 'admin' | 'editor' | 'helper'): CurrentUser => ({
  id: 3, email: 'person@example.invalid', name: 'Testperson', is_superadmin: false,
  event_roles: { '1': role }, csrf_token: 'test',
})

function mockApi(hasEvents = true, eventsResponse?: Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input).replace('/api', '')
    if (path === '/events' && eventsResponse) return eventsResponse
    const body = path === '/events' ? hasEvents ? [{ id: 1, name: 'Konferenz', start_date: '2099-06-01', end_date: '2099-06-01', accent_color: null, logo_url: null }] : []
      : path === '/events/1/days' ? [{ id: 2, event_id: 1, date: '2099-06-01', start_time: '09:00:00', end_time: '18:00:00' }]
        : path === '/events/1/rooms' ? [{ id: 3, event_id: 1, name: 'Saal', sort_order: 0 }]
          : path === '/events/1/helper-plan' ? { duties: [], conflicts: [] }
            : path === '/schedule/days/2' ? { day_id: 2, date: '2099-06-01', start_time: '09:00:00', end_time: '18:00:00', rooms: [{ id: 3, event_id: 1, name: 'Saal', sort_order: 0, slots: [] }], collisions: [], speaker_conflicts: [] }
              : []
    return new Response(JSON.stringify(body), { status: 200 })
  }))
}

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it.each(['Testperson', null])('shows the account name %s and full email in the header', async name => {
  mockApi(false)
  const currentUser = { ...user('helper'), name }
  const { container } = render(<App currentUser={currentUser} />)
  await screen.findByText('Erstelle zuerst eine Veranstaltung.')
  const account = container.querySelector('.account-name')!
  expect(account.querySelector('strong')?.textContent ?? null).toBe(name)
  expect(account.querySelector('strong')?.title ?? null).toBe(name)
  expect(account.querySelector('span')?.textContent).toBe(currentUser.email)
  expect(account.querySelector('span')?.title).toBe(currentUser.email)
  expect(screen.getByRole('radiogroup', { name: 'Darstellung' })).toBeTruthy()
})

it('shows planning actions to editors without admin controls', async () => {
  mockApi()
  render(<App currentUser={user('editor')} />)
  await screen.findByRole('button', { name: '+ Slot' })
  fireEvent.click(screen.getByRole('button', { name: 'Menü' }))
  expect(screen.getByRole('button', { name: '+ Dienst' })).toBeTruthy()
  for (const name of ['+ Veranstaltung', '+ Tag', '+ Raum', 'Team verwalten', 'Restore', 'Benutzer', 'Bearbeiten']) {
    expect(screen.queryByRole('button', { name })).toBeNull()
  }
  expect(screen.queryByRole('link', { name: 'Backup herunterladen' })).toBeNull()
})

it('shows event controls to event admins without global controls', async () => {
  mockApi()
  render(<App currentUser={user('admin')} />)
  await screen.findByRole('button', { name: '+ Tag' })
  fireEvent.click(screen.getByRole('button', { name: 'Menü' }))
  expect(screen.getByRole('button', { name: '+ Raum' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Team verwalten' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Restore' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: '+ Veranstaltung' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Benutzer' })).toBeNull()
})

it.each([
  ['helper', false, ['Mein Konto', 'Abmelden']],
  ['editor', false, ['Mein Konto', 'Abmelden']],
  ['admin', false, ['Mein Konto', 'Restore', 'Abmelden']],
  ['admin', true, ['Mein Konto', 'Benutzer', 'Restore', '+ Veranstaltung', 'Abmelden']],
] as const)('shows the permitted menu actions for %s (superadmin: %s)', async (role, isSuperadmin, labels) => {
  mockApi()
  const onLogout = vi.fn()
  render(<App currentUser={{ ...user(role), is_superadmin: isSuperadmin }} onLogout={onLogout} />)
  await screen.findByRole('button', { name: 'Tagesplan' })
  fireEvent.click(screen.getByRole('button', { name: 'Menü' }))
  const panel = screen.getByRole('group', { name: 'Header-Aktionen' })
  expect(within(panel).getAllByRole('button').map(button => button.textContent)).toEqual(labels)
  fireEvent.click(within(panel).getByRole('button', { name: 'Abmelden' }))
  expect(onLogout).toHaveBeenCalledOnce()
  expect(screen.queryByRole('group', { name: 'Header-Aktionen' })).toBeNull()
})

it.each([false, true])('keeps the appropriate menu actions without events (superadmin: %s)', async isSuperadmin => {
  mockApi(false)
  render(<App currentUser={{ ...user('admin'), is_superadmin: isSuperadmin }} />)
  await screen.findByText('Erstelle zuerst eine Veranstaltung.')
  fireEvent.click(screen.getByRole('button', { name: 'Menü' }))
  const labels = within(screen.getByRole('group', { name: 'Header-Aktionen' })).getAllByRole('button').map(button => button.textContent)
  expect(labels).toEqual(isSuperadmin ? ['Mein Konto', 'Benutzer', 'Restore', '+ Veranstaltung'] : ['Mein Konto'])
})

it('disables event creation while loading and enables it afterwards', async () => {
  let finish!: (response: Response) => void
  mockApi(false, new Promise(resolve => { finish = resolve }))
  render(<App currentUser={{ ...user('admin'), is_superadmin: true }} />)
  fireEvent.click(screen.getByRole('button', { name: 'Menü' }))
  const create = screen.getByRole('button', { name: '+ Veranstaltung' }) as HTMLButtonElement
  expect(create.disabled).toBe(true)
  fireEvent.click(create)
  expect(screen.getByRole('button', { name: 'Menü' }).getAttribute('aria-expanded')).toBe('true')
  await act(async () => finish(new Response(JSON.stringify([]))))
  expect(create.disabled).toBe(false)
  fireEvent.click(create)
  expect(screen.getByRole('heading', { name: 'Veranstaltung anlegen' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Menü' }).getAttribute('aria-expanded')).toBe('false')
})
