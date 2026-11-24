import type { ReactNode } from 'react'
import { formatDate } from './date'
import ThemeControl from './ThemeControl'
import type { Event } from './types'

export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/\/$/, '')
}

export function eventPeriod(event: Pick<Event, 'start_date' | 'end_date'>): string {
  return event.start_date === event.end_date
    ? formatDate(event.start_date)
    : `${formatDate(event.start_date)} bis ${formatDate(event.end_date)}`
}

/** Kopfbereich für Programmseite, Session-Seiten und die Vorschau im Design-Editor. */
export function PublicHeader({ event, showSubtitle = true, themeControl = <ThemeControl /> }: {
  event: Event | null
  showSubtitle?: boolean
  themeControl?: ReactNode
}) {
  const subtitle = event ? event.program_subtitle || eventPeriod(event) : null
  return <header className="public-header">
    <div className="public-container public-header-content">
      <div className="public-title">
        {event?.logo_url && <span className="public-logo"><img src={event.logo_url} alt={`Logo von ${event.name}`} /></span>}
        <div><span className="eyebrow">{event?.program_eyebrow || 'VERANSTALTUNGSPROGRAMM'}</span>
          <h1>{event?.name ?? 'Programm'}</h1>
          {showSubtitle && subtitle && <p>{subtitle}</p>}
        </div>
      </div>
      <div className="public-header-side">
        {event?.header_graphic_url && <img className="public-header-graphic" src={event.header_graphic_url} alt="" />}
        {themeControl}
      </div>
    </div>
  </header>
}

/** Fußbereich mit Infoblöcken, Fußgrafik, Partnerlogos und Webadresse. */
export function PublicFooter({ event, showInfo = true }: { event: Event | null; showInfo?: boolean }) {
  if (!event) return null
  const blocks = showInfo ? event.info_blocks ?? [] : []
  const partners = event.partner_logos ?? []
  if (!blocks.length && !partners.length && !event.footer_graphic_url && !event.website_url) return null
  return <footer className="public-footer">
    <div className="public-container public-footer-content">
      {blocks.length > 0 && <section className="public-info-blocks" aria-label="Informationen">
        {blocks.map(block => <article className="public-info-block" key={block.id}>
          <h3>{block.title}</h3>
          {block.body && <p>{block.body}</p>}
        </article>)}
      </section>}
      {event.footer_graphic_url && <img className="public-footer-graphic" src={event.footer_graphic_url} alt="" />}
      {partners.length > 0 && <ul className="public-partners" aria-label="Partner">
        {partners.map(partner => {
          const content = <>
            {partner.image_url && <img src={partner.image_url} alt="" />}
            <span><strong>{partner.name}</strong>{partner.subtitle && <small>{partner.subtitle}</small>}</span>
          </>
          return <li key={partner.id}>
            {partner.url
              ? <a className="public-partner" href={partner.url} target="_blank" rel="noopener noreferrer">{content}</a>
              : <div className="public-partner">{content}</div>}
          </li>
        })}
      </ul>}
      {event.website_url && <p className="public-footer-url">Mehr unter <a href={event.website_url} target="_blank" rel="noopener noreferrer">{displayUrl(event.website_url)}</a></p>}
    </div>
  </footer>
}
