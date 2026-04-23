# 佛堂進階班管理平台 — 專案 Spec

> 本文件適用於放入 Cursor AI 的 `.cursorrules` 或專案根目錄的 `CLAUDE.md`。
> 每次開發時，AI 助理應先閱讀此文件，遵照架構與規範進行。

---

## 專案概述

**專案名稱：** 佛堂進階班出席管理平台（暫名：`bantang-app`）
**目標使用者：** 佛堂進階班的領班（每班 2–3 人，共 6–20 人）與大領班（1 人）
**使用情境：** 每週上課時透過手機瀏覽器使用（PWA）；亦支援非上課日查詢與補登

### 核心功能
1. **點名系統** — 班員出席記錄（出席 / 請假 / 缺席三態）、查看累計堂數、距上次出席天數、生日提醒
2. **每週提醒** — 講師邀請狀態、主持輪值提醒、個人輪值預告
3. **報表匯出** — 快速產生本週出席文字摘要，可一鍵複製貼到群組

---

## 技術架構

### 前端
- **框架：** React 18（Vite 建立）
- **語言：** TypeScript
- **樣式：** Tailwind CSS v4（使用 `@tailwindcss/vite` plugin）
- **路由：** React Router v6
- **狀態管理：** React Context + useReducer（小型，不需 Redux）
- **目標：** PWA（需加入 `manifest.json` 與 Service Worker，讓使用者可加入手機桌面）

### 後端 / 資料庫
- **平台：** Firebase（Google）
  - **Firestore** — 主要資料庫，使用 `onSnapshot` 實現即時同步，支援多領班同時點名
  - **Firebase Authentication** — 登入（使用 Google Sign-In，不需記帳密碼）
  - **Firebase Hosting** — 靜態部署
- **費用：** Spark（免費）方案，規模在 6–20 位使用者範圍內完全足夠

### 開發工具
- **編輯器：** Cursor AI
- **版本控制：** Git + GitHub
- **部署：** Firebase CLI（`firebase deploy`）

---

## 資料結構（Firestore Collections）

```
/users/{userId}
  - name: string
  - email: string
  - role: "class_master" | "leader" | "junior_leader" | "member"
  - isAdmin?: boolean  ← 領班可帶此旗標，享有等同主班的權限
  - classId: string  ← 所屬班級

/classes/{classId}
  - name: string         ← 班級名稱（例：「第一班」）
  - leaderIds: string[]  ← 所有領班的 userId

/members/{memberId}
  - name: string
  - birthday: string                              ← ISO 格式 "MM-DD"（不含年份）
  - initialAttendanceCount: number                ← 加入前既有堂數
  - mentor: string                                ← 引保師
  - regionUnit: string                            ← 區域單位
  - regionNumber: string                          ← 區域數字
  - etiquetteItems: Record<string, EtiquetteStatus>  ← { itemId: status }
  - notes: string
  - createdAt: string
  - createdBy: string

/class_members/{classId}/members/{memberId}
  - memberId: string
  - classId: string
  - joinedAt: string      ← "YYYY-MM-DD"
  - addedBy: string       ← userId
  - isActive: boolean     ← false = 軟刪除
  - removedAt?: string
  - removedBy?: string
  - removeReason?: string

/attendance/{attendanceId}
  - memberId: string
  - classId: string
  - date: string              ← ISO 格式 "YYYY-MM-DD"
  - status: AttendanceStatus  ← "present" | "leave" | "absent"（取代 boolean）
  - note: string              ← 備註（例：請假原因）
  - recordedBy: string        ← userId（最後更新者）
  - lastUpdatedBy: string     ← userId
  - lastUpdatedAt: string     ← ISO timestamp

/sessions/{sessionId}
  - classId: string
  - date: string          ← "YYYY-MM-DD"（上課日）
  - createdBy: string     ← userId
  - createdAt: string
  - isFinalized: boolean  ← 點名是否已完成送出
  - finalizedAt?: string
  - finalizedBy?: string

/weekly_tasks/{classId}/weeks/{weekId}
  - weekStart: string           ← "YYYY-MM-DD"
  - speakerConfirmed: boolean   ← 講師已確認（取代 guestSpeakerInvited）
  - hostThisWeek: string        ← memberId 或 userId
  - hostNotified: boolean       ← 主持人已通知
  - nextHostPreview: string     ← 下週主持人預告（memberId）
  - notes: string

/settings/main
  - regionUnits: string[]       ← 可用區域單位清單

/etiquette_items/{itemId}
  - name: string
  - order: number
  - isActive: boolean
```

---

## 多領班協作機制

同一班級可能有 2–3 位領班同時使用 App 進行點名：

- **即時同步：** 所有點名頁面使用 `onSnapshot` 監聽 `attendance` 集合，變更即時反映到其他領班的畫面
- **衝突處理：** 採 last-write-wins 策略；每筆 attendance 記錄 `lastUpdatedBy` 與 `lastUpdatedAt`，UI 可顯示「最後由 XX 更新」
- **協作提示（選做）：** 可在點名頁右上角顯示 `ActiveEditors` 元件，列出目前正在點名的其他領班姓名縮寫

---

## 權限設計

| 角色 | 可操作範圍 |
|------|-----------|
| `leader`（領班） | 只能查看、編輯**自己班級**的資料；底部導覽 3 個 Tab |
| `class_master`（主班）或帶 `isAdmin` 旗標的領班 | 可查看**所有班級**的資料與匯出報表；底部導覽額外增加第 4 個「總覽」Tab |

Firebase Firestore Security Rules 必須實作上述邏輯，**不得在前端單獨控制權限**。

---

## 導覽架構（Bottom Tab Bar）

底部固定導覽列，高度 64px，取代側邊選單：

| Tab | Icon | 路由 | 顯示對象 |
|-----|------|------|---------|
| 點名 | 📋 | `/attendance` | 所有人 |
| 本週 | 📅 | `/weekly` | 所有人 |
| 班員 | 👥 | `/members` | 所有人 |
| 總覽 | 🏛 | `/admin` | 最高管理者（主班 / `isAdmin` 領班）限定 |

- Tab 切換不重新載入資料（React Router `<Outlet>` 模式）
- 底部安全區域（iOS Home Indicator）需加 `pb-safe` padding
- 活躍 Tab 使用 amber-700 高亮，非活躍用 gray-400

---

## 頁面結構

```
/login              → Google 登入頁
/attendance         → 點名頁（預設首頁；顯示班員列表、三態出席按鈕）
/members            → 班員管理（新增、編輯、查看個人出席紀錄）
/members/:id        → 個人詳情（累計堂數、生日、距上次出席、禮節進度）
/weekly             → 每週任務確認（講師、主持輪值）
/report             → 匯出本週出席報表（文字格式、一鍵複製）
/admin              → （大領班限定）所有班級總覽
```

> `/dashboard` 已移除；`*` fallback 導向 `/attendance`

---

## 點名頁面設計規範（`/attendance`）

### 狀態設計
出席採三態循環按鈕：`出席（present）→ 請假（leave）→ 缺席（absent）→ 出席...`

```
AttendanceStatus = "present" | "leave" | "absent"
```

| 狀態 | 顏色 | Icon |
|------|------|------|
| present（出席） | green-500 | ✅ |
| leave（請假）   | amber-500 | 🟡 |
| absent（缺席）  | gray-300  | ⬜ |

### 頁面元素（由上到下）
1. **Header** — 日期選擇器（預設今日）+ 班級名稱
2. **進度列** — 「已點 N / 總 M 人」進度條
3. **班員列表** — 每人一行：姓名 + 三態按鈕（點擊循環切換）
4. **完成按鈕** — 底部固定「完成點名」按鈕，點擊後確認並寫入 Session（isFinalized: true）

### 互動規則
- 預設所有人為 `absent`
- 點擊班員的出席按鈕，立即寫入 Firestore（樂觀更新 UI，後台 `setDoc`）
- 使用 `onSnapshot` 同步，其他領班的變更即時更新
- 完成點名後按鈕變為「重新開啟」，允許補登

---

## 本週任務頁面設計規範（`/weekly`）

採 Checklist 格式，每項任務可勾選：

```
□ 講師已確認邀請（speakerConfirmed）
□ 本週主持人已通知（hostNotified）：{主持人姓名}
  下週主持人預告：{nextHostPreview 姓名}
□ 備註欄位（自由文字）
```

- 每個 checkbox 點擊即寫入 Firestore
- 主持人欄位顯示姓名，點擊可開啟下拉選擇班員

---

## 報表文字格式範本

```
【進階班出席報表】
日期：{YYYY年MM月DD日}
班別：{班級名稱}

出席（{n}人）：{姓名1}、{姓名2}、...
請假（{k}人）：{姓名A}、{姓名B}、...
缺席（{m}人）：{姓名C}、{姓名D}、...

備註：{notes}

— 由佛堂進階班系統自動產生
```

---

## 視覺設計規範

### 色彩系統
| 用途 | Tailwind Token | Hex 參考 |
|------|---------------|---------|
| 主色（文字/按鈕） | `amber-700` | #b45309 |
| 主色淡（背景/邊框） | `amber-100` | #fef3c7 |
| 頁面底色 | `amber-50` | #fffbeb |
| 出席 / 成功 | `green-500` | #22c55e |
| 請假 / 警示 | `amber-500` | #f59e0b |
| 缺席 / 錯誤 | `gray-300` | #d1d5db |
| 禮節未通過 | `red-500` | #ef4444 |
| 生日提醒背景 | `pink-50` | #fdf2f8 |

### 字型
- **主字型：** `Noto Serif TC`（Google Fonts 引入）— 溫潤的繁體中文感
- **備用：** `system-ui, sans-serif`
- **最小字型：** 16px（避免 iOS 自動縮放）

### 間距與圓角
- 卡片圓角：`rounded-2xl`（16px）
- 行內元素圓角：`rounded-xl`（12px）
- 標準內距：`px-4 py-3`（頁面邊距 16px）
- 卡片陰影：`shadow-sm`

### 觸控目標
- 所有可點擊元素最小高度：**44px**（符合 Apple HIG）
- 點名行高建議：`py-3`（48px 含文字）

---

## TypeScript 型別定義

```typescript
// ─── 出席三態 ────────────────────────────────────────────
export type AttendanceStatus = 'present' | 'leave' | 'absent'

// ─── 禮節項目狀態 ─────────────────────────────────────────
export type EtiquetteStatus = 'preparing' | 'failed' | 'passed'

// ─── 使用者角色 ───────────────────────────────────────────
export type UserRole = 'class_master' | 'leader' | 'junior_leader' | 'member'

// ─── /users/{userId} ─────────────────────────────────────
export interface AppUser {
  uid: string
  name: string
  email: string | null
  photoURL: string | null
  role: UserRole
  isAdmin?: boolean   // 領班可帶此旗標，視同 class_master
  classId: string
}

// ─── /members/{memberId} ─────────────────────────────────
export interface Member {
  id: string
  name: string
  birthday: string                                // "MM-DD"
  initialAttendanceCount: number
  mentor: string
  regionUnit: string
  regionNumber: string
  etiquetteItems: Record<string, EtiquetteStatus>
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

// ─── /attendance/{attendanceId} ──────────────────────────
export interface Attendance {
  id: string
  memberId: string
  classId: string
  date: string              // "YYYY-MM-DD"
  status: AttendanceStatus  // 取代原 present: boolean
  note: string
  recordedBy: string
  lastUpdatedBy: string
  lastUpdatedAt: string
}

// ─── /sessions/{sessionId} ───────────────────────────────
export interface Session {
  id: string
  classId: string
  date: string
  createdBy: string
  createdAt: string
  isFinalized: boolean
  finalizedAt?: string
  finalizedBy?: string
}

// ─── /weekly_tasks/{classId}/weeks/{weekId} ──────────────
export interface WeeklyTask {
  id: string
  weekStart: string
  speakerConfirmed: boolean
  hostThisWeek: string
  hostNotified: boolean
  nextHostPreview: string
  notes: string
}

// ─── /etiquette_items/{itemId} ───────────────────────────
export interface EtiquetteItem {
  id: string
  name: string
  order: number
  isActive: boolean
}

// ─── /settings/main ──────────────────────────────────────
export interface Settings {
  regionUnits: string[]
}

// ─── Auth Context ─────────────────────────────────────────
export interface AuthContextType {
  user: AppUser | null
  loading: boolean
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
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
```

---

## 元件命名規範

- 元件檔案：`PascalCase.tsx`（例：`AttendanceList.tsx`）
- 工具函式：`camelCase.ts`（例：`formatReport.ts`）
- Firebase 操作集中在 `src/lib/firebase/` 資料夾
- 頁面放在 `src/pages/`，可複用元件放在 `src/components/`

### 主要元件清單
| 元件 | 說明 |
|------|------|
| `BottomNav.tsx` | 底部固定導覽列（3 或 4 Tab） |
| `MemberCard.tsx` | 班員卡片（列表用，顯示姓名 + 區域 + 堂數） |
| `MemberForm.tsx` | 新增 / 編輯班員底部 Sheet |
| `BirthdayBanner.tsx` | 生日倒數提醒橫幅 |
| `ActiveEditors.tsx` | 顯示正在協作的其他領班（選做） |
| `ReportText.tsx` | 報表預覽文字 + 一鍵複製按鈕 |
| `AttendanceRow.tsx` | 點名列表的單行（姓名 + 三態按鈕） |
| `StatCard.tsx` | 數字統計小卡（累計堂數等） |

---

## 專案資料夾結構

```
bantang-app/
├── public/
│   ├── manifest.json        ← PWA 設定
│   └── icons/               ← App 圖示
├── src/
│   ├── components/          ← 可複用 UI 元件
│   │   ├── BottomNav.tsx
│   │   ├── MemberCard.tsx
│   │   ├── MemberForm.tsx
│   │   ├── BirthdayBanner.tsx
│   │   ├── ActiveEditors.tsx
│   │   ├── ReportText.tsx
│   │   ├── AttendanceRow.tsx
│   │   └── StatCard.tsx
│   ├── pages/               ← 對應路由的頁面
│   │   ├── Login.tsx
│   │   ├── Attendance.tsx
│   │   ├── Members.tsx
│   │   ├── MemberDetail.tsx
│   │   ├── Weekly.tsx
│   │   ├── Report.tsx
│   │   └── Admin.tsx
│   ├── lib/
│   │   └── firebase/        ← Firestore CRUD、Auth 操作
│   │       ├── config.ts
│   │       ├── auth.ts
│   │       ├── members.ts
│   │       ├── attendance.ts   ← 點名讀寫、onSnapshot
│   │       ├── sessions.ts     ← Session 建立與完成
│   │       ├── weekly.ts
│   │       └── settings.ts
│   ├── context/             ← AuthContext、ClassContext
│   ├── hooks/               ← 自定義 hooks
│   │   ├── useAttendance.ts    ← onSnapshot 點名訂閱
│   │   ├── useMembers.ts
│   │   └── useWeeklyTask.ts
│   ├── types/               ← TypeScript 型別定義（index.ts）
│   └── utils/               ← 工具函式
│       ├── formatReport.ts     ← 報表文字產生
│       ├── dateHelpers.ts      ← 日期計算（生日倒數等）
│       └── attendanceHelpers.ts
├── .cursorrules             ← 本文件（或參考 CLAUDE.md）
├── firebase.json
├── firestore.rules
├── firestore.indexes.json
└── vite.config.ts
```

---

## Firestore Security Rules 規範

```javascript
// firestore.rules 重點邏輯（偽代碼）

// /users/{userId}
//   只有本人可讀寫

// 最高管理者（isTopAdmin）= role == 'class_master' || isAdmin == true

// /members/{memberId}
//   登入使用者皆可讀
//   只有 leader / 最高管理者 可寫

// /class_members/{classId}/members/{memberId}
//   get /users/{userId}.classId === classId → 可讀寫
//   最高管理者 → 可讀所有

// /attendance/{attendanceId}
//   attendanceId 的 classId === user.classId → 可讀寫
//   最高管理者 → 可讀所有

// /weekly_tasks/{classId}/weeks/{weekId}
//   classId === user.classId → 可讀寫
//   最高管理者 → 可讀寫所有

// /settings/main
//   所有登入使用者可讀
//   只有最高管理者 可寫
```

**原則：** 所有權限判斷必須在 Security Rules 層執行，前端只做 UI 控制（不可依賴前端做安全防護）。

---

## 開發優先順序（Sprint 建議）

### Sprint 1 — 基礎架構
- [x] Vite + React + TypeScript 初始化
- [x] Firebase 專案設定與連接
- [x] Google 登入（Firebase Auth）
- [x] 基本路由與 Layout
- [ ] `BottomNav.tsx` 元件（3 / 4 Tab）
- [ ] 移除 `/dashboard`，將 `/attendance` 設為預設

### Sprint 2 — 班員管理
- [x] 班員資料 CRUD（Firestore + class_members 子集合）
- [x] 個人出席詳情（堂數、距上次、生日警示）
- [x] 禮節項目管理（20 項，三態狀態）
- [x] 長按移除班員（軟刪除）

### Sprint 3 — 點名系統
- [ ] 更新 `Attendance` 型別（`status` 三態取代 `boolean`）
- [ ] 新增 `Session` 資料結構與 Firebase 操作
- [ ] 點名頁面（三態循環、進度條、`onSnapshot` 即時同步）
- [ ] 完成點名 → 寫入 Session（isFinalized）

### Sprint 4 — 提醒與報表
- [ ] 每週任務頁面（Checklist 格式，勾選即寫入）
- [ ] 報表文字產生（三態：出席/請假/缺席）
- [ ] 一鍵複製報表文字

### Sprint 5 — 完善與部署
- [ ] Firebase Security Rules 完整設定
- [ ] PWA manifest + icon
- [ ] Firebase Hosting 部署
- [ ] 多裝置測試（手機優先）
- [ ] `ActiveEditors` 協作提示（選做）

---

## 注意事項 & 限制

- **手機優先設計：** 所有 UI 以 375px 寬手機螢幕為主要設計尺寸
- **繁體中文介面：** 所有 UI 文字使用繁體中文
- **最小字型 16px：** 防止 iOS Safari 自動縮放輸入框
- **不使用原生 App：** 避免 App Store 上架費用，全部使用 PWA Web
- **免費優先：** 外部服務優先選擇有免費方案的（Firebase Spark、Vercel Free 等）
- **不儲存敏感個人資料：** 不儲存身份證、電話等敏感欄位，只需姓名與生日月日
- **非上課日支援：** 日期選擇器允許補登過去日期，不強制只能當日點名

---

*最後更新：2026-03*
