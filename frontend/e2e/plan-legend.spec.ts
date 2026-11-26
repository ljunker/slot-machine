import { expect, test } from './fixtures'

test('zeigt Legende, Bedienhinweis und Zoom über dem Plan', async ({ page, request }) => {
  const event = await (await request.post('/api/events', { data: {
    name: 'Legenden-Konferenz', start_date: '2026-10-01', end_date: '2026-10-01',
  } })).json()
  const day = await (await request.post(`/api/events/${event.id}/days`, { data: {
    event_id: event.id, date: '2026-10-01', start_time: '09:00', end_time: '18:00',
  } })).json()
  const room = await (await request.post('/api/rooms', { data: { event_id: event.id, name: 'Saal' } })).json()
  for (const [topic, start, end] of [['Keynote', '10:00', '11:00'], ['Parallel', '10:30', '11:30'], ['Kurz', '12:00', '12:15']]) {
    expect((await request.post('/api/slots', { data: {
      event_id: event.id, day_id: day.id, room_id: room.id, topic, start_time: start, end_time: end,
    } })).ok()).toBeTruthy()
  }

  await page.reload()
  await page.getByLabel('Veranstaltung wählen').selectOption(String(event.id))
  const keynote = page.locator('[data-slot-id]', { hasText: 'Keynote' })
  await expect(keynote.locator('.status-badge')).toHaveText('Raumkonflikt')
  await expect(page.locator('[data-slot-id]', { hasText: 'Kurz' })).toHaveClass(/density-compact/)

  const hint = page.getByRole('note', { name: 'Bedienhinweis' })
  await expect(hint).toBeVisible()
  await hint.getByRole('button', { name: 'Verstanden' }).click()
  await expect(hint).toBeHidden()

  await page.getByText('Legende', { exact: true }).click()
  await expect(page.locator('.plan-legend-body')).toContainText('Rednerkonflikt')

  const before = (await keynote.boundingBox())!.height
  await page.getByRole('button', { name: 'Raster vergrößern' }).click()
  await expect.poll(async () => (await keynote.boundingBox())!.height).toBeCloseTo(before * 1.5, 0)

  await page.reload()
  await page.getByLabel('Veranstaltung wählen').selectOption(String(event.id))
  await expect(page.locator('[data-slot-id]', { hasText: 'Keynote' })).toBeVisible()
  await expect(page.getByRole('note', { name: 'Bedienhinweis' })).toHaveCount(0)
  await expect(page.locator('.plan-legend-body')).toBeVisible()
  await expect(page.getByText('150 %')).toBeVisible()

  await page.locator('[data-slot-id]', { hasText: 'Keynote' }).click({ position: { x: 20, y: 70 } })
  await expect(page.getByRole('complementary', { name: 'Session bearbeiten' })).toBeVisible()
})
