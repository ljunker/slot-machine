import { expect, test } from './fixtures'
import type { Locator } from '@playwright/test'

test('plant offene und mehrfach besetzte Dienste in Raumspalten', async ({ page, request }) => {
  const eventResponse = await request.post('/api/events', { data: {
    name: 'Helfertest', start_date: '2026-10-01', end_date: '2026-10-01',
  } })
  const event = await eventResponse.json()
  const dayResponse = await request.post(`/api/events/${event.id}/days`, { data: {
    event_id: event.id, date: '2026-10-01', start_time: '09:00', end_time: '18:00',
  } })
  const day = await dayResponse.json()
  const roomA = await (await request.post('/api/rooms', { data: { event_id: event.id, name: 'Saal A' } })).json()
  const roomB = await (await request.post('/api/rooms', { data: { event_id: event.id, name: 'Saal B' } })).json()
  await page.goto('/')
  await page.getByLabel('Veranstaltung wählen').selectOption(String(event.id))
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

  const publicPlan = await request.get(`/api/schedule/days/${day.id}`)
  expect((await publicPlan.json()).duties).toBeUndefined()
  await page.goto(`/programm/${event.id}`)
  await expect(page.getByText('Einlass')).toHaveCount(0)
  await expect(page.getByText('Ada')).toHaveCount(0)

  const helpers = await (await request.get(`/api/events/${event.id}/helpers`)).json()
  const ada = helpers.find((person: { name: string }) => person.name === 'Ada')
  const slot = await (await request.post('/api/slots', { data: {
    event_id: event.id, day_id: day.id, room_id: roomA.id, topic: 'Vortrag',
    start_time: '10:15', end_time: '10:45',
  } })).json()
  const sessionDuty = await (await request.post(`/api/events/${event.id}/duties`, { data: {
    kind: 'session', slot_id: slot.id, helper_ids: [ada.id],
  } })).json()
  await page.goto('/')
  await page.getByLabel('Veranstaltung wählen').selectOption(String(event.id))
  await expect(page.locator('[aria-label="Helferdienste Saal A"] [data-duty-id]')).toHaveCount(2)
  await expect(page.getByRole('region', { name: 'Helferkonflikte' })).toHaveCount(0)
  await request.patch(`/api/slots/${slot.id}`, { data: {
    room_id: roomB.id, start_time: '10:15', end_time: '10:45',
  } })
  await page.reload()
  await page.getByLabel('Veranstaltung wählen').selectOption(String(event.id))
  await expect(page.locator('[aria-label="Helferdienste Saal B"] [data-duty-id]')).toHaveCount(1)
  await expect(page.locator(`[data-duty-id="${sessionDuty.id}"]`)).toContainText('Vortrag')
  await expect(page.getByRole('region', { name: 'Helferkonflikte' })).toContainText('Ada')
  await request.patch(`/api/slots/${slot.id}`, { data: { is_cancelled: true } })
  await page.reload()
  await page.getByLabel('Veranstaltung wählen').selectOption(String(event.id))
  await expect(page.locator(`[data-duty-id="${sessionDuty.id}"]`)).toHaveCount(0)
  await page.getByRole('button', { name: 'Ada', exact: true }).click()
  await expect(page.locator('.helper-duties')).toContainText('Abgesagt')
})

test('gibt parallelen Diensten im Helferplan Platz, auch bei schmalem Fenster', async ({ page, request }) => {
  const event = await (await request.post('/api/events', { data: {
    name: 'Parallele Dienste', start_date: '2026-10-01', end_date: '2026-10-01',
  } })).json()
  const day = await (await request.post(`/api/events/${event.id}/days`, { data: {
    event_id: event.id, date: '2026-10-01', start_time: '09:00', end_time: '18:00',
  } })).json()
  const room = await (await request.post('/api/rooms', { data: { event_id: event.id, name: 'Saal' } })).json()
  await request.post('/api/slots', { data: {
    event_id: event.id, day_id: day.id, room_id: room.id, topic: 'Vortrag',
    start_time: '10:00', end_time: '11:00',
  } })
  for (const title of ['Einlass', 'Technik', 'Info']) {
    await request.post(`/api/events/${event.id}/duties`, { data: {
      kind: 'room', title, day_id: day.id, room_id: room.id,
      start_time: '10:00', end_time: '11:00', helper_ids: [],
    } })
  }
  await page.setViewportSize({ width: 700, height: 800 })
  await page.goto('/')
  await page.getByLabel('Veranstaltung wählen').selectOption(String(event.id))
  await expect(page.locator('[aria-label="Helferdienste Saal"] [data-duty-id]')).toHaveCount(3)
  expect(await page.locator('.schedule-grid').evaluate(element => getComputedStyle(element).gridTemplateColumns)).toContain('180px')
  await page.getByRole('button', { name: 'Helferplan' }).click()
  const sizes = await page.locator('.schedule-scroll').evaluate(container => {
    const cards = [...container.querySelectorAll<HTMLElement>('[aria-label="Helferdienste Saal"] [data-duty-id]')]
      .map(card => card.getBoundingClientRect())
      .sort((a, b) => a.left - b.left)
    return {
      scrolls: container.scrollWidth > container.clientWidth,
      widths: cards.map(card => card.width),
      separated: cards.every((card, index) => index === 0 || cards[index - 1].right <= card.left + 1),
      dutyBeforeProgram: container.querySelector('[aria-label="Helferdienste Saal"]')!.getBoundingClientRect().right
        <= container.querySelector('[data-room-column]')!.getBoundingClientRect().left + 1,
      programWidth: container.querySelector('[data-room-column]')!.getBoundingClientRect().width,
      timeBelowTitle: container.querySelector('.slot-grip strong')!.getBoundingClientRect().bottom
        <= container.querySelector('.slot-grip span')!.getBoundingClientRect().top + 1,
    }
  })
  expect(sizes.scrolls).toBe(true)
  expect(sizes.widths).toHaveLength(3)
  expect(sizes.widths.every(width => width >= 219)).toBe(true)
  expect(sizes.separated).toBe(true)
  expect(sizes.dutyBeforeProgram).toBe(true)
  expect(sizes.programWidth).toBe(180)
  expect(sizes.timeBelowTitle).toBe(true)
  if (process.env.HELPER_PLAN_SCREENSHOT) await page.screenshot({ path: process.env.HELPER_PLAN_SCREENSHOT, fullPage: true })
})

test('verschiebt und verlängert Dienste über ihre Karten', async ({ page, request }) => {
  const event = await (await request.post('/api/events', { data: {
    name: 'Dienstbewegung', start_date: '2026-10-01', end_date: '2026-10-01',
  } })).json()
  const day = await (await request.post(`/api/events/${event.id}/days`, { data: {
    event_id: event.id, date: '2026-10-01', start_time: '09:00', end_time: '18:00',
  } })).json()
  const roomA = await (await request.post('/api/rooms', { data: { event_id: event.id, name: 'A' } })).json()
  const roomB = await (await request.post('/api/rooms', { data: { event_id: event.id, name: 'B' } })).json()
  const general = await (await request.post(`/api/events/${event.id}/duties`, { data: {
    kind: 'general', title: 'Aufbau', day_id: day.id, start_time: '09:00', end_time: '10:00',
  } })).json()
  const roomDuty = await (await request.post(`/api/events/${event.id}/duties`, { data: {
    kind: 'room', title: 'Einlass', day_id: day.id, room_id: roomA.id,
    start_time: '10:00', end_time: '11:00',
  } })).json()
  const slot = await (await request.post('/api/slots', { data: {
    event_id: event.id, day_id: day.id, room_id: roomA.id, topic: 'Vortrag',
    start_time: '11:00', end_time: '12:00',
  } })).json()
  const sessionDuty = await (await request.post(`/api/events/${event.id}/duties`, { data: {
    kind: 'session', slot_id: slot.id, title: 'Betreuung',
  } })).json()
  await page.setViewportSize({ width: 2200, height: 900 })
  await page.goto('/')
  await page.getByLabel('Veranstaltung wählen').selectOption(String(event.id))
  await page.getByRole('button', { name: 'Helferplan' }).click()

  async function drag(source: Locator, target: Locator, deltaY: number) {
    await expect(source).toBeVisible()
    await expect(target).toBeVisible()
    const from = (await source.boundingBox())!
    const to = (await target.boundingBox())!
    await page.mouse.move(from.x + 24, from.y + 16)
    await page.mouse.down()
    await page.mouse.move(to.x + 30, from.y + 16 + deltaY, { steps: 4 })
    await page.mouse.up()
  }

  await drag(page.locator(`[data-duty-id="${general.id}"] .duty-grip`), page.locator(`[data-duty-column="${roomA.id}"]`), 24)
  await expect.poll(async () => {
    const duty = await (await request.get(`/api/duties/${general.id}`)).json()
    return [duty.kind, duty.room_id, duty.start_time, duty.end_time]
  }).toEqual(['room', roomA.id, '09:15:00', '10:15:00'])
  await expect(page.locator(`[data-duty-column="${roomA.id}"] [data-duty-id="${general.id}"]`)).toContainText('09:15–10:15')
  await drag(page.locator(`[data-duty-id="${general.id}"] .duty-grip`), page.locator('[data-duty-column="general"]'), 0)
  await expect.poll(async () => {
    const duty = await (await request.get(`/api/duties/${general.id}`)).json()
    return [duty.kind, duty.room_id]
  }).toEqual(['general', null])
  await expect(page.locator(`[data-duty-column="general"] [data-duty-id="${general.id}"]`)).toHaveCount(1)

  await drag(page.locator(`[data-duty-id="${roomDuty.id}"] .duty-grip`), page.locator(`[data-duty-column="${roomB.id}"]`), 24)
  await expect.poll(async () => {
    const duty = await (await request.get(`/api/duties/${roomDuty.id}`)).json()
    return [duty.room_id, duty.start_time, duty.end_time]
  }).toEqual([roomB.id, '10:15:00', '11:15:00'])
  await expect(page.locator(`[data-duty-column="${roomB.id}"] [data-duty-id="${roomDuty.id}"]`)).toContainText('10:15–11:15')
  const resize = page.locator(`[data-duty-id="${roomDuty.id}"] .duty-resize`)
  await expect(resize).toBeVisible()
  const handle = (await resize.boundingBox())!
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down()
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2 + 24, { steps: 4 })
  await page.mouse.up()
  await expect.poll(async () => (await (await request.get(`/api/duties/${roomDuty.id}`)).json()).end_time).toBe('11:30:00')
  await expect(page.locator(`[data-duty-column="${roomB.id}"] [data-duty-id="${roomDuty.id}"]`)).toContainText('10:15–11:30')

  await drag(page.locator(`[data-duty-id="${sessionDuty.id}"] .duty-grip`), page.locator(`[data-duty-column="${roomB.id}"]`), 24)
  await expect.poll(async () => {
    const schedule = await (await request.get(`/api/schedule/days/${day.id}`)).json()
    const moved = schedule.rooms.flatMap((room: { slots: { id: number; room_id: number; start_time: string; end_time: string }[] }) => room.slots)
      .find((item: { id: number }) => item.id === slot.id)
    return [moved?.room_id, moved?.start_time, moved?.end_time]
  }).toEqual([roomB.id, '11:15:00', '12:15:00'])
  await expect(page.locator(`[data-duty-column="${roomB.id}"] [data-duty-id="${sessionDuty.id}"]`)).toHaveCount(1)
  const sessionHandle = page.locator(`[data-duty-id="${sessionDuty.id}"] .duty-resize`)
  const sessionBox = (await sessionHandle.boundingBox())!
  await page.mouse.move(sessionBox.x + sessionBox.width / 2, sessionBox.y + sessionBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(sessionBox.x + sessionBox.width / 2, sessionBox.y + sessionBox.height / 2 - 24, { steps: 4 })
  await page.mouse.up()
  await expect.poll(async () => (await (await request.get(`/api/duties/${sessionDuty.id}`)).json()).end_time).toBe('12:00:00')
  await expect(page.locator('aside.editor')).toHaveCount(0)
  await page.locator(`[data-duty-id="${general.id}"]`).click()
  await expect(page.locator('aside.editor')).toHaveCount(1)
})

test('ordnet allgemeine, Raum- und Session-Dienste dauerhaft innerhalb ihrer Spalten', async ({ page, request }) => {
  const event = await (await request.post('/api/events', { data: {
    name: 'Dienstreihenfolge', start_date: '2026-10-01', end_date: '2026-10-01',
  } })).json()
  const day = await (await request.post(`/api/events/${event.id}/days`, { data: {
    event_id: event.id, date: '2026-10-01', start_time: '09:00', end_time: '18:00',
  } })).json()
  const room = await (await request.post('/api/rooms', { data: { event_id: event.id, name: 'Saal' } })).json()
  const general = []
  for (const title of ['Getränke', 'Parkeinweisung', 'Registration']) {
    general.push(await (await request.post(`/api/events/${event.id}/duties`, { data: {
      kind: 'general', title, day_id: day.id, start_time: '15:00', end_time: '17:00',
    } })).json())
  }
  const roomDuties = []
  for (const title of ['Einlass', 'Technik']) {
    roomDuties.push(await (await request.post(`/api/events/${event.id}/duties`, { data: {
      kind: 'room', title, day_id: day.id, room_id: room.id, start_time: '15:00', end_time: '17:00',
    } })).json())
  }
  const slot = await (await request.post('/api/slots', { data: {
    event_id: event.id, day_id: day.id, room_id: room.id, topic: 'Vortrag',
    start_time: '15:00', end_time: '17:00',
  } })).json()
  const session = await (await request.post(`/api/events/${event.id}/duties`, { data: {
    kind: 'session', title: 'Betreuung', slot_id: slot.id,
  } })).json()
  await page.setViewportSize({ width: 1800, height: 900 })
  await page.goto('/')
  await page.getByLabel('Veranstaltung wählen').selectOption(String(event.id))
  await page.getByRole('button', { name: 'Helferplan' }).click()

  async function dragSideways(sourceId: number, targetId: number) {
    await page.locator(`[data-duty-id="${sourceId}"]`).scrollIntoViewIfNeeded()
    const from = (await page.locator(`[data-duty-id="${sourceId}"] .duty-grip`).boundingBox())!
    const to = (await page.locator(`[data-duty-id="${targetId}"]`).boundingBox())!
    await page.mouse.move(from.x + 24, from.y + 14)
    await page.mouse.down()
    await page.mouse.move(to.x + to.width / 2, from.y + 14, { steps: 6 })
    await expect(page.locator(`[data-duty-id="${sourceId}"].ghost`)).toHaveCount(1)
    await page.mouse.up()
  }
  async function order(ids: number[]) {
    return Promise.all(ids.map(async id => (await (await request.get(`/api/duties/${id}`)).json()).sort_order))
  }
  async function left(id: number) {
    return page.locator(`[data-duty-id="${id}"]`).evaluate(element =>
      Math.round(parseFloat((element as HTMLElement).style.left)))
  }

  await dragSideways(general[0].id, general[2].id)
  await expect.poll(() => order([general[1].id, general[2].id, general[0].id])).toEqual([0, 1, 2])
  await page.reload()
  await page.getByLabel('Veranstaltung wählen').selectOption(String(event.id))
  await page.getByRole('button', { name: 'Helferplan' }).click()
  await expect.poll(() => left(general[0].id)).toBe(67)
  await page.getByRole('button', { name: 'Tagesplan' }).click()
  await expect.poll(() => left(general[0].id)).toBe(67)
  await page.getByRole('button', { name: 'Helferplan' }).click()

  await dragSideways(roomDuties[0].id, session.id)
  await expect.poll(() => order([roomDuties[1].id, session.id, roomDuties[0].id])).toEqual([0, 1, 2])
  await dragSideways(session.id, roomDuties[1].id)
  await expect.poll(() => order([session.id, roomDuties[1].id, roomDuties[0].id])).toEqual([0, 1, 2])
  await page.reload()
  await page.getByLabel('Veranstaltung wählen').selectOption(String(event.id))
  await page.getByRole('button', { name: 'Helferplan' }).click()
  await expect.poll(() => left(session.id)).toBe(0)
  await expect.poll(() => left(roomDuties[0].id)).toBe(67)
  const savedSession = await (await request.get(`/api/duties/${session.id}`)).json()
  expect([savedSession.room_id, savedSession.start_time, savedSession.end_time]).toEqual([room.id, '15:00:00', '17:00:00'])
  const savedGeneral = await (await request.get(`/api/duties/${general[0].id}`)).json()
  expect([savedGeneral.start_time, savedGeneral.end_time]).toEqual(['15:00:00', '17:00:00'])
})
