// ─── 使用者角色 ───────────────────────────────────────────

export type UserRole =
  | 'class_master'   // 主班：最高管理者（與 head_leader 權限相同）
  | 'head_leader'    // 大領班：最高管理者（與 class_master 權限相同）
  | 'leader'         // 領班：基本領班
  | 'junior_leader'  // 小班長：可管理班員入口後台
  | 'member'         // 班員：一般成員

// ─── 出席三態 ─────────────────────────────────────────────

export type AttendanceStatus = 'present' | 'leave' | 'absent'

// ─── 禮節項目狀態 ─────────────────────────────────────────

export type EtiquetteStatus = 'preparing' | 'failed' | 'passed'

// ─── /users/{userId} ─────────────────────────────────────

export interface AppUser {
  uid: string
  name: string
  email: string | null
  photoURL: string | null
  role: UserRole
  classId: string
}

// ─── /classes/{classId} ──────────────────────────────────

export interface Class {
  id: string
  name: string
  leaderIds: string[]
  sheetTabName?: string    // 課表 Google Sheet 的分頁名稱，如 "2026光明"
  sheetClassLabel?: string // 分頁內的等級班標頭，如 "禮行"、"義理"
}

// ─── /etiquette_items/{itemId} ───────────────────────────

export interface EtiquetteItem {
  id: string
  name: string
  order: number
  isActive: boolean
}

// ─── /members/{memberId}（不綁定班級） ────────────────────

export interface Member {
  id: string
  name: string
  birthday: string                                // "MM-DD"
  initialAttendanceCount: number                  // 加入前既有堂數
  mentor: string                                  // 引保師
  regionUnit: string                              // 區域單位
  regionNumber: string                            // 區域數字
  etiquetteItems: Record<string, EtiquetteStatus> // { itemId: status }
  notes: string
  createdAt: string
  createdBy: string
}

// ─── /class_members/{classId}/members/{memberId} ─────────

export interface ClassMember {
  memberId: string
  classId: string
  joinedAt: string
  addedBy: string
  isActive: boolean
  removedAt?: string
  removedBy?: string
  removeReason?: string
}

export interface ClassMemberWithName extends ClassMember {
  className: string
}

// ─── /settings/main ──────────────────────────────────────

export interface Settings {
  regionUnits: string[]
}

// ─── /attendance/{attendanceId} ──────────────────────────

export interface Attendance {
  id: string
  memberId: string
  classId: string
  date: string              // "YYYY-MM-DD"
  status: AttendanceStatus  // 'present' | 'leave' | 'absent'
  note: string              // 備註（例：請假原因）
  recordedBy: string        // 初次建立者
  lastUpdatedBy: string     // 最後更新者
  lastUpdatedAt: string     // 最後更新時間（ISO timestamp）
}

// ─── /sessions/{sessionId} ───────────────────────────────

export interface Session {
  id: string
  classId: string
  date: string          // "YYYY-MM-DD"（上課日）
  createdBy: string     // userId
  createdAt: string     // ISO timestamp
  isFinalized: boolean  // 點名是否已完成送出
  finalizedAt?: string  // ISO timestamp
  finalizedBy?: string  // userId
}

// ─── /weekly_tasks/{classId}/weeks/{weekId} ──────────────

export interface WeeklyTask {
  id: string
  weekStart: string
  hostNotified: boolean            // 本週主持人已通知
  speakerStatuses: Record<string, boolean> // key=date (YYYY-MM-DD)，true=已邀請
  verifyStatuses: Record<string, boolean>  // key=date (YYYY-MM-DD)，true=已驗收
  notes: string
}

// ─── Google Sheets 課表快取（/schedule_cache/{id}） ──────

export interface UpcomingSpeaker {
  date: string          // YYYY-MM-DD
  weekLabel: string     // "本週" | "下週" | "第2週" | "第3週"
  name: string          // 講師名字（空字串代表無安排）
  topic: string         // 講題（空字串代表未讀取到）
  verifyNeeded: boolean // 課表「驗」欄為 TRUE 時需驗收
}

export interface ScheduleData {
  hostThisWeek: string             // 當週操持名字
  hostNextWeek: string             // 下週操持名字
  upcomingSpeakers: UpcomingSpeaker[]
  cleaningDuty?: string            // 習勞輪值班級（從課表讀取）
  syncedAt: string                 // ISO timestamp
}

// ─── Auth Context ─────────────────────────────────────────

export interface AuthContextType {
  user: AppUser | null
  loading: boolean
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
  refreshUser?: () => Promise<void>
}

// ─── 報表 ─────────────────────────────────────────────────

export interface AttendanceReport {
  date: string
  className: string
  present: Member[]
  leave: Member[]
  absent: Member[]
  notes: string
}

// ─── 班員入口：/venues/{venueId} ─────────────────────────

export interface Venue {
  id: string
  name: string              // 佛堂名稱，如「三重佛堂」
  city: string              // '台北' | '新北' | '桃園'
  address: string           // 完整地址
  mapUrl: string            // Google Maps 分享連結
  lineGroupUrl?: string     // ★ LINE 群組加入連結
  description: string       // 簡介（可空）
  members?: string[]        // ★ 手動維護的成員姓名陣列
  order: number             // 顯示排序（小的在前）
}

// ─── 班員入口：/events/{eventId} ─────────────────────────

export type EventType = 'lecture' | 'trip' | 'camp' | 'class' | 'other'

export interface Responsible {
  name: string
  lineId: string            // LINE ID（加好友用）
}

export interface PortalEvent {
  id: string
  title: string
  type: EventType
  description: string
  imageUrl?: string         // ★ 活動封面圖片（Firebase Storage URL）
  eventDates: string[]      // YYYY-MM-DD 陣列（可多天）
  deadline: string          // 意願填寫截止日，YYYY-MM-DD
  responsible: Responsible[] // ★ 負責人陣列（至多 3 位）
  isPublished: boolean      // 大領班控制上下架
  createdAt: string
  createdBy: string
  claimedBy?: {             // ★ 認領此活動回覆管理的小班長
    uid: string
    name: string
    claimedAt: string
  }
}

// ─── 班員入口：/event_responses/{responseId} ─────────────

export type InterestLevel = 'yes' | 'maybe' | 'no'

export interface EventResponse {
  id: string
  eventId: string
  name: string
  phone: string
  email: string             // ★ 必填 email
  interest: InterestLevel   // 'yes'=參加, 'maybe'=考慮, 'no'=無法參加
  note: string
  submittedAt: string
  submitterUid?: string     // 若以 member 身分登入則帶入
}
