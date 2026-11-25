import { useId, useState } from 'react'

const EYE = <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
const PUPIL = <circle cx="12" cy="12" r="3" />
const SLASH = <path d="m3 3 18 18" />

/** Password input with a show/hide toggle and an optional hint below it. */
export default function PasswordField({ label, value, onChange, autoComplete, minLength, maxLength = 1024, required = true, disabled, hint, autoFocus }: {
  label: string
  value: string
  onChange: (value: string) => void
  autoComplete: 'current-password' | 'new-password'
  minLength?: number
  maxLength?: number
  required?: boolean
  disabled?: boolean
  hint?: string
  autoFocus?: boolean
}) {
  const id = useId()
  const hintId = useId()
  const [visible, setVisible] = useState(false)
  return <div className="field password-field">
    <label htmlFor={id}>{label}</label>
    <div className="password-input">
      <input id={id} type={visible ? 'text' : 'password'} required={required} minLength={minLength} maxLength={maxLength}
        autoComplete={autoComplete} autoFocus={autoFocus} aria-describedby={hint ? hintId : undefined}
        value={value} disabled={disabled} onChange={event => onChange(event.target.value)} />
      <button type="button" className="password-toggle" aria-label="Klartext anzeigen" aria-controls={id} aria-pressed={visible}
        disabled={disabled} onClick={() => setVisible(current => !current)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{EYE}{PUPIL}{visible && SLASH}</svg>
      </button>
    </div>
    {hint && <small id={hintId} className="field-hint">{hint}</small>}
  </div>
}
