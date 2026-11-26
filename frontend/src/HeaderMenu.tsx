import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import Icon from './Icon'
import type { IconName } from './Icon'

export type HeaderMenuAction = {
  label: string
  onClick?: () => void
  /** Renders the entry as a link instead of a button. */
  href?: string
  download?: boolean
  disabled?: boolean
  separatorBefore?: boolean
  icon?: IconName
}

export default function HeaderMenu({ actions, label = 'Menü', panelLabel = 'Header-Aktionen', triggerClassName = 'header-secondary', align = 'right', labelHidden = false, leading }: {
  actions: HeaderMenuAction[]
  label?: string
  panelLabel?: string
  triggerClassName?: string
  align?: 'left' | 'right'
  /** Zeigt die Beschriftung nur für Screenreader (z. B. neben einem Avatar). */
  labelHidden?: boolean
  /** Inhalt vor der Beschriftung, z. B. ein Avatar. */
  leading?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  return <div className="header-menu" ref={root} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
  }} onKeyDown={event => {
    if (event.key !== 'Escape' || !open) return
    event.preventDefault()
    event.stopPropagation()
    setOpen(false)
    trigger.current?.focus()
  }}>
    <button ref={trigger} type="button" className={triggerClassName} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(value => !value)}>
      {leading}{labelHidden ? <span className="visually-hidden">{label}</span> : label} <Icon name="chevron-down" className="header-menu-chevron" />
    </button>
    <div id={panelId} className={`header-menu-panel${align === 'left' ? ' header-menu-panel-left' : ''}`} role="group" aria-label={panelLabel} hidden={!open}>
      {actions.map(action => {
        const className = `header-menu-action${action.separatorBefore ? ' header-menu-separated' : ''}`
        const content = <>{action.icon && <Icon name={action.icon} />}{action.label}</>
        if (action.href) return <a key={action.label} className={className} href={action.href} download={action.download || undefined} onClick={() => setOpen(false)}>{content}</a>
        return <button key={action.label} type="button" className={className} disabled={action.disabled} onClick={() => {
          setOpen(false)
          trigger.current?.focus()
          action.onClick?.()
        }}>{content}</button>
      })}
    </div>
  </div>
}
