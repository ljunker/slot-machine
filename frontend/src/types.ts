export type Event = { id: number; name: string; start_date: string; end_date: string }
export type EventDay = { id: number; event_id: number; date: string; start_time: string; end_time: string }
export type Room = { id: number; event_id: number; name: string; sort_order: number }
export type SpeakerSummary = { id: number; name: string }
export type Speaker = SpeakerSummary & { event_id: number; bio: string | null; website: string | null; photo_url: string | null }
export type SpeakerSession = { id: number; day_id: number | null; date: string | null; room_id: number | null; room_name: string | null; topic: string; start_time: string | null; end_time: string | null }
export type SpeakerDetail = Speaker & { sessions: SpeakerSession[] }
export type Helper = { id: number; event_id: number; name: string }
export type DutyKind = 'general' | 'room' | 'session'
export type Duty = {
  id: number
  event_id: number
  kind: DutyKind
  title: string | null
  helper_ids: number[]
  helpers: Helper[]
  day_id: number | null
  date: string | null
  room_id: number | null
  slot_id: number | null
  session_topic: string | null
  start_time: string | null
  end_time: string | null
  status: 'active' | 'unplanned' | 'cancelled'
}
export type DutyConflict = { first_duty_id: number; second_duty_id: number; helper_ids: number[] }
export type HelperPlan = { duties: Duty[]; conflicts: DutyConflict[] }
export type ChangeNotice = {
  type: 'rescheduled' | 'updated' | 'cancelled'
  expires_at: number | null
  previous_start_time: string | null
  previous_end_time: string | null
  previous_room_name: string | null
}
export type Slot = {
  id: number
  event_id: number
  day_id: number
  room_id: number
  topic: string
  speaker_ids: number[]
  speakers: SpeakerSummary[]
  description: string | null
  start_time: string
  end_time: string
  is_cancelled: boolean
  change_notice: ChangeNotice | null
}
export type UnplannedSession = Omit<Slot, 'day_id' | 'room_id' | 'start_time' | 'end_time'> & {
  day_id: null
  room_id: null
  start_time: null
  end_time: null
}
export type ScheduleRoom = Room & { slots: Slot[] }
export type CollisionPair = { first_slot_id: number; second_slot_id: number }
export type SpeakerConflict = CollisionPair & { speaker_ids: number[] }
export type DaySchedule = {
  day_id: number
  date: string
  start_time: string
  end_time: string
  rooms: ScheduleRoom[]
  collisions: CollisionPair[]
  speaker_conflicts: SpeakerConflict[]
}
