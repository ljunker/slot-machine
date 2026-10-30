import type { Page } from '@playwright/test'
import { createTeamAccount, expect, test } from './fixtures'

async function login(page: Page, email: string, password: string) {
  await page.goto('/')
  await page.getByLabel('E-Mail', { exact: true }).fill(email)
  await page.getByLabel('Passwort', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Anmelden' }).click()
  await expect(page.getByRole('button', { name: 'Mein Konto' })).toBeVisible()
}

for (const viewport of [
  { name: 'Desktop', width: 1440, height: 1000 },
  { name: 'Mobil', width: 390, height: 844 },
]) {
  test(`ändert eigenen Namen und Passwort auf ${viewport.name}`, async ({ request, browser }, testInfo) => {
    const eventResponse = await request.post('/api/events', { data: {
      name: `Kontoeinstellungen ${viewport.name}`, start_date: '2026-10-01', end_date: '2026-10-02',
    } })
    expect(eventResponse.ok()).toBeTruthy()
    const event = await eventResponse.json()
    let secondDayId = 0
    for (const date of ['2026-10-01', '2026-10-02']) {
      const day = await request.post(`/api/events/${event.id}/days`, { data: {
        event_id: event.id, date, start_time: '09:00', end_time: '18:00',
      } })
      expect(day.ok()).toBeTruthy()
      secondDayId = (await day.json()).id
    }
    expect((await request.post('/api/rooms', { data: { event_id: event.id, name: 'Saal' } })).ok()).toBeTruthy()
    const account = createTeamAccount(event.id, 'Ada Helferin')
    const dutyResponse = await request.post(`/api/events/${event.id}/duties`, { data: {
      kind: 'general', title: 'Einlass', day_id: secondDayId, start_time: '10:00', end_time: '11:00', user_ids: [account.id],
    } })
    expect(dutyResponse.ok()).toBeTruthy()
    const duty = await dutyResponse.json()
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } })
    const secondContext = await browser.newContext()
    try {
      const page = await context.newPage()
      const secondPage = await secondContext.newPage()
      await login(page, account.email, account.password)
      await login(secondPage, account.email, account.password)
      await page.getByRole('button', { name: /^2\. Oktober 2026/ }).click()
      await page.getByRole('button', { name: 'Helferplan', exact: true }).click()
      await expect(page.locator(`[data-duty-id="${duty.id}"]`)).toContainText('Ada Helferin')
      const opener = page.getByRole('button', { name: 'Mein Konto' })
      await opener.click()
      let dialog = page.getByRole('dialog', { name: 'Mein Konto' })
      await expect(dialog.getByLabel('Name', { exact: true })).toBeFocused()
      await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('Ada Helferin')
      await page.keyboard.press('Shift+Tab')
      await expect(dialog.getByRole('button', { name: 'Schließen' })).toBeFocused()
      await page.keyboard.press('Shift+Tab')
      await expect(dialog.getByRole('button', { name: 'Passwort ändern' })).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(dialog.getByRole('button', { name: 'Schließen' })).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      await expect(opener).toBeFocused()
      await page.keyboard.press('Enter')
      dialog = page.getByRole('dialog', { name: 'Mein Konto' })
      await dialog.getByLabel('Name', { exact: true }).fill('  Ada  Müller  ')
      await dialog.getByRole('button', { name: 'Namen speichern' }).click()
      await expect(dialog.getByRole('status')).toHaveText('Name gespeichert.')
      await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('Ada Müller')
      await expect(page.locator('.account-name')).toContainText('Ada Müller')
      await expect(page.locator(`[data-duty-id="${duty.id}"]`)).toContainText('Ada Müller')
      await expect(page.getByLabel('Veranstaltung wählen')).toHaveValue(String(event.id))
      await expect(page.locator('.day-row.active')).toContainText('2. Oktober 2026')
      await expect(page.getByRole('button', { name: 'Helferplan', exact: true })).toHaveAttribute('aria-pressed', 'true')
      await page.screenshot({ path: testInfo.outputPath('account-dialog.png') })
      const bounds = await dialog.boundingBox()
      expect(bounds!.x).toBeGreaterThanOrEqual(0)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width)
      expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)

      await dialog.getByLabel('Aktuelles Passwort').fill(account.password)
      await dialog.getByLabel('Neues Passwort', { exact: true }).fill('Changedpassword123!')
      await dialog.getByLabel('Neues Passwort wiederholen').fill('Differentpassword123!')
      await dialog.getByRole('button', { name: 'Passwort ändern' }).click()
      await expect(dialog.getByRole('alert')).toHaveText('Die neuen Passwörter stimmen nicht überein.')
      await dialog.getByLabel('Neues Passwort wiederholen').fill('Changedpassword123!')
      await dialog.getByLabel('Aktuelles Passwort').fill('Wrongpassword123!')
      await dialog.getByRole('button', { name: 'Passwort ändern' }).click()
      await expect(dialog.getByRole('alert')).toHaveText('Aktuelles Passwort ist falsch')
      await dialog.getByLabel('Aktuelles Passwort').fill(account.password)
      const logoutCalls: string[] = []
      page.on('request', outgoing => { if (outgoing.url().endsWith('/api/auth/logout')) logoutCalls.push(outgoing.url()) })
      await dialog.getByRole('button', { name: 'Passwort ändern' }).click()
      await expect(page.getByRole('status')).toHaveText('Passwort geändert. Bitte erneut anmelden.')
      await expect(page.getByRole('dialog')).toHaveCount(0)
      expect(logoutCalls).toEqual([])
      expect((await context.cookies()).some(cookie => cookie.name === 'event_session')).toBe(false)
      expect((await secondContext.request.get('/api/auth/me')).status()).toBe(401)
      await secondPage.reload()
      await expect(secondPage.getByRole('button', { name: 'Anmelden' })).toBeVisible()
      await page.getByLabel('E-Mail', { exact: true }).fill(account.email)
      await page.getByLabel('Passwort', { exact: true }).fill(account.password)
      await page.getByRole('button', { name: 'Anmelden' }).click()
      await expect(page.getByRole('alert')).toHaveText('E-Mail oder Passwort falsch')
      await page.getByLabel('Passwort', { exact: true }).fill('Changedpassword123!')
      await page.getByRole('button', { name: 'Anmelden' }).click()
      await expect(opener).toBeVisible()
      await expect(page.locator('.account-name')).toContainText('Ada Müller')
      await opener.click()
      for (const label of ['Aktuelles Passwort', 'Neues Passwort', 'Neues Passwort wiederholen']) {
        await expect(page.getByLabel(label, { exact: true })).toHaveValue('')
      }
      expect((await request.get('/api/auth/me')).ok()).toBeTruthy()
    } finally {
      await context.close()
      await secondContext.close()
    }
  })
}
