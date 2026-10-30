import { useEffect, useId, useRef, useState } from 'react'

export type HeaderMenuAction = {
  label: string
  onClick: () => void
  disabled?: boolean
  separatorBefore?: boolean
}

export default function HeaderMenu({ actions }: { actions: HeaderMenuAction[] }) {
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
    <button ref={trigger} type="button" className="header-secondary" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(value => !value)}>
      Menü <svg className="header-menu-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
    </button>
    <div id={panelId} className="header-menu-panel" role="group" aria-label="Header-Aktionen" hidden={!open}>
      {actions.map(action => <button key={action.label} type="button" className={`header-menu-action${action.separatorBefore ? ' header-menu-separated' : ''}`} disabled={action.disabled} onClick={() => {
        setOpen(false)
        trigger.current?.focus()
        action.onClick()
      }}>{action.label}</button>)}
    </div>
  </div>
}
