import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import HeaderMenu from './HeaderMenu'

afterEach(cleanup)

function renderMenu() {
  const onAccount = vi.fn(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Menü' })))
  const onDisabled = vi.fn()
  const onLogout = vi.fn()
  render(<>
    <button>Vorher</button>
    <HeaderMenu actions={[
      { label: 'Mein Konto', onClick: onAccount },
      { label: '+ Veranstaltung', disabled: true, onClick: onDisabled },
      { label: 'Abmelden', separatorBefore: true, onClick: onLogout },
    ]} />
    <button>Nachher</button>
    <p>Außerhalb</p>
  </>)
  return { user: userEvent.setup(), trigger: screen.getByRole('button', { name: 'Menü' }), onAccount, onDisabled, onLogout }
}

it('toggles a labelled panel and hides its actions when closed', async () => {
  const { user, trigger } = renderMenu()
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
  expect(screen.queryByRole('button', { name: 'Mein Konto' })).toBeNull()
  await user.click(trigger)
  const panel = screen.getByRole('group', { name: 'Header-Aktionen' })
  expect(trigger.getAttribute('aria-controls')).toBe(panel.id)
  expect(trigger.getAttribute('aria-expanded')).toBe('true')
  expect(within(panel).getAllByRole('button').map(button => button.textContent)).toEqual(['Mein Konto', '+ Veranstaltung', 'Abmelden'])
  await user.click(trigger)
  expect(screen.queryByRole('group', { name: 'Header-Aktionen' })).toBeNull()
})

it('opens with Enter and Space and closes with Escape, restoring trigger focus', async () => {
  const { user, trigger } = renderMenu()
  trigger.focus()
  await user.keyboard('{Enter}')
  await user.tab()
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Mein Konto' }))
  await user.keyboard('{Escape}')
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
  expect(document.activeElement).toBe(trigger)
  await user.keyboard(' ')
  expect(trigger.getAttribute('aria-expanded')).toBe('true')
  await user.keyboard(' ')
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
})

it('keeps normal Tab order, skips disabled actions and closes when focus leaves', async () => {
  const { user, trigger, onDisabled } = renderMenu()
  await user.click(trigger)
  await user.tab()
  await user.tab()
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Abmelden' }))
  await user.tab({ shift: true })
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Mein Konto' }))
  await user.tab({ shift: true })
  expect(document.activeElement).toBe(trigger)
  await user.tab({ shift: true })
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Vorher' }))
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
  await user.click(trigger)
  await user.tab()
  await user.tab()
  await user.tab()
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Nachher' }))
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
  expect(onDisabled).not.toHaveBeenCalled()
})

it('closes on outside clicks without stealing focus from the clicked button', async () => {
  const { user, trigger } = renderMenu()
  await user.click(trigger)
  const outside = screen.getByRole('button', { name: 'Nachher' })
  await user.click(outside)
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
  expect(document.activeElement).toBe(outside)
  await user.click(trigger)
  await user.click(screen.getByText('Außerhalb'))
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
})

it.each(['click', 'keyboard'])('closes and focuses the trigger before invoking an action once via %s', async method => {
  const { user, trigger, onAccount, onDisabled, onLogout } = renderMenu()
  await user.click(trigger)
  if (method === 'click') await user.click(screen.getByRole('button', { name: 'Mein Konto' }))
  else { await user.tab(); await user.keyboard('{Enter}') }
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
  expect(document.activeElement).toBe(trigger)
  expect(onAccount).toHaveBeenCalledOnce()
  expect(onDisabled).not.toHaveBeenCalled()
  expect(onLogout).not.toHaveBeenCalled()
})
