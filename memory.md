# 專案記憶庫 (memory.md)

> 現況快照與待辦（精簡版，2026-07-19 整理）。
> 開發規範與坑點 → `CLAUDE.md`（＝`AGENTS.md`）；目錄結構與模組職責 → `系統架構.md`；DB 結構快照與增量 SQL 歷史 → `DB_Table.md`（Changelog 只增不刪）。

---

## 1. 當前系統架構概況

- **主線**：`EQDashboard.V2.Web`（ASP.NET Core .NET 9 + ES Modules + Bootstrap 5/jQuery，全 CDN 無 bundler）；整合測試 `EQDashboard.V2.Web.Tests`（xUnit + WebApplicationFactory，8/8 通過）。
- **DB**：MSSQL `EQDashboardV2` @ `Sariel`（6GB RAM，禁 `SqlBulkCopy`）。無 EF Migrations，`SchemaBootstrap` 啟動時冪等自我修復 **20 張表**（實體 7＋關聯 10＋`UserActivityLogs`＋`DailyUserVisits`＋`DailyMenuClicks`）與全部索引。
- **驗證 (`AuthSettings`)**：Kestrel + Negotiate 自動登入（無手動帳密 Tab）；三開關：`SimulatedAccount`（本地模擬，經 `IOptionsSnapshot<AuthSettings>` 動態讀取配合 Cookie `OnValidatePrincipal` 即時作廢切換）、`DefaultAdmins`（自動建立/升級 admin 防鎖死）、`OpenAccessMode`（開放瀏覽自動建帳、全站放行；關閉則嚴格限 DB 名單）。當帳號初次建立或不存在於 DB（包含 OpenAccessMode 或 DefaultAdmins 自動建帳）時，自動至 `[WEB].[dbo].[notes_person]` 以 `EMPNO` 比對補齊員工姓名 `NAME` 與部門 `DEPTNAME`。App Grid 管理權限隔離不分模式生效。
- **快取鏈**：`SettingsService` 雙層快取（Global 60s / Volatile 10s）＋ ETag（摻入 `empId`/`isAdmin`）；`InitialDataCacheInvalidator`（Singleton）集中清快取＋bump ETag，連動作廢 `visibleMenus:{ETag}:{empId}`；`CacheInvalidationInterceptor` 為 EF 寫入安全網（raw SQL 寫入仍須手動 Invalidate）。
- **scope-to-own**：`GetInitialData` 對帳號相關表（`Accounts`/`PersonalSettings`/`Map_Account_*`）只回登入者自身列；全帳號管理走 `/api/Accounts`（唯一 server-side 分頁 DataTable）；自身授權走 `/api/Auth/MyProfile`（no-store，與 GetInitialData 並行）。
- **稽核與流量統計**：`ActivityLoggingMiddleware` → `ActivityLogQueue`（Channel，滿載告警不丟棄）→ `ActivityLogProcessor` 批次寫 `UserActivityLogs`；登入統計時 `SettingsService.RecordDailyUserVisitAsync` 以 `UPDATE...IF @@ROWCOUNT=0 INSERT` 冪等 upsert `DailyUserVisits`；`AnalyticsController`（admin-only）提供 DAU/MAU KPI 與造訪明細，前端 `admin/traffic-stats.js`（`#page-traffic-stats`）。
- **圖示與 Web Farm 部署**：為支援多主機 Web Farm 部署，上傳的圖示（Base64）統一儲存於資料庫（`Menus.Icon` / `Apps.IconBase64`），不再寫入本機實體檔案。前端由 `window.resolveIconUrl` 自動相容新舊圖示路徑並加 `onerror` 降級。APP 圖示編輯由 `setIconPreviewBoxVisible` 以 `d-none !important` 控制，全新建立時不顯示預覽卡片區塊。
- **帳號管理與委派欄位**：帳號列表為 serverSide DataTable（方案 A 旗艦優化為 6 欄配置），將「權限層級」與「委派啟用狀態」整合為「管理層級與狀態 (`th_role_and_status`)」，將「可視群組」與「委派目錄」整合為「可視與管轄範圍 (`th_scope_and_managed`)」，大幅釋放橫向寬度供預設首頁與長目錄名稱不折行展開。
- **前端**：唯一進入點 `index.html` → `main.js`；狀態中心 `store.js`；版本碼 `?v=20260727b` 全站一致；i18n zh/en/ja 全量覆蓋；RWD 集中 `css/responsive.css` + `ui/layout.js`。

---

## 2. 目前待辦事項 (Active Tasks)

- [x] **本地 Git 版控收尾**：確認 `bin/`、`obj/`、`.vs/`、`App_Data/`、`appsettings.json` 不進版控並完成 commit，維持工作目錄乾淨。
- [x] **DataProtection 金鑰輪換（安全優先）**：刪除歷史外洩之 `App_Data/keys/*`，重啟由系統自動重產新金鑰（現有 Sessions 失效）。
- [x] **大型規模擴展評估（長期可選）**：看板/權限達數千筆規模時，評估 Category/Tags 檢索、側欄樹狀 Lazy Rendering 與分廠 on-demand 載入。已實作側欄樹狀 DOM lazy-loading。
- [x] **UI/UX 深度優化與最近瀏覽紀錄**：完成跨裝置最近瀏覽紀錄同步 (利用 Accounts 的 JSON Preferences 欄位)、修正 Toast 提示堆疊位置為右下角以防遮擋、以及深色主題 (Dark Mode) `localStorage` 持久化與無閃爍載入。
- [x] **移除常用看板**：已從側欄、API、以及 `api.js` 中徹底移除「常用看板」功能。
---

## 3. 文件同步規範（雙 AI 協同：Gemini + Claude）

每次修改完成前必自動執行：
1. 同步 `CLAUDE.md`（＝`AGENTS.md`）與本檔：寫入新規範、移除過時任務。
2. 檔案增刪/職責調整時同步 `系統架構.md`。
3. DB 架構異動時：更新 `DB_Table.md` 快照 → 於方案根目錄 `sql\` 產出冪等增量 `.sql` → 於 `DB_Table.md` Changelog **只增不刪**追加日期與檔名。
4. 回覆末尾註明 `*已自動更新 CLAUDE.md 與 memory.md*`（有 SQL 檔亦一併列出）。
