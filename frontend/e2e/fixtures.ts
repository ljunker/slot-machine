import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
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
    expect((await request.patch('/api/auth/me', { data: { name: 'E2E Admin' } })).ok()).toBeTruthy()
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
    if (await page.getByRole('heading', { name: 'Namen festlegen' }).isVisible()) {
      await page.getByLabel('Name', { exact: true }).fill('E2E Admin')
      await page.getByRole('button', { name: 'Speichern' }).click()
    }
    await expect(page.getByRole('heading', { name: 'Programmplanung' })).toBeVisible()
    await use(page)
    await context.close()
  },
})

export { expect }

export function createTeamAccount(eventId: number, name: string | null, role = 'helper'): { id: number; email: string; password: string } {
  const code = `import json, sys, uuid
import app.models
from app.db.database import SessionLocal
from app.models.auth import User, EventMembership
from app.services.auth import password_hash
values = json.loads(sys.argv[1])
with SessionLocal() as db:
    email = uuid.uuid4().hex + '@example.invalid'
    user = User(email=email, name=values['name'], password_hash=password_hash('HelperPassword123!'))
    db.add(user)
    db.flush()
    db.add(EventMembership(event_id=values['event_id'], user_id=user.id, role=values['role']))
    db.commit()
    print(json.dumps({'id': user.id, 'email': email, 'password': 'HelperPassword123!'}))
`
  return JSON.parse(execFileSync('uv', ['run', '--no-sync', 'python', '-c', code, JSON.stringify({ event_id: eventId, name, role })], {
    cwd: resolve('..'), env: { ...process.env, DATABASE_URL: `sqlite:///${process.env.SLOT_MACHINE_E2E_DATABASE}` }, encoding: 'utf8',
  }))
}
