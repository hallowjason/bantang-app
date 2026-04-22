# Session Context — 2026-04-22 iccf 修正

## 專案路徑
/Users/gooo/Desktop/.claude/projects/bantang-app (branch: main)

## 本次 session 摘要

用戶回報兩個 iccf 同步相關 bug：

### 問題 1：一般領班看不到 iccf 登入入口（雞生蛋）
- 點名頁 iccf UI 被 `iccfClassCode` gated，但這個欄位只有靠 server 的 `backfillIccfClassCode` 在領班登入 iccf 成功後才會自動回寫
- Admin iccf tab 又只給 `head_leader / class_master`
- 一般領班永遠沒辦法登入 → class doc 永遠缺 iccfClassCode → UI 永遠不顯示 → 一般領班永遠沒辦法登入

### 問題 2：許眾棠完成點名但 iccf 沒更新
- 沒有排程送出；sync 是 in-memory 非同步 job
- 多條 silent-failure 路徑：
  1. `iccfClassCode` 空 → 完全不跑 sync
  2. `triggerIccfSync` 的 `catch { /* ignore */ }` 吞掉 400 / 403 錯誤
  3. session 過期 → 要求再登入，用戶若離開就斷了
  4. 伺服器重啟 → in-memory jobs Map 全清空
- Firebase finalize 先成功、toast 顯示「✓ 已完成點名」騙了用戶，但 iccf 實際沒寫入

## 上次完成（Pass 1 — commit 於本次 session）

全部改在 `src/pages/Attendance.tsx`：

**問題 1：**
- import 加 `iccfLogout`
- Session 指示器拿掉 `iccfClassCode` gate，改三態顯示（已登入 / 未登入+已綁定 / 未綁定）
- 新增獨立「登入 iccf / 登出」按鈕（只要未 finalized 永遠可見）
- 新增 `handleIccfLogout` 函式

**問題 2：**
- 新增 `iccfSyncNotice` state (`{ level: 'error'|'warn'|'info', text }`)
- `triggerIccfSync`：catch error 改成塞進 notice（紅色）；新處理 `jobId: null + message` info 路徑
- `doFinalize`：iccfClassCode 設了但沒 sessionId 時顯示 warn notice（琥珀色）
- UI 加 notice 面板（可關閉 ×）

驗證：`tsc --noEmit` ✓、`npm run build` ✓、preview runtime 無 React error
⚠️ preview 無法完整驗收 iccf panel（後端沒跑 + 無 seed data，`members.length > 0` gate 擋住 footer）

## 待辦 / 未完成

### Pass 2：完成點名後若 iccf 沒同步，顯示「重新送出 iccf」按鈕
- 目的：讓「已 finalized 但 iccf 失敗」的班期可以後補同步，不用「重新開啟補登」
- 做法：在 finalized 狀態下（現在只有「產生出席報表」+「重新開啟補登」）加第三個按鈕
- 需要判斷「已 finalized 但 `iccfSyncedAt` 未寫入」→ 顯示按鈕
- 按鈕行為：呼叫現有的 `triggerIccfSync`（force 或非 force 皆可），會觸發 server 的 ensureAlive 檢查 session 存活
- server 端現有 `force` 路徑已支援「已同步過」的 override，所以 Pass 2 基本上只是把 UI 按鈕接到現有流程

### Pass 3（策略層面，未決定要不要做）
- **iccf 失敗時是否不標 Firebase finalized？** 風險：iccf 持續掛掉時用戶永遠無法「完成」；建議不做，改用 Pass 2 的 retry 按鈕
- **in-memory job store 搬 MongoDB？** 避免 server 重啟 job 掉。現有的 `jobs = new Map()` 在 `server/src/jobs/iccfSyncWorker.ts`

## 重要決策與限制

- 不要動 server 端（除非 Pass 3 決議動）
- iccfSyncNotice 用單一 state 而不是多個，避免狀態擴散
- 後端 API (`/api/iccf/sync`) 已經有 `force` 參數支援重新送出，不用再加後端 route
- `apiPost` 會吞掉 server response 的 `code` 欄位，只保留 `error` message —— 如果 Pass 2/3 需要 code 判斷，要先改 `client.ts`
- server 端 `createIccfSyncJob` 裡的 `findInFlightJob` 會去重，同一個 `(classId, date)` 不會重複跑
- Session 資料結構（bantang 端 `Session`）已有 `iccfSyncedAt` 欄位，worker 成功後會回寫 MongoDB 的 sessions doc

## 下次繼續

```
cd /Users/gooo/Desktop/.claude/projects/bantang-app
# 告訴 Claude：「繼續上次的工作，做 Pass 2」
```
