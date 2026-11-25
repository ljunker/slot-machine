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
  await expect(page.getByLabel('Abendvortrag verschieben')).toBeAttached()
  await page.getByLabel('Abendvortrag verschieben').scrollIntoViewIfNeeded()
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

  const grip = await page.getByLabel('Abendvortrag verschieben').boundingBox()
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
