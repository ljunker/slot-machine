import { expect, it } from 'vitest'
import { formatDate, formatShortDate } from './date'

it('formats an ISO calendar date in German', () => {
  expect(formatDate('2027-05-21')).toBe('21. Mai 2027')
})

it('formats short day labels for tabs', () => {
  expect(formatShortDate('2026-06-12')).toBe('Fr 12.6.')
  expect(formatShortDate('2026-11-29')).toBe('So 29.11.')
})
