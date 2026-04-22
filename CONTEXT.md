# Session Context — 2026-04-22 17:50

## 專案路徑
主 repo：`/Users/gooo/Desktop/.claude/projects/bantang-app`（main HEAD `1171c40`）

## main 目前頂端
```
1171c40 test: align E2E selectors with Lovable emoji-less labels (#17)
140a46a refactor(ui): Phase 3c — Lovable design system migration + dev auth bypass (#16)
6cac831 test: wait for weekly task GET before typing to fix flaky notes spec (#15)
```

**CI 狀態：Build Check + E2E Tests 全綠。Zeabur bantang-api RUNNING、API 正常回應。**

## 2026-04-22 Session 完成（Zeabur 清理 2/3）

### ✅ Task 1 — 刪除 `bantang-api` 重複 `MONGODB_HOST`
- 原有兩筆 key=`MONGODB_HOST` value=`service-69c8f16da972bb88a76361df`
- 用 `delete-environment-variable` 刪一次，剩一筆（Zeabur 不支援依索引刪除，但同 key 重複刪一次只會移除一筆）

### ✅ Task 2 — `MONGODB_URI` 硬編 IP → 內部 DNS
- 舊：`mongodb://mongo:***@172.104.105.153:30097/sjjbclass?authSource=admin`（外部 NodePort）
- 新：`mongodb://mongo:***@${MONGODB_HOST}:27017/sjjbclass?authSource=admin`（Zeabur 內部 DNS，container 注入時展開為 `service-69c8f16da972bb88a76361df:27017`）
- 改前驗證：DNS 解析 → `10.43.243.112`、TCP 27017 可達
- **Pod restart 過程（重要教訓）**：
  - `kill 1` / `kill -9 1` 從容器內發無效（PID namespace 保護 pid 1）
  - env var 改動本身**不會觸發 pod 重啟**
  - 最後用 `update-service-ports`（同值 `[{id:"web",port:8080,type:"HTTP"}]`）觸發 spec reconcile 才讓 K8s 重建 pod
  - 驗證 `/proc/1/stat` starttime 從 202644614 → 218059932 = 新 pod

### ⏭ Task 3（留給用戶）— 輪替 `FIREBASE_SERVICE_ACCOUNT_B64`
- 目前未輪替。Zeabur MCP 沒有 Firebase Console 能力，需手動操作
- 若沒有外洩疑慮可**不做**
- 流程：Firebase Console → Project Settings → Service Accounts → 產生新 private key → base64 encode → 用 `update-environment-variable` 更新 Zeabur → 觸發 redeploy（推一個 server/** 空 commit 或再跑 update-service-ports）→ revoke 舊 key

## Zeabur MCP 操作心得（下次遇到要用）
- **env var 變更不會自動重啟 pod**；container 繼續跑舊值
- **在 container 內 `kill` pid 1 無效**（kernel drop signal）
- **觸發 pod 重建的方式**：`update-service-ports`（同值即可）/ `deploy-from-specification` / 推 server/** 到 GitHub 觸發 CI 重 build image
- `get-runtime-logs` 只顯示 Zeabur pod 事件（如 ImagePullBackOff），看不到 Node app 本身 stdout；app 行為判斷靠 `curl` HTTP 狀態或 `execute-command` 進容器 debug
- `execute-command` 走 busybox sh，沒有 `/dev/tcp`，要測 TCP 連線用 `node -e`

## 樣式改動 SOP（長期規則）

凡涉及 UI class 名 / text label / button 文案 / component 樣式：
1. 本機改 + 每段跑 `tsc --noEmit` / `npm run build`
2. **改 UI 前先 grep E2E**：`grep -rnE 'locator.*(bg-white|bg-sky|text-sky)|getByRole.*name.*<舊字串>' e2e/` — 有命中就同一個 PR 一起改
3. preview_start + screenshot 給用戶看
4. Commit + push + 開 PR
5. **等 CI 綠燈再 merge**，禁用 `gh pr merge --auto`（此 repo 會立刻合併不等 CI）
6. Merge 後看 main CI 也綠

**禁用習慣：**
- 不靠 preview 視覺 OK 就 merge（preview 不跑 E2E）
- 不加裝飾性 emoji 到 UI label（Lovable 設計決策）
- 不寫 `text-[Xpx]` 任意值（只用 `text-xs/sm/base/lg/xl`）

## 重要決策與限制
- **Lovable 刻意去 emoji**：heading/button 不放裝飾 emoji，但語意 emoji（`✓ 已儲存` / `✕` 關閉）保留
- **字級三階統一**：`text-xs` (12) / `text-sm` (14) / `text-base` (16)；標題用 `text-lg` / `text-xl`
- **Dev auth bypass**：改 `.env.local` 的 `role` 欄位後**要重啟 dev server**（Vite 不 HMR env 變數）
- **E2E 選擇器**：tab 類 button 用 anchored regex（`/^班級$/`）避免 `iccf` substring 衝突；card 選擇器用 `div.card-lovable`
- **auto-merge 行為**：此 repo 設定不等 CI 就合併，高風險改動要手動確認 CI 綠再 merge
- **iccf 自動點名腳本**：獨立於此 repo 的 Apps Script，串接 `bantang-api.zeabur.app`，重啟 API 時要避免 downtime（本次 K8s rolling 零 downtime）

## 待辦
- (可選) Task 3 Firebase key 輪替

## 下次繼續的指令
```
cd /Users/gooo/Desktop/.claude/projects/bantang-app
git checkout main && git pull
```
