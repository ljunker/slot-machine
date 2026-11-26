import { expect, test } from './fixtures'

test('verschiebt Sessions per Tastatur, behält den Fokus und plant ohne Ziehen ein', async ({ page, request }) => {
  const event = await (await request.post('/api/events', { data: { name: 'Tastatur', start_date: '2026-10-01', end_date: '2026-10-01' } })).json()
  const day = await (await request.post(`/api/events/${event.id}/days`, { data: { event_id: event.id, date: '2026-10-01', start_time: '09:00', end_time: '18:00' } })).json()
  const rooms = []
  for (const name of ['Saal A', 'Saal B']) rooms.push(await (await request.post('/api/rooms', { data: { event_id: event.id, name } })).json())
  const talk = await (await request.post('/api/slots', { data: { event_id: event.id, day_id: day.id, room_id: rooms[0].id, topic: 'Keynote', start_time: '10:00', end_time: '11:00' } })).json()
  const idea = await (await request.post('/api/slots', { data: { event_id: event.id, topic: 'Neue Idee' } })).json()

  await page.reload()
  await page.getByLabel('Veranstaltung wählen').selectOption(String(event.id))
  const card = page.getByRole('button', { name: 'Keynote bearbeiten' })
  await card.focus()
  await page.keyboard.press('Alt+ArrowDown')
  await expect(page.locator(`[data-slot-id="${talk.id}"]`)).toContainText('10:15–11:15')
  await page.keyboard.press('Alt+ArrowRight')
  await expect(page.locator('[data-room-column]').nth(1).locator(`[data-slot-id="${talk.id}"]`)).toHaveCount(1)
  await expect(card).toBeFocused()
  await page.keyboard.press('Shift+Alt+ArrowDown')
  await expect(page.locator(`[data-slot-id="${talk.id}"]`)).toContainText('10:15–11:30')
  await expect.poll(async () => {
    const schedule = await (await request.get(`/api/schedule/days/${day.id}`)).json()
    return schedule.rooms[1].slots.map((slot: { id: number; start_time: string; end_time: string }) => [slot.id, slot.start_time, slot.end_time])
  }).toEqual([[talk.id, '10:15:00', '11:30:00']])

  await page.keyboard.press('?')
  await expect(page.getByRole('dialog', { name: 'Tastenkürzel im Plan' })).toBeVisible()
  await page.keyboard.press('Escape')

  const grip = page.getByRole('button', { name: 'Neue Idee einplanen' })
  await grip.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: '„Neue Idee“ einplanen' })
  await dialog.getByLabel('Raum').selectOption(String(rooms[0].id))
  await dialog.getByLabel('Beginn').fill('14:00')
  await dialog.getByRole('button', { name: 'Einplanen' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.locator('[data-room-column]').first().locator(`[data-slot-id="${idea.id}"]`)).toContainText('14:00–15:00')
})

test('Dashboard trennt To-dos vom Stand und springt zum passenden Abschnitt', async ({ page, request }) => {
  const event = await (await request.post('/api/events', { data: { name: 'Dashboard-To-dos', start_date: '2026-10-01', end_date: '2026-10-01' } })).json()
  const day = await (await request.post(`/api/events/${event.id}/days`, { data: { event_id: event.id, date: '2026-10-01', start_time: '09:00', end_time: '18:00' } })).json()
  const room = await (await request.post('/api/rooms', { data: { event_id: event.id, name: 'Saal' } })).json()
  for (const topic of ['Eins', 'Zwei']) await request.post('/api/slots', { data: { event_id: event.id, day_id: day.id, room_id: room.id, topic, start_time: '10:00', end_time: '11:00' } })

  await page.reload()
  await page.getByLabel('Veranstaltung wählen').selectOption(String(event.id))
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click()
  const todos = page.getByRole('region', { name: /Zu erledigen/ })
  await expect(todos.locator('.metric-error')).toHaveCount(1)
  await expect(todos.locator('.metric-done')).toHaveCount(2)
  await todos.getByRole('button', { name: 'Konflikte: 1, zur Liste springen' }).click()
  await expect(page.locator('#dashboard-conflicts')).toBeFocused()
  await expect(page.locator('#dashboard-conflicts')).toBeInViewport()
})
