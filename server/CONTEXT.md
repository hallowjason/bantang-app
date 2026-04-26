# Session Context — 2026-04-26 18:30

## 專案路徑
/Users/gooo/Desktop/.claude/projects/bantang-app/server (branch: main)

> 這是 server 子專案 CONTEXT；全專案總覽請讀 `../CONTEXT.md`。

## 最近 5 個 commits
08ab371 feat(iccf): 年度換班自動偵測 + 審計歷程
ded10b9 fix(iccf): 班別代號編輯收斂為主班 / 管理員專用
c7bb4f4 feat(admin): 管理員授予/移除 toggle
885e71a refactor: 全站套用 class_master + isAdmin 角色模型
678541e refactor(auth): 拆分 head_leader 為 class_master + isAdmin tag

## 本次 Session 後端變動

### Bug Fix：members.ts sec_class 傳錯參數
- `src/routes/members.ts`（兩處）：`POST /api/members` 與 `POST /api/members/:id/iccf-sync` 補入前加 `classEntry` lookup，將 B-number 轉為 sec_code 再傳給 `iccfAddMember`。

### 新增：parser.ts ClassMemberEntry 相關
- `ClassMemberEntry` interface：`{ name, alternateName, regionCell, iccfMemberId }`
- `parseClassMemberList(html)` — 解析 show_classmbr5.php；動態 header 偵測；no_mem form-decode
- `normalizeRegionKey(unit, number?)` — regionUnit+Number 合併/標準化，供 duplicate 比對

### 新增：client.ts addMember 預檢流程
- 函數簽章：`addMember(jar, name, regionUnit, regionNumber, classCode, iccfClassCode)`
- Step 0：fetch show_classmbr5.php → parseClassMemberList → normalizeRegionKey 比對 → duplicate / error / 繼續

### 修正：scripts/smoke-parser.ts
- 新增 `parseClassMemberList` 與 `normalizeRegionKey` smoke tests（共 11 個 case）

## 重要決策與限制

- **iccf 結班 label 不可偽造**：`已結班 / 聯班結業` 由 iccf 伺服器端渲染，client 無法作假。
- **session.classes 儲存策略**：`listClasses` 回傳全部（含 ended），但 `createSession` 只把 active 寫入 session record。
- **sec_class vs B-number 不可混用**：form URL 用 sec_class（TWC），session 比對用 B-number（B3000549）。
- **duplicate 語義**：「已在此班」（show_classmbr5 命中），不是「同名同區曾建立」。
- **`/api/_test/*` 端點僅在 `FIREBASE_AUTH_EMULATOR_HOST` 設定時掛載**（`index.ts:69`）。

## 測試與驗證

- `npx tsc --noEmit` — 乾淨
- `npx tsx scripts/smoke-parser.ts` — 全部通過（parseClassServiceList / parseClassMemberList / normalizeRegionKey）
- `npx playwright test -c e2e/playwright.config.ts iccf-backfill` — 7 passed

## 待辦 / 未完成

### 待 commit
- 本 session 所有修改尚在 working tree，尚未 commit

### Pass 3（先前積欠）
- in-memory job store 改用 MongoDB 持久化（server 重啟會吃掉 in-flight jobs）
- iccf 失敗時是否要 block Firebase finalize？目前是 finalize 先、iccf 後（非阻斷）

## 下次繼續的指令
```
cd /Users/gooo/Desktop/.claude/projects/bantang-app/server
# 說：「繼續上次的工作」
# 先 commit 本次修改，再做真實環境驗證
```
