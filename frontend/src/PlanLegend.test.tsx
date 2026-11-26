import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import PlanLegend from './PlanLegend'

beforeEach(() => window.localStorage.clear())
afterEach(() => cleanup())

it('explains every state with a label and remembers whether the legend is open', () => {
  render(<PlanLegend canPlan zoom={1.6} onZoom={() => {}} />)
  const legend = screen.getByText('Legende').closest('details')!
  for (const label of ['Raumkonflikt', 'Rednerkonflikt', 'Verschoben', 'Geändert', 'Abgesagt', 'Offener Dienst', 'Helferkonflikt']) {
    expect(legend.textContent).toContain(label)
  }
  legend.open = true
  fireEvent(legend, new Event('toggle'))
  expect(window.localStorage.getItem('slot-machine-plan-legend-open')).toBe('true')
})

it('shows the usage hint once until it is dismissed', () => {
  const { unmount } = render(<PlanLegend canPlan zoom={1.6} onZoom={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: 'Verstanden' }))
  expect(screen.queryByRole('note', { name: 'Bedienhinweis' })).toBeNull()
  unmount()
  render(<PlanLegend canPlan zoom={1.6} onZoom={() => {}} />)
  expect(screen.queryByRole('note', { name: 'Bedienhinweis' })).toBeNull()
})

it('hides planning hints from read-only users', () => {
  render(<PlanLegend canPlan={false} zoom={1.6} onZoom={() => {}} />)
  expect(screen.queryByRole('note', { name: 'Bedienhinweis' })).toBeNull()
})

it('steps through the zoom levels', () => {
  const onZoom = vi.fn()
  render(<PlanLegend canPlan zoom={2.4} onZoom={onZoom} />)
  expect(screen.getByText('150 %')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Raster vergrößern' }))
  expect(onZoom).toHaveBeenCalledWith(3.2)
  fireEvent.click(screen.getByRole('button', { name: 'Raster verkleinern' }))
  expect(onZoom).toHaveBeenCalledWith(1.6)
})
