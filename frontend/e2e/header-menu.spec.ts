import { expect, test } from './fixtures'

test('öffnet alle Header-Aktionen und meldet über das Menü ab', async ({ page }) => {
  const trigger = page.getByRole('button', { name: 'Menü', exact: true })
  const panel = page.getByRole('group', { name: 'Header-Aktionen' })
  await trigger.focus()
  await page.keyboard.press('Enter')
  await expect(panel.getByRole('button')).toHaveText(['Mein Konto', 'Benutzer', 'Restore', '+ Veranstaltung', 'Abmelden'])
  await page.keyboard.press('Tab')
  await expect(panel.getByRole('button', { name: 'Mein Konto', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
  await expect(trigger).toBeFocused()
  await page.keyboard.press('Space')
  await expect(panel).toBeVisible()
  await page.getByRole('heading', { name: 'Programmplanung' }).click()
  await expect(panel).toBeHidden()

  for (const [action, dialog] of [['Benutzer', 'Benutzer verwalten'], ['Restore', 'Backup wiederherstellen']] as const) {
    await trigger.click()
    await panel.getByRole('button', { name: action, exact: true }).click()
    await expect(panel).toBeHidden()
    const opened = page.getByRole('dialog', { name: dialog })
    await expect(opened).toBeVisible()
    await opened.getByRole('button', { name: 'Schließen', exact: true }).click()
  }
  await trigger.click()
  await panel.getByRole('button', { name: '+ Veranstaltung', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Veranstaltung anlegen' })).toBeVisible()
  await expect(panel).toBeHidden()
  await page.getByRole('button', { name: 'Schließen', exact: true }).click()
  await trigger.click()
  await panel.getByRole('button', { name: 'Mein Konto', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Mein Konto' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()
  await expect(panel).toBeHidden()

  const logoutCalls: string[] = []
  page.on('request', request => { if (request.url().endsWith('/api/auth/logout')) logoutCalls.push(request.url()) })
  await trigger.click()
  await panel.getByRole('button', { name: 'Abmelden', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Anmelden', exact: true })).toBeVisible()
  expect(logoutCalls).toHaveLength(1)
})

test('bedient die Theme-Segmente mit Pfeiltasten und merkt sich die Auswahl', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  const system = page.getByRole('radio', { name: 'System', exact: true })
  const light = page.getByRole('radio', { name: 'Hell', exact: true })
  const dark = page.getByRole('radio', { name: 'Dunkel', exact: true })
  await system.focus()
  await expect(system).toBeChecked()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.keyboard.press('ArrowRight')
  await expect(light).toBeChecked()
  await expect(light).toBeFocused()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.reload()
  await expect(light).toBeChecked()
  await light.focus()
  await page.keyboard.press('ArrowRight')
  await expect(dark).toBeChecked()
  await page.keyboard.press('ArrowRight')
  await expect(system).toBeChecked()
  expect(await page.evaluate(() => localStorage.getItem('slot-machine-theme'))).toBeNull()
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Menü', exact: true })).toBeFocused()
})

for (const viewport of [
  { name: 'Desktop', width: 1440, height: 1000 },
  { name: 'Mobil', width: 390, height: 844 },
  { name: 'Schmal', width: 320, height: 720 },
]) {
  for (const theme of ['light', 'dark'] as const) {
    for (const longAccount of [false, true]) {
      test(`zeigt die Toolbar mit ${longAccount ? 'langem' : 'normalem'} Kontonamen auf ${viewport.name} in ${theme}`, async ({ page }, testInfo) => {
        await page.setViewportSize(viewport)
        const name = longAccount ? 'LangerKontoname'.repeat(14) : 'Lars'
        const email = longAccount ? `${'langeadresse'.repeat(12)}@example.invalid` : 'admin@example.org'
        await page.route('**/api/auth/me', async route => {
          const response = await route.fetch()
          await route.fulfill({ response, json: { ...await response.json(), name, email } })
        })
        await page.reload()
        const choice = page.getByRole('radio', { name: theme === 'light' ? 'Hell' : 'Dunkel', exact: true })
        await choice.check()
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
        const account = page.locator('.account-name')
        await expect(account.locator('strong')).toHaveAttribute('title', name)
        await expect(account.locator('span')).toHaveAttribute('title', email)
        await expect(account).toContainText(name)
        const trigger = page.getByRole('button', { name: 'Menü', exact: true })
        const themeBounds = (await page.getByRole('radiogroup', { name: 'Darstellung' }).boundingBox())!
        const triggerBounds = (await trigger.boundingBox())!
        const accountBounds = (await account.boundingBox())!
        expect(themeBounds.height).toBe(44)
        expect(triggerBounds.height).toBe(44)
        expect(themeBounds.y).toBe(triggerBounds.y)
        if (viewport.width <= 600) {
          expect(accountBounds.y).toBeGreaterThanOrEqual(themeBounds.y + themeBounds.height)
        } else {
          expect(accountBounds.width).toBeLessThanOrEqual(240)
          expect(Math.abs(accountBounds.y + accountBounds.height / 2 - (themeBounds.y + 22))).toBeLessThan(1)
        }
        await page.locator('.app-header').screenshot({ path: testInfo.outputPath('header-toolbar.png') })
        await expect(page.getByRole('button', { name: 'Mein Konto', exact: true })).toBeHidden()
        await trigger.click()
        const panel = page.getByRole('group', { name: 'Header-Aktionen' })
        await expect(panel).toBeVisible()
        const bounds = (await panel.boundingBox())!
        expect(bounds.x).toBeGreaterThanOrEqual(0)
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width)
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width)
        expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
        for (const button of await panel.getByRole('button').all()) await expect(button).toBeInViewport()
        await page.screenshot({ path: testInfo.outputPath('header-menu.png') })
        await choice.click()
        await expect(panel).toBeHidden()
        await expect(choice).toBeFocused()
        await page.keyboard.press('ArrowRight')
        await expect(page.getByRole('radio', { checked: true })).toBeFocused()
        await page.locator('.app-header').screenshot({ path: testInfo.outputPath('header-focus.png') })
      })
    }
  }
}
