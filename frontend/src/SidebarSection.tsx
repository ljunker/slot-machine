import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import Icon from './Icon'
import { readStorage, writeStorage } from './storage'

const COLLAPSED_KEY = 'slot-machine-sidebar-collapsed'

/** Ab so vielen Einträgen bekommt eine Liste in der Seitenleiste ein Suchfeld. */
export const SEARCH_THRESHOLD = 10

/** Eingeklappte Abschnitte der Seitenleiste, pro Browser gemerkt. */
export function useCollapsedSections(): [Set<string>, (id: string) => void] {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      const stored: unknown = JSON.parse(readStorage(COLLAPSED_KEY) ?? '[]')
      return new Set(Array.isArray(stored) ? stored.filter((item): item is string => typeof item === 'string') : [])
    } catch { return new Set() }
  })
  function toggle(id: string) {
    setCollapsed(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      writeStorage(COLLAPSED_KEY, JSON.stringify([...next]))
      return next
    })
  }
  return [collapsed, toggle]
}

/** Abschnitt der Seitenleiste: Überschrift klappt ein und aus, rechts daneben eine optionale Aktion. */
export function SidebarSection({ title, count, collapsed, onToggle, action, children }: {
  title: string
  count?: number
  collapsed: boolean
  onToggle: () => void
  action?: ReactNode
  children: ReactNode
}) {
  const bodyId = useId()
  return <section className={`sidebar-section${collapsed ? ' collapsed' : ''}`}>
    <div className="section-heading">
      <h2><button type="button" className="section-toggle" aria-expanded={!collapsed} aria-controls={bodyId} onClick={onToggle}>
        <Icon name="chevron-down" className="section-chevron" size={14} />{title}{count !== undefined && <span className="section-count"> ({count})</span>}
      </button></h2>
      {action}
    </div>
    <div id={bodyId} className="section-body" hidden={collapsed}>{children}</div>
  </section>
}

/** Suchfeld für lange Listen in der Seitenleiste. */
export function SidebarSearch({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <input type="search" className="sidebar-search" aria-label={label} placeholder="Suchen …" value={value} onChange={event => onChange(event.target.value)} />
}

/** Vergleicht ohne Rücksicht auf Groß- und Kleinschreibung. */
export function matches(query: string, ...texts: (string | null | undefined)[]): boolean {
  const needle = query.trim().toLocaleLowerCase('de')
  return !needle || texts.some(text => text?.toLocaleLowerCase('de').includes(needle))
}
