const dateFormatter = new Intl.DateTimeFormat('de-DE', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
})

export function formatDate(date: string): string {
  return dateFormatter.format(new Date(`${date}T00:00:00Z`))
}

const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']

/** Kurzes Tageslabel für Tabs, z. B. „Fr 12.6.“. */
export function formatShortDate(date: string): string {
  const value = new Date(`${date}T00:00:00Z`)
  return `${WEEKDAYS[value.getUTCDay()]} ${value.getUTCDate()}.${value.getUTCMonth() + 1}.`
}

const weekdayFormatter = new Intl.DateTimeFormat('de-DE', {
  weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC',
})

/** Datum mit Wochentag für Überschriften, z. B. „Freitag, 12.06.2026“. */
export function formatWeekdayDate(date: string): string {
  return weekdayFormatter.format(new Date(`${date}T00:00:00Z`))
}
