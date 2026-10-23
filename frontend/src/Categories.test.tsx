import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import Editor from './Editor'
import CategoryLabels, { CategoryStripe } from './CategoryLabels'
import type { Category, EventDay, Room } from './types'

const categories: Category[] = [
  { id: 1, event_id: 4, name: 'Musik', color: '#AA0000' },
  { id: 2, event_id: 4, name: 'Tanz', color: '#00AA00' },
]
const day: EventDay = { id: 7, event_id: 4, date: '2099-06-01', start_time: '09:00:00', end_time: '18:00:00' }
const room: Room = { id: 8, event_id: 4, name: 'Saal', sort_order: 0 }

it('saves multiple categories on an unplanned session', async () => {
  const onSave = vi.fn(async () => true)
  render(<Editor kind="slot" days={[day]} rooms={[room]} speakers={[]} categories={categories}
    createUnplanned onSave={onSave} onDelete={null} onClose={() => {}} />)
  fireEvent.change(screen.getByLabelText('Thema'), { target: { value: 'Auftritt' } })
  fireEvent.click(screen.getByLabelText('Musik'))
  fireEvent.click(screen.getByLabelText('Tanz'))
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
    topic: 'Auftritt', category_ids: [1, 2], day_id: null,
  }))
})

it('shows every category name and stripe color', () => {
  const { container } = render(<div><CategoryStripe categories={categories} /><CategoryLabels categories={categories} /></div>)
  expect([...container.querySelectorAll('.category-label')].map(label => label.textContent)).toEqual(['Musik', 'Tanz'])
  expect(container.querySelectorAll('.category-stripe > span')).toHaveLength(2)
  expect((container.querySelector('.category-stripe > span') as HTMLElement).style.backgroundColor).toBe('rgb(170, 0, 0)')
})
