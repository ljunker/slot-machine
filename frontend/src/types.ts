export type Event = { id: number; name: string; start_date: string; end_date: string }
export type EventDay = { id: number; event_id: number; date: string; start_time: string; end_time: string }
export type Room = { id: number; event_id: number; name: string; sort_order: number }
export type Slot = {
  id: number
  day_id: number
  room_id: number
  topic: string
  speaker: string | null
  description: string | null
  start_time: string
  end_time: string
}
export type ScheduleRoom = Room & { slots: Slot[] }
export type CollisionPair = { first_slot_id: number; second_slot_id: number }
export type DaySchedule = {
  day_id: number
  date: string
  start_time: string
  end_time: string
  rooms: ScheduleRoom[]
  collisions: CollisionPair[]
}
