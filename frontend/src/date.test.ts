import { expect, it } from 'vitest'
import { formatDate } from './date'

it('formats an ISO calendar date in German', () => {
  expect(formatDate('2027-05-21')).toBe('21. Mai 2027')
})
