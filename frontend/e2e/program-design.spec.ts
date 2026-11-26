import { expect, test } from './fixtures'

// 4 × 2 Pixel PNG als Platzhalter für Logo und Grafiken.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAIAAADwyuo0AAAAFElEQVR4nGNc5i3BAANMcBYDAwMAGbQBDWSbBX0AAAAASUVORK5CYII=', 'base64')

test('gestaltet das Besucherprogramm im Editor und zeigt es öffentlich lesbar an', async ({ page, request }) => {
  const created = await request.post('/api/events', { data: { name: 'Round Dance Festival E2E', start_date: '2099-05-21', end_date: '2099-05-23' } })
  expect(created.ok()).toBeTruthy()
  const eventId = (await created.json() as { id: number }).id
  expect((await request.post(`/api/events/${eventId}/days`, { data: { event_id: eventId, date: '2099-05-22', start_time: '11:00', end_time: '18:00' } })).ok()).toBeTruthy()
  const upload = await request.post(`/api/events/${eventId}/graphics/footer`, { multipart: { image: { name: 'skyline.png', mimeType: 'image/png', buffer: png } } })
  expect(upload.ok()).toBeTruthy()

  await page.reload()
  await page.getByRole('combobox', { name: 'Veranstaltung wählen' }).selectOption({ label: 'Round Dance Festival E2E' })
  await page.getByRole('button', { name: 'Veranstaltung verwalten' }).click()
  await page.getByRole('button', { name: 'Besucherprogramm gestalten' }).click()
  const dialog = page.getByRole('dialog', { name: 'Besucherprogramm gestalten' })
  await dialog.getByRole('button', { name: 'Vorlage Creme und Petrol' }).click()
  await dialog.getByLabel('Überschrift').fill('PROGRAMM')
  await dialog.getByLabel('Untertitel').fill('21.–23.05.2099 · HAMBURG')
  await dialog.getByLabel('Webadresse').fill('https://rdf.example.org/')
  await dialog.getByLabel('Neuer Partner').fill('Butterflies')
  await dialog.getByRole('button', { name: 'Partner hinzufügen' }).click()
  await expect(dialog.getByRole('group', { name: 'Partner Butterflies' })).toBeVisible()
  await dialog.getByLabel('Neuer Infoblock').fill('Gut zu wissen')
  await dialog.getByRole('button', { name: 'Infoblock hinzufügen' }).click()
  const info = dialog.getByRole('group', { name: 'Infoblock Gut zu wissen' })
  await info.getByLabel('Text').fill('Cues auf Englisch')
  await expect(dialog.getByLabel('Vorschau des Besucherprogramms').getByText('Cues auf Englisch')).toBeVisible()
  await expect(dialog.getByText('10 ungespeicherte Änderungen')).toBeVisible()
  await dialog.getByRole('button', { name: 'Änderungen speichern' }).click()
  await expect(dialog.getByText('Alle Änderungen gespeichert.')).toBeVisible()
  await expect(dialog.getByRole('group', { name: 'Infoblock Gut zu wissen' }).getByLabel('Text')).toHaveValue('Cues auf Englisch')

  for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 760 }]) {
    await page.setViewportSize(viewport)
    for (const theme of ['light', 'dark']) {
      await page.goto(`/programm/${eventId}`)
      await page.getByRole('combobox', { name: 'Darstellung' }).selectOption(theme)
      await expect(page.getByRole('heading', { name: 'Round Dance Festival E2E' })).toBeVisible()
      await expect(page.getByText('21.–23.05.2099 · HAMBURG')).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Gut zu wissen' })).toBeVisible()
      await expect(page.getByRole('link', { name: 'rdf.example.org' })).toBeVisible()
      await expect(page.locator('.public-page')).toHaveClass(/design-active/)
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width)
      const colors = await page.locator('.public-page').evaluate(element => {
        const style = getComputedStyle(element)
        const title = getComputedStyle(element.querySelector('h1')!)
        return { background: style.backgroundColor, title: title.color }
      })
      if (theme === 'light') expect(colors.background).toBe('rgb(250, 247, 240)')
      else expect(colors.background).not.toBe('rgb(250, 247, 240)')
      expect(colors.title).not.toBe(colors.background)
    }
  }
})
