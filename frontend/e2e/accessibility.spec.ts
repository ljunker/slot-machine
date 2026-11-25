import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'

async function expectReadableContrast(page: Page, view: string) {
  const results = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze()
  const findings = results.violations.flatMap(violation => violation.nodes.map(node => `${node.target.join(' ')}: ${node.failureSummary ?? ''}`))
  expect(findings, `Kontrastfehler in ${view}`).toEqual([])
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`Hauptansichten erreichen WCAG-AA-Kontrast (${colorScheme})`, async ({ page, request }) => {
    const event = await (await request.post('/api/events', { data: {
      name: `Kontrast ${colorScheme}`, start_date: '2026-10-01', end_date: '2026-10-01',
    } })).json()
    const day = await (await request.post(`/api/events/${event.id}/days`, { data: {
      event_id: event.id, date: '2026-10-01', start_time: '09:00', end_time: '18:00',
    } })).json()
    const room = await (await request.post('/api/rooms', { data: { event_id: event.id, name: 'Saal' } })).json()
    for (const [topic, start, end] of [['Eröffnung', '10:00', '11:00'], ['Überschneidung', '10:30', '11:30']]) {
      expect((await request.post('/api/slots', { data: {
        event_id: event.id, day_id: day.id, room_id: room.id, topic, start_time: start, end_time: end,
      } })).ok()).toBeTruthy()
    }
    expect((await request.post('/api/slots', { data: { event_id: event.id, topic: 'Ungeplante Idee' } })).ok()).toBeTruthy()

    await page.emulateMedia({ colorScheme })
    await page.reload()
    await page.getByLabel('Veranstaltung wählen').selectOption(String(event.id))
    await expect(page.locator('[data-slot-id]')).toHaveCount(2)
    await expectReadableContrast(page, 'Tagesplan')

    await page.getByRole('button', { name: 'Dashboard', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Veranstaltungsdashboard' })).toBeVisible()
    await expectReadableContrast(page, 'Dashboard')

    await page.getByRole('button', { name: 'Konflikte', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Konfliktübersicht' })).toBeVisible()
    await expect(page.getByText('Lade Konflikte …')).toHaveCount(0)
    await expectReadableContrast(page, 'Konflikte')
  })
}
