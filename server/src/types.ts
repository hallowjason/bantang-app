// Shared types for the backend (mirrors frontend src/types/index.ts)

export type UserRole =
  | 'class_master'
  | 'leader'
  | 'junior_leader'
  | 'member'

export type AttendanceStatus = 'present' | 'leave' | 'absent'
export type EtiquetteStatus = 'preparing' | 'failed' | 'passed'
export type EventType = 'lecture' | 'trip' | 'camp' | 'class' | 'other'
export type InterestLevel = 'yes' | 'maybe' | 'no'

export interface AppUser {
  _id: string   // Firebase UID
  name: string
  email: string | null
  photoURL: string | null
  role: UserRole
  classId: string
  isAdmin?: boolean  // 「管理員」標籤：可由主班或現任管理員指派
}

export interface IccfClassCodeHistoryEntry {
  from: string
  to: string
  at: string   // ISO 8601
  byLeaderUid: string
  /**
   * - backfill              : DB 空 + iccf 恰好 1 個 active，直接寫入
   * - backfill_name_match   : DB 空 + iccf 多個 active，用 app class.name 字元 subsequence
   *                           比對命中恰好 1 個 active className 才寫入
   * - annual_renewal        : DB 有舊碼 + 舊碼對應 iccf 已結班 + iccf 恰好 1 個新 active
   * - annual_renewal_name_match : 同上但多個 active 時用 name subsequence 篩到唯一一個
   */
  reason:
    | 'backfill'
    | 'backfill_name_match'
    | 'annual_renewal'
    | 'annual_renewal_name_match'
  /**
   * Optional: snapshot of the matched iccf className at write time. Only set
   * for *_name_match reasons so the audit log shows which iccf class was
   * picked. Useful for auditing potential mis-matches without replaying the
   * iccf list.
   */
  matchedClassName?: string
}

export interface Class {
  _id: string
  name: string
  leaderIds: string[]
  sheetTabName?: string
  sheetClassLabel?: string
  iccfClassCode?: string
  /** Append-only audit log of automatic iccfClassCode writes (backfill + renewal). */
  iccfClassCodeHistory?: IccfClassCodeHistoryEntry[]
}

export interface EtiquetteItem {
  _id: string   // e.g. "item_01"
  name: string
  order: number
  isActive: boolean
}

export type IccfSyncStatus = 'pending' | 'synced' | 'not_found' | 'name_mismatch' | 'duplicate' | 'forbidden' | 'error'

export interface Member {
  _id: string
  name: string
  birthday: string
  initialAttendanceCount: number
  mentor: string
  regionUnit: string
  regionNumber: string
  etiquetteItems: Record<string, EtiquetteStatus>
  notes: string
  createdAt: string
  createdBy: string
  iccfStatus?: IccfSyncStatus
  iccfMemberId?: string
  iccfSyncedAt?: string
  iccfLastError?: string
}

export interface ClassMember {
  _id: string   // "{classId}_{memberId}"
  memberId: string
  classId: string
  joinedAt: string
  addedBy: string
  isActive: boolean
  removedAt?: string
  removedBy?: string
  removeReason?: string
}

export interface Attendance {
  _id: string   // "{classId}_{memberId}_{date}"
  memberId: string
  classId: string
  date: string
  status: AttendanceStatus
  note: string
  recordedBy: string
  lastUpdatedBy: string
  lastUpdatedAt: string
}

export interface Session {
  _id: string   // "{classId}_{date}"
  classId: string
  date: string
  createdBy: string
  createdAt: string
  isFinalized: boolean
  finalizedAt?: string | null
  finalizedBy?: string | null
  iccfSyncedAt?: string | null   // ISO timestamp of last successful iccf attendance sync
  iccfSyncJobId?: string | null  // jobId of the last successful sync
}

export interface WeeklyTask {
  _id: string   // "{classId}_{weekStart}"
  classId: string
  weekStart: string
  hostNotified: boolean
  speakerStatuses: Record<string, boolean>
  verifyStatuses: Record<string, boolean>
  notes: string
}

export interface Settings {
  _id: string   // "main"
  regionUnits: string[]
}

export interface Venue {
  _id: string
  name: string
  city: string
  address: string
  mapUrl: string
  lineGroupUrl?: string
  description: string
  members?: string[]
  order: number
}

export interface Responsible {
  name: string
  lineId: string
}

export interface PortalEvent {
  _id: string
  title: string
  type: EventType
  description: string
  imageUrl?: string
  eventDates: string[]
  deadline: string
  responsible: Responsible[]
  isPublished: boolean
  createdAt: string
  createdBy: string
  claimedBy?: {
    uid: string
    name: string
    claimedAt: string
  }
}

export interface UpcomingSpeaker {
  date: string
  weekLabel: string
  name: string
  topic: string
  verifyNeeded: boolean
}

export interface ScheduleData {
  hostThisWeek: string
  hostNextWeek: string
  upcomingSpeakers: UpcomingSpeaker[]
  cleaningDuty?: string
  syncedAt: string
}

export interface EventResponse {
  _id: string
  eventId: string
  name: string
  phone: string
  email: string
  interest: InterestLevel
  note: string
  submittedAt: string
  submitterUid?: string
}
