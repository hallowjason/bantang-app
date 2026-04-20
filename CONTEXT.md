# Session Context — 2026-04-20 22:50

## 下一個 session 應該從哪開始
**從主 repo（非 worktree）**：
```
cd /Users/gooo/Desktop/.claude/projects/bantang-app
git checkout main
git pull origin main
```

## 進行中 PR
**PR #5** — https://github.com/hallowjason/bantang-app/pull/5
branch: `claude/crazy-roentgen-1ad603`
標題：ci: build check + deploy workflows; strengthen server healthchecks
狀態：✅ CI 綠燈，等 review + merge

## 本次 Session 完成（Option B — 部署驗證 / CI-CD）

### Server 健康檢查
- `GET /health`（liveness）：零外部依賴，回 `{ ok, uptime }`
- `GET /ready`（readiness）：ping MongoDB + 檢查 Firebase 憑證；fail → 503
- Startup env validation：缺 `MONGODB_URI` 或 Firebase 憑證 → `process.exit(1)` fail-fast
- `server/Dockerfile`：加 `HEALTHCHECK`（用 node 內建 http，alpine 無 curl）

### GitHub Actions
- `build-check.yml`：PR + push main → 前後端 tsc + lint
- `deploy-frontend.yml`：push main 且改到前端 → Firebase Hosting live channel
- 搭配既有 `build-server.yml`（push image → GHCR）已是完整 CI 鏈

### Lint 清債（commit 8ae2837）
- eslint.config.js：允許 `_` 前綴（慣例）；`react-hooks/set-state-in-effect` 降為 warn（v7 新規則過於積極）
- 刪掉 `server/src/iccf/client.ts` 的 3 個未使用 URL constants
- `server/src/middleware/auth.ts` 和 `src/components/MemberForm.tsx` 的 `catch (err)` → bare `catch`
- `server/src/routes/iccfSession.ts` 移除未使用的 `IccfError` import
- `src/context/AuthContext.tsx` 的 `useAuth` hook 加 `eslint-disable` 註解

### Docs
- `.env.example` 補全 server 所需 env

## Merge PR #5 之後必做

### 1. 設定 GitHub Secrets（deploy-frontend.yml 要用）
repo Settings → Secrets and variables → Actions → New repository secret：
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`（值：`sjjb-a2453`）
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_SHEET_ID`
- `VITE_API_URL`（指向 Zeabur server public URL，例：`https://bantang-api.zeabur.app`）
- `FIREBASE_SERVICE_ACCOUNT`（service account JSON 整串，不要 base64）
  生成：Firebase Console → Project Settings → Service Accounts → Generate new private key

### 2. Zeabur 檢查
- 把 health check path 從預設 `/` 改指 `/ready`（可選，能在 DB 壞時觸發重啟）
- 重新 deploy server 一次，確認 Docker HEALTHCHECK 狀態 `healthy`
- curl 驗：
  - `https://<zeabur-url>/health` → 200 `{ok:true,uptime:...}`
  - `https://<zeabur-url>/ready` → 200 `{ok:true,checks:{db:true,firebaseCreds:true}}`

### 3. 觸發一次 deploy-frontend
GitHub → Actions → Deploy Frontend → `Run workflow` 手動觸發一次，確認 Firebase Hosting 成功 deploy。

---

## 下一階段：Option A — E2E 測試（Playwright）

### 建議覆蓋範圍（3 條 critical flow）
1. **Login flow** — Google Sign-In mock → 進 `/attendance`，驗證 role-based 導覽（leader 3 tab、head_leader 4 tab）
2. **Attendance flow** — 三態循環（absent → present → leave → absent）→ finalize 鎖定 → reopen
3. **Member CRUD** — 新增班員（純本地 path，不含 iccf）→ 編輯 → 軟刪除 → 確認不再出現於點名頁

### 已知技術考量
- Firebase Auth 需要 mock 或用 Firebase Auth Emulator
- 後端 test DB：用 MongoDB Memory Server 啟本地 API
- iccf 整合 E2E **不做**（需真 iccf 帳密 + 真實外站），用 unit/integration test 覆蓋
- Playwright 目標瀏覽器：chromium；行動版用 `device: 'Pixel 7'` viewport

### 建議結構
```
e2e/
├── playwright.config.ts
├── fixtures/
│   ├── auth.ts          # mock Firebase Auth / seed test user
│   └── testData.ts      # seed test classes/members
├── tests/
│   ├── login.spec.ts
│   ├── attendance.spec.ts
│   └── members.spec.ts
└── utils/
    └── apiHelpers.ts    # seed/cleanup via API
```

### CI 整合（之後再做）
- 新增 `.github/workflows/e2e.yml`
- 先本地能跑，CI 之後再接

---

## 重要決策與限制（沿用）
- iccf session 不存密碼，30 min idle 過期
- iccf Phase 1–4 已全部 merged
- worktree tsc 需 symlink node_modules：
  ```
  ln -s /Users/gooo/Desktop/.claude/projects/bantang-app/node_modules node_modules
  ln -s /Users/gooo/Desktop/.claude/projects/bantang-app/server/node_modules server/node_modules
  ```
- liveness (`/health`) vs readiness (`/ready`) 分離；Zeabur 應用 `/ready`

---

## 下次 Session 啟動指令

```
cd /Users/gooo/Desktop/.claude/projects/bantang-app
git checkout main
git pull origin main
```

然後告訴 Claude：
> 閱讀 CONTEXT.md，開始 Option A（Playwright E2E 測試）。先確認 PR #5 是否已 merge，若還沒 merge 就提醒我先去 merge、設好 GitHub Secrets，再開始寫測試。

⚠️ 若 PR #5 還沒 merge，**不要**在舊 branch 上疊 E2E 架構；先等 merge。
