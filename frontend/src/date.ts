const dateFormatter = new Intl.DateTimeFormat('de-DE', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
})

export function formatDate(date: string): string {
  return dateFormatter.format(new Date(`${date}T00:00:00Z`))
}
