import { expect, test as base } from '@playwright/test'

const baseURL = 'http://127.0.0.1:5173'
const credentials = { email: 'e2e@example.invalid', password: 'E2eTestpassword123!' }

export const test = base.extend({
  request: async ({ playwright }, use) => {
    const loginContext = await playwright.request.newContext({ baseURL })
    const login = await loginContext.post('/api/auth/login', { data: credentials })
    expect(login.ok()).toBeTruthy()
    const csrf = (await login.json() as { csrf_token: string }).csrf_token
    const storageState = await loginContext.storageState()
    await loginContext.dispose()
    const request = await playwright.request.newContext({ baseURL, storageState, extraHTTPHeaders: { 'X-CSRF-Token': csrf } })
    await use(request)
    await request.dispose()
  },
  page: async ({ browser }, use) => {
    const context = await browser.newContext({ baseURL })
    const page = await context.newPage()
    await page.goto('/')
    await page.getByRole('textbox', { name: 'E-Mail' }).fill(credentials.email)
    await page.getByLabel('Passwort').fill(credentials.password)
    await page.getByRole('button', { name: 'Anmelden' }).click()
    await expect(page.getByRole('button', { name: 'Abmelden' })).toBeVisible()
    await use(page)
    await context.close()
  },
})

export { expect }
