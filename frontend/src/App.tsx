import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import { request, uploadImage, write } from './api'
import ProgramDesignEditor from './ProgramDesignEditor'
import Editor from './Editor'
import type { EditorKind } from './Editor'
import DutyEditor from './DutyEditor'
import { DutyDetails, SlotDetails } from './ReadOnlyDetails'
import ConflictOverview from './ConflictOverview'
import Dashboard from './Dashboard'
import Schedule from './Schedule'
import PlanLegend, { usePlanZoom } from './PlanLegend'
import Icon from './Icon'
import type { DutyPatch } from './Schedule'
import SpeakerEditor from './SpeakerEditor'
import CategoryEditor from './CategoryEditor'
import CategoryLabels from './CategoryLabels'
import ThemeControl from './ThemeControl'
import HeaderMenu from './HeaderMenu'
import type { HeaderMenuAction } from './HeaderMenu'
import BackupRestore from './BackupRestore'
import AccountDialog from './AccountDialog'
import { TeamManagement, UserManagement } from './TeamManagement'
import type { Category, CurrentUser, DaySchedule, Duty, Event, EventDay, DutyParticipant, HelperPlan, Room, Slot, Speaker, UnplannedSession } from './types'
import { SNAP_MINUTES, toMinutes, toTime } from './time'
import { formatDate, formatWeekdayDate } from './date'
import { pageTitle, usePageTitle } from './pageTitle'
import UndoToast from './UndoToast'
import { ToastRegion, useToasts } from './Toast'
import { useConfirm } from './Dialog'
import UnsavedChangesDialog from './UnsavedChangesDialog'
import { UnsavedChangesProvider } from './unsavedChanges'
import type { UnsavedEditor } from './unsavedChanges'
import type { UndoEntry } from './UndoToast'
import { applyDutyOrder, applyDutyPatch, applySlotPatch } from './optimistic'
import type { SlotPositionPatch } from './optimistic'

type Panel = { kind: EditorKind | 'speaker' | 'category' | 'duty'; id: number | null; createUnplanned?: boolean }
type BacklogPreview = { roomId: number | null; start: number; topic: string }

/** Initialen für den Avatar im Kopfbereich, z. B. „Ada Müller“ → „AM“. */
function initials(name: string | null | undefined, email: string): string {
  const parts = (name || email.split('@')[0]).split(/[\s._-]+/).filter(Boolean)
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? '?').slice(0, 2)).toUpperCase()
}

const PANEL_NAMES: Record<Panel['kind'], string> = {
  event: 'Veranstaltung', day: 'Tag', room: 'Raum', slot: 'Slot', speaker: 'Rednerprofil', category: 'Kategorie', duty: 'Dienst',
}

export default function App({ currentUser, onLogout, onProfileChange, onPasswordChanged }: {
  currentUser: CurrentUser
  onLogout?: () => void
  onProfileChange?: (user: CurrentUser) => void
  onPasswordChanged?: () => void
}) {
  const [events, setEvents] = useState<Event[]>([])
  const [eventId, setEventId] = useState<number | null>(null)
  const [days, setDays] = useState<EventDay[]>([])
  const [dayId, setDayId] = useState<number | null>(null)
  const [rooms, setRooms] = useState<Room[]>([])
  const [speakers, setSpeakers] = useState<Speaker[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [helpers, setHelpers] = useState<DutyParticipant[]>([])
  const [helperPlan, setHelperPlan] = useState<HelperPlan>({ duties: [], conflicts: [] })
  const [schedule, setSchedule] = useState<DaySchedule | null>(null)
  const [view, setView] = useState<'schedule' | 'helpers' | 'conflicts' | 'dashboard'>('schedule')
  const [overviewSchedules, setOverviewSchedules] = useState<DaySchedule[] | null>(null)
  const [overviewError, setOverviewError] = useState('')
  const [dashboardDayId, setDashboardDayId] = useState<number | null>(null)
  const [loadError, setLoadError] = useState('')
  const [unplanned, setUnplanned] = useState<UnplannedSession[]>([])
  const [backlogPreview, setBacklogPreview] = useState<BacklogPreview | null>(null)
  const [panel, setPanel] = useState<Panel | null>(null)
  const toast = useToasts()
  const showToast = toast.show
  const [confirm, confirmDialog] = useConfirm()
  /** Errors appear as a toast that stays until it is closed. An empty message changes nothing. */
  const setError = useCallback((message: string) => showToast('error', message), [showToast])
  const showSuccess = useCallback((message: string) => showToast('success', message), [showToast])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [undoEntry, setUndoEntry] = useState<UndoEntry | null>(null)
  const undoNumber = useRef(0)
  const unsavedEditor = useRef<UnsavedEditor | null>(null)
  const [panelDirty, setPanelDirty] = useState(false)
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null)
  const registerEditor = useCallback((editor: UnsavedEditor | null) => {
    unsavedEditor.current = editor
    setPanelDirty(editor?.dirty ?? false)
  }, [])
  const [showRestore, setShowRestore] = useState(false)
  const [showTeam, setShowTeam] = useState(false)
  const [showDesign, setShowDesign] = useState(false)
  const [showUsers, setShowUsers] = useState(false)
  const [showAccount, setShowAccount] = useState(false)
  const [clearingChangeNotices, setClearingChangeNotices] = useState(false)
  const [zoom, setZoom] = usePlanZoom()
  const loadNumber = useRef(0)
  const overviewLoadNumber = useRef(0)
  const isSuperadmin = currentUser.is_superadmin
  const isAdmin = isSuperadmin || (eventId !== null && currentUser.event_roles[String(eventId)] === 'admin')
  const canPlan = isAdmin || (eventId !== null && currentUser.event_roles[String(eventId)] === 'editor')
  const isDashboard = view === 'dashboard' && isAdmin
  const isOverview = view === 'conflicts' || isDashboard

  /**
   * Loads the event's planning data. A quiet load keeps the current plan on screen
   * (and with it the scroll position) and only marks it as refreshing.
   */
  async function loadAll(preferredEvent: number | null, preferredDay: number | null, { quiet = false } = {}): Promise<boolean> {
    const number = ++loadNumber.current
    ++overviewLoadNumber.current
    if (quiet) setRefreshing(true)
    else {
      setLoading(true)
      setOverviewSchedules(null)
    }
    setLoadError('')
    setOverviewError('')
    try {
      const eventList = await request<Event[]>('/events')
      const selectedEvent = eventList.find(item => item.id === preferredEvent)?.id ?? eventList[0]?.id ?? null
      const [dayList, roomList, speakerList, categoryList, unplannedList, helperList, loadedHelperPlan] = selectedEvent === null
        ? [[], [], [], [], [], [], { duties: [], conflicts: [] }] as [EventDay[], Room[], Speaker[], Category[], UnplannedSession[], DutyParticipant[], HelperPlan]
        : await Promise.all([
          request<EventDay[]>(`/events/${selectedEvent}/days`),
          request<Room[]>(`/events/${selectedEvent}/rooms`),
          request<Speaker[]>(`/events/${selectedEvent}/speakers`),
          request<Category[]>(`/events/${selectedEvent}/categories`),
          request<UnplannedSession[]>(`/events/${selectedEvent}/unplanned-sessions`),
          currentUser.is_superadmin || currentUser.event_roles[String(selectedEvent)] !== 'helper'
            ? request<DutyParticipant[]>(`/events/${selectedEvent}/duty-participants`) : Promise.resolve([]),
          request<HelperPlan>(`/events/${selectedEvent}/helper-plan`),
        ])
      const selectedDay = dayList.find(item => item.id === preferredDay)?.id ?? dayList[0]?.id ?? null
      const daySchedule = selectedDay === null ? null : await request<DaySchedule>(`/schedule/days/${selectedDay}`)
      if (number !== loadNumber.current) return false
      setEvents(eventList)
      setEventId(selectedEvent)
      setDays(dayList)
      setDayId(selectedDay)
      setRooms(roomList)
      setSpeakers(speakerList)
      setCategories(categoryList)
      setHelpers(helperList)
      setHelperPlan(loadedHelperPlan)
      setSchedule(daySchedule)
      setUnplanned(unplannedList)
      setError('')
      return true
    } catch (cause) {
      if (number === loadNumber.current) {
        setError((cause as Error).message)
        setLoadError((cause as Error).message)
      }
      return false
    } finally {
      if (number === loadNumber.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }

  function refresh(): Promise<boolean> {
    return loadAll(eventId, dayId, { quiet: true })
  }

  /** Runs an action that replaces or closes the editor, asking first if it holds unsaved input. */
  function guard(action: () => void) {
    if (unsavedEditor.current?.dirty) setPendingAction(() => action)
    else action()
  }

  function openPanel(next: Panel | null) {
    if (next && panel && next.kind === panel.kind && next.id === panel.id && !!next.createUnplanned === !!panel.createUnplanned) return
    guard(() => setPanel(next))
  }

  async function saveBeforeLeaving() {
    const action = pendingAction
    if (!action || !await unsavedEditor.current?.save()) return
    setPendingAction(null)
    action()
  }

  function discardAndLeave() {
    const action = pendingAction
    setPendingAction(null)
    unsavedEditor.current = null
    setPanelDirty(false)
    setPanel(null)
    action?.()
  }

  useEffect(() => {
    if (!panelDirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [panelDirty])

  useEffect(() => { void loadAll(null, null) }, [])

  useEffect(() => {
    if (!isOverview || eventId === null || loading || loadError) return
    let active = true
    const number = ++overviewLoadNumber.current
    setOverviewError('')
    Promise.all(days.map(day => request<DaySchedule>(`/schedule/days/${day.id}`)))
      .then(loaded => { if (active && number === overviewLoadNumber.current) setOverviewSchedules(loaded) })
      .catch((cause: Error) => { if (active && number === overviewLoadNumber.current) setOverviewError(cause.message) })
    return () => { active = false }
  }, [isOverview, eventId, days, loading, loadError])

  useEffect(() => {
    setDashboardDayId(null)
    setUndoEntry(null)
  }, [eventId])

  useEffect(() => {
    if (view === 'dashboard' && !isAdmin) {
      setView('schedule')
      setPanel(null)
    }
  }, [view, isAdmin])

  function openOverviewEntry(targetDayId: number | null, kind: 'slot' | 'duty', id: number) {
    guard(() => void showOverviewEntry(targetDayId, kind, id))
  }

  async function showOverviewEntry(targetDayId: number | null, kind: 'slot' | 'duty', id: number) {
    if (targetDayId !== null && !await loadAll(eventId, targetDayId, { quiet: true })) return
    if (!isDashboard) setView('schedule')
    setPanel({ kind, id })
  }

  const selectedEvent = events.find(item => item.id === eventId)
  usePageTitle(pageTitle(isDashboard ? 'Dashboard' : view === 'conflicts' ? 'Konflikte' : view === 'helpers' ? 'Helferplan' : 'Planung', selectedEvent?.name))
  const selectedDay = days.find(item => item.id === dayId)
  const selectedRoom = panel?.kind === 'room' ? rooms.find(item => item.id === panel.id) : undefined
  const selectedSlot = panel?.kind === 'slot'
    ? [...(schedule?.rooms.flatMap(item => item.slots) ?? []), ...(schedule?.shared_slots ?? []), ...unplanned].find(item => item.id === panel.id)
    : undefined
  const selectedSpeaker = panel?.kind === 'speaker' ? speakers.find(item => item.id === panel.id) : undefined
  const selectedCategory = panel?.kind === 'category' ? categories.find(item => item.id === panel.id) : undefined
  const selectedDuty = panel?.kind === 'duty' ? helperPlan.duties.find(item => item.id === panel.id) : undefined

  async function save(body: Record<string, unknown>): Promise<boolean> {
    if (!panel) return false
    let savedEvent: Event | null = null
    try {
      if (panel.kind === 'event') {
        const saved = await write<Event>(panel.id === null ? 'POST' : 'PATCH', panel.id === null ? '/events' : `/events/${panel.id}`, body)
        savedEvent = saved
        await loadAll(saved.id, dayId, { quiet: saved.id === eventId })
      } else if (panel.kind === 'day' && eventId !== null) {
        const saved = await write<EventDay>(panel.id === null ? 'POST' : 'PATCH', panel.id === null ? `/events/${eventId}/days` : `/days/${panel.id}`, panel.id === null ? { ...body, event_id: eventId } : body)
        await loadAll(eventId, saved.id, { quiet: true })
      } else if (panel.kind === 'room' && eventId !== null) {
        await write<Room>(panel.id === null ? 'POST' : 'PATCH', panel.id === null ? '/rooms' : `/rooms/${panel.id}`, panel.id === null ? { ...body, event_id: eventId } : body)
        await refresh()
      } else if (panel.kind === 'slot' && eventId !== null) {
        await write<Slot>(panel.id === null ? 'POST' : 'PATCH', panel.id === null ? '/slots' : `/slots/${panel.id}`, panel.id === null ? { ...body, event_id: eventId } : body)
        await refresh()
      }
      showSuccess(`${PANEL_NAMES[panel.kind]} gespeichert.`)
      return true
    } catch (cause) {
      if (savedEvent) {
        await loadAll(savedEvent.id, dayId)
        if (panel.kind === 'event' && panel.id === null) setPanel({ kind: 'event', id: savedEvent.id })
      }
      setError((cause as Error).message)
      return false
    }
  }

  async function remove(): Promise<boolean> {
    if (!panel || panel.id === null) return false
    const path = { event: `/events/${panel.id}`, day: `/days/${panel.id}`, room: `/rooms/${panel.id}`, slot: `/slots/${panel.id}`, speaker: `/speakers/${panel.id}`, category: `/categories/${panel.id}`, duty: `/duties/${panel.id}` }[panel.kind]
    try {
      await write<void>('DELETE', path)
      await loadAll(panel.kind === 'event' ? null : eventId, panel.kind === 'day' ? null : dayId, { quiet: panel.kind !== 'event' })
      if (panel.kind === 'event') setView('schedule')
      showSuccess(`${PANEL_NAMES[panel.kind]} gelöscht.`)
      return true
    } catch (cause) {
      setError((cause as Error).message)
      return false
    }
  }

  async function saveSpeaker(body: { name: string; bio: string | null; website: string | null }, photo: File | null): Promise<boolean> {
    if (!panel || panel.kind !== 'speaker' || eventId === null) return false
    let saved: Speaker | null = null
    try {
      saved = await write<Speaker>(panel.id === null ? 'POST' : 'PATCH', panel.id === null ? `/events/${eventId}/speakers` : `/speakers/${panel.id}`, body)
      if (photo) await uploadImage(`/speakers/${saved.id}/photo`, 'photo', photo)
      await refresh()
      showSuccess('Rednerprofil gespeichert.')
      return true
    } catch (cause) {
      if (saved) await refresh()
      if (saved && panel.id === null) setPanel({ kind: 'speaker', id: saved.id })
      setError((cause as Error).message)
      return false
    }
  }

  async function saveCategory(body: { name: string; color: string }): Promise<boolean> {
    if (panel?.kind !== 'category' || eventId === null) return false
    try {
      await write<Category>(panel.id === null ? 'POST' : 'PATCH',
        panel.id === null ? `/events/${eventId}/categories` : `/categories/${panel.id}`, body)
      await refresh()
      showSuccess('Kategorie gespeichert.')
      return true
    } catch (cause) {
      setError((cause as Error).message)
      return false
    }
  }

  async function deleteSpeakerPhoto() {
    if (panel?.kind !== 'speaker' || panel.id === null) return
    try {
      await write<Speaker>('DELETE', `/speakers/${panel.id}/photo`)
      await refresh()
    } catch (cause) { setError((cause as Error).message) }
  }

  async function clearSlotRescheduledNotice() {
    if (panel?.kind !== 'slot' || panel.id === null) return
    try {
      await write<void>('DELETE', `/slots/${panel.id}/rescheduled-notice`)
      await refresh()
    } catch (cause) { setError((cause as Error).message) }
  }

  async function clearEventChangeNotices() {
    if (eventId === null || !await confirm({
      title: 'Alle Änderungs-Flags entfernen?',
      message: 'Alle Verschoben- und Geändert-Flags dieser Veranstaltung werden entfernt. Abgesagte Sessions bleiben abgesagt.',
      confirmLabel: 'Flags entfernen',
    })) return
    setClearingChangeNotices(true)
    try {
      await write<void>('DELETE', `/events/${eventId}/change-notices`)
      await refresh()
      showSuccess('Änderungs-Flags entfernt.')
    } catch (cause) { setError((cause as Error).message) }
    finally { setClearingChangeNotices(false) }
  }

  async function signup(duty: Duty, leave: boolean) {
    try {
      await write<Duty>(leave ? 'DELETE' : 'PUT', `/duties/${duty.id}/signup`)
      await refresh()
    } catch (cause) {
      await refresh()
      setError((cause as Error).message)
    }
  }

  async function saveDuty(body: Record<string, unknown>): Promise<boolean> {
    if (panel?.kind !== 'duty' || eventId === null) return false
    try {
      await write<Duty>(panel.id === null ? 'POST' : 'PATCH', panel.id === null ? `/events/${eventId}/duties` : `/duties/${panel.id}`, body)
      await refresh()
      showSuccess('Dienst gespeichert.')
      return true
    } catch (cause) { setError((cause as Error).message); return false }
  }

  async function reorder(roomId: number, direction: -1 | 1) {
    if (eventId === null) return
    const ids = rooms.map(room => room.id)
    const index = ids.indexOf(roomId)
    const other = index + direction
    if (other < 0 || other >= ids.length) return
    ;[ids[index], ids[other]] = [ids[other], ids[index]]
    try {
      await write<Room[]>('PATCH', `/events/${eventId}/rooms/order`, { room_ids: ids })
      await refresh()
    } catch (cause) { setError((cause as Error).message) }
  }

  /** Sends a change, shows it right away and reloads quietly; on failure the server state returns. */
  async function applyChange(send: () => Promise<unknown>, preview?: () => void): Promise<boolean> {
    preview?.()
    try {
      await send()
      await refresh()
      return true
    } catch (cause) {
      await refresh()
      setError((cause as Error).message)
      return false
    }
  }

  function changeSlot(slotId: number, patch: Record<string, unknown>): Promise<boolean> {
    return applyChange(
      () => write<Slot>('PATCH', `/slots/${slotId}`, patch),
      'day_id' in patch ? undefined : () => setSchedule(current => current && applySlotPatch(current, slotId, patch as SlotPositionPatch)),
    )
  }

  function changeDuty(duty: Duty, patch: DutyPatch): Promise<boolean> {
    const slotId = duty.slot_id
    if (duty.kind === 'session' && slotId === null) return Promise.resolve(false)
    return applyChange(
      () => duty.kind === 'session'
        ? write<Slot>('PATCH', `/slots/${slotId}`, { room_id: patch.room_id, start_time: patch.start_time, end_time: patch.end_time })
        : write<Duty>('PATCH', `/duties/${duty.id}`, patch),
      () => {
        setHelperPlan(current => applyDutyPatch(current, duty.id, patch))
        if (duty.kind === 'session' && slotId !== null) setSchedule(current => current && applySlotPatch(current, slotId, patch))
      },
    )
  }

  function reorderDuties(selectedDayId: number, roomId: number | null, dutyIds: number[]): Promise<boolean> {
    if (eventId === null) return Promise.resolve(false)
    return applyChange(
      () => write<Duty[]>('PATCH', `/events/${eventId}/duties/order`, { day_id: selectedDayId, room_id: roomId, duty_ids: dutyIds }),
      () => setHelperPlan(current => applyDutyOrder(current, dutyIds)),
    )
  }

  function offerUndo(message: string, undo: () => Promise<unknown>) {
    setUndoEntry({ id: ++undoNumber.current, message, undo })
  }

  /** Drag & drop in the plan: save at once, but offer to take the change back. */
  async function dragSlot(slotId: number, patch: SlotPositionPatch) {
    const slot = [...(schedule?.rooms.flatMap(room => room.slots) ?? []), ...(schedule?.shared_slots ?? [])].find(item => item.id === slotId)
    if (!slot || !await changeSlot(slotId, patch)) return
    const previous: SlotPositionPatch = { room_id: slot.room_id, start_time: slot.start_time.slice(0, 5), end_time: slot.end_time.slice(0, 5) }
    const resized = patch.start_time === undefined && patch.room_id === undefined
    offerUndo(`„${slot.topic}“ ${resized ? 'in der Dauer geändert' : 'verschoben'}.`, () => changeSlot(slotId, previous))
  }

  async function dragDuty(duty: Duty, patch: DutyPatch) {
    if (!await changeDuty(duty, patch)) return
    const previous: DutyPatch = { start_time: duty.start_time?.slice(0, 5), end_time: duty.end_time?.slice(0, 5) }
    if (patch.room_id !== undefined) previous.room_id = duty.room_id
    if (patch.kind !== undefined && duty.kind !== 'session') previous.kind = duty.kind
    const title = duty.title || duty.session_topic || (duty.kind === 'room' ? 'Raumdienst' : 'Allgemeiner Dienst')
    offerUndo(`Dienst „${title}“ ${patch.start_time === undefined ? 'in der Dauer geändert' : 'verschoben'}.`,
      () => changeDuty({ ...duty, ...patch, start_time: patch.start_time ?? duty.start_time, end_time: patch.end_time ?? duty.end_time } as Duty, previous))
  }

  async function dragDutyOrder(selectedDayId: number, roomId: number | null, dutyIds: number[]) {
    const previous = helperPlan.duties.filter(duty => dutyIds.includes(duty.id))
      .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id).map(duty => duty.id)
    if (!await reorderDuties(selectedDayId, roomId, dutyIds)) return
    offerUndo('Dienste neu angeordnet.', () => reorderDuties(selectedDayId, roomId, previous))
  }

  function beginBacklogDrag(event: PointerEvent, session: UnplannedSession) {
    if (event.button !== 0 || !schedule || dayId === null) return
    event.preventDefault()
    const dayStart = toMinutes(schedule.start_time)
    const dayEnd = toMinutes(schedule.end_time)

    function position(pointer: globalThis.PointerEvent): BacklogPreview | null {
      const scroll = document.querySelector<HTMLElement>('.schedule-scroll')
      if (!scroll) return null
      const visible = scroll.getBoundingClientRect()
      if (pointer.clientX < visible.left || pointer.clientX > visible.right || pointer.clientY < visible.top || pointer.clientY > visible.bottom) return null
      for (const column of document.querySelectorAll<HTMLElement>(session.scope === 'all_rooms' ? '[data-program-column]' : '[data-room-column]')) {
        const rect = column.getBoundingClientRect()
        if (pointer.clientX < rect.left || pointer.clientX > rect.right || pointer.clientY < rect.top || pointer.clientY > rect.bottom) continue
        const start = dayStart + Math.round((pointer.clientY - rect.top) / (SNAP_MINUTES * zoom)) * SNAP_MINUTES
        if (start < dayStart || start + 60 > dayEnd) return null
        return { roomId: session.scope === 'all_rooms' ? null : Number(column.dataset.roomColumn), start, topic: session.topic }
      }
      return null
    }

    function move(pointer: globalThis.PointerEvent) { setBacklogPreview(position(pointer)) }
    function cleanup() {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', cancel)
      setBacklogPreview(null)
    }
    function finish(pointer: globalThis.PointerEvent) {
      const target = position(pointer)
      cleanup()
      if (target) void changeSlot(session.id, {
        day_id: dayId, room_id: target.roomId,
        start_time: toTime(target.start), end_time: toTime(target.start + 60),
      }).then(saved => {
        if (saved) offerUndo(`„${session.topic}“ eingeplant.`, () => changeSlot(session.id, { day_id: null, room_id: null, start_time: null, end_time: null }))
      })
    }
    function cancel() { cleanup() }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', cancel)
  }

  const headerActions: HeaderMenuAction[] = [
    { label: 'Mein Konto', onClick: () => { setShowTeam(false); setShowUsers(false); setShowRestore(false); setShowAccount(true) } },
  ]
  if (isSuperadmin) headerActions.push({ label: 'Benutzer', onClick: () => setShowUsers(true) })
  if (isSuperadmin || selectedEvent && isAdmin) headerActions.push({ label: 'Restore', onClick: () => setShowRestore(true) })
  if (isSuperadmin) headerActions.push({ label: '+ Veranstaltung', disabled: loading, onClick: () => openPanel({ kind: 'event', id: null }) })
  if (onLogout) headerActions.push({ label: 'Abmelden', separatorBefore: true, onClick: onLogout })

  return <UnsavedChangesProvider value={registerEditor}><div className="app-shell">
    <header className="app-header">
      <div className="header-context">
        <h1 className="header-brand"><span className="header-brand-mark" aria-hidden="true" />Programmplanung</h1>
        {events.length > 0 && <div className="event-switcher">
          <select aria-label="Veranstaltung wählen" value={eventId ?? ''} onChange={e => { const next = Number(e.target.value); guard(() => { setPanel(null); setShowTeam(false); setShowDesign(false); setShowRestore(false); void loadAll(next, null) }) }}>
            {events.map(event => <option key={event.id} value={event.id}>{event.name}</option>)}
          </select>
          {selectedEvent && <span className="event-switcher-dates">{formatDate(selectedEvent.start_date)} – {formatDate(selectedEvent.end_date)}</span>}
        </div>}
      </div>
      <div className="header-actions">
        <ThemeControl variant="segmented" />
        {currentUser.name && <div className="account-name"><strong title={currentUser.name}>{currentUser.name}</strong></div>}
        <HeaderMenu actions={headerActions} labelHidden leading={<span className="avatar" aria-hidden="true">{initials(currentUser.name, currentUser.email)}</span>} />
      </div>
    </header>
    <div className="workspace">
      <nav className="sidebar" aria-label="Planung" inert={loading}>
        <section>
          <div className="section-heading"><h2>Veranstaltung</h2>{selectedEvent && isAdmin && <button className="text-button" onClick={() => openPanel({ kind: 'event', id: selectedEvent.id })}>Bearbeiten</button>}</div>
          {selectedEvent ? <p className="sidebar-event-name">{selectedEvent.name}</p> : <p className="muted">Keine Veranstaltung</p>}
          {selectedEvent && (isAdmin || canPlan) && <div className="sidebar-actions">
            {isAdmin && <button type="button" className="secondary small" onClick={() => setShowTeam(true)}>Team verwalten</button>}
            {isAdmin && <button type="button" className="secondary small" onClick={() => setShowDesign(true)}>Besucherprogramm gestalten</button>}
            {isAdmin && <a className="program-link" href={`/api/backups/events/${selectedEvent.id}`} download><Icon name="download" />Backup herunterladen</a>}
            {canPlan && <button type="button" className="danger small clear-change-button" disabled={clearingChangeNotices} onClick={() => void clearEventChangeNotices()}>Alle Änderungs-Flags entfernen</button>}
          </div>}
        </section>
        {selectedEvent && <section>
          <div className="section-heading"><h2>Tage</h2>{isAdmin && <button className="text-button" aria-label="Tag hinzufügen" onClick={() => openPanel({ kind: 'day', id: null })}><Icon name="plus" />Tag</button>}</div>
          {days.length === 0 && <p className="muted">Noch keine Tage</p>}
          <div className="day-list">{days.map(day => <div className={`day-row${day.id === dayId ? ' active' : ''}`} key={day.id}>
            <button type="button" onClick={() => guard(() => { setPanel(null); if (isOverview) setView('schedule'); void loadAll(eventId, day.id, { quiet: true }) })}>{formatDate(day.date)}<small>{day.start_time.slice(0, 5)}–{day.end_time.slice(0, 5)}</small></button>
            {isAdmin && <button type="button" className="icon-button" aria-label={`${formatDate(day.date)} bearbeiten`} title="Tag bearbeiten" onClick={() => openPanel({ kind: 'day', id: day.id })}><Icon name="edit" /></button>}
          </div>)}</div>
        </section>}
        {selectedEvent && <section>
          <div className="section-heading"><h2>Räume</h2>{isAdmin && <button className="text-button" aria-label="Raum hinzufügen" onClick={() => openPanel({ kind: 'room', id: null })}><Icon name="plus" />Raum</button>}</div>
          {rooms.length === 0 && <p className="muted">Noch keine Räume</p>}
          <div className="room-list">{rooms.map((room, index) => <div className="room-row" key={room.id}>
            {isAdmin ? <button type="button" className="room-name" onClick={() => openPanel({ kind: 'room', id: room.id })}>{room.name}</button> : <span className="room-name">{room.name}</span>}
            {isAdmin && <button type="button" className="icon-button" aria-label={`${room.name} nach oben`} title={index === 0 ? 'Steht bereits ganz oben' : 'Nach oben verschieben'} disabled={index === 0} onClick={() => void reorder(room.id, -1)}><Icon name="arrow-up" /></button>}
            {isAdmin && <button type="button" className="icon-button" aria-label={`${room.name} nach unten`} title={index === rooms.length - 1 ? 'Steht bereits ganz unten' : 'Nach unten verschieben'} disabled={index === rooms.length - 1} onClick={() => void reorder(room.id, 1)}><Icon name="arrow-down" /></button>}
          </div>)}</div>
        </section>}
        {selectedEvent && <section>
          <div className="section-heading"><h2>Kategorien</h2>{isAdmin && <button className="text-button" aria-label="Kategorie hinzufügen" onClick={() => openPanel({ kind: 'category', id: null })}><Icon name="plus" />Kategorie</button>}</div>
          {categories.length === 0 && <p className="muted">Noch keine Kategorien</p>}
          <div className="room-list">{categories.map(category => <div className="room-row" key={category.id}>
            {isAdmin ? <button type="button" className="room-name category-name" onClick={() => openPanel({ kind: 'category', id: category.id })}><span className="category-dot" style={{ backgroundColor: category.color }} />{category.name}</button> : <span className="room-name category-name"><span className="category-dot" style={{ backgroundColor: category.color }} />{category.name}</span>}
          </div>)}</div>
        </section>}
        {selectedEvent && <section>
          <div className="section-heading"><h2>Ungeplante Sessions ({unplanned.length})</h2>{canPlan && <button className="text-button" aria-label="Session hinzufügen" onClick={() => openPanel({ kind: 'slot', id: null, createUnplanned: true })}><Icon name="plus" />Session</button>}</div>
          {unplanned.length === 0 && <p className="muted">Keine ungeplanten Sessions</p>}
          <div className="unplanned-list">{unplanned.map(session => <div className="unplanned-row" key={session.id}>
            {canPlan && <button type="button" className="unplanned-grip" aria-label={`${session.topic} einplanen`} title="In einen Raum ziehen" onPointerDown={event => beginBacklogDrag(event, session)}><Icon name="grip" /></button>}
            <button type="button" className="unplanned-name" onClick={() => openPanel({ kind: 'slot', id: session.id })}>{session.topic}<small>{session.speakers.map(speaker => speaker.name).join(', ')}</small><CategoryLabels categories={session.categories} /></button>
          </div>)}</div>
          {canPlan && unplanned.length > 0 && <p className="muted">Zum Einplanen in einen Raum ziehen oder Session bearbeiten.</p>}
        </section>}
        {selectedEvent && canPlan && <section>
          <div className="section-heading"><h2>Redner</h2><button className="text-button" aria-label="Redner hinzufügen" onClick={() => openPanel({ kind: 'speaker', id: null })}><Icon name="plus" />Redner</button></div>
          {speakers.length === 0 && <p className="muted">Noch keine Redner</p>}
          <div className="room-list">{speakers.map(person => <div className="room-row" key={person.id}>
            <button type="button" className="room-name" onClick={() => openPanel({ kind: 'speaker', id: person.id })}>{person.name}</button>
          </div>)}</div>
        </section>}
        {selectedEvent && <section>
          <div className="section-heading"><h2>Dienste ({helperPlan.duties.length})</h2></div>
          {helperPlan.duties.length === 0 && <p className="muted">Noch keine Dienste</p>}
          <div className="duty-list">{helperPlan.duties.map(duty => <button type="button" key={duty.id} onClick={() => openPanel({ kind: 'duty', id: duty.id })}>
            <strong>{duty.title || duty.session_topic || (duty.kind === 'room' ? 'Raumdienst' : 'Allgemeiner Dienst')}{duty.title && duty.session_topic ? `: ${duty.session_topic}` : ''}</strong>
            <small>{duty.date ? formatDate(duty.date) : 'Ohne Tag'} · {duty.status === 'cancelled' ? 'Abgesagt' : duty.status === 'unplanned' ? 'Ungeplant' : duty.start_time?.slice(0, 5) + '–' + duty.end_time?.slice(0, 5)} · {duty.users.length ? duty.users.map(helper => helper.name).join(', ') : 'Offen'} · {duty.user_ids.length}/{duty.capacity} Plätze</small>
          </button>)}</div>
        </section>}
      </nav>
      <main className="main-area" aria-busy={refreshing || undefined}>
        {refreshing && !loading && <div className="refresh-indicator" aria-hidden="true" />}
        {selectedEvent && <div className="planning-views" role="group" aria-label="Planungsansicht">
          {isAdmin && <button type="button" aria-pressed={isDashboard} onClick={() => guard(() => { setPanel(null); setView('dashboard') })}>Dashboard</button>}
          <button type="button" aria-pressed={view === 'schedule'} onClick={() => setView('schedule')}>Tagesplan</button>
          <button type="button" aria-pressed={view === 'helpers'} onClick={() => setView('helpers')}>Helferplan</button>
          <button type="button" aria-pressed={view === 'conflicts'} onClick={() => guard(() => { setPanel(null); setView('conflicts') })}>Konflikte</button>
        </div>}
        <div className="plan-heading"><div className="plan-title"><h2>{isDashboard ? 'Dashboard' : view === 'conflicts' ? 'Konfliktübersicht' : selectedDay ? formatWeekdayDate(selectedDay.date) : 'Programm'}</h2><p>{isOverview ? 'Gesamte Veranstaltung' : selectedDay ? <><time>{selectedDay.start_time.slice(0, 5)}–{selectedDay.end_time.slice(0, 5)}</time> Uhr · {rooms.length} {rooms.length === 1 ? 'Raum' : 'Räume'}</> : 'Wähle oder erstelle einen Veranstaltungstag.'}</p></div>
          <div className="plan-actions">
            {selectedEvent && <a className="program-link" href={`/programm/${selectedEvent.id}`}>Besucherprogramm ansehen</a>}
            {selectedEvent && days.length > 0 && <HeaderMenu label="Exportieren" panelLabel="Export" triggerClassName="secondary menu-trigger" actions={[
              { label: 'PDF-Programm herunterladen', icon: 'download', href: `/api/events/${selectedEvent.id}/program.pdf`, download: true },
              { label: 'Programm als JSON', icon: 'download', href: `/api/events/${selectedEvent.id}/program.json`, download: true },
            ]} />}
            {selectedEvent && canPlan && !isOverview && <button className="secondary" aria-label="Dienst hinzufügen" disabled={loading} onClick={() => openPanel({ kind: 'duty', id: null })}><Icon name="plus" />Dienst</button>}
            {selectedDay && canPlan && !isOverview && <button className="primary" aria-label="Slot hinzufügen" disabled={loading} onClick={() => openPanel({ kind: 'slot', id: null })}><Icon name="plus" />Slot</button>}
          </div>
        </div>
        {!isOverview && loading && <p className="state-message">Lade Programm …</p>}
        {!isOverview && !loading && schedule && <PlanLegend canPlan={canPlan} zoom={zoom} onZoom={setZoom} />}
        {!isOverview && !loading && schedule && <Schedule key={schedule.day_id} pxPerMinute={zoom} readOnly={!canPlan} currentUserId={currentUser.id} onSignup={signup} schedule={schedule} helperPlan={helperPlan} focus={view === 'helpers' ? 'helpers' : 'program'} backlogPreview={backlogPreview} hasSharedBacklog={unplanned.some(session => session.scope === 'all_rooms')} onEdit={slot => openPanel({ kind: 'slot', id: slot.id })} onEditDuty={duty => openPanel({ kind: 'duty', id: duty.id })} onChange={dragSlot} onChangeDuty={dragDuty} onReorderDuties={dragDutyOrder} />}
        {!isOverview && !loading && !schedule && <div className="empty-state">{events.length === 0 ? 'Erstelle zuerst eine Veranstaltung.' : 'Lege einen Tag und mindestens einen Raum an.'}</div>}
        {isDashboard && selectedEvent && <Dashboard
          days={days} rooms={rooms} speakerCount={speakers.length} schedules={overviewSchedules}
          helperPlan={helperPlan} unplanned={unplanned}
          dayId={days.some(day => day.id === dashboardDayId) ? dashboardDayId : null}
          onDayChange={setDashboardDayId}
          loading={loading || (!overviewSchedules && !overviewError && !loadError)}
          error={overviewError || loadError} onRefresh={() => void refresh()}
          onOpenSlot={(day, slot) => void openOverviewEntry(day, 'slot', slot)}
          onOpenDuty={(day, duty) => void openOverviewEntry(day, 'duty', duty)}
        />}
        {view === 'conflicts' && (loading || (!overviewSchedules && !overviewError && !loadError)) && <p className="state-message" role="status">Lade Konflikte …</p>}
        {view === 'conflicts' && !loading && (overviewError || loadError) && <div className="empty-state" role="alert">Konflikte konnten nicht geladen werden: {overviewError || loadError}<br /><button className="text-button" type="button" onClick={() => void refresh()}>Erneut versuchen</button></div>}
        {view === 'conflicts' && !loading && overviewSchedules && !overviewError && !loadError && <ConflictOverview readOnly={!canPlan} schedules={overviewSchedules} helperPlan={helperPlan} onOpenSlot={(day, slot) => void openOverviewEntry(day, 'slot', slot)} onOpenDuty={(day, duty) => void openOverviewEntry(day, 'duty', duty)} />}
      </main>
      {canPlan && panel?.kind === 'speaker' && <SpeakerEditor
        key={`speaker-${panel.id ?? 'new'}`}
        speaker={selectedSpeaker}
        onSave={saveSpeaker}
        onDelete={panel.id === null ? null : remove}
        onDeletePhoto={panel.id === null ? null : deleteSpeakerPhoto}
        onClose={() => setPanel(current => current === panel ? null : current)}
        onRequestClose={() => openPanel(null)}
      />}
      {panel?.kind === 'category' && isAdmin && <CategoryEditor
        key={`category-${panel.id ?? 'new'}`}
        category={selectedCategory}
        onSave={saveCategory}
        onDelete={panel.id === null ? null : remove}
        onClose={() => setPanel(current => current === panel ? null : current)}
        onRequestClose={() => openPanel(null)}
      />}
      {canPlan && panel?.kind === 'duty' && <DutyEditor
        currentUserId={currentUser.id} onSignup={signup}
        key={`duty-${panel.id ?? 'new'}`}
        duty={selectedDuty}
        days={days}
        selectedDay={selectedDay}
        rooms={rooms}
        sessions={[...(schedule?.rooms.flatMap(room => room.slots) ?? []), ...(schedule?.shared_slots ?? []), ...unplanned]}
        helpers={helpers}
        onSave={saveDuty}
        onDelete={panel.id === null ? null : remove}
        onClose={() => setPanel(current => current === panel ? null : current)}
        onRequestClose={() => openPanel(null)}
      />}
      {!canPlan && selectedDuty && <DutyDetails duty={selectedDuty} rooms={rooms} currentUserId={currentUser.id} onSignup={signup} onClose={() => setPanel(null)} />}
      {!canPlan && selectedSlot && <SlotDetails slot={selectedSlot} onClose={() => setPanel(null)} />}
      {canPlan && panel && panel.kind !== 'speaker' && panel.kind !== 'category' && panel.kind !== 'duty' && <Editor
        key={`${panel.kind}-${panel.id ?? 'new'}-${panel.createUnplanned ? 'unplanned' : 'planned'}`}
        kind={panel.kind}
        event={panel.kind === 'event' ? events.find(item => item.id === panel.id) : selectedEvent}
        day={panel.kind === 'day' ? days.find(item => item.id === panel.id) : selectedDay}
        days={days}
        room={selectedRoom}
        slot={selectedSlot}
        rooms={rooms}
        speakers={speakers}
        categories={categories}
        createUnplanned={panel.createUnplanned}
        onSave={save}
        onClearRescheduledNotice={panel.kind === 'slot' && panel.id !== null ? clearSlotRescheduledNotice : null}
        onDelete={panel.id === null || panel.kind === 'event' && !isSuperadmin ? null : remove}
        onClose={() => setPanel(current => current === panel ? null : current)}
        onRequestClose={() => openPanel(null)}
      />}
      {showRestore && isAdmin && <BackupRestore events={events} selectedEventId={eventId} allowCreate={isSuperadmin} onComplete={async (restoredId, warnings = []) => {
        setPanel(null)
        if (await loadAll(restoredId, null)) { setShowRestore(false); showSuccess(['Backup wiederhergestellt.', ...warnings].join(' ')) }
        else throw new Error('Restore abgeschlossen, aber Planungsansicht konnte nicht geladen werden')
      }} onClose={() => setShowRestore(false)} />}
      {showTeam && isAdmin && eventId !== null && <TeamManagement eventId={eventId} currentUserId={currentUser.id} onClose={() => setShowTeam(false)} />}
      {showDesign && isAdmin && selectedEvent && <ProgramDesignEditor event={selectedEvent} onChanged={() => refresh()} onClose={() => setShowDesign(false)} />}
      {showUsers && isSuperadmin && <UserManagement currentUserId={currentUser.id} onClose={() => setShowUsers(false)} />}
      {showAccount && <AccountDialog currentUser={currentUser} onProfileSaved={async updated => {
        onProfileChange?.(updated)
        return refresh()
      }} onPasswordChanged={() => onPasswordChanged?.()} onClose={() => setShowAccount(false)} />}
    </div>
    <ToastRegion toasts={toast.toasts} onDismiss={toast.dismiss}>
      {undoEntry && <UndoToast entry={undoEntry} onDismiss={() => setUndoEntry(current => current?.id === undoEntry.id ? null : current)} />}
    </ToastRegion>
    {confirmDialog}
    {pendingAction && <UnsavedChangesDialog onSave={saveBeforeLeaving} onDiscard={discardAndLeave} onCancel={() => setPendingAction(null)} />}
  </div></UnsavedChangesProvider>
}
