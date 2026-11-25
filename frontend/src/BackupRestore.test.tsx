import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import BackupRestore from './BackupRestore'
import type { Event } from './types'

const event: Event = {
  id: 7, name: 'Bestehend', start_date: '2026-10-01', end_date: '2026-10-02',
  accent_color: null, logo_url: null,
}

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('previews replacement and requires confirmation before restore', async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify({
    name: 'Gesichert', source_event_id: 7, target_event_id: 7, mode: 'replace',
    counts: { slots: 2, speakers: 1 }, remapped_session_ids: 0, removed_session_links: 1,
    ...(String(input).endsWith('/restore') ? { event_id: 7 } : {}),
  }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  const onComplete = vi.fn(async () => {})
  render(<BackupRestore events={[event]} selectedEventId={7} onComplete={onComplete} onClose={() => {}} />)
  fireEvent.change(screen.getByLabelText('ZIP-Backup'), { target: { files: [new File(['zip'], 'backup.zip')] } })
  fireEvent.click(screen.getByRole('button', { name: 'Vorschau prüfen' }))
  await screen.findByText('Backup: Gesichert')
  expect(screen.getByText(/1 bisherige Session-Links entfallen/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Wiederherstellen' }))
  let dialog = await screen.findByRole('alertdialog', { name: 'Veranstaltung ersetzen?' })
  expect(dialog.textContent).toContain('„Bestehend“ wird vollständig durch das Backup „Gesichert“ ersetzt.')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  expect(fetchMock).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'Wiederherstellen' }))
  dialog = await screen.findByRole('alertdialog', { name: 'Veranstaltung ersetzen?' })
  const replace = within(dialog).getByRole('button', { name: 'Veranstaltung ersetzen' }) as HTMLButtonElement
  expect(replace.disabled).toBe(true)
  fireEvent.change(within(dialog).getByLabelText('Zur Bestätigung „Bestehend“ eingeben'), { target: { value: 'Bestehend' } })
  expect(replace.disabled).toBe(false)
  fireEvent.click(replace)
  await waitFor(() => expect(onComplete).toHaveBeenCalledWith(7, []))
  expect(fetchMock).toHaveBeenCalledTimes(2)
  const body = (fetchMock.mock.calls[1] as unknown as [unknown, RequestInit])[1].body as FormData
  expect(body.get('target_event_id')).toBe('7')
})

it('creates an event without existing target and shows preview errors', async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'Ungültige Backup-Datei' }), { status: 400 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({
      name: 'Gesichert', source_event_id: 7, target_event_id: null, mode: 'create',
      counts: { slots: 0 }, remapped_session_ids: 0, removed_session_links: 0,
    }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ event_id: 9 }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  const onComplete = vi.fn(async () => {})
  render(<BackupRestore events={[]} selectedEventId={null} onComplete={onComplete} onClose={() => {}} />)
  fireEvent.change(screen.getByLabelText('ZIP-Backup'), { target: { files: [new File(['zip'], 'backup.zip')] } })
  fireEvent.click(screen.getByRole('button', { name: 'Vorschau prüfen' }))
  await screen.findByRole('alert')
  expect(screen.getByRole('alert').textContent).toBe('Ungültige Backup-Datei')
  fireEvent.click(screen.getByRole('button', { name: 'Vorschau prüfen' }))
  await screen.findByText('Backup: Gesichert')
  fireEvent.click(screen.getByRole('button', { name: 'Wiederherstellen' }))
  const dialog = await screen.findByRole('alertdialog', { name: 'Als neue Veranstaltung wiederherstellen?' })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Wiederherstellung starten' }))
  await waitFor(() => expect(onComplete).toHaveBeenCalledWith(9, []))
  const body = fetchMock.mock.calls[2][1].body as FormData
  expect(body.get('target_event_id')).toBeNull()
})
