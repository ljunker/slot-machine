import { useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { uploadImage, write } from './api'
import { contrastRatio, programDesign } from './branding'
import { PublicFooter, PublicHeader } from './PublicChrome'
import type { ChangeNotice, Event, InfoBlock, PartnerLogo } from './types'
import Dialog, { useConfirm } from './Dialog'
import type { ConfirmOptions } from './Dialog'
import InlineMessage from './InlineMessage'
import Icon from './Icon'
import NoticeBadge from './NoticeBadge'
import CategoryLabels, { CategoryStripe } from './CategoryLabels'
import UnsavedChangesDialog from './UnsavedChangesDialog'

type ColorField = 'background_color' | 'text_color' | 'accent_color' | 'header_background_color' | 'card_color'
type TextField = 'program_eyebrow' | 'program_subtitle' | 'website_url'
type Colors = Record<ColorField, string | null>
type Texts = Record<TextField, string>

export const COLORS: { field: ColorField; label: string; fallback: string }[] = [
  { field: 'background_color', label: 'Hintergrund', fallback: '#F5F7FB' },
  { field: 'text_color', label: 'Text', fallback: '#172039' },
  { field: 'accent_color', label: 'Akzent', fallback: '#4569DD' },
  { field: 'header_background_color', label: 'Kopfbereich', fallback: '#15213C' },
  { field: 'card_color', label: 'Session-Karten', fallback: '#E7EFFF' },
]

/**
 * Neutrale Farbvorlagen. Jede ist geprüft: Text und Akzent erreichen auf Hintergrund
 * und Karten mindestens 4,5:1 (siehe ProgramDesign.test.tsx).
 */
export const PALETTES: { name: string; colors: Record<ColorField, string> }[] = [
  { name: 'Blau', colors: { background_color: '#F5F7FB', text_color: '#172039', accent_color: '#3A5BC7', header_background_color: '#15213C', card_color: '#E7EFFF' } },
  { name: 'Creme und Petrol', colors: { background_color: '#FAF7F0', text_color: '#1D488B', accent_color: '#167B7B', header_background_color: '#FAF7F0', card_color: '#FFFFFF' } },
  { name: 'Salbei', colors: { background_color: '#F3F6F1', text_color: '#1F2D24', accent_color: '#2F6B3E', header_background_color: '#23382A', card_color: '#FFFFFF' } },
  { name: 'Terrakotta', colors: { background_color: '#FBF5F0', text_color: '#2E1E16', accent_color: '#A04516', header_background_color: '#3B241A', card_color: '#FFFFFF' } },
  { name: 'Graphit', colors: { background_color: '#F5F5F7', text_color: '#1C1C22', accent_color: '#6541B5', header_background_color: '#1C1C22', card_color: '#FFFFFF' } },
]

const IMAGE_TYPES = 'image/jpeg,image/png,image/webp'

/** Geplante Änderung an einem Bild; hochgeladen bzw. gelöscht wird erst beim Speichern. */
type ImageChange = { kind: 'keep' } | { kind: 'remove' } | { kind: 'upload'; file: File; preview: string }
const KEEP: ImageChange = { kind: 'keep' }

type PartnerDraft = { key: string; id: number | null; name: string; subtitle: string; url: string; imageUrl: string | null; image: ImageChange }
type BlockDraft = { key: string; id: number | null; title: string; body: string }
type ImageSlot = 'logo' | 'header' | 'footer'
type Draft = {
  colors: Colors
  texts: Texts
  images: Record<ImageSlot, ImageChange>
  partners: PartnerDraft[]
  blocks: BlockDraft[]
}

const IMAGE_SLOTS: { slot: ImageSlot; label: string; path: string; field: 'logo' | 'image'; url: (event: Event) => string | null | undefined }[] = [
  { slot: 'logo', label: 'Logo', path: 'logo', field: 'logo', url: event => event.logo_url },
  { slot: 'header', label: 'Kopfgrafik', path: 'graphics/header', field: 'image', url: event => event.header_graphic_url },
  { slot: 'footer', label: 'Fußgrafik', path: 'graphics/footer', field: 'image', url: event => event.footer_graphic_url },
]

function partnerDraft(partner: PartnerLogo): PartnerDraft {
  return { key: `p${partner.id}`, id: partner.id, name: partner.name, subtitle: partner.subtitle ?? '', url: partner.url ?? '', imageUrl: partner.image_url, image: KEEP }
}

function blockDraft(block: InfoBlock): BlockDraft {
  return { key: `b${block.id}`, id: block.id, title: block.title, body: block.body }
}

function fromEvent(event: Event): Draft {
  return {
    colors: Object.fromEntries(COLORS.map(({ field }) => [field, event[field] ?? null])) as Colors,
    texts: { program_eyebrow: event.program_eyebrow ?? '', program_subtitle: event.program_subtitle ?? '', website_url: event.website_url ?? '' },
    images: { logo: KEEP, header: KEEP, footer: KEEP },
    partners: (event.partner_logos ?? []).map(partnerDraft),
    blocks: (event.info_blocks ?? []).map(blockDraft),
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const partnerFields = (partner: PartnerDraft) => [partner.name, partner.subtitle, partner.url]
const blockFields = (block: BlockDraft) => [block.title, block.body]

/** Zählt die einzelnen ungespeicherten Änderungen des Entwurfs gegenüber dem gespeicherten Stand. */
export function countChanges(draft: Draft, saved: Draft): number {
  let count = 0
  for (const { field } of COLORS) if (draft.colors[field] !== saved.colors[field]) count++
  for (const field of Object.keys(draft.texts) as TextField[]) if (draft.texts[field] !== saved.texts[field]) count++
  for (const slot of Object.keys(draft.images) as ImageSlot[]) if (draft.images[slot].kind !== 'keep') count++
  count += countListChanges(draft.partners, saved.partners, (a, b) => same(partnerFields(a), partnerFields(b)) && a.image.kind === 'keep')
  count += countListChanges(draft.blocks, saved.blocks, (a, b) => same(blockFields(a), blockFields(b)))
  return count
}

function countListChanges<T extends { id: number | null }>(draft: T[], saved: T[], unchanged: (a: T, b: T) => boolean): number {
  const savedById = new Map(saved.map(item => [item.id, item]))
  const kept = draft.filter(item => item.id !== null && savedById.has(item.id))
  let count = draft.length - kept.length + saved.length - kept.length
  for (const item of kept) if (!unchanged(item, savedById.get(item.id)!)) count++
  const savedOrder = saved.map(item => item.id).filter(id => kept.some(item => item.id === id))
  if (!same(kept.map(item => item.id), savedOrder)) count++
  return count
}

function shownImage(change: ImageChange, saved: string | null | undefined): string | null {
  if (change.kind === 'upload') return change.preview
  return change.kind === 'remove' ? null : saved ?? null
}

function objectUrl(file: File): string {
  return typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : ''
}

function releaseUrl(change: ImageChange) {
  if (change.kind === 'upload' && change.preview && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(change.preview)
}

function moveItem<T>(items: T[], index: number, offset: number): T[] {
  const target = index + offset
  if (target < 0 || target >= items.length) return items
  const next = [...items]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

let nextKey = 0
const newKey = (prefix: string) => `${prefix}new${++nextKey}`

function ImageField({ label, savedUrl, change, alt, onChange }: {
  label: string
  savedUrl: string | null | undefined
  change: ImageChange
  alt: string
  onChange: (change: ImageChange) => void
}) {
  const url = shownImage(change, savedUrl)
  return <div className="design-image-field">
    <label>{label}<input type="file" accept={IMAGE_TYPES} onChange={event => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (file) onChange({ kind: 'upload', file, preview: objectUrl(file) })
    }} /></label>
    {change.kind === 'upload' && <small className="design-pending">Neu ausgewählt: {change.file.name}</small>}
    {change.kind === 'remove' && <small className="design-pending">Wird beim Speichern entfernt.</small>}
    {(url || change.kind !== 'keep') && <div className="event-logo-preview">
      {url && <img src={url} alt={alt} />}
      {change.kind !== 'keep' && <button type="button" className="text-button" onClick={() => onChange(KEEP)}>Rückgängig</button>}
      {url && change.kind !== 'remove' && savedUrl && <button type="button" className="text-button" onClick={() => onChange({ kind: 'remove' })}>{label} entfernen</button>}
    </div>}
  </div>
}

type Confirm = (options: ConfirmOptions) => Promise<boolean>

function RowActions({ name, first, last, onMove, onRemove }: {
  name: string; first: boolean; last: boolean; onMove: (offset: number) => void; onRemove: () => void
}) {
  return <div className="design-item-actions">
    <button type="button" className="icon-button" aria-label={`${name} nach oben`} disabled={first} onClick={() => onMove(-1)}><Icon name="arrow-up" /></button>
    <button type="button" className="icon-button" aria-label={`${name} nach unten`} disabled={last} onClick={() => onMove(1)}><Icon name="arrow-down" /></button>
    <button type="button" className="danger small" onClick={onRemove}>Löschen</button>
  </div>
}

/** Beispielkarten in typischen Zuständen, damit sich die Gestaltung realistisch beurteilen lässt. */
const SAMPLE_CATEGORY = [{ id: -1, name: 'Workshop', color: '#2F6B3E' }]
const notice = (type: ChangeNotice['type']): ChangeNotice => ({ type, expires_at: null, previous_start_time: '09:00:00', previous_end_time: '10:00:00', previous_room_name: null })
const SAMPLES: { title: string; time: string; speaker: string; notice?: ChangeNotice; categories?: typeof SAMPLE_CATEGORY }[] = [
  { title: 'Beispiel-Session', time: '10:00–11:00', speaker: 'Vorname Nachname' },
  { title: 'Mit Kategorie', time: '11:15–12:15', speaker: 'Vorname Nachname', categories: SAMPLE_CATEGORY },
  { title: 'Verschobene Session', time: '13:00–14:00', speaker: 'Vorname Nachname', notice: notice('rescheduled') },
  { title: 'Abgesagte Session', time: '14:15–15:15', speaker: 'Vorname Nachname', notice: notice('cancelled') },
]

export default function ProgramDesignEditor({ event, onChanged, onClose }: {
  event: Event
  onChanged: () => Promise<unknown>
  onClose: () => void
}) {
  const [draft, setDraft] = useState(() => fromEvent(event))
  const [resync, setResync] = useState(false)
  const [previewTheme, setPreviewTheme] = useState<'light' | 'dark'>('light')
  const [newPartner, setNewPartner] = useState('')
  const [newInfo, setNewInfo] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [askClose, setAskClose] = useState(false)
  const [confirm, confirmDialog] = useConfirm()
  const base = `/events/${event.id}`
  const saved = fromEvent(event)
  const changes = countChanges(draft, saved)
  const dirty = changes > 0

  // Beim Verlassen der Seite vor ungespeicherten Änderungen warnen.
  useEffect(() => {
    if (!dirty) return
    const warn = (unload: BeforeUnloadEvent) => { unload.preventDefault(); unload.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  // Nach dem Speichern den Entwurf auf den neu geladenen Stand setzen.
  useEffect(() => {
    if (!resync) return
    setDraft(fromEvent(event))
    setResync(false)
  }, [resync, event])

  // Vorschau-Adressen ausgewählter Bilder beim Schließen freigeben.
  const draftRef = useRef(draft)
  draftRef.current = draft
  useEffect(() => () => {
    const current = draftRef.current
    Object.values(current.images).forEach(releaseUrl)
    current.partners.forEach(partner => releaseUrl(partner.image))
  }, [])

  const { colors, texts } = draft
  const preview: Event = {
    ...event,
    ...colors,
    program_eyebrow: texts.program_eyebrow.trim() || null,
    program_subtitle: texts.program_subtitle.trim() || null,
    website_url: texts.website_url.trim() || null,
    logo_url: shownImage(draft.images.logo, event.logo_url),
    header_graphic_url: shownImage(draft.images.header, event.header_graphic_url),
    footer_graphic_url: shownImage(draft.images.footer, event.footer_graphic_url),
    partner_logos: draft.partners.filter(partner => partner.name.trim()).map((partner, index) => ({
      id: partner.id ?? -index - 1, name: partner.name, subtitle: partner.subtitle || null, url: partner.url || null,
      image_url: shownImage(partner.image, partner.imageUrl), sort_order: index,
    })),
    info_blocks: draft.blocks.filter(block => block.title.trim()).map((block, index) => ({ id: block.id ?? -index - 1, title: block.title, body: block.body, sort_order: index })),
  }
  const design = programDesign(preview, { force: true })
  const textContrast = contrastRatio(colors.text_color ?? '#172039', colors.background_color ?? '#F5F7FB')

  function update(change: (current: Draft) => Draft) {
    setMessage('')
    setDraft(change)
  }

  function setImage(slot: ImageSlot, change: ImageChange) {
    update(current => { releaseUrl(current.images[slot]); return { ...current, images: { ...current.images, [slot]: change } } })
  }

  function setPartner(key: string, change: Partial<PartnerDraft>) {
    update(current => ({ ...current, partners: current.partners.map(partner => {
      if (partner.key !== key) return partner
      if (change.image) releaseUrl(partner.image)
      return { ...partner, ...change }
    }) }))
  }

  function setBlock(key: string, change: Partial<BlockDraft>) {
    update(current => ({ ...current, blocks: current.blocks.map(block => block.key === key ? { ...block, ...change } : block) }))
  }

  function addPartner() {
    const name = newPartner.trim()
    if (!name) return
    update(current => ({ ...current, partners: [...current.partners, { key: newKey('p'), id: null, name, subtitle: '', url: '', imageUrl: null, image: KEEP }] }))
    setNewPartner('')
  }

  function addBlock() {
    const title = newInfo.trim()
    if (!title) return
    update(current => ({ ...current, blocks: [...current.blocks, { key: newKey('b'), id: null, title, body: '' }] }))
    setNewInfo('')
  }

  async function removePartner(partner: PartnerDraft, ask: Confirm) {
    if (partner.id !== null && !await ask({ title: 'Partner entfernen?', message: `„${partner.name}“ und sein Logo werden beim Speichern aus dem Besucherprogramm entfernt.`, confirmLabel: 'Partner entfernen' })) return
    releaseUrl(partner.image)
    update(current => ({ ...current, partners: current.partners.filter(item => item.key !== partner.key) }))
  }

  async function removeBlock(block: BlockDraft, ask: Confirm) {
    if (block.id !== null && !await ask({ title: 'Infoblock löschen?', message: `„${block.title}“ wird beim Speichern aus Besucherprogramm und PDF entfernt.`, confirmLabel: 'Infoblock löschen' })) return
    update(current => ({ ...current, blocks: current.blocks.filter(item => item.key !== block.key) }))
  }

  function discard() {
    Object.values(draft.images).forEach(releaseUrl)
    draft.partners.forEach(partner => releaseUrl(partner.image))
    setDraft(fromEvent(event))
    setNewPartner('')
    setNewInfo('')
    setError('')
    setMessage('')
  }

  async function applyImage(path: string, field: 'logo' | 'image', change: ImageChange) {
    if (change.kind === 'upload') await uploadImage(path, field, change.file)
    else if (change.kind === 'remove') await write('DELETE', path)
  }

  /**
   * Schreibt alle Änderungen nacheinander. Erledigte Schritte werden im Arbeitsstand
   * vermerkt, damit ein erneuter Versuch nach einem Fehler nichts doppelt anlegt.
   */
  async function persist(): Promise<boolean> {
    const work: Draft = { ...draft, images: { ...draft.images }, partners: draft.partners.map(partner => ({ ...partner })), blocks: draft.blocks.map(block => ({ ...block })) }
    const invalid = work.partners.find(partner => !partner.name.trim()) ?? work.blocks.find(block => !block.title.trim())
    if (invalid) {
      setError('Partner brauchen einen Namen und Infoblöcke einen Titel.')
      return false
    }
    setBusy(true)
    setError('')
    setMessage('')
    try {
      if (!same(work.colors, saved.colors) || !same(work.texts, saved.texts)) {
        await write('PATCH', base, {
          ...work.colors,
          program_eyebrow: work.texts.program_eyebrow || null,
          program_subtitle: work.texts.program_subtitle || null,
          website_url: work.texts.website_url || null,
        })
      }
      for (const { slot, path, field } of IMAGE_SLOTS) {
        await applyImage(`${base}/${path}`, field, work.images[slot])
        work.images[slot] = KEEP
      }

      const savedPartners = new Map(saved.partners.map(partner => [partner.id, partner]))
      for (const partner of saved.partners) {
        if (!work.partners.some(item => item.id === partner.id)) await write('DELETE', `${base}/partner-logos/${partner.id}`)
      }
      for (const partner of work.partners) {
        const fields = { name: partner.name.trim(), subtitle: partner.subtitle.trim() || null, url: partner.url.trim() || null }
        if (partner.id === null) {
          partner.id = (await write<PartnerLogo>('POST', `${base}/partner-logos`, fields)).id
        } else {
          const before = savedPartners.get(partner.id)
          if (before && !same(partnerFields(partner), partnerFields(before))) await write('PATCH', `${base}/partner-logos/${partner.id}`, fields)
        }
        await applyImage(`${base}/partner-logos/${partner.id}/image`, 'image', partner.image)
        if (partner.image.kind !== 'keep') partner.imageUrl = partner.image.kind === 'remove' ? null : `/api${base}/partner-logos/${partner.id}/image`
        partner.image = KEEP
      }
      const partnerIds = work.partners.map(partner => partner.id!)
      if (!same(partnerIds, saved.partners.map(partner => partner.id!).filter(id => partnerIds.includes(id)).concat(partnerIds.filter(id => !savedPartners.has(id))))) {
        await write('PUT', `${base}/partner-logos/order`, { ids: partnerIds })
      }

      const savedBlocks = new Map(saved.blocks.map(block => [block.id, block]))
      for (const block of saved.blocks) {
        if (!work.blocks.some(item => item.id === block.id)) await write('DELETE', `${base}/info-blocks/${block.id}`)
      }
      for (const block of work.blocks) {
        const fields = { title: block.title.trim(), body: block.body }
        if (block.id === null) {
          block.id = (await write<InfoBlock>('POST', `${base}/info-blocks`, fields)).id
        } else {
          const before = savedBlocks.get(block.id)
          if (before && !same(blockFields(block), blockFields(before))) await write('PATCH', `${base}/info-blocks/${block.id}`, fields)
        }
      }
      const blockIds = work.blocks.map(block => block.id!)
      if (!same(blockIds, saved.blocks.map(block => block.id!).filter(id => blockIds.includes(id)).concat(blockIds.filter(id => !savedBlocks.has(id))))) {
        await write('PUT', `${base}/info-blocks/order`, { ids: blockIds })
      }

      await onChanged()
      setResync(true)
      setMessage('Alle Änderungen gespeichert.')
      return true
    } catch (cause) {
      setDraft(work)
      setError(`Nicht alles wurde gespeichert: ${(cause as Error).message}`)
      await onChanged().catch(() => {})
      return false
    } finally {
      setBusy(false)
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!busy) void persist()
  }

  function requestClose() {
    if (busy) return
    if (dirty) setAskClose(true)
    else onClose()
  }

  function addOnEnter(add: () => void) {
    return (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== 'Enter') return
      event.preventDefault()
      add()
    }
  }

  return <Dialog className="design-dialog" label="Besucherprogramm gestalten" closeOnBackdrop={false} closeDisabled={busy} onClose={requestClose}>
    <div className="editor-heading"><h2>Besucherprogramm gestalten</h2><button type="button" className="text-button" onClick={requestClose}>Schließen</button></div>
    <div className="design-layout">
      <form className="design-settings" id="design-form" aria-label="Gestaltung" onSubmit={submit}>
        <fieldset><legend>Farben</legend>
          <p className="muted">Ohne eigene Farbe gilt das Standarddesign. Für den Dunkelmodus werden die Farben automatisch abgedunkelt; zu schwacher Kontrast wird ausgeglichen.</p>
          <div className="design-palettes" role="group" aria-label="Farbvorlagen">
            <span className="design-palettes-label">Vorlage übernehmen</span>
            {PALETTES.map(palette => <button key={palette.name} type="button" className="design-palette" aria-label={`Vorlage ${palette.name}`}
              onClick={() => update(current => ({ ...current, colors: { ...palette.colors } }))}>
              <span className="design-palette-swatches" aria-hidden="true">
                {COLORS.map(({ field }) => <span key={field} style={{ backgroundColor: palette.colors[field] }} />)}
              </span>
              {palette.name}
            </button>)}
          </div>
          {COLORS.map(({ field, label, fallback }) => <div className="design-color" key={field}>
            <label className="cancel-checkbox"><input type="checkbox" checked={colors[field] !== null} onChange={change => update(current => ({ ...current, colors: { ...current.colors, [field]: change.target.checked ? current.colors[field] ?? fallback : null } }))} />{label}</label>
            {colors[field] !== null && <input type="color" aria-label={`Farbe ${label}`} value={colors[field] ?? fallback} onChange={change => update(current => ({ ...current, colors: { ...current.colors, [field]: change.target.value.toUpperCase() } }))} />}
          </div>)}
          <p className={`muted${textContrast < 4.5 ? ' design-warning' : ''}`}>Kontrast Text zu Hintergrund: {textContrast.toFixed(1).replace('.', ',')}:1{textContrast < 4.5 ? ' – zu schwach, die Textfarbe wird automatisch angepasst.' : ''}</p>
        </fieldset>

        <fieldset><legend>Kopfbereich</legend>
          {(Object.entries({ program_eyebrow: ['Überschrift', 60, 'VERANSTALTUNGSPROGRAMM'], program_subtitle: ['Untertitel', 160, 'Zeitraum der Veranstaltung'], website_url: ['Webadresse', 255, 'https://'] }) as [TextField, [string, number, string]][])
            .map(([field, [label, maxLength, placeholder]]) => <label key={field}>{label}<input type={field === 'website_url' ? 'url' : 'text'} maxLength={maxLength} placeholder={placeholder} value={texts[field]}
              onChange={change => update(current => ({ ...current, texts: { ...current.texts, [field]: change.target.value } }))} /></label>)}
        </fieldset>

        <fieldset><legend>Grafiken</legend>
          <p className="muted">JPEG, PNG oder WebP bis 5 MB.</p>
          {IMAGE_SLOTS.map(({ slot, label, url }) => <ImageField key={slot} label={label} savedUrl={url(event)} change={draft.images[slot]}
            alt={slot === 'logo' ? `Logo von ${event.name}` : label} onChange={change => setImage(slot, change)} />)}
        </fieldset>

        <fieldset><legend>Partnerlogos</legend>
          <ul className="design-list">{draft.partners.map((partner, index) => <li className="design-list-item" key={partner.key}>
            <div role="group" aria-label={`Partner ${partner.name || 'ohne Namen'}`}>
              <label>Name<input required maxLength={120} value={partner.name} onChange={change => setPartner(partner.key, { name: change.target.value })} /></label>
              <label>Untertitel<input maxLength={160} value={partner.subtitle} onChange={change => setPartner(partner.key, { subtitle: change.target.value })} /></label>
              <label>Link<input type="url" maxLength={255} placeholder="https://" value={partner.url} onChange={change => setPartner(partner.key, { url: change.target.value })} /></label>
              <ImageField label="Partnerlogo" savedUrl={partner.imageUrl} change={partner.image} alt={`Logo von ${partner.name}`} onChange={image => setPartner(partner.key, { image })} />
              <RowActions name={partner.name} first={index === 0} last={index === draft.partners.length - 1}
                onMove={offset => update(current => ({ ...current, partners: moveItem(current.partners, index, offset) }))}
                onRemove={() => void removePartner(partner, confirm)} />
            </div>
          </li>)}</ul>
          <div className="management-form">
            <label>Neuer Partner<input maxLength={120} value={newPartner} onChange={change => setNewPartner(change.target.value)} onKeyDown={addOnEnter(addPartner)} /></label>
            <button type="button" className="secondary" disabled={!newPartner.trim()} onClick={addPartner}>Partner hinzufügen</button>
          </div>
        </fieldset>

        <fieldset><legend>Infoblöcke</legend>
          <p className="muted">Erscheinen unter dem Programm und als eigene Seite im PDF.</p>
          <ul className="design-list">{draft.blocks.map((block, index) => <li className="design-list-item" key={block.key}>
            <div role="group" aria-label={`Infoblock ${block.title || 'ohne Titel'}`}>
              <label>Titel<input required maxLength={120} value={block.title} onChange={change => setBlock(block.key, { title: change.target.value })} /></label>
              <label>Text<textarea maxLength={4000} rows={3} value={block.body} onChange={change => setBlock(block.key, { body: change.target.value })} /></label>
              <RowActions name={block.title} first={index === 0} last={index === draft.blocks.length - 1}
                onMove={offset => update(current => ({ ...current, blocks: moveItem(current.blocks, index, offset) }))}
                onRemove={() => void removeBlock(block, confirm)} />
            </div>
          </li>)}</ul>
          <div className="management-form">
            <label>Neuer Infoblock<input maxLength={120} placeholder="z. B. Gut zu wissen" value={newInfo} onChange={change => setNewInfo(change.target.value)} onKeyDown={addOnEnter(addBlock)} /></label>
            <button type="button" className="secondary" disabled={!newInfo.trim()} onClick={addBlock}>Infoblock hinzufügen</button>
          </div>
        </fieldset>
      </form>

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
              <div className="design-preview-slots">
                {SAMPLES.map(sample => <div key={sample.title} className={`design-preview-slot public-slot${sample.notice ? ` notice-${sample.notice.type}` : ''}`}>
                  <CategoryStripe categories={sample.categories} />
                  <strong>{sample.title}</strong>
                  <span className="public-slot-time">{sample.time}</span>
                  <small>{sample.speaker}</small>
                  {(sample.notice || sample.categories) && <span className="public-slot-meta">
                    {sample.notice && <NoticeBadge notice={sample.notice} />}
                    <CategoryLabels categories={sample.categories} />
                  </span>}
                </div>)}
              </div>
              <a className="program-link" href="#vorschau">PDF-Programm herunterladen</a>
            </main>
            <PublicFooter event={preview} />
          </div>
        </div>
      </div>
    </div>

    <div className="design-savebar" role="region" aria-label="Speicherstatus">
      <span className="design-savebar-status" aria-live="polite">
        {error ? <InlineMessage tone="error">{error}</InlineMessage>
          : changes > 0 ? <span className="unsaved-badge">{changes === 1 ? '1 ungespeicherte Änderung' : `${changes} ungespeicherte Änderungen`}</span>
            : message ? <InlineMessage tone="success">{message}</InlineMessage>
              : <span className="muted">Alles gespeichert</span>}
      </span>
      <div className="design-savebar-actions">
        <button type="button" className="secondary" disabled={busy || changes === 0} onClick={discard}>Verwerfen</button>
        <button type="submit" form="design-form" className="primary" disabled={busy || changes === 0}>{busy ? 'Speichert …' : 'Änderungen speichern'}</button>
      </div>
    </div>
    {askClose && <UnsavedChangesDialog
      onSave={async () => { if (await persist()) { setAskClose(false); onClose() } }}
      onDiscard={() => { setAskClose(false); discard(); onClose() }}
      onCancel={() => setAskClose(false)} />}
    {confirmDialog}
  </Dialog>
}
