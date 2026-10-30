import { expect, test } from './fixtures'

test('admin dashboard filters demand, edits another day and refreshes without losing its filter', async ({ page, request }) => {
  const event = await (await request.post('/api/events', { data: {
    name: 'Dashboard-Konferenz', start_date: '2026-10-01', end_date: '2026-10-02',
  } })).json()
  const days = []
  for (const date of ['2026-10-01', '2026-10-02']) {
    days.push(await (await request.post(`/api/events/${event.id}/days`, { data: {
      event_id: event.id, date, start_time: '09:00', end_time: '18:00',
    } })).json())
  }
  const room = await (await request.post('/api/rooms', { data: { event_id: event.id, name: 'Großer Saal' } })).json()
  const createSlot = async (data: Record<string, unknown>) => {
    const response = await request.post('/api/slots', { data: { event_id: event.id, ...data } })
    expect(response.ok()).toBeTruthy()
    return response.json()
  }
  await createSlot({ day_id: days[0].id, scope: 'all_rooms', topic: 'Mittagspause', speaker_required: false, start_time: '12:00', end_time: '13:00' })
  const talk = await createSlot({ day_id: days[1].id, room_id: room.id, topic: 'Vortrag offen', start_time: '10:00', end_time: '11:00' })
  await createSlot({ topic: 'Neue Idee' })
  const cancelled = await createSlot({ day_id: days[0].id, room_id: room.id, topic: 'Abgesagter Vortrag', start_time: '14:00', end_time: '15:00' })
  expect((await request.patch(`/api/slots/${cancelled.id}`, { data: { is_cancelled: true } })).ok()).toBeTruthy()
  const user = await (await request.get('/api/auth/me')).json()
  expect((await request.post(`/api/events/${event.id}/duties`, { data: {
    kind: 'session', slot_id: talk.id, title: 'Technik', capacity: 3, user_ids: [user.id],
  } })).ok()).toBeTruthy()
  expect((await request.post(`/api/events/${event.id}/duties`, { data: {
    kind: 'session', slot_id: cancelled.id, title: 'Entfallener Dienst', capacity: 4,
  } })).ok()).toBeTruthy()

  await page.reload()
  await page.getByLabel('Veranstaltung wählen').selectOption(String(event.id))
  await expect(page.getByRole('button', { name: 'Tagesplan', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click()
  const dashboard = page.getByRole('region', { name: 'Veranstaltungsdashboard' })
  const metric = (label: string) => dashboard.locator('dl > div').filter({ has: page.locator('dt', { hasText: label }) }).locator('dd')
  await expect(metric('Geplante aktive Sessions')).toHaveText('2')
  await expect(metric('Offene Helferplätze')).toHaveText('2')
  await expect(metric('Redner fehlen')).toHaveText('2')
  await expect(dashboard.getByRole('region', { name: 'Offene Helferplätze' })).toContainText('1/3 belegt · 2 Plätze fehlen')
  await expect(dashboard.getByRole('region', { name: 'Redner fehlen' })).not.toContainText('Mittagspause')

  await dashboard.getByLabel('Zeitraum').selectOption(String(days[1].id))
  await expect(metric('Ungeplante Sessions')).toHaveText('0')
  await expect(metric('Redner fehlen')).toHaveText('1')
  await dashboard.getByRole('button', { name: 'Vortrag offen am 2. Oktober 2026 bearbeiten', exact: true }).click()
  await expect(page.getByLabel('Veranstaltungstag')).toHaveValue(String(days[1].id))
  await page.getByRole('checkbox', { name: 'Redner erforderlich' }).uncheck()
  await page.getByRole('button', { name: 'Speichern', exact: true }).click()
  await expect(metric('Redner fehlen')).toHaveText('0')
  await expect(dashboard.getByLabel('Zeitraum')).toHaveValue(String(days[1].id))
  await expect(page.getByRole('button', { name: 'Dashboard', exact: true })).toHaveAttribute('aria-pressed', 'true')

  expect((await request.patch(`/api/slots/${talk.id}`, { data: { speaker_required: true } })).ok()).toBeTruthy()
  await dashboard.getByRole('button', { name: 'Aktualisieren' }).click()
  await expect(metric('Redner fehlen')).toHaveText('1')
  await expect(dashboard.getByLabel('Zeitraum')).toHaveValue(String(days[1].id))
  await dashboard.getByLabel('Zeitraum').selectOption('')
  await expect(metric('Absagen')).toHaveText('1')
  await page.screenshot({ path: 'test-results/dashboard-desktop.png', fullPage: true })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('radio', { name: 'Dunkel', exact: true }).check()
  await expect(dashboard.getByRole('button', { name: 'Neue Idee ungeplant bearbeiten' }).first()).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
  await page.screenshot({ path: 'test-results/dashboard-mobile-dark.png', fullPage: true })
})
