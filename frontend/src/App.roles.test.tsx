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

it.each(['Testperson', null])('shows the account name %s and initials in the header, without the email', async name => {
  mockApi(false)
  const currentUser = { ...user('helper'), name }
  const { container } = render(<App currentUser={currentUser} />)
  await screen.findByText('Erstelle zuerst eine Veranstaltung.')
  const account = container.querySelector('.account-name')
  expect(account?.querySelector('strong')?.textContent ?? null).toBe(name)
  expect(account?.querySelector('strong')?.title ?? null).toBe(name)
  expect(container.querySelector('.app-header')?.textContent).not.toContain(currentUser.email)
  expect(screen.getByRole('button', { name: 'Menü' }).textContent).toContain(name ? 'TE' : currentUser.email.slice(0, 2).toUpperCase())
  expect(screen.getByRole('radiogroup', { name: 'Darstellung' })).toBeTruthy()
})

function manageLabels(): string[] {
  fireEvent.click(screen.getByRole('button', { name: 'Veranstaltung verwalten' }))
  return within(screen.getByRole('group', { name: 'Veranstaltung verwalten' })).getAllByRole('button').map(button => button.textContent ?? '')
}

it('shows planning actions to editors without admin controls', async () => {
  mockApi()
  render(<App currentUser={user('editor')} />)
  await screen.findByRole('button', { name: 'Session hinzufügen' })
  expect(screen.getByRole('button', { name: 'Dienst hinzufügen' })).toBeTruthy()
  for (const name of ['Tag hinzufügen', 'Raum hinzufügen']) expect(screen.queryByRole('button', { name })).toBeNull()
  expect(manageLabels()).toEqual(['Änderungsmarkierungen entfernen'])
  fireEvent.click(screen.getByRole('button', { name: 'Menü' }))
  expect(screen.queryByRole('button', { name: 'Benutzer' })).toBeNull()
})

it('bundles the event administration in one menu for event admins', async () => {
  mockApi()
  render(<App currentUser={user('admin')} />)
  await screen.findByRole('button', { name: 'Tag hinzufügen' })
  expect(screen.getByRole('button', { name: 'Raum hinzufügen' })).toBeTruthy()
  expect(manageLabels()).toEqual(['Stammdaten bearbeiten', 'Team verwalten', 'Besucherprogramm gestalten', 'Sicherung & Wiederherstellung', 'Änderungsmarkierungen entfernen'])
  fireEvent.click(screen.getByRole('button', { name: 'Sicherung & Wiederherstellung' }))
  const dialog = screen.getByRole('dialog', { name: 'Sicherung & Wiederherstellung' })
  expect(within(dialog).getByRole('link', { name: 'Sicherung herunterladen' }).getAttribute('href')).toBe('/api/backups/events/1')
  expect(within(dialog).getByLabelText('Sicherungsdatei (ZIP)')).toBeTruthy()
  expect(screen.getByRole('navigation', { name: 'Planung' }).textContent).not.toMatch(/Team verwalten|Sicherung|Bearbeiten/)
})

it('hides the administration menu from helpers', async () => {
  mockApi()
  render(<App currentUser={user('helper')} />)
  await screen.findByRole('button', { name: 'Tagesplan' })
  expect(screen.queryByRole('button', { name: 'Veranstaltung verwalten' })).toBeNull()
})

it.each([
  ['helper', false, ['Mein Konto', 'Abmelden']],
  ['editor', false, ['Mein Konto', 'Abmelden']],
  ['admin', false, ['Mein Konto', 'Abmelden']],
  ['admin', true, ['Mein Konto', 'Benutzer', 'Abmelden']],
] as const)('keeps only account actions in the header menu for %s (superadmin: %s)', async (role, isSuperadmin, labels) => {
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

it('offers superadmins a new event and the restore in the administration menu', async () => {
  mockApi()
  render(<App currentUser={{ ...user('admin'), is_superadmin: true }} />)
  await screen.findByRole('button', { name: 'Tagesplan' })
  expect(manageLabels()).toEqual(['Stammdaten bearbeiten', 'Team verwalten', 'Besucherprogramm gestalten', 'Sicherung & Wiederherstellung', 'Änderungsmarkierungen entfernen', 'Neue Veranstaltung'])
})

it.each([false, true])('keeps the appropriate administration actions without events (superadmin: %s)', async isSuperadmin => {
  mockApi(false)
  render(<App currentUser={{ ...user('admin'), is_superadmin: isSuperadmin }} />)
  await screen.findByText('Erstelle zuerst eine Veranstaltung.')
  if (isSuperadmin) expect(manageLabels()).toEqual(['Sicherung & Wiederherstellung', 'Neue Veranstaltung'])
  else expect(screen.queryByRole('button', { name: 'Veranstaltung verwalten' })).toBeNull()
})

it('disables event creation while loading and enables it afterwards', async () => {
  let finish!: (response: Response) => void
  mockApi(false, new Promise(resolve => { finish = resolve }))
  render(<App currentUser={{ ...user('admin'), is_superadmin: true }} />)
  const trigger = screen.getByRole('button', { name: 'Veranstaltung verwalten' })
  fireEvent.click(trigger)
  const create = screen.getByRole('button', { name: 'Neue Veranstaltung' }) as HTMLButtonElement
  expect(create.disabled).toBe(true)
  fireEvent.click(create)
  expect(trigger.getAttribute('aria-expanded')).toBe('true')
  await act(async () => finish(new Response(JSON.stringify([]))))
  expect(create.disabled).toBe(false)
  fireEvent.click(create)
  expect(screen.getByRole('heading', { name: 'Veranstaltung anlegen' })).toBeTruthy()
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
})

it('offers the program as PDF and JSON to everyone in the planning team', async () => {
  mockApi()
  render(<App currentUser={user('helper')} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Exportieren' }))
  const json = screen.getByRole('link', { name: 'Programm als JSON' })
  expect(json.getAttribute('href')).toBe('/api/events/1/program.json')
  expect(json.hasAttribute('download')).toBe(true)
  expect(screen.getByRole('link', { name: 'PDF-Programm herunterladen' }).getAttribute('href')).toBe('/api/events/1/program.pdf')
})
