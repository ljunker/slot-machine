import { useState } from 'react'
import Icon from './Icon'
import type { IconName } from './Icon'
import { ZOOM_LEVELS } from './time'

const LEGEND_KEY = 'slot-machine-plan-legend-open'
const HINTS_KEY = 'slot-machine-plan-hints-seen'
const ZOOM_KEY = 'slot-machine-plan-zoom'

function readStorage(key: string): string | null {
  try { return window.localStorage.getItem(key) } catch { return null }
}

function writeStorage(key: string, value: string) {
  try { window.localStorage.setItem(key, value) } catch { /* Speicher gesperrt: Zustand gilt nur bis zum Neuladen */ }
}

/** Zoomstufe des Rasters, pro Browser gemerkt. */
export function usePlanZoom(): [number, (value: number) => void] {
  const [zoom, setZoom] = useState<number>(() => {
    const stored = Number(readStorage(ZOOM_KEY))
    return (ZOOM_LEVELS as readonly number[]).includes(stored) ? stored : ZOOM_LEVELS[0]
  })
  return [zoom, value => { setZoom(value); writeStorage(ZOOM_KEY, String(value)) }]
}

type Entry = { swatch: string; icon: IconName; label: string; text: string }

const PROGRAM_ENTRIES: Entry[] = [
  { swatch: 'collision', icon: 'conflict', label: 'Raumkonflikt', text: 'Sessions überschneiden sich im selben Raum' },
  { swatch: 'speaker-conflict', icon: 'user', label: 'Rednerkonflikt', text: 'Redner ist gleichzeitig eingeplant (gestrichelter Rahmen)' },
  { swatch: 'notice-rescheduled', icon: 'moved', label: 'Verschoben', text: 'nach der Veröffentlichung verlegt' },
  { swatch: 'notice-updated', icon: 'changed', label: 'Geändert', text: 'Inhalt nach der Veröffentlichung geändert' },
  { swatch: 'notice-cancelled', icon: 'cancelled', label: 'Abgesagt', text: 'findet nicht statt' },
]

const DUTY_ENTRIES: Entry[] = [
  { swatch: 'duty-open', icon: 'warning', label: 'Offener Dienst', text: 'es fehlen noch Helfer' },
  { swatch: 'helper-conflict', icon: 'users', label: 'Helferkonflikt', text: 'Helfer ist gleichzeitig eingeteilt' },
]

/**
 * Leiste über dem Raster: einklappbare Legende der Zustände, Zoom und ein einmaliger
 * Bedienhinweis für alle, die planen dürfen.
 */
export default function PlanLegend({ canPlan, zoom, onZoom }: { canPlan: boolean; zoom: number; onZoom: (value: number) => void }) {
  const [open, setOpen] = useState(() => readStorage(LEGEND_KEY) === 'true')
  const [hintsSeen, setHintsSeen] = useState(() => readStorage(HINTS_KEY) === 'true')
  const zoomIndex = Math.max(0, (ZOOM_LEVELS as readonly number[]).indexOf(zoom))

  function dismissHints() {
    setHintsSeen(true)
    writeStorage(HINTS_KEY, 'true')
  }

  return <div className="plan-toolbar">
    <details className="plan-legend" open={open} onToggle={event => {
      const next = event.currentTarget.open
      setOpen(next)
      writeStorage(LEGEND_KEY, String(next))
    }}>
      <summary><Icon name="info" />Legende</summary>
      <div className="plan-legend-body">
        <ul aria-label="Programm">
          {PROGRAM_ENTRIES.map(entry => <li key={entry.label}>
            <span className={`legend-swatch ${entry.swatch}`} aria-hidden="true"><Icon name={entry.icon} size={13} /></span>
            <span><strong>{entry.label}</strong> – {entry.text}</span>
          </li>)}
        </ul>
        <ul aria-label="Dienste">
          {DUTY_ENTRIES.map(entry => <li key={entry.label}>
            <span className={`legend-swatch ${entry.swatch}`} aria-hidden="true"><Icon name={entry.icon} size={13} /></span>
            <span><strong>{entry.label}</strong> – {entry.text}</span>
          </li>)}
          <li><span className="legend-swatch legend-category" aria-hidden="true" /><span><strong>Farbstreifen oben</strong> – Kategorien der Session</span></li>
        </ul>
        {canPlan && <p className="plan-legend-hints">
          Karte anklicken zum Bearbeiten · am Titel ziehen zum Verschieben · untere Kante ziehen für die Dauer · Dienste lassen sich in ihrer Spalte seitlich anordnen.
          Kurze Sessions zeigen weniger Angaben; alle Details stehen im Tooltip.
        </p>}
      </div>
    </details>
    <div className="plan-zoom" role="group" aria-label="Rasterhöhe">
      <button type="button" className="icon-button" aria-label="Raster verkleinern" disabled={zoomIndex === 0} onClick={() => onZoom(ZOOM_LEVELS[zoomIndex - 1])}><Icon name="zoom-out" /></button>
      <span className="plan-zoom-value" aria-live="polite">{Math.round(zoom / ZOOM_LEVELS[0] * 100)} %</span>
      <button type="button" className="icon-button" aria-label="Raster vergrößern" disabled={zoomIndex === ZOOM_LEVELS.length - 1} onClick={() => onZoom(ZOOM_LEVELS[zoomIndex + 1])}><Icon name="zoom-in" /></button>
    </div>
    {canPlan && !hintsSeen && <div className="plan-hint-popover" role="note" aria-label="Bedienhinweis">
      <Icon name="info" size={18} />
      <p><strong>So bedienst du den Plan:</strong> Karte anklicken zum Bearbeiten, am Titel ziehen zum Verschieben, untere Kante ziehen für die Dauer. Die Legende erklärt Farben und Symbole.</p>
      <button type="button" className="secondary small" onClick={dismissHints}>Verstanden</button>
    </div>}
  </div>
}
