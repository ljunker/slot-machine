import Icon from './Icon'
import type { IconName } from './Icon'
import { noticeLabel } from './changeNotice'
import type { ChangeNotice } from './types'

const NOTICE_ICONS: Record<ChangeNotice['type'], IconName> = { rescheduled: 'moved', updated: 'changed', cancelled: 'cancelled' }

/** Icon zur Änderungsmarkierung, damit „Verschoben“, „Geändert“ und „Abgesagt“ nicht nur über die Farbe erkennbar sind. */
export function NoticeIcon({ notice, size = 13 }: { notice: ChangeNotice; size?: number }) {
  return <Icon name={NOTICE_ICONS[notice.type]} size={size} />
}

export default function NoticeBadge({ notice }: { notice: ChangeNotice }) {
  return <span className="change-badge"><NoticeIcon notice={notice} />{noticeLabel(notice)}</span>
}
