import { expect, test } from './fixtures'

async function createEvent(request: import('@playwright/test').APIRequestContext, name: string, roomCount: number) {
  const event = await (await request.post('/api/events', { data: { name, start_date: '2026-10-01', end_date: '2026-10-01' } })).json()
  await request.post(`/api/events/${event.id}/days`, { data: { event_id: event.id, date: '2026-10-01', start_time: '09:00', end_time: '18:00' } })
  for (let index = 1; index <= roomCount; index++) await request.post('/api/rooms', { data: { event_id: event.id, name: `Saal ${index}` } })
  return event as { id: number }
}

test('zeigt den Tagesplan mit vier Räumen auf 1440 px ohne horizontales Scrollen', async ({ page, request }, testInfo) => {
  const event = await createEvent(request, 'Vier Räume', 4)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.reload()
  await page.getByLabel('Veranstaltung wählen').selectOption(String(event.id))
  await expect(page.locator('[data-room-column]')).toHaveCount(4)
  await expect(page.locator('.duty-column')).toHaveCount(0)
  const scroll = page.locator('.schedule-scroll')
  expect(await scroll.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('tagesplan.png') })

  await page.getByRole('checkbox', { name: 'Dienste anzeigen' }).check()
  await expect(page.locator('.duty-column')).toHaveCount(5)
  await page.reload()
  await page.getByLabel('Veranstaltung wählen').selectOption(String(event.id))
  await expect(page.getByRole('checkbox', { name: 'Dienste anzeigen' })).toBeChecked()
  await expect(page.locator('.duty-column')).toHaveCount(5)
})

test('bündelt die Verwaltung der Veranstaltung in einem Menü', async ({ page, request }, testInfo) => {
  const event = await createEvent(request, 'Verwaltung', 1)
  await page.reload()
  await page.getByLabel('Veranstaltung wählen').selectOption(String(event.id))
  const sidebar = page.getByRole('navigation', { name: 'Planung' })
  await expect(sidebar).not.toContainText('Team verwalten')
  await page.getByRole('button', { name: 'Veranstaltung verwalten' }).click()
  const menu = page.getByRole('group', { name: 'Veranstaltung verwalten' })
  await expect(menu.getByRole('button')).toHaveText(['Stammdaten bearbeiten', 'Team verwalten', 'Besucherprogramm gestalten',
    'Sicherung & Wiederherstellung', 'Änderungsmarkierungen entfernen', 'Neue Veranstaltung'])
  await page.screenshot({ path: testInfo.outputPath('verwaltung.png') })
  await menu.getByRole('button', { name: 'Sicherung & Wiederherstellung' }).click()
  const dialog = page.getByRole('dialog', { name: 'Sicherung & Wiederherstellung' })
  await expect(dialog.getByRole('link', { name: 'Sicherung herunterladen' })).toHaveAttribute('href', `/api/backups/events/${event.id}`)
  await expect(dialog.getByLabel('Sicherungsdatei (ZIP)')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('sicherung.png') })
})

test('öffnet die Seitenleiste auf dem Smartphone als Schublade', async ({ page, request }, testInfo) => {
  const event = await createEvent(request, 'Mobil', 2)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  await page.getByLabel('Veranstaltung wählen').selectOption(String(event.id))
  const sidebar = page.getByRole('navigation', { name: 'Planung' })
  await expect(sidebar).toBeHidden()
  await expect(page.locator('.schedule-scroll')).toBeInViewport()
  await page.getByRole('button', { name: 'Planung', exact: true }).click()
  await expect(sidebar).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.screenshot({ path: testInfo.outputPath('schublade.png') })
  await page.keyboard.press('Escape')
  await expect(sidebar).toBeHidden()
  await page.getByRole('button', { name: 'Planung', exact: true }).click()
  await sidebar.getByRole('button', { name: 'Planung schließen' }).click()
  await expect(sidebar).toBeHidden()
})
