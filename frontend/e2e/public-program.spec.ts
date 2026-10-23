import { expect, test } from './fixtures'

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
  const roomB = await roomBResponse.json() as { id: number }
  const speakerResponse = await request.post(`/api/events/${event.id}/speakers`, { data: { name: 'Ada' } })
  const speaker = await speakerResponse.json()
  const slotResponse = await request.post('/api/slots', { data: { day_id: day.id, room_id: roomA.id, topic: 'Eröffnung', speaker_ids: [speaker.id], description: 'Willkommen zur Konferenz.', start_time: '10:00', end_time: '11:00' } })
  expect(slotResponse.ok()).toBeTruthy()
  const slot = await slotResponse.json() as { id: number }

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
  await page.getByRole('region', { name: 'Session-Details' }).getByRole('link', { name: 'Session-Seite öffnen' }).click()
  await expect(page).toHaveURL(new RegExp(`/programm/${event.id}/sessions/${slot.id}$`))
  await expect(page.getByRole('heading', { name: 'Eröffnung' })).toBeVisible()
  await expect(page.locator('.public-session-page')).toContainText('10:00–11:00 Uhr · Saal A')
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Eröffnung' })).toBeVisible()
  await page.getByRole('link', { name: 'Zum Veranstaltungsprogramm' }).click()
  await expect(page).toHaveURL(new RegExp(`/programm/${event.id}$`))

  await page.getByRole('combobox', { name: 'Darstellung' }).selectOption('dark')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)).toBe('rgb(14, 22, 38)')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await request.patch(`/api/slots/${slot.id}`, { data: { room_id: roomB.id, start_time: '11:00', end_time: '12:00' } })
  await page.reload()
  await expect(page.locator(`.public-slot.notice-rescheduled`)).toContainText('Verschoben')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('tab', { name: 'Saal B' }).click()
  await expect(page.getByRole('tabpanel', { name: 'Saal B' })).toContainText('Vorher: 10:00–11:00 Uhr · Saal A')

  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.getByRole('combobox', { name: 'Veranstaltung wählen' }).selectOption(String(event.id))
  await page.getByRole('button', { name: 'Eröffnung bearbeiten' }).click()
  await expect(page.getByRole('complementary', { name: 'Slot bearbeiten' })).toContainText('Vorher: 10:00–11:00 Uhr · Saal A')
  await page.getByRole('checkbox', { name: 'Session abgesagt' }).check()
  await page.getByRole('button', { name: 'Speichern' }).click()
  await expect(page.locator(`[data-slot-id="${slot.id}"]`)).toContainText('Abgesagt')
})

test('zeigt Programm und PDF ohne Anmeldung, sperrt die Planung', async ({ browser, request }) => {
  const created = await request.post('/api/events', { data: {
    name: 'Öffentliche Konferenz', start_date: '2099-06-01', end_date: '2099-06-01',
  } })
  const event = await created.json() as { id: number }
  const day = await request.post(`/api/events/${event.id}/days`, { data: {
    event_id: event.id, date: '2099-06-01', start_time: '09:00', end_time: '18:00',
  } })
  expect(day.ok()).toBeTruthy()
  const anonymous = await browser.newContext({ baseURL: 'http://127.0.0.1:5173' })
  const page = await anonymous.newPage()
  await page.goto(`/programm/${event.id}`)
  await expect(page.getByRole('heading', { name: 'Öffentliche Konferenz' })).toBeVisible()
  const pdf = await page.request.get(`/api/events/${event.id}/program.pdf`)
  expect(pdf.status()).toBe(200)
  expect(pdf.headers()['content-type']).toContain('application/pdf')
  expect((await page.request.get('/api/events')).status()).toBe(401)
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Anmelden' })).toBeVisible()
  await anonymous.close()
})

test('zeigt Session-Titel trotz Kategorie und Geändert-Flag vollständig', async ({ page, request }) => {
  const created = await request.post('/api/events', { data: {
    name: 'Karten-Test', start_date: '2099-06-01', end_date: '2099-06-01',
  } })
  const event = await created.json() as { id: number }
  const day = await (await request.post(`/api/events/${event.id}/days`, { data: {
    event_id: event.id, date: '2099-06-01', start_time: '15:00', end_time: '17:00',
  } })).json() as { id: number }
  const room = await (await request.post('/api/rooms', { data: {
    event_id: event.id, name: 'Halle 1',
  } })).json() as { id: number }
  await request.post('/api/rooms', { data: { event_id: event.id, name: 'Halle 2' } })
  const speaker = await (await request.post(`/api/events/${event.id}/speakers`, { data: {
    name: 'Lars',
  } })).json() as { id: number }
  const category = await (await request.post(`/api/events/${event.id}/categories`, { data: {
    name: 'Anfänger', color: '#00CC00',
  } })).json() as { id: number }
  const slot = await (await request.post('/api/slots', { data: {
    event_id: event.id, day_id: day.id, room_id: room.id, topic: 'Meine Session',
    start_time: '15:00', end_time: '16:00', speaker_ids: [speaker.id], category_ids: [category.id],
  } })).json() as { id: number }
  await request.patch(`/api/slots/${slot.id}`, { data: { description: 'Aktualisiert' } })

  await page.setViewportSize({ width: 900, height: 700 })
  await page.goto(`/programm/${event.id}`)
  const card = page.locator('.public-slot.notice-updated')
  await expect(card).toContainText('Meine Session')
  await expect(card).toContainText('Anfänger')
  await expect(card).toContainText('Geändert')
  const bounds = await card.evaluate(element => {
    const card = element.getBoundingClientRect()
    const title = element.querySelector('strong')!.getBoundingClientRect()
    return { titleTop: title.top, titleHeight: title.height, cardTop: card.top }
  })
  expect(bounds.titleHeight).toBeGreaterThan(12)
  expect(bounds.titleTop).toBeGreaterThanOrEqual(bounds.cardTop + 5)
})
