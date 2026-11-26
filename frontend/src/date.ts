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
