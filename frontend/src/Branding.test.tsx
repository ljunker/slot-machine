import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Editor from './Editor'
import PublicProgram from './PublicProgram'
import { brandingStyle } from './branding'
import type { Event } from './types'

const event: Event = {
  id: 7, name: 'Konferenz', start_date: '2099-06-01', end_date: '2099-06-01',
  accent_color: '#A64B18', logo_url: '/api/events/7/logo',
}

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('event branding', () => {
  it('keeps accent and button text at readable contrast in both themes', () => {
    const luminance = (hex: string) => {
      const channels = [1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16) / 255)
      const [red, green, blue] = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
      return 0.2126 * red + 0.7152 * green + 0.0722 * blue
    }
    const contrast = (first: string, second: string) => {
      const values = [luminance(first), luminance(second)].sort((a, b) => b - a)
      return (values[0] + 0.05) / (values[1] + 0.05)
    }
    for (const accent of ['#000000', '#ffffff', '#a64b18', '#ff0000', '#00ffff']) {
      const style = brandingStyle(accent) as Record<string, string>
      expect(contrast(style['--brand-light'], '#ffffff')).toBeGreaterThanOrEqual(4.5)
      expect(contrast(style['--brand-dark'], '#182337')).toBeGreaterThanOrEqual(4.5)
      expect(contrast(style['--brand-light'], style['--brand-on-light'])).toBeGreaterThanOrEqual(4.5)
      expect(contrast(style['--brand-dark'], style['--brand-on-dark'])).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('edits color and logo in the event editor', async () => {
    const onSave = vi.fn(async () => true)
    const onDeleteLogo = vi.fn(async () => {})
    const onClose = vi.fn()
    render(<Editor kind="event" event={event} days={[]} rooms={[]} speakers={[]} onSave={onSave} onDelete={null} onDeleteLogo={onDeleteLogo} onClose={onClose} />)
    expect(screen.getByRole('img', { name: 'Logo von Konferenz' }).getAttribute('src')).toBe(event.logo_url)
    fireEvent.change(screen.getByLabelText('Akzentfarbe'), { target: { value: '#123456' } })
    const logo = new File(['image'], 'logo.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText(/Logo \(JPEG/), { target: { files: [logo] } })
    await waitFor(() => expect(screen.getByRole('img', { name: 'Logo von Konferenz' }).getAttribute('src')).toMatch(/^data:image\/png;base64,/))
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ accent_color: '#123456' }), logo))
    expect(onClose).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Logo entfernen' }))
    expect(onDeleteLogo).toHaveBeenCalled()
  })

  it('shows branding only for selected public event and keeps both themes readable', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input)
      const id = path.includes('/events/8') ? 8 : 7
      const body = path.endsWith('/days') ? [] : id === 7 ? event : { ...event, id: 8, name: 'Ohne Branding', accent_color: null, logo_url: null }
      return new Response(JSON.stringify(body), { status: 200 })
    }))
    const { container, rerender } = render(<PublicProgram eventId={7} />)
    await screen.findByRole('img', { name: 'Logo von Konferenz' })
    const page = container.querySelector('.public-page') as HTMLElement
    expect(page.classList.contains('branding-active')).toBe(true)
    const style = brandingStyle(event.accent_color) as Record<string, string>
    expect(style['--brand-light']).toMatch(/^#[0-9a-f]{6}$/)
    expect(style['--brand-dark']).toMatch(/^#[0-9a-f]{6}$/)
    expect(style['--brand-light']).not.toBe(style['--brand-dark'])
    expect(page.style.getPropertyValue('--brand-light')).toBe(style['--brand-light'])
    rerender(<PublicProgram eventId={8} />)
    await screen.findByText('Ohne Branding')
    expect(page.classList.contains('branding-active')).toBe(false)
    expect(page.style.getPropertyValue('--brand-light')).toBe('')
    expect(screen.queryByRole('img', { name: 'Logo von Konferenz' })).toBeNull()
  })
})
