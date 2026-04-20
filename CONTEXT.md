# Session Context — 2026-04-20 22:30

## 專案路徑
/Users/gooo/Desktop/.claude/projects/bantang-app/.claude/worktrees/crazy-roentgen-1ad603
branch: claude/crazy-roentgen-1ad603（base: main）

## 最近 5 個 commits（main）
a5f269e iccf Phase 4 edge cases: topicName guard, dup-sync, response parsing (#4)
3cae32e fix: repairIccfSync handles 401 from session-expired guard (#3)
94e0248 fix: ping tri-state, session-expired 401, PUT allow-list (#2)
c348098 iccf Phase 4: session liveness + repair endpoint + error copy (#1)
431c0cf feat: auto-backfill iccfClassCode to classes doc on iccf login

## 本次 Session 完成（Option B — 部署驗證 / CI/CD）

### Server
- `/health`（liveness）：只回 `{ ok, uptime }`，零外部依賴
- `/ready`（readiness）：ping MongoDB + 檢查 Firebase 憑證 env；fail → 503
- Startup env validation：缺 `MONGODB_URI` 或 Firebase 憑證 → fail-fast exit 1
- `server/Dockerfile`：加 `HEALTHCHECK`（每 30s 打 /health，用 node 內建 http）

### CI/CD
- `.github/workflows/build-check.yml`：PR + push main → 前後端 tsc build（前端用 placeholder env）
- `.github/workflows/deploy-frontend.yml`：push main 且改到前端檔案 → Firebase Hosting live channel
  - 需在 GitHub Secrets 設：`VITE_FIREBASE_*`、`VITE_SHEET_ID`、`VITE_API_URL`、`FIREBASE_SERVICE_ACCOUNT`

### Docs
- `.env.example`：補全 server 需要的環境變數（`MONGODB_URI` / Firebase Admin 憑證 / `FRONTEND_URL` / `PORT` / `UPLOADS_DIR` / `VITE_API_URL`）

## 待辦
- PR review & merge
- 在 GitHub repo Settings → Secrets 加上列 secrets，deploy workflow 才會真的跑
- Zeabur 端驗證：確認 `/ready` 被 health check 採用（可能要在 Zeabur 面板設 healthcheck path）
- 下一階段：Option A — E2E 測試（Playwright）

## 重要決策與限制
- liveness vs readiness 分離：Docker HEALTHCHECK 打 `/health`（快、不依賴 DB），LB/Zeabur 外部監控可打 `/ready`
- worktree tsc 需 symlink node_modules：
  ```
  ln -s /Users/gooo/Desktop/.claude/projects/bantang-app/node_modules node_modules
  ln -s /Users/gooo/Desktop/.claude/projects/bantang-app/server/node_modules server/node_modules
  ```
- deploy-frontend 用 `FirebaseExtended/action-hosting-deploy@v0`（不用 deprecated CI token）

## 前幾個 session 累積記憶
- iccf Phase 1–4 已全部 merged（session 管理、補入、點名同步、邊界修復）
- iccf session 不存密碼，30 min idle 過期，ensureAlive 死 session 自動刪除
- iccfClassCode 會 auto-backfill 到 classes doc

## 下次繼續
```
cd /Users/gooo/Desktop/.claude/projects/bantang-app
git pull origin main   # 如果 PR 已 merge
# 告訴 Claude：「閱讀 CONTEXT.md，繼續下一階段（Option A：E2E 測試）」
```
