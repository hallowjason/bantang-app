# Session Context — 2026-04-21 12:10

## 專案路徑
/Users/gooo/Desktop/.claude/projects/bantang-app/.claude/worktrees/hungry-vaughan-40d7f3 (branch: claude/hungry-vaughan-40d7f3)

## 狀態

- **Phase 1**：已合併（PR #6 → main 的 `99a5985`）— login + role-based navigation
- **Phase 2**：已合併（PR #7 → main 的 `e43e089`）— attendance 三態循環 + finalize + reopen
- **Phase 3**：進行中 — Members CRUD E2E 測試

## Phase 3 測試規格（新檔：e2e/specs/members.spec.ts）

### 共用 helpers（放 spec 檔頂部）
- `setupLeaderOnMembers(page, members?)` — seed class + optional members + mintE2EToken(leader, classId) + goto /members
- `longPress(locator, ms=700)` — dispatchEvent pointerdown → waitForTimeout → dispatchEvent pointerup（觸發 RemoveDialog）
- `memberRow(page, name)` — `page.locator('li').filter({ hasText: name }).locator('button').first()`

### 6 個 test

| # | 測試名 | 動作與斷言 |
|---|-------|-----------|
| 1 | 新增班員（最小必填） | 點「＋ 新增」→ 填姓名 → 儲存 → 列表顯示新名 + 「0 堂」badge |
| 2 | 新增班員（完整欄位） | 填姓名 + 月 + 日 + 引保師 + 初始堂數 + 第一個 region unit → 儲存 → 列表含該班員；詳細頁顯示正確資料 |
| 3 | 編輯班員（姓名 + 備註） | seed 1 位 → 點進 detail → 「編輯」→ 改姓名 + 填備註 → 儲存 → detail header 顯示新名 + 備註區塊可見 |
| 4 | PUT allow-list 生效 | 呼叫 `apiPut('/api/members/:id', { name: 'X', iccfStatus: 'synced' })` → GET 回該 member → `iccfStatus` 仍為 undefined（被 allow-list 濾掉），`name` 已更新 |
| 5 | 長按移除班員（含原因必填） | seed 2 位 → longPress 班員甲 → 按「確認移除」空原因 → 顯示「請填寫移除原因」→ 填原因 → 確認 → 列表只剩班員乙 |
| 6 | 空狀態 | seedClass 但不 seedMembers → 顯示「尚無班員」+「＋ 新增」按鈕可見 |

### 關鍵 selector（已 grep 確認）
- 新增按鈕：`getByRole('button', { name: '＋ 新增' })`
- 儲存按鈕：`getByRole('button', { name: /儲存$/ })`（避「儲存中...」干擾）
- 列表項 badge：`li button` 最後 span（顯示「N 堂」）
- 移除 dialog 標題：`「移除出班」`
- 原因 textarea：`getByPlaceholder('請填寫移除原因')`
- 確認移除：`getByRole('button', { name: '確認移除' })`
- 編輯按鈕（MemberDetail header）：`getByRole('button', { name: '編輯' })`
- 空狀態文字：`getByText('尚無班員')`

### 技術重點
- **不 seed iccfClassCode** → MemberForm 不觸發 iccf 流程，submit 走 `doSave()`
- **不用自訂 region unit** → 會呼叫 `POST /api/settings/region-units`（requireTopAdmin，leader 會 403）；直接用 default region units（「精明」等）
- **long-press 模擬** → 用 `dispatchEvent` 觸發 pointerdown/pointerup；pressTimer 600ms，需 wait ≥ 700ms
- **PUT allow-list 測試** → 繞過 UI，直接呼叫 API。需要 helper `apiPutWithToken(path, body, token)` 或直接 fetch with Authorization header

### Isolation
每個 test 用 `uniqueClassId('e2e-mem')`，避免 worker 間污染。

## 驗證
- `npm run test:e2e` 全綠（Phase 1 + 2 + 3 共 16 tests）
- `npx tsc --noEmit` clean
- 單跑：`npx playwright test e2e/specs/members.spec.ts`

## 下次繼續
```
cd /Users/gooo/Desktop/.claude/projects/bantang-app/.claude/worktrees/hungry-vaughan-40d7f3
# 告訴 Claude：「繼續 Phase 3」
```
