export type Event = { id: number; name: string; start_date: string; end_date: string }
export type EventDay = { id: number; event_id: number; date: string; start_time: string; end_time: string }
export type Room = { id: number; event_id: number; name: string; sort_order: number }
export type SpeakerSummary = { id: number; name: string }
export type Speaker = SpeakerSummary & { event_id: number; bio: string | null; website: string | null; photo_url: string | null }
export type SpeakerSession = { id: number; day_id: number; date: string; room_id: number; room_name: string; topic: string; start_time: string; end_time: string }
export type SpeakerDetail = Speaker & { sessions: SpeakerSession[] }
export type Slot = {
  id: number
  day_id: number
  room_id: number
  topic: string
  speaker_ids: number[]
  speakers: SpeakerSummary[]
  description: string | null
  start_time: string
  end_time: string
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
