/**
 * Bequemlichkeits-Zustände pro Browser (eingeklappte Abschnitte, Zoom, Toggles).
 * Ist der Speicher gesperrt, gilt der Zustand nur bis zum Neuladen.
 */
export function readStorage(key: string): string | null {
  try { return window.localStorage.getItem(key) } catch { return null }
}

export function writeStorage(key: string, value: string) {
  try { window.localStorage.setItem(key, value) } catch { /* Speicher gesperrt */ }
}
