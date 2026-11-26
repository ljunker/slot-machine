import { expect, test } from './fixtures'

test('Verschieben lässt den sichtbaren Ausschnitt des Plans stehen', async ({ page, request }) => {
  const event = await (await request.post('/api/events', { data: {
    name: 'Scroll-Konferenz', start_date: '2026-10-01', end_date: '2026-10-01',
  } })).json()
  const day = await (await request.post(`/api/events/${event.id}/days`, { data: {
    event_id: event.id, date: '2026-10-01', start_time: '08:00', end_time: '22:00',
  } })).json()
  const rooms = []
  for (let index = 1; index <= 6; index += 1) {
    rooms.push(await (await request.post('/api/rooms', { data: { event_id: event.id, name: `Raum ${index}` } })).json())
  }
  expect((await request.post('/api/slots', { data: {
    event_id: event.id, day_id: day.id, room_id: rooms[4].id, topic: 'Abendvortrag', start_time: '18:00', end_time: '19:00',
  } })).ok()).toBeTruthy()

  await page.reload()
  await page.getByLabel('Veranstaltung wählen').selectOption(String(event.id))
  const scroll = page.locator('.schedule-scroll')
  await expect(page.getByRole('button', { name: 'Abendvortrag bearbeiten' })).toBeAttached()
  await page.getByRole('button', { name: 'Abendvortrag bearbeiten' }).scrollIntoViewIfNeeded()
  const before = await scroll.evaluate(element => ({ top: element.scrollTop, left: element.scrollLeft }))
  expect(before.top).toBeGreaterThan(0)
  expect(before.left).toBeGreaterThan(0)

  let loadingShown = false
  await page.exposeFunction('reportLoading', () => { loadingShown = true })
  await page.evaluate(() => {
    new MutationObserver(() => {
      if (document.body.textContent?.includes('Lade Programm')) (window as unknown as { reportLoading: () => void }).reportLoading()
    }).observe(document.body, { childList: true, subtree: true, characterData: true })
  })

  const grip = await page.getByRole('button', { name: 'Abendvortrag bearbeiten' }).boundingBox()
  expect(grip).not.toBeNull()
  await page.mouse.move(grip!.x + 20, grip!.y + 10)
  await page.mouse.down()
  await page.mouse.move(grip!.x + 20, grip!.y + 10 + 30 * 1.6, { steps: 6 })
  await page.mouse.up()

  const card = page.locator(`[data-room-column="${rooms[4].id}"] [data-slot-id]`)
  await expect(card).toContainText('18:30–19:30')
  await expect(page.locator('main[aria-busy]')).toHaveCount(0)
  const after = await scroll.evaluate(element => ({ top: element.scrollTop, left: element.scrollLeft }))
  expect(after).toEqual(before)
  expect(loadingShown).toBe(false)
})

test('Rückgängig nach dem Verschieben hinterlässt keine Markierung im Besucherprogramm', async ({ page, request }) => {
  const event = await (await request.post('/api/events', { data: {
    name: 'Rückgängig-Konferenz', start_date: '2026-10-01', end_date: '2026-10-01', program_published: true,
  } })).json()
  const day = await (await request.post(`/api/events/${event.id}/days`, { data: {
    event_id: event.id, date: '2026-10-01', start_time: '09:00', end_time: '18:00',
  } })).json()
  const rooms = []
  for (const name of ['Saal A', 'Saal B']) rooms.push(await (await request.post('/api/rooms', { data: { event_id: event.id, name } })).json())
  expect((await request.post('/api/slots', { data: {
    event_id: event.id, day_id: day.id, room_id: rooms[0].id, topic: 'Eröffnung', start_time: '10:00', end_time: '11:00',
  } })).ok()).toBeTruthy()

  await page.reload()
  await page.getByLabel('Veranstaltung wählen').selectOption(String(event.id))
  const grip = await page.getByRole('button', { name: 'Eröffnung bearbeiten' }).boundingBox()
  const target = await page.locator(`[data-room-column="${rooms[1].id}"]`).boundingBox()
  expect(grip).not.toBeNull()
  expect(target).not.toBeNull()
  await page.mouse.move(grip!.x + 20, grip!.y + 10)
  await page.mouse.down()
  await page.mouse.move(target!.x + 50, grip!.y + 10, { steps: 8 })
  await page.mouse.up()
  await expect(page.locator(`[data-room-column="${rooms[1].id}"] [data-slot-id]`)).toContainText('Verschoben')

  await page.getByRole('status').getByRole('button', { name: 'Rückgängig' }).click()
  await expect(page.locator(`[data-room-column="${rooms[0].id}"] [data-slot-id]`)).toContainText('10:00–11:00')
  await expect(page.locator('[data-slot-id]')).not.toContainText('Verschoben')

  const publicSchedule = await (await request.get(`/api/public/events/${event.id}/days/${day.id}/schedule`)).json()
  expect(publicSchedule.rooms.flatMap((room: { slots: { change_notice: unknown }[] }) => room.slots.map(slot => slot.change_notice))).toEqual([null])
  await page.goto(`/programm/${event.id}`)
  await expect(page.getByText('Eröffnung').first()).toBeVisible()
  await expect(page.getByText('Verschoben')).toHaveCount(0)
})
