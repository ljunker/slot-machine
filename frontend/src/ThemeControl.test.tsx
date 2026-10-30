import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ThemeControl from './ThemeControl'

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  vi.unstubAllGlobals()
  delete document.documentElement.dataset.theme
})

describe('theme choice', () => {
  it.each(['select', 'segmented'] as const)('%s follows system, stores explicit choice, and returns to system', variant => {
    let dark = true
    let onChange: (() => void) | undefined
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      get matches() { return dark },
      addEventListener: (_name: string, callback: () => void) => { onChange = callback },
      removeEventListener: () => {},
    })))
    render(<ThemeControl variant={variant} />)
    function choose(value: 'system' | 'light' | 'dark') {
      if (variant === 'select') fireEvent.change(screen.getByRole('combobox', { name: 'Darstellung' }), { target: { value } })
      else fireEvent.click(screen.getByRole('radio', { name: { system: 'System', light: 'Hell', dark: 'Dunkel' }[value] }))
    }
    expect(document.documentElement.dataset.theme).toBe('dark')
    choose('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(window.localStorage.getItem('slot-machine-theme')).toBe('light')
    dark = false
    act(() => onChange?.())
    expect(document.documentElement.dataset.theme).toBe('light')
    choose('system')
    expect(window.localStorage.getItem('slot-machine-theme')).toBeNull()
    dark = true
    act(() => onChange?.())
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('uses one Tab stop and native arrow keys for the labelled segments', async () => {
    const user = userEvent.setup()
    render(<><ThemeControl variant="segmented" /><button>Danach</button></>)
    const group = screen.getByRole('radiogroup', { name: 'Darstellung' })
    expect(group.querySelectorAll('input')).toHaveLength(3)
    const system = screen.getByRole('radio', { name: 'System' }) as HTMLInputElement
    const light = screen.getByRole('radio', { name: 'Hell' }) as HTMLInputElement
    const dark = screen.getByRole('radio', { name: 'Dunkel' }) as HTMLInputElement
    await user.tab()
    expect(document.activeElement).toBe(system)
    await user.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(light)
    expect(light.checked).toBe(true)
    expect(window.localStorage.getItem('slot-machine-theme')).toBe('light')
    await user.keyboard('{ArrowRight}')
    expect(dark.checked).toBe(true)
    expect(document.documentElement.dataset.theme).toBe('dark')
    await user.keyboard('{ArrowRight}')
    expect(system.checked).toBe(true)
    expect(window.localStorage.getItem('slot-machine-theme')).toBeNull()
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Danach' }))
  })

  it('restores the stored segment and synchronizes changes from other tabs', () => {
    window.localStorage.setItem('slot-machine-theme', 'dark')
    render(<ThemeControl variant="segmented" />)
    expect((screen.getByRole('radio', { name: 'Dunkel' }) as HTMLInputElement).checked).toBe(true)
    expect(document.documentElement.dataset.theme).toBe('dark')
    window.localStorage.setItem('slot-machine-theme', 'light')
    fireEvent(window, new StorageEvent('storage', { key: 'slot-machine-theme' }))
    expect((screen.getByRole('radio', { name: 'Hell' }) as HTMLInputElement).checked).toBe(true)
    expect(document.documentElement.dataset.theme).toBe('light')
    window.localStorage.clear()
    fireEvent(window, new StorageEvent('storage', { key: null }))
    expect((screen.getByRole('radio', { name: 'System' }) as HTMLInputElement).checked).toBe(true)
  })
})
