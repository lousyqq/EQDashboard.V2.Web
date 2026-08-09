# EQ Performance Dashboard - 專案說明文件 (CLAUDE.md / AGENTS.md)

> AI 助手在此專案開發、修改、除錯的最小必要知識與規範（最新狀態快照，2026-07-19 整理）。
> **現役主線**：`EQDashboard.V2.Web`（ASP.NET Core .NET 9.0 + ES Modules 前端 + 最小整合測試 `EQDashboard.V2.Web.Tests`）。
> **文件分工**：本檔＝規範與待辦｜`系統架構.md`＝目錄結構與模組職責｜`DB_Table.md`＝DB 結構快照與增量 SQL 歷史（Changelog 只增不刪）｜`memory.md`＝現況快照與待辦。

---

## 1. 專案概況與運行模式

- **架構**：Kestrel/IIS；後端 Service 層 + DI 解耦；前端 ES Modules + Bootstrap 5/Vanilla JS（全 CDN，無 npm/bundler）。
- **資料**：MSSQL（`ConnectionStrings:EQDashboard`，DB `EQDashboardV2`，Server `Sariel`）。CRUD 異動自動靜默寫回 DB；個人版面存 `PersonalSettings` + LocalStorage 快取；登入更新 `Accounts.LoginCount/LastLoginTime` 並冪等 upsert `DailyUserVisits`。
- **驗證 (`AuthSettings`)**：Kestrel + Negotiate 自動偵測 Windows 桌機帳號（如 `00058897` 或 `UMC\00059987`），前端無手動帳密 Tab 與登出按鈕。三核心配置：
  1. **`SimulatedAccount`**：指定帳號本地模擬驗證；留空 (`""`) 自動抓桌機身分。後端 Controller/Service 統一注入 `IOptionsSnapshot<AuthSettings>`，並在 Cookie 驗證中配置 `OnValidatePrincipal`：當 `appsettings.json` 的 `SimulatedAccount` 變更或切換回 Windows 偵測時，即時作廢舊 Cookie (`SignOutAsync`) 並觸發前端 `tryAutoLogin` / `completeLoginAfterAuth` 重新拉取新登入者的完整權限結構 (`fetchInitialDataFromDB`)。
  2. **`DefaultAdmins`**（`["yu-ting", "00058897", "00059987"]`）：這些身分登入時若 DB 不存在或權限不足，自動建立/升級為 `admin`，防止系統鎖死。
  3. **`OpenAccessMode=true`**：名單外新登入者自動建帳（`roleLevel="user"`、部門「一般使用者」）、自動綁定所有角色群組（可視全廠區）；預設首頁不設定（自動抓第一個，登入網頁預設停留 12A）；全站開放瀏覽（後端 `GetVisibleMenuIdsAsync` 回 null 不過濾、前端全放行）。`false` 則嚴格限 DB 帳號名單登入與授權。
- **App Grid 權限隔離**：無 `canManageCurrentAppGrid` 者一律隱藏編輯/刪除圖示與操作端點，不分模式；開啟方式全站一致（新視窗全螢幕或彈窗/IE 模式）。

---

## 2. 目錄結構（詳細職責見 `系統架構.md`）

```
EQDashboard.V2.Web\
├── Program.cs            # DI、Middleware Pipeline、CSP、健康檢查 (/health, /health/ready)
├── appsettings.json      # ConnectionStrings:EQDashboard + AuthSettings
├── Models\  Data\  Controllers\  Middleware\  Helpers\
├── Services\
│   ├── SchemaBootstrap.cs              # 啟動時 idempotent DDL 自我修復（補表/補欄位/補索引）
│   ├── InitialDataCacheInvalidator.cs  # Singleton 快取作廢 + ETag bump 中心
│   └── CacheInvalidationInterceptor.cs # EF SaveChangesInterceptor 快取作廢安全網
└── wwwroot\
    ├── index.html        # 唯一 UI 進入點 (<script type="module" src="js/main.js">)
    ├── partials\modals.html
    ├── css\              # variables / navbar / sidebar / components / responsive (RWD)
    └── js\               # main / store(狀態中心) / api / auth / config
        ├── ui\           # layout / navigation / dialogs
        ├── render\       # sidebar / sidebar-item / tables / account-ui
        └── admin\        # fab / role / account / menu / misc / activity-log / traffic-stats / modal-utils
```

增量 DB 異動 SQL 腳本放在方案根目錄 `sql\`（如 `sql\2026-07-18_Add_DailyUserVisits.sql`）。

---

## 3. 資料庫重點（完整結構快照與 SQL 歷史一律見 `DB_Table.md`）

- 不使用 EF Migrations；`SchemaBootstrap.cs` 啟動時以冪等 SQL（`IF NOT EXISTS` / `COL_LENGTH IS NULL`）自我修復表、欄位與索引。
- **19 張表**：實體 7（`Menus`/`Fabs`/`Roles`/`Accounts`/`Apps`/`Requests`/`PersonalSettings`）＋關聯 10（`Map_*`）＋稽核統計 2（`UserActivityLogs`、`DailyUserVisits` 複合 PK `(VisitDate, EmpId)`）。
- **Per-Fab 覆寫**：`Map_Account_ExtraMenu`/`Map_Account_DenyMenu` PK 為 `(EmpId, FabId, MenuId)`，`FabId` 存廠區名稱（如 `12A`），刻意不建 FK 以免多重 Cascade 路徑衝突。
- **命名映射**：前端 JS 一律 CamelCase（`m.displayName`），後端 C#/DB 一律 PascalCase（`DisplayName`）。`Accounts` 覆寫存檔必帶 `LoginCount`/`LastLoginTime`，以免被洗成 NULL。
- **圖示**：為支援多主機 Web Farm 部署，上傳的圖示（Base64）統一儲存於資料庫（`Menus.Icon` / `Apps.IconBase64`），不再寫入本機實體檔案。舊有實體圖示已由 `IconStorageService.MigrateBase64IconsAsync` 於系統啟動時自動轉換回 DB 儲存。前端統一經由 `window.resolveIconUrl` 處理，`IconStorageService` 負責 MIME 驗證。APP 圖示編輯區由 `setIconPreviewBoxVisible` 透過 Bootstrap `d-none !important` / `d-flex !important` 嚴密控制（全新建立 APP 尚未上傳圖檔時不顯示預覽卡片區塊）。

---

## 4. API 規範

- **`GET /Settings/GetInitialData`**：非 Admin 由 `IMenuAuthService.GetVisibleMenuIdsAsync` 後端列級過濾；帳號相關表（`Accounts`/`PersonalSettings`/`Map_Account_*`）不分身分一律 **scope-to-own**（`.Where(x => x.EmpId == empId)` 只回登入者自身列，**嚴禁移除自身資料列**）；ETag 必摻入身分（`"{ETag}:{empId}:{isAdmin}"`）防共用機台跨帳號快取回放。
- **`/api/Accounts`（Admin-Only）**：`GET ?page=&pageSize=&q=` 伺服器端分頁，`q` 進 DB 前必截斷至 100 字（防 SqlException 8152 字串截斷）；`GET /{id}` 呼叫端必套 `encodeURIComponent(id)`（防網域工號 `\` 造成 404）；`GET /export` 全量匯出供 Excel 備份。
- **`GET /api/Auth/MyProfile`**：回傳登入者完整設定與授權（empId/name/department/登入統計/roleLevel/canEditOthers/assignedRoles/manageableMenus/per-fab extraMenus·denyMenus/defaultPages），與 `GetInitialData` 並行發送省 RTT；`MyProfile`/`WhoAmI`/`Config` 皆帶 `Cache-Control: no-cache, no-store, must-revalidate` 且前端 `{cache:'no-store'}`。**全域 401 攔截排除清單必含 `/api/Auth/MyProfile`、`/api/Auth/Login`、`/Settings/GetInitialData`、`/api/Auth/WhoAmI`**（防冷開頁誤判登出）。
- **`/api/Analytics`（Admin-Only）**：`GET UsageStats?days=N`（DAU/MAU/註冊數/活躍率 KPI、每日與 12 個月趨勢、部門/廠區活躍比率）；`GET details?page=&pageSize=&date=&dept=&q=`（每日個人造訪明細分頁）。

---

## 5. C# 與 MSSQL 開發規範（必 100% 嚴格遵循）

1. **薄 Controller**：統一 `XxxController : Controller`，業務邏輯封裝至 `Services/`。
2. **SQL 參數化**：原生 ADO.NET/DDL 對外部輸入一律 `SqlParameter`，嚴禁字串拼接（`SchemaBootstrap` DDL 硬編碼白名單除外）。
3. **交易與執行策略**：多步驟「先刪舊 mapping、再寫新 mapping」一律包原子交易；因 `EnableRetryOnFailure`，手動交易必經 `_context.Database.CreateExecutionStrategy().ExecuteAsync(...)` 內包 `BeginTransactionAsync()`。
4. **複合 PK 先刪後寫兩回合**：替換 `Map_Role_Menu`/`Map_Fab_Role`/`PersonalSettings` 等關聯時，先 `RemoveRange(old)` + `SaveChangesAsync()`，再 `Add(new)` + `SaveChangesAsync()`（同回合 Remove+Add 相同 PK 會觸發 EF Identity Map 追蹤衝突）；寫入前以 `HashSet`/`.Distinct()` 去重。
5. **參照預檢**：寫 `Map_*` 前先 `ValidateMappingRefsAsync` 驗 `RoleId`/`MenuId` 存在，回 400 而非 500 FK 錯誤。
6. **索引唯一事實來源**＝`SchemaBootstrap.EnsureIndexesAsync`（冪等 T-SQL）；**嚴禁 EF `HasIndex`**（無 Migrations 時為無效 metadata）。帳號搜尋靠覆蓋索引 `IX_Accounts_Search (Name, Department)`。
7. **UPDATE + OUTPUT 單次往返**：「更新並取新值」一律單一 SQL 配 `OUTPUT INSERTED.*`，禁 UPDATE 後再 SELECT；reader 無列＝WHERE 未命中（帳號不存在）。
8. **快取作廢與 ETag**：異動 `Menus`/`Fabs`/`Roles`/`Map_*` 的寫入端點完成後必呼叫 `IInitialDataCacheInvalidator.InvalidateInitialDataCache()`（雙重關鍵：清快取＋bump ETag，連動作廢 `visibleMenus:{ETag}:{empId}`）；EF 寫入有 `CacheInvalidationInterceptor` 安全網，**raw ADO.NET/raw SQL 寫入必須手動呼叫**。
9. **約束啟用**：一律 `WITH CHECK CHECK CONSTRAINT ALL`；嚴禁 `WITH NOCHECK CHECK`（Untrusted 狀態）。
10. **禁用 `SqlBulkCopy`**：主機 `Sariel` 僅 6GB RAM，Bulk Copy 的 Memory Grant 易卡死 `RESOURCE_SEMAPHORE`；維持參數化批次 INSERT。
11. **DbContext 池化 (`AddDbContextPool`)**：建構子只收 `DbContextOptions<AppDbContext>`；嚴禁注入 Scoped 服務、嚴禁可變實例欄位、嚴禁實例層級變更（`SetCommandTimeout`/`QueryTrackingBehavior`）。
12. **`AsSplitQuery`**：≥2 個 Collection `Include` 的 LINQ 查詢必加 `.AsSplitQuery()`。
13. **`AsNoTracking`**：唯讀 GET 序列化查詢必加；即將 `SaveChanges` 的查詢嚴禁加（會靜默無效）。
14. **身分與 IP**：`EmpId` 唯一取自 `User.FindFirst(ClaimTypes.NameIdentifier)?.Value`，**嚴禁 `User.Identity.Name`**（為姓名）；IP 走 `ClientIpHelper.GetClientIp(HttpContext)`，僅供稽核不可作授權。
15. **狀態碼與日誌**：資源不存在回 404；業務驗證/格式/授權阻擋回 400；日誌一律 DI 注入 `ILogger<T>`，**嚴禁 `Console.WriteLine`**（IIS 下無法捕獲）。
16. **跨時區一致性**：每日統計/跨日比對（如 `DailyUserVisits`）的「今天」一律以 DB 端 `CONVERT(date, GETDATE())` 為準。

---

## 6. 前端開發與安全規範（必守）

- **CSRF**：Antiforgery Middleware 必配置於 `UseAuthentication()`/`UseAuthorization()` **之後**（Token 綁 Identity Claims）；登入後 `refreshCsrfToken()`；`api.js` 攔截器對 400 + `Invalid Token` 自動刷新重試 1 次。
- **CSP/SRI**：CSP 必含 `'unsafe-inline'`＋CDN 白名單（`cdn.jsdelivr.net`/`cdnjs.cloudflare.com`/`cdn.datatables.net`/`code.jquery.com`）＋`frame-src` 允許外部看板 iframe；CDN 標籤必帶 `integrity="sha384-..."` + `crossorigin="anonymous"`，換版本重算校驗碼。
- **Authorization baseline**：Controller 預設 class-level `[Authorize]`，管理員功能再加 `[Authorize(Roles="admin")]`。
- **ES Modules**：`import` 絕對置頂（任一 SyntaxError 中斷整張模組圖）；inline `onclick` 用的函式必 `window.X = X`；狀態一律走 `store.js` 的 `appState`。
- **App Shell 快取防禦**：`syncDataToDB()`、RESTful 存檔（`save*API`/`delete*API`）、切帳號/登出後必呼叫 `window.clearAppCache(preserveCurrentUser)`（`app_shell_*` 快照 Ctrl+F5 不會清）；`restoreLoginFromStorage` 比對 `window._currentServerEmpId` 雙重驗證，並以 `Object.assign` 將 DB 最新身分同步回 localStorage。
- **版本碼 `?v=`**：`index.html` 與所有模組 `import ?v=` 全站完全一致（目前 `20260727b`），改版一律全域取代，否則同模組雙載、狀態分裂。
- **訊息分流**：成功/資訊走 `showToast(msg, type, delay, isHtml)`（非阻斷 Toast）；錯誤與需決策才走 `customAlert`/`customConfirm`，嚴禁為成功訊息新增阻斷 Modal；查詢表格載入態一律 `skeletonRows(colCount, rowCount)` 骨架屏。
- **i18n 全量覆蓋**：新 UI 文字必掛 `data-i18n`（placeholder 用 `data-i18n-placeholder`），`config.js` 字典同步補 zh/en/ja；JS 動態字串走 `t(key, fallback)`，含數值用 `{0}`/`{1}` 模板＋`.replace()`；含圖示元素把文字包 `<span data-i18n>`。
- **轉義三件套**：ID 進 inline `onclick('ID')` 先 `_jsArg()`（防網域 ID 的 `\` 被吃）；DB 資料進 `innerHTML` 必 `escHtml()`（防 XSS）；REST URL 的 ID 必 `encodeURIComponent()`。
- **RWD**：`@media` 斷點全集中 `css/responsive.css`（≤992 側欄浮層＋遮罩 / ≤768 手機 / ≤480 窄幅）；JS 行為集中 `ui/layout.js` RWD 區塊（`RWD_SIDEBAR_BREAKPOINT = 992` 與 CSS 一致）。
- **表格/挑選器**：`renderAccountTable` 是唯一 `serverSide:true` DataTable（方案 A 旗艦優化為 6 欄配置，將層級與委派整合為「管理層級與狀態」，將可視群組與委派選單整合為「可視與管轄範圍」，大幅釋放寬度供長路徑文字展開），禁改回記憶體分頁；查詢篩選綁 Enter 送出且新查詢重設回第 1 頁；sticky 表頭只宣告於 `components.css`；`openMenuSelector` 支援 folder 當預設首頁，權限與 Root 判定必檢查整個 `parentIds` 陣列：`(!cleanId(m.parentId)) && (m.parentIds||[]).filter(Boolean).length===0`；樹狀模板引用的 `${xxxHtml}` 必先以 `const` 宣告。
- **排序**：系統選單拖曳走 `batchSaveMenusAPI`（禁 Excel 全量覆寫）；個人排序走 `/api/PersonalSettings`，personal 模式根層排序 fallback 對齊 `dedupedInitIds` 索引。
- **意見箱**：`openFeedbackPage` 導向系統「需求申請」頁（非外部信箱），管理員於「申請審核管理」回覆。

---

## 7. 當前待辦事項 (Active Tasks)

- [x] **本地版控收尾**：確保 `bin/`、`obj/`、`.vs/`、`App_Data/`、`appsettings.json` 不進版控，並 commit 保存最新狀態。
- [x] **DataProtection 金鑰輪換（安全優先）**：清除歷史外洩的 `App_Data/keys/*` 並重啟重產新金鑰（現有 Sessions 失效）。
- [x] **大型規模擴展評估（長期可選）**：看板/權限達數千筆時，評估 Menu 分類檢索、側欄樹狀 lazy-loading 與分廠 on-demand 載入。已實作側欄樹狀 DOM lazy-loading。

---

## 🔄 每輪對話文件同步規範 (Mandatory Protocol)

1. **同步 `CLAUDE.md`（＝`AGENTS.md`）與 `memory.md`**：寫入新確定的規範/坑點，移除過時任務。
2. **同步 `系統架構.md`**：檔案增刪、移動或核心職責調整時更新架構樹與說明。
3. **DB 架構異動（嚴格遵從）**：凡涉及 `SchemaBootstrap.cs`、實體欄位、資料表或索引增刪修：
   1. 同步修改 `DB_Table.md` 上方結構快照；
   2. 於方案根目錄 `sql\` 產出增量異動 `.sql` 腳本（`IF NOT EXISTS` 冪等 DDL、相容既有資料）；
   3. 於 `DB_Table.md` 末「5. Schema Changelog」**只增不刪**追加當日日期 (`YYYY-MM-DD`) 與 `.sql` 檔名。
4. **回覆通知**：對話末尾註明 `*已自動更新 CLAUDE.md 與 memory.md*`（有 SQL 檔亦一併列出）。
