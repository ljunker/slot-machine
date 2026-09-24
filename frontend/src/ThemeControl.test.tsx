import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ThemeControl from './ThemeControl'

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  vi.unstubAllGlobals()
  delete document.documentElement.dataset.theme
})

describe('theme choice', () => {
  it('follows system, stores explicit choice, and returns to system', () => {
    let dark = true
    let onChange: (() => void) | undefined
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      get matches() { return dark },
      addEventListener: (_name: string, callback: () => void) => { onChange = callback },
      removeEventListener: () => {},
    })))
    render(<ThemeControl />)
    const choice = screen.getByRole('combobox', { name: 'Darstellung' })
    expect(document.documentElement.dataset.theme).toBe('dark')
    fireEvent.change(choice, { target: { value: 'light' } })
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(window.localStorage.getItem('slot-machine-theme')).toBe('light')
    dark = false
    act(() => onChange?.())
    expect(document.documentElement.dataset.theme).toBe('light')
    fireEvent.change(choice, { target: { value: 'system' } })
    expect(window.localStorage.getItem('slot-machine-theme')).toBeNull()
    dark = true
    act(() => onChange?.())
    expect(document.documentElement.dataset.theme).toBe('dark')
  })
})
