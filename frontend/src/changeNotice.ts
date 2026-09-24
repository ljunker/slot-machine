import { useEffect, useState } from 'react'
import type { ChangeNotice } from './types'

type NoticeSlot = { change_notice: ChangeNotice | null }

export function activeNotice(slot: NoticeSlot, now: number): ChangeNotice | null {
  const notice = slot.change_notice
  return notice && (notice.expires_at === null || notice.expires_at * 1000 > now) ? notice : null
}

export function noticeLabel(notice: ChangeNotice): string {
  return { rescheduled: 'Verschoben', updated: 'Geändert', cancelled: 'Abgesagt' }[notice.type]
}

export function previousPlanning(notice: ChangeNotice): string | null {
  if (notice.type !== 'rescheduled') return null
  const time = notice.previous_start_time && notice.previous_end_time
    ? `${notice.previous_start_time.slice(0, 5)}–${notice.previous_end_time.slice(0, 5)} Uhr`
    : null
  return [time, notice.previous_room_name].filter(Boolean).join(' · ') || null
}

export function useNoticeNow(slots: NoticeSlot[]): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const next = slots.map(slot => slot.change_notice?.expires_at).filter((value): value is number => value !== null && value !== undefined)
      .map(value => value * 1000).filter(value => value > now).sort((a, b) => a - b)[0]
    if (next === undefined) return
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(1, next - Date.now() + 1))
    return () => window.clearTimeout(timer)
  }, [slots, now])
  return now
}
