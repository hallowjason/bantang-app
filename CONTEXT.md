# Session Context — 2026-04-20 21:50

## 專案路徑
/Users/gooo/Desktop/.claude/projects/bantang-app (main)
進行中 PR branch: claude/charming-goldwasser-3a5d63 → PR #1

## 最近 commits（此 PR branch）
72351a4 feat: iccf Phase 4 - frontend session_expired retry + repair button + status badges
3d60931 feat: iccf Phase 4 - session liveness check + repair endpoint + error copy
431c0cf feat: auto-backfill iccfClassCode to classes doc on iccf login

## 本次 Session 完成（Phase 4 全部）

### Backend（3d60931）
- 新增 `server/src/iccf/ensureAlive.ts`：getSession → ping iccf → touch TTL
- `POST /api/members`：addMember 前 ping；死 session → 回 `status: session_expired`
- `POST /api/members/:id/iccf-sync`（**新端點**）：重跑單一班員 iccf 補入
- `POST /api/iccf/sync`：建 job 前 ping；死 session → `{ jobId: null, sessionExpired: true }`
- `iccfSyncWorker`：新增 `errorCode: 'session_expired' | 'unknown'`

### Frontend（72351a4）
- `src/lib/iccfCopy.ts`：7 種 iccf 狀態 → badge / tone / summary / suggestedReply（ROLLCALL.md 話術）
- `MemberForm`：偵測 session_expired → 自動彈 IccfLoginModal → 重試 doSave
- `Attendance`：sessionExpired → 只重試 triggerIccfSync（不重跑 finalize）；job 輪詢到 session_expired 顯示「重新登入並重試」連結
- `Members`：iccf status badge（各 tone 色）+ 「重試 iccf 補入」修復按鈕

## 待辦
- PR #1 review & merge
- 手動驗收：
  - iccf session 過期 → 補入/點名自動重登重試
  - 「重試 iccf 補入」按鈕各失敗狀態
  - Members badge 顏色正確

## 重要決策與限制
- iccf session 不存密碼，30 min idle 後過期
- ping 走 `/publicphp/header_all5.php`，透過偵測 `name=zant` 判斷
- ensureAlive 失敗自動刪 server-side session
- worktree tsc 需 symlink node_modules：`ln -sf /path/to/bantang-app/node_modules node_modules`

## 下次繼續
```
cd /Users/gooo/Desktop/.claude/projects/bantang-app
# 如果 PR #1 已 merge：git pull origin main
# 告訴 Claude：「閱讀 CONTEXT.md，繼續下一個功能」
```
