import { expect, test } from '@playwright/test'

test('plant offene und mehrfach besetzte Dienste in Raumspalten', async ({ page }) => {
  const eventResponse = await page.request.post('/api/events', { data: {
    name: 'Helfertest', start_date: '2026-10-01', end_date: '2026-10-01',
  } })
  const event = await eventResponse.json()
  const dayResponse = await page.request.post(`/api/events/${event.id}/days`, { data: {
    event_id: event.id, date: '2026-10-01', start_time: '09:00', end_time: '18:00',
  } })
  const day = await dayResponse.json()
  const roomA = await (await page.request.post('/api/rooms', { data: { event_id: event.id, name: 'Saal A' } })).json()
  const roomB = await (await page.request.post('/api/rooms', { data: { event_id: event.id, name: 'Saal B' } })).json()
  await page.goto('/')
  await expect(page.locator('[data-room-column]')).toHaveCount(2)
  await expect(page.locator('.duty-column')).toHaveCount(3)
  await expect(page.getByText('Helferdienste', { exact: true })).toHaveCount(2)

  await page.getByRole('button', { name: '+ Dienst' }).click()
  await page.getByLabel('Titel (optional)').fill('Aufbau')
  await page.getByRole('button', { name: 'Speichern' }).click()
  await expect(page.locator('[data-duty-id]').first()).toContainText('Offen')

  for (const name of ['Ada', 'Ben']) {
    await page.getByRole('button', { name: '+ Helfer' }).click()
    await page.getByLabel('Name').fill(name)
    await page.getByRole('button', { name: 'Speichern' }).click()
  }
  await page.getByRole('button', { name: '+ Dienst' }).click()
  await page.getByLabel('Dienstart').selectOption('room')
  await page.getByLabel('Titel (optional)').fill('Einlass')
  await page.getByRole('combobox', { name: /^Raum/ }).selectOption({ label: 'Saal A' })
  await page.getByLabel('Beginn').fill('10:00')
  await page.getByLabel('Ende').fill('11:00')
  await page.getByRole('checkbox', { name: 'Ada' }).check()
  await page.getByRole('checkbox', { name: 'Ben' }).check()
  await page.getByRole('button', { name: 'Speichern' }).click()
  await expect(page.locator('[aria-label="Helferdienste Saal A"] [data-duty-id]')).toContainText('Ada, Ben')
  await expect(page.locator('[aria-label="Helferdienste Saal B"] [data-duty-id]')).toHaveCount(0)
  if (process.env.HELPER_SCREENSHOT) await page.screenshot({ path: process.env.HELPER_SCREENSHOT, fullPage: true })

  const publicPlan = await page.request.get(`/api/schedule/days/${day.id}`)
  expect((await publicPlan.json()).duties).toBeUndefined()
  await page.goto(`/programm/${event.id}`)
  await expect(page.getByText('Einlass')).toHaveCount(0)
  await expect(page.getByText('Ada')).toHaveCount(0)

  const helpers = await (await page.request.get(`/api/events/${event.id}/helpers`)).json()
  const ada = helpers.find((person: { name: string }) => person.name === 'Ada')
  const slot = await (await page.request.post('/api/slots', { data: {
    event_id: event.id, day_id: day.id, room_id: roomA.id, topic: 'Vortrag',
    start_time: '10:15', end_time: '10:45',
  } })).json()
  const sessionDuty = await (await page.request.post(`/api/events/${event.id}/duties`, { data: {
    kind: 'session', slot_id: slot.id, helper_ids: [ada.id],
  } })).json()
  await page.goto('/')
  await expect(page.locator('[aria-label="Helferdienste Saal A"] [data-duty-id]')).toHaveCount(2)
  await expect(page.getByRole('region', { name: 'Helferkonflikte' })).toHaveCount(0)
  await page.request.patch(`/api/slots/${slot.id}`, { data: {
    room_id: roomB.id, start_time: '10:15', end_time: '10:45',
  } })
  await page.reload()
  await expect(page.locator('[aria-label="Helferdienste Saal B"] [data-duty-id]')).toHaveCount(1)
  await expect(page.locator(`[data-duty-id="${sessionDuty.id}"]`)).toContainText('Vortrag')
  await expect(page.getByRole('region', { name: 'Helferkonflikte' })).toContainText('Ada')
  await page.request.patch(`/api/slots/${slot.id}`, { data: { is_cancelled: true } })
  await page.reload()
  await expect(page.locator(`[data-duty-id="${sessionDuty.id}"]`)).toHaveCount(0)
  await page.getByRole('button', { name: 'Ada', exact: true }).click()
  await expect(page.locator('.helper-duties')).toContainText('Abgesagt')
})
