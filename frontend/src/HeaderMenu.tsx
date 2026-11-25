import { useEffect, useId, useRef, useState } from 'react'

export type HeaderMenuAction = {
  label: string
  onClick?: () => void
  /** Renders the entry as a link instead of a button. */
  href?: string
  download?: boolean
  disabled?: boolean
  separatorBefore?: boolean
}

export default function HeaderMenu({ actions, label = 'Menü', panelLabel = 'Header-Aktionen', triggerClassName = 'header-secondary', align = 'right' }: {
  actions: HeaderMenuAction[]
  label?: string
  panelLabel?: string
  triggerClassName?: string
  align?: 'left' | 'right'
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
      {label} <svg className="header-menu-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
    </button>
    <div id={panelId} className={`header-menu-panel${align === 'left' ? ' header-menu-panel-left' : ''}`} role="group" aria-label={panelLabel} hidden={!open}>
      {actions.map(action => {
        const className = `header-menu-action${action.separatorBefore ? ' header-menu-separated' : ''}`
        if (action.href) return <a key={action.label} className={className} href={action.href} download={action.download || undefined} onClick={() => setOpen(false)}>{action.label}</a>
        return <button key={action.label} type="button" className={className} disabled={action.disabled} onClick={() => {
          setOpen(false)
          trigger.current?.focus()
          action.onClick?.()
        }}>{action.label}</button>
      })}
    </div>
  </div>
}
