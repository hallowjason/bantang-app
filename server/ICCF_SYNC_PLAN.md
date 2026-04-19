# iccf 同步整合計畫（Plan v2）

> 目的：bantang-app 的班員管理與點名，同步到 `https://iccf.ikd.org.tw`（寶光崇正道務系統）。

## 核心決策

| 項目 | 決策 |
|---|---|
| 帳密儲存 | **不存密碼**，領班於 bantang-app 即時輸入，server 只保留 iccf session cookie（30 分鐘 idle 過期） |
| 多領班 | 同班多領班均可建立 session；任一有效 session 均可代班操作；UI 顯示「目前使用 X 領班的 iccf session」 |
| 單一登入衝突 | 自動強制踢掉對方 session（`online_warm5.php` → `logout5.php` → 重 login） |
| 補入 vs 點名 | **分兩流程**：建立新班員時 → iccf 補入（Gate）；點名時 → iccf 出席（Routine） |
| 建立班員時無 iccf session | **強制領班先登入**，避免累積未同步孤兒資料 |
| 失敗策略 | 補入失敗不重試，回報領班手動處理；點名應不失敗（已於補入階段 Gate） |

## 站台技術摘要（curl 探測結果）

- 純 PHP + frameset + Big5 + IE7 相容模式
- 登入：`POST /55index.php` body=`zant={account}&zpsd={password}&action=login`
- 登出：`GET /logout5.php`
- Session：`PHPSESSID` cookie，無 CSRF token
- 殘留 session 警告頁：`/publicphp/online_warm5.php` → 先 `logout5.php` 再重登
- 班期主選單：`/publicphp/header_class5.php`
- 補入班員：`/classmbr/add_classmbr_first5.php?label=add&class_code_head=&class_close=1&first=T&sec_class=TWT019&...`
- 班員出席：`/class_present/select_class_pres5.php?...`
- 所有輸出/輸入皆 Big5（需 iconv-lite）

## 兩條流程

### Flow A：建立新班員的 iccf 補入（Gate）
```
前端 MemberForm → (若無 session) 彈 IccfLoginModal
 → POST /api/iccf/session 建立 session
 → POST /api/members 同時呼叫 iccfClient.addMember(name, area)
 → 依結果標記 members.iccfStatus：synced / not_found / name_mismatch / duplicate / forbidden
 → 前端顯示同步結果
```

### Flow B：出席點名（Routine）
```
前端 Attendance 送出 → (若無 session) 彈 IccfLoginModal
 → POST /api/attendance 建立 iccf_sync_job (pending)
 → Worker 立即處理：navigateToClass → markAttendance(members[])
 → 前端輪詢 job 狀態
```

## 檔案結構

```
server/src/
├── iccf/
│   ├── client.ts          login/logout/addMember/markAttendance
│   ├── sessionStore.ts    in-memory Map + Mongo 備援
│   ├── encoding.ts        Big5 encode/decode
│   ├── parser.ts          cheerio 解析
│   └── errors.ts          標準錯誤
├── routes/
│   ├── iccfSession.ts     POST/DELETE/GET /api/iccf/session
│   └── iccfSync.ts        job 狀態查詢
├── jobs/
│   └── iccfSyncWorker.ts  處理 attendance sync job
└── models/
    ├── IccfSession.ts     Mongo 備援 schema
    └── IccfSyncJob.ts
```

### members 新增欄位
- `iccfStatus: 'pending' | 'synced' | 'not_found' | 'name_mismatch' | 'duplicate' | 'forbidden'`
- `iccfMemberId?: string`
- `iccfSyncedAt?: Date`
- `iccfLastError?: string`

## Phase

### Phase 1：Session 管理 + login force-kick（進行中）
- `encoding.ts` / `errors.ts` / `client.ts` (login/logout) / `sessionStore.ts`
- `POST /api/iccf/session`、`DELETE /:id`、`GET /current`
- 前端 `IccfLoginModal` + `api/iccfSession.ts`
- 驗收：Admin 頁輸入帳密 → 回傳班別清單

### Phase 2：補入班員（Flow A）
- `client.addMember` / `parser.ts` / members schema 欄位
- MemberForm 攔截 POST + 顯示同步結果

### Phase 3：點名同步（Flow B）
- `client.markAttendance` / `iccfSyncWorker.ts`
- Attendance 送出即建 job；前端輪詢

### Phase 4：邊界與修復
- Session 過期提示重登
- 「修復同步失敗」按鈕
- 錯誤訊息對應 OpenClaw ROLLCALL.md 建議回覆
- 每次操作前 ping iccf 確認 session 還活著
