import { expect, test } from '@playwright/test'

test('zeigt Besucherprogramm auf Smartphone ohne Bearbeitung und horizontales Raumraster', async ({ page, request }) => {
  const eventResponse = await request.post('/api/events', { data: { name: 'Mobile Konferenz', start_date: '2099-06-01', end_date: '2099-06-02' } })
  expect(eventResponse.ok()).toBeTruthy()
  const event = await eventResponse.json() as { id: number }
  const dayResponse = await request.post(`/api/events/${event.id}/days`, { data: { event_id: event.id, date: '2099-06-01', start_time: '09:00', end_time: '18:00' } })
  expect(dayResponse.ok()).toBeTruthy()
  const day = await dayResponse.json() as { id: number }
  const roomAResponse = await request.post('/api/rooms', { data: { event_id: event.id, name: 'Saal A' } })
  const roomBResponse = await request.post('/api/rooms', { data: { event_id: event.id, name: 'Saal B' } })
  expect(roomAResponse.ok()).toBeTruthy()
  expect(roomBResponse.ok()).toBeTruthy()
  const roomA = await roomAResponse.json() as { id: number }
  const slotResponse = await request.post('/api/slots', { data: { day_id: day.id, room_id: roomA.id, topic: 'Eröffnung', speaker: 'Ada', description: 'Willkommen zur Konferenz.', start_time: '10:00', end_time: '11:00' } })
  expect(slotResponse.ok()).toBeTruthy()

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByRole('combobox', { name: 'Veranstaltung wählen' }).selectOption(String(event.id))
  await expect(page.getByRole('link', { name: 'Besucherprogramm ansehen' })).toHaveAttribute('href', `/programm/${event.id}`)
  await page.getByRole('link', { name: 'Besucherprogramm ansehen' }).click()
  await expect(page).toHaveURL(new RegExp(`/programm/${event.id}$`))
  await expect(page.getByRole('heading', { name: 'Mobile Konferenz' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Saal A' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tabpanel', { name: 'Saal A' }).getByText('Eröffnung')).toBeVisible()
  await expect(page.getByText('Willkommen zur Konferenz.')).toBeHidden()
  await page.getByRole('tabpanel', { name: 'Saal A' }).locator('summary').click()
  await expect(page.getByText('Willkommen zur Konferenz.')).toBeVisible()
  await page.getByRole('tab', { name: 'Saal B' }).click()
  await expect(page.getByRole('tabpanel', { name: 'Saal B' })).toContainText('keine Programmpunkte')
  await expect(page.getByRole('button', { name: /Bearbeiten|\+ Slot/ })).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Mobile Konferenz' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Saal A' })).toHaveAttribute('aria-selected', 'true')

  await page.setViewportSize({ width: 1280, height: 900 })
  await expect(page.locator('.public-desktop-program')).toBeVisible()
  await expect(page.locator('.public-mobile-program')).toBeHidden()
  await page.getByRole('button', { name: 'Eröffnung, 10:00 bis 11:00 Uhr, Details anzeigen' }).click()
  await expect(page.getByRole('region', { name: 'Session-Details' })).toContainText('Willkommen zur Konferenz.')
})
