import type { ReactNode } from 'react'

export type MessageTone = 'info' | 'success' | 'warning' | 'error'

/** Message next to the form or action it belongs to. Errors are announced at once, the rest politely. */
export default function InlineMessage({ tone = 'info', className, children }: { tone?: MessageTone; className?: string; children: ReactNode }) {
  return <p className={`inline-message inline-message-${tone}${className ? ` ${className}` : ''}`} role={tone === 'error' ? 'alert' : 'status'}>{children}</p>
}
