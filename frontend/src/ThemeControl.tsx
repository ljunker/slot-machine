import { useEffect, useId, useState } from 'react'

type Preference = 'system' | 'light' | 'dark'
const storageKey = 'slot-machine-theme'
const options: { value: Preference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Hell' },
  { value: 'dark', label: 'Dunkel' },
]

function ThemeIcon({ value }: { value: Preference }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {value === 'system' && <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8m-4-4v4" /></>}
    {value === 'light' && <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>}
    {value === 'dark' && <path d="M20.5 13A8.5 8.5 0 0 1 11 3.5 8.5 8.5 0 1 0 20.5 13Z" />}
  </svg>
}

function storedPreference(): Preference {
  try {
    const value = window.localStorage.getItem(storageKey)
    return value === 'light' || value === 'dark' ? value : 'system'
  } catch {
    return 'system'
  }
}

function applyTheme(preference: Preference) {
  const dark = preference === 'dark' || (preference === 'system' && (window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false))
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
}

export default function ThemeControl({ variant = 'select' }: { variant?: 'select' | 'segmented' }) {
  const [preference, setPreference] = useState<Preference>(storedPreference)
  const groupName = useId()

  useEffect(() => {
    applyTheme(preference)
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    const onMediaChange = () => { if (preference === 'system') applyTheme(preference) }
    const onStorageChange = (event: StorageEvent) => {
      if (event.key === storageKey || event.key === null) setPreference(storedPreference())
    }
    media?.addEventListener('change', onMediaChange)
    window.addEventListener('storage', onStorageChange)
    return () => {
      media?.removeEventListener('change', onMediaChange)
      window.removeEventListener('storage', onStorageChange)
    }
  }, [preference])

  function choose(value: Preference) {
    setPreference(value)
    applyTheme(value)
    try {
      if (value === 'system') window.localStorage.removeItem(storageKey)
      else window.localStorage.setItem(storageKey, value)
    } catch { /* Theme still applies for this page. */ }
  }

  if (variant === 'segmented') return <div className="theme-control theme-control--segmented" role="radiogroup" aria-label="Darstellung">
    {options.map(option => <label key={option.value} className="theme-option" title={option.label}>
      <input type="radio" name={groupName} value={option.value} aria-label={option.label} checked={preference === option.value} onChange={() => choose(option.value)} />
      <span className="theme-option-icon"><ThemeIcon value={option.value} /></span>
    </label>)}
  </div>

  return <label className="theme-control">Darstellung
    <select aria-label="Darstellung" value={preference} onChange={event => choose(event.target.value as Preference)}>
      <option value="system">System</option>
      <option value="light">Hell</option>
      <option value="dark">Dunkel</option>
    </select>
  </label>
}
