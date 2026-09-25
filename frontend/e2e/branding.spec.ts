import { expect, test } from '@playwright/test'

const logo = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAIAAADwyuo0AAAAFElEQVR4nGNc5i3BAANMcBYDAwMAGbQBDWSbBX0AAAAASUVORK5CYII=', 'base64')

test('zeigt Logo und lesbare Akzentfarben auf Mobilgeräten', async ({ page, request }) => {
  const create = async (name: string, accent_color: string | null) => {
    const response = await request.post('/api/events', { data: { name, start_date: '2099-06-01', end_date: '2099-06-01', accent_color } })
    expect(response.ok()).toBeTruthy()
    return (await response.json() as { id: number }).id
  }
  const brandedId = await create('Konferenz mit Branding', '#A64B18')
  const plainId = await create('Konferenz ohne Branding', null)
  const upload = await request.post(`/api/events/${brandedId}/logo`, { multipart: { logo: { name: 'logo.png', mimeType: 'image/png', buffer: logo } } })
  expect(upload.ok()).toBeTruthy()

  await page.setViewportSize({ width: 375, height: 700 })
  await page.goto(`/programm/${brandedId}`)
  const image = page.getByRole('img', { name: 'Logo von Konferenz mit Branding' })
  await expect(image).toBeVisible()
  expect(await image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBe(4)
  expect(await image.evaluate(element => element.getBoundingClientRect().right)).toBeLessThanOrEqual(375)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
  const program = page.locator('.public-page')
  await expect(program).toHaveClass(/branding-active/)

  await page.getByRole('combobox', { name: 'Darstellung' }).selectOption('light')
  const light = await program.evaluate(element => getComputedStyle(element).getPropertyValue('--primary').trim())
  await page.getByRole('combobox', { name: 'Darstellung' }).selectOption('dark')
  const dark = await program.evaluate(element => getComputedStyle(element).getPropertyValue('--primary').trim())
  expect(light).not.toBe(dark)

  await page.goto(`/programm/${plainId}`)
  await expect(page.getByRole('heading', { name: 'Konferenz ohne Branding' })).toBeVisible()
  await expect(page.locator('.public-page')).not.toHaveClass(/branding-active/)
  await expect(page.locator('.public-logo')).toHaveCount(0)
})
