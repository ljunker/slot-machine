import { useEffect } from 'react'

export const APP_TITLE = 'Event Scheduler'
const DEFAULT_ICON = '/favicon.svg'

/** „Teil · Veranstaltung“ ohne leere Bestandteile. */
export function pageTitle(...parts: (string | null | undefined)[]): string {
  return parts.filter(Boolean).join(' · ') || APP_TITLE
}

function setIcon(href: string) {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    document.head.append(link)
  }
  if (link.getAttribute('href') !== href) {
    link.removeAttribute('type')
    link.href = href
  }
}

/** Setzt Dokumenttitel und (optional) Favicon, z. B. das Logo der Veranstaltung. */
export function usePageTitle(title: string | null, icon?: string | null) {
  useEffect(() => {
    if (title) document.title = title
  }, [title])
  useEffect(() => {
    setIcon(icon || DEFAULT_ICON)
    return () => setIcon(DEFAULT_ICON)
  }, [icon])
}
