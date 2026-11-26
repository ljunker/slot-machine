import { useState } from 'react'
import type { FormEvent } from 'react'
import { uploadImage, write } from './api'
import { contrastRatio, programDesign } from './branding'
import { PublicFooter, PublicHeader } from './PublicChrome'
import type { Event, InfoBlock, PartnerLogo } from './types'
import Dialog, { useConfirm } from './Dialog'
import type { ConfirmOptions } from './Dialog'
import InlineMessage from './InlineMessage'
import Icon from './Icon'

type ColorField = 'background_color' | 'text_color' | 'accent_color' | 'header_background_color' | 'card_color'
type TextField = 'program_eyebrow' | 'program_subtitle' | 'website_url'

const COLORS: { field: ColorField; label: string; fallback: string }[] = [
  { field: 'background_color', label: 'Hintergrund', fallback: '#F5F7FB' },
  { field: 'text_color', label: 'Text', fallback: '#172039' },
  { field: 'accent_color', label: 'Akzent', fallback: '#4569DD' },
  { field: 'header_background_color', label: 'Kopfbereich', fallback: '#15213C' },
  { field: 'card_color', label: 'Session-Karten', fallback: '#E7EFFF' },
]

/** Farben des Round-Dance-Festival-Flyers als Vorlage. */
const FLYER_COLORS: Record<ColorField, string> = {
  background_color: '#FAF7F0',
  text_color: '#1D488B',
  accent_color: '#167B7B',
  header_background_color: '#FAF7F0',
  card_color: '#FFFFFF',
}

const IMAGE_TYPES = 'image/jpeg,image/png,image/webp'

function initialColors(event: Event): Record<ColorField, string | null> {
  return Object.fromEntries(COLORS.map(({ field }) => [field, event[field] ?? null])) as Record<ColorField, string | null>
}

function initialTexts(event: Event): Record<TextField, string> {
  return {
    program_eyebrow: event.program_eyebrow ?? '',
    program_subtitle: event.program_subtitle ?? '',
    website_url: event.website_url ?? '',
  }
}

function move<T extends { id: number }>(items: T[], id: number, offset: number): number[] {
  const ids = items.map(item => item.id)
  const index = ids.indexOf(id)
  const target = index + offset
  if (index < 0 || target < 0 || target >= ids.length) return ids
  ;[ids[index], ids[target]] = [ids[target], ids[index]]
  return ids
}

function ImageField({ label, url, alt, path, field, onDone, onError }: {
  label: string
  url: string | null | undefined
  alt: string
  path: string
  field: 'logo' | 'image'
  onDone: () => Promise<unknown>
  onError: (message: string) => void
}) {
  const [busy, setBusy] = useState(false)
  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    try {
      await action()
      await onDone()
    } catch (cause) {
      onError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return <div className="design-image-field">
    <label>{label}<input type="file" accept={IMAGE_TYPES} disabled={busy} onChange={change => {
      const file = change.target.files?.[0]
      change.target.value = ''
      if (file) void run(() => uploadImage(path, field, file))
    }} /></label>
    {url && <div className="event-logo-preview"><img src={url} alt={alt} />
      <button type="button" className="text-button" disabled={busy} onClick={() => void run(() => write('DELETE', path))}>{label} entfernen</button>
    </div>}
  </div>
}

type Confirm = (options: ConfirmOptions) => Promise<boolean>

function PartnerRow({ eventId, partner, first, last, onChanged, onError, onMove, confirm }: {
  eventId: number; partner: PartnerLogo; first: boolean; last: boolean
  onChanged: () => Promise<unknown>; onError: (message: string) => void; onMove: (offset: number) => void; confirm: Confirm
}) {
  const [name, setName] = useState(partner.name)
  const [subtitle, setSubtitle] = useState(partner.subtitle ?? '')
  const [url, setUrl] = useState(partner.url ?? '')
  const base = `/events/${eventId}/partner-logos/${partner.id}`

  async function save(event: FormEvent) {
    event.preventDefault()
    try {
      await write('PATCH', base, { name, subtitle: subtitle || null, url: url || null })
      await onChanged()
    } catch (cause) { onError((cause as Error).message) }
  }

  async function remove() {
    if (!await confirm({ title: 'Partner entfernen?', message: `„${partner.name}“ und sein Logo werden aus dem Besucherprogramm entfernt.`, confirmLabel: 'Partner entfernen' })) return
    try {
      await write('DELETE', base)
      await onChanged()
    } catch (cause) { onError((cause as Error).message) }
  }

  return <li className="design-list-item">
    <form onSubmit={event => void save(event)} aria-label={`Partner ${partner.name}`}>
      <label>Name<input required maxLength={120} value={name} onChange={event => setName(event.target.value)} /></label>
      <label>Untertitel<input maxLength={160} value={subtitle} onChange={event => setSubtitle(event.target.value)} /></label>
      <label>Link<input type="url" maxLength={255} placeholder="https://" value={url} onChange={event => setUrl(event.target.value)} /></label>
      <ImageField label="Partnerlogo" url={partner.image_url} alt={`Logo von ${partner.name}`} path={`${base}/image`} field="image" onDone={onChanged} onError={onError} />
      <div className="design-item-actions">
        <button type="submit" className="secondary small">Partner speichern</button>
        <button type="button" className="icon-button" aria-label={`${partner.name} nach oben`} disabled={first} onClick={() => onMove(-1)}><Icon name="arrow-up" /></button>
        <button type="button" className="icon-button" aria-label={`${partner.name} nach unten`} disabled={last} onClick={() => onMove(1)}><Icon name="arrow-down" /></button>
        <button type="button" className="danger small" onClick={() => void remove()}>Löschen</button>
      </div>
    </form>
  </li>
}

function InfoRow({ eventId, block, first, last, onChanged, onError, onMove, confirm }: {
  eventId: number; block: InfoBlock; first: boolean; last: boolean
  onChanged: () => Promise<unknown>; onError: (message: string) => void; onMove: (offset: number) => void; confirm: Confirm
}) {
  const [title, setTitle] = useState(block.title)
  const [body, setBody] = useState(block.body)
  const base = `/events/${eventId}/info-blocks/${block.id}`

  async function save(event: FormEvent) {
    event.preventDefault()
    try {
      await write('PATCH', base, { title, body })
      await onChanged()
    } catch (cause) { onError((cause as Error).message) }
  }

  async function remove() {
    if (!await confirm({ title: 'Infoblock löschen?', message: `„${block.title}“ wird aus Besucherprogramm und PDF entfernt.`, confirmLabel: 'Infoblock löschen' })) return
    try {
      await write('DELETE', base)
      await onChanged()
    } catch (cause) { onError((cause as Error).message) }
  }

  return <li className="design-list-item">
    <form onSubmit={event => void save(event)} aria-label={`Infoblock ${block.title}`}>
      <label>Titel<input required maxLength={120} value={title} onChange={event => setTitle(event.target.value)} /></label>
      <label>Text<textarea maxLength={4000} rows={3} value={body} onChange={event => setBody(event.target.value)} /></label>
      <div className="design-item-actions">
        <button type="submit" className="secondary small">Infoblock speichern</button>
        <button type="button" className="icon-button" aria-label={`${block.title} nach oben`} disabled={first} onClick={() => onMove(-1)}><Icon name="arrow-up" /></button>
        <button type="button" className="icon-button" aria-label={`${block.title} nach unten`} disabled={last} onClick={() => onMove(1)}><Icon name="arrow-down" /></button>
        <button type="button" className="danger small" onClick={() => void remove()}>Löschen</button>
      </div>
    </form>
  </li>
}

export default function ProgramDesignEditor({ event, onChanged, onClose }: {
  event: Event
  onChanged: () => Promise<unknown>
  onClose: () => void
}) {
  const [colors, setColors] = useState(() => initialColors(event))
  const [texts, setTexts] = useState(() => initialTexts(event))
  const [previewTheme, setPreviewTheme] = useState<'light' | 'dark'>('light')
  const [newPartner, setNewPartner] = useState('')
  const [newInfo, setNewInfo] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [confirm, confirmDialog] = useConfirm()
  const partners = event.partner_logos ?? []
  const blocks = event.info_blocks ?? []
  const base = `/events/${event.id}`

  const preview: Event = {
    ...event,
    ...colors,
    program_eyebrow: texts.program_eyebrow.trim() || null,
    program_subtitle: texts.program_subtitle.trim() || null,
    website_url: texts.website_url.trim() || null,
  }
  const design = programDesign(preview, { force: true })
  const textContrast = contrastRatio(colors.text_color ?? '#172039', colors.background_color ?? '#F5F7FB')

  function report(text: string) {
    setMessage('')
    setError(text)
  }

  async function changed() {
    setError('')
    await onChanged()
  }

  async function save(submit: FormEvent) {
    submit.preventDefault()
    setSaving(true)
    setError('')
    setMessage('')
    try {
      await write('PATCH', base, {
        ...colors,
        program_eyebrow: texts.program_eyebrow || null,
        program_subtitle: texts.program_subtitle || null,
        website_url: texts.website_url || null,
      })
      await onChanged()
      setMessage('Gestaltung gespeichert.')
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function create(path: string, body: Record<string, string>, reset: () => void) {
    try {
      await write('POST', path, body)
      reset()
      await changed()
    } catch (cause) { report((cause as Error).message) }
  }

  async function reorder(path: string, ids: number[]) {
    try {
      await write('PUT', path, { ids })
      await changed()
    } catch (cause) { report((cause as Error).message) }
  }

  return <Dialog className="design-dialog" label="Besucherprogramm gestalten" closeOnBackdrop={false} onClose={onClose}>
    <div className="editor-heading"><h2>Besucherprogramm gestalten</h2><button type="button" className="text-button" onClick={onClose}>Schließen</button></div>
    {error && <InlineMessage tone="error">{error}</InlineMessage>}
    {message && <InlineMessage tone="success">{message}</InlineMessage>}
    <div className="design-layout">
      <div className="design-settings">
        <form onSubmit={submit => void save(submit)} className="design-form" aria-label="Farben und Texte">
          <fieldset><legend>Farben</legend>
            <p className="muted">Ohne eigene Farbe gilt das Standarddesign. Für den Dunkelmodus werden die Farben automatisch abgedunkelt; zu schwacher Kontrast wird ausgeglichen.</p>
            {COLORS.map(({ field, label, fallback }) => <div className="design-color" key={field}>
              <label className="cancel-checkbox"><input type="checkbox" checked={colors[field] !== null} onChange={change => setColors(current => ({ ...current, [field]: change.target.checked ? current[field] ?? fallback : null }))} />{label}</label>
              {colors[field] !== null && <input type="color" aria-label={`Farbe ${label}`} value={colors[field] ?? fallback} onChange={change => setColors(current => ({ ...current, [field]: change.target.value.toUpperCase() }))} />}
            </div>)}
            <button type="button" className="text-button" onClick={() => setColors({ ...FLYER_COLORS })}>Flyer-Farben übernehmen (Creme, Navy, Teal)</button>
            <p className={`muted${textContrast < 4.5 ? ' design-warning' : ''}`}>Kontrast Text zu Hintergrund: {textContrast.toFixed(1).replace('.', ',')}:1{textContrast < 4.5 ? ' – zu schwach, die Textfarbe wird automatisch angepasst.' : ''}</p>
          </fieldset>
          <fieldset><legend>Kopfbereich</legend>
            <label>Überschrift<input maxLength={60} placeholder="VERANSTALTUNGSPROGRAMM" value={texts.program_eyebrow} onChange={change => setTexts(current => ({ ...current, program_eyebrow: change.target.value }))} /></label>
            <label>Untertitel<input maxLength={160} placeholder="Zeitraum der Veranstaltung" value={texts.program_subtitle} onChange={change => setTexts(current => ({ ...current, program_subtitle: change.target.value }))} /></label>
            <label>Webadresse<input type="url" maxLength={255} placeholder="https://" value={texts.website_url} onChange={change => setTexts(current => ({ ...current, website_url: change.target.value }))} /></label>
          </fieldset>
          <button className="primary" type="submit" disabled={saving}>Farben und Texte speichern</button>
        </form>

        <fieldset><legend>Grafiken</legend>
          <p className="muted">JPEG, PNG oder WebP bis 5 MB. Bilder werden sofort gespeichert.</p>
          <ImageField label="Logo" url={event.logo_url} alt={`Logo von ${event.name}`} path={`${base}/logo`} field="logo" onDone={changed} onError={report} />
          <ImageField label="Kopfgrafik" url={event.header_graphic_url} alt="Kopfgrafik" path={`${base}/graphics/header`} field="image" onDone={changed} onError={report} />
          <ImageField label="Fußgrafik" url={event.footer_graphic_url} alt="Fußgrafik" path={`${base}/graphics/footer`} field="image" onDone={changed} onError={report} />
        </fieldset>

        <fieldset><legend>Partnerlogos</legend>
          <ul className="design-list">{partners.map((partner, index) => <PartnerRow key={partner.id} eventId={event.id} partner={partner}
            first={index === 0} last={index === partners.length - 1} onChanged={changed} onError={report}
            onMove={offset => void reorder(`${base}/partner-logos/order`, move(partners, partner.id, offset))} confirm={confirm} />)}</ul>
          <form className="management-form" onSubmit={submit => { submit.preventDefault(); void create(`${base}/partner-logos`, { name: newPartner }, () => setNewPartner('')) }}>
            <label>Neuer Partner<input required maxLength={120} value={newPartner} onChange={change => setNewPartner(change.target.value)} /></label>
            <button type="submit" className="secondary">Partner hinzufügen</button>
          </form>
        </fieldset>

        <fieldset><legend>Infoblöcke</legend>
          <p className="muted">Erscheinen unter dem Programm und als eigene Seite im PDF.</p>
          <ul className="design-list">{blocks.map((block, index) => <InfoRow key={block.id} eventId={event.id} block={block}
            first={index === 0} last={index === blocks.length - 1} onChanged={changed} onError={report}
            onMove={offset => void reorder(`${base}/info-blocks/order`, move(blocks, block.id, offset))} confirm={confirm} />)}</ul>
          <form className="management-form" onSubmit={submit => { submit.preventDefault(); void create(`${base}/info-blocks`, { title: newInfo, body: '' }, () => setNewInfo('')) }}>
            <label>Neuer Infoblock<input required maxLength={120} placeholder="z. B. Gut zu wissen" value={newInfo} onChange={change => setNewInfo(change.target.value)} /></label>
            <button type="submit" className="secondary">Infoblock hinzufügen</button>
          </form>
        </fieldset>
      </div>

      <div className="design-preview-panel">
        <div className="design-preview-toolbar">
          <strong>Vorschau</strong>
          <div role="group" aria-label="Vorschau-Darstellung">
            {(['light', 'dark'] as const).map(theme => <button key={theme} type="button" className="text-button" aria-pressed={previewTheme === theme} onClick={() => setPreviewTheme(theme)}>{theme === 'light' ? 'Hell' : 'Dunkel'}</button>)}
          </div>
          <a className="program-link" href={`/programm/${event.id}`} target="_blank" rel="noreferrer">Besucherprogramm öffnen</a>
        </div>
        <div className="design-preview" data-theme={previewTheme} aria-label="Vorschau des Besucherprogramms">
          <div className={`public-page${design.className}`} style={design.style} inert>
            <PublicHeader event={preview} themeControl={null} />
            <main className="public-container public-main">
              <span className="eyebrow">TAGESPROGRAMM</span>
              <div className="design-preview-slot public-slot"><strong>Beispiel-Session</strong><span className="public-slot-time">10:00–11:00</span><small>Vorname Nachname</small></div>
              <a className="program-link" href="#vorschau">PDF-Programm herunterladen</a>
            </main>
            <PublicFooter event={preview} />
          </div>
        </div>
      </div>
    </div>
    {confirmDialog}
  </Dialog>
}
