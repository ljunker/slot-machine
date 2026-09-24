import { useEffect, useState } from 'react'

type Preference = 'system' | 'light' | 'dark'
const storageKey = 'slot-machine-theme'

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

export default function ThemeControl() {
  const [preference, setPreference] = useState<Preference>(storedPreference)

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

  return <label className="theme-control">Darstellung
    <select aria-label="Darstellung" value={preference} onChange={event => choose(event.target.value as Preference)}>
      <option value="system">System</option>
      <option value="light">Hell</option>
      <option value="dark">Dunkel</option>
    </select>
  </label>
}
