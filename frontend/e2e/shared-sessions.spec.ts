import { expect, test } from './fixtures'

test('bearbeitet gemeinsame Sessions mit Balken, Diensten, Konflikten und stabilen Besucherlinks', async ({ page, request, browser }) => {
  await page.setViewportSize({ width: 1800, height: 1100 })
  const event = await (await request.post('/api/events', { data: {
    name: 'Gemeinsames Programm', start_date: '2026-10-01', end_date: '2026-10-01',
  } })).json()
  const day = await (await request.post(`/api/events/${event.id}/days`, { data: {
    event_id: event.id, date: '2026-10-01', start_time: '09:00', end_time: '18:00',
  } })).json()
  const rooms = []
  for (const name of ['Saal A', 'Saal B']) rooms.push(await (await request.post('/api/rooms', { data: { event_id: event.id, name } })).json())
  await page.goto('/')
  await page.getByLabel('Veranstaltung wählen').selectOption(String(event.id))
  await page.getByRole('button', { name: '+ Slot' }).click()
  await page.getByLabel('Thema').fill('Gemeinsame Pause')
  await page.getByLabel('Geltungsbereich').selectOption('all_rooms')
  await expect(page.getByLabel('Raum', { exact: true })).toHaveCount(0)
  await page.getByLabel('Beginn').fill('10:00')
  await page.getByLabel('Ende').fill('11:00')
  await page.getByRole('button', { name: 'Speichern' }).click()
  const bar = page.locator('[data-shared-layer] [data-slot-id]')
  await expect(bar).toHaveCount(1)
  const slotId = Number(await bar.getAttribute('data-slot-id'))
  const box = await bar.boundingBox()
  const columns = page.locator('[data-program-column]')
  const left = (await columns.nth(0).boundingBox())!
  const right = (await columns.nth(1).boundingBox())!
  expect(box!.width).toBeGreaterThan(left.width + right.width)

  const grip = (await page.getByLabel('Gemeinsame Pause verschieben', { exact: true }).boundingBox())!
  await page.mouse.move(grip.x + 30, grip.y + 10)
  await page.mouse.down()
  await page.mouse.move(right.x + 40, grip.y + 34, { steps: 8 })
  await page.mouse.up()
  await expect(bar).toContainText('10:15–11:15')
  const resized = (await page.getByLabel('Gemeinsame Pause verlängern oder verkürzen').boundingBox())!
  await page.mouse.move(resized.x + 30, resized.y + resized.height / 2)
  await page.mouse.down()
  await page.mouse.move(resized.x + 30, resized.y + resized.height / 2 + 24, { steps: 8 })
  await page.mouse.up()
  await expect(bar).toContainText('10:15–11:30')

  const duty = await (await request.post(`/api/events/${event.id}/duties`, { data: { kind: 'session', slot_id: slotId, title: 'Betreuung' } })).json()
  const roomDuty = await (await request.post(`/api/events/${event.id}/duties`, { data: {
    kind: 'room', day_id: day.id, room_id: rooms[0].id, title: 'Buffet', start_time: '10:15', end_time: '11:30',
  } })).json()
  await page.reload()
  await page.getByLabel('Veranstaltung wählen').selectOption(String(event.id))
  await expect(page.locator(`[data-duty-column="general"] [data-duty-id="${duty.id}"]`)).toBeVisible()
  await page.locator(`[data-duty-id="${roomDuty.id}"]`).click()
  await expect(page.getByLabel('Titel (optional)')).toHaveValue('Buffet')
  await page.getByRole('button', { name: 'Schließen', exact: true }).click()
  for (const view of ['Helferplan', 'Tagesplan']) {
    await page.getByRole('button', { name: view, exact: true }).click()
    await expect(bar).toHaveCount(1)
    await expect(page.locator(`[data-duty-id="${duty.id}"]`)).toBeVisible()
  }
  if (process.env.SHARED_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SHARED_SCREENSHOT_DIR}/planner.png`, fullPage: true })

  await page.getByRole('button', { name: 'Gemeinsame Pause bearbeiten' }).click()
  await page.getByLabel('Geltungsbereich').selectOption('room')
  await page.getByLabel('Raum', { exact: true }).selectOption(String(rooms[0].id))
  await page.getByRole('button', { name: 'Speichern' }).click()
  await expect(page.locator(`[data-room-column="${rooms[0].id}"] [data-slot-id="${slotId}"]`)).toHaveCount(1)
  await page.getByRole('button', { name: 'Gemeinsame Pause bearbeiten' }).click()
  await page.getByLabel('Geltungsbereich').selectOption('all_rooms')
  await page.getByRole('button', { name: 'Speichern' }).click()
  await expect(bar).toHaveCount(1)

  const visitor = await browser.newContext({ viewport: { width: 1400, height: 1050 } })
  const publicPage = await visitor.newPage()
  await publicPage.goto(`/programm/${event.id}`)
  await expect(publicPage.locator('.public-desktop-program [data-shared-layer] [data-slot-id]')).toHaveCount(1)
  if (process.env.SHARED_SCREENSHOT_DIR) await publicPage.screenshot({ path: `${process.env.SHARED_SCREENSHOT_DIR}/public.png`, fullPage: true })
  await publicPage.setViewportSize({ width: 390, height: 844 })
  for (const room of rooms) {
    await publicPage.getByRole('tab', { name: room.name }).click()
    await expect(publicPage.getByRole('tabpanel')).toContainText('Gemeinsame Pause')
    await expect(publicPage.getByRole('tabpanel').getByRole('link', { name: 'Session-Seite öffnen' })).toHaveAttribute('href', `/programm/${event.id}/sessions/${slotId}`)
  }
  await publicPage.getByRole('tabpanel').getByRole('link', { name: 'Session-Seite öffnen' }).click()
  await expect(publicPage.locator('.public-session-page')).toContainText('Alle Räume')

  await request.post('/api/slots', { data: { day_id: day.id, room_id: rooms[0].id, topic: 'Parallelvortrag', start_time: '10:30', end_time: '11:00' } })
  await page.reload()
  await page.getByLabel('Veranstaltung wählen').selectOption(String(event.id))
  await expect(bar).toHaveCount(0)
  await expect(page.locator(`[data-slot-id="${slotId}"]`)).toHaveCount(2)
  await page.getByRole('button', { name: 'Konflikte', exact: true }).click()
  await expect(page.locator('.conflict-count')).toHaveText('1 Konflikt in dieser Veranstaltung')
  await expect(page.locator('.conflict-participants')).toContainText('Alle Räume')
  await publicPage.goto(`/programm/${event.id}`)
  await publicPage.setViewportSize({ width: 1400, height: 1050 })
  await expect(publicPage.locator(`.public-desktop-program [data-slot-id="${slotId}"]`)).toHaveCount(2)
  if (process.env.SHARED_SCREENSHOT_DIR) await publicPage.screenshot({ path: `${process.env.SHARED_SCREENSHOT_DIR}/public-overlap.png`, fullPage: true })
  await visitor.close()
})

test('plant gemeinsame Sessions ohne Räume und aus der Seitenleiste wieder ein', async ({ page, request }) => {
  await page.setViewportSize({ width: 1600, height: 1100 })
  const event = await (await request.post('/api/events', { data: { name: 'Pause ohne Räume', start_date: '2026-10-01', end_date: '2026-10-01' } })).json()
  const day = await (await request.post(`/api/events/${event.id}/days`, { data: { event_id: event.id, date: '2026-10-01', start_time: '09:00', end_time: '18:00' } })).json()
  await page.goto('/')
  await page.getByLabel('Veranstaltung wählen').selectOption(String(event.id))
  await page.getByRole('button', { name: '+ Slot' }).click()
  await page.getByLabel('Thema').fill('Frühstück')
  await page.getByLabel('Geltungsbereich').selectOption('all_rooms')
  await page.getByRole('button', { name: 'Speichern' }).click()
  await expect(page.locator('[data-shared-layer] [data-slot-id]')).toHaveCount(1)
  const id = Number(await page.locator('[data-slot-id]').getAttribute('data-slot-id'))
  await page.getByRole('button', { name: 'Frühstück bearbeiten' }).click()
  await page.getByRole('button', { name: 'Planung entfernen' }).click()
  await page.getByRole('button', { name: 'Speichern' }).click()
  await expect(page.getByRole('button', { name: 'Frühstück einplanen' })).toBeVisible()
  const source = (await page.getByRole('button', { name: 'Frühstück einplanen' }).boundingBox())!
  const target = (await page.locator('[data-program-column]').boundingBox())!
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2)
  await page.mouse.down()
  await page.mouse.move(target.x + 40, target.y + 96, { steps: 8 })
  await expect(page.locator('.backlog-ghost')).toContainText('Alle Räume')
  await page.mouse.up()
  await expect(page.locator(`[data-shared-layer] [data-slot-id="${id}"]`)).toContainText('10:00–11:00')
  const schedule = await (await request.get(`/api/schedule/days/${day.id}`)).json()
  expect(schedule.shared_slots[0].scope).toBe('all_rooms')
  expect(schedule.shared_slots[0].room_id).toBeNull()
  await request.post('/api/rooms', { data: { event_id: event.id, name: 'Neuer Raum' } })
  await page.reload()
  await page.getByLabel('Veranstaltung wählen').selectOption(String(event.id))
  await expect(page.locator('[data-room-column]')).toHaveCount(1)
  await expect(page.locator(`[data-shared-layer] [data-slot-id="${id}"]`)).toHaveCount(1)
})
