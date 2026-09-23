import type { EventDay } from './types'

export function localDate(): string {
  const today = new Date()
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
}

export function defaultDay(days: EventDay[], today = localDate()): EventDay | null {
  const ordered = [...days].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)
  return ordered.find(day => day.date >= today) ?? ordered.at(-1) ?? null
}
