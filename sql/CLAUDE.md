# EQ Performance Dashboard - 專案說明文件 (CLAUDE.md)

> 本文件提供 AI 助手在此專案下開發、修改、除錯所需的最小必要知識（現況快照，非歷史日誌）。
> **兩個專案版本：**
> - **EQDashboard**（原版）：單一專案，JS/CSS 為單檔。
> - **EQDashboard.V2.Web**（重構版，**目前主線**）：相同功能，後端拆 Service 層 + DI、前端 ES Modules 模組化、Modal 抽離。
> **兩版版面與功能 100% 一致，V2 僅改善可維護性。** 現役方案僅 `EQDashboard.V2.Web.sln`（測試專案已移除），build 0 警告 0 錯誤。

---

## 1. 專案定位與運行模式

| 項目 | 舊版 (參考網頁) | 新版 (本專案 V2) |
| --- | --- | --- |
| 啟動方式 | 瀏覽器開 `TEST_20260429.html` | 啟動 ASP.NET Core Kestrel/IIS |
| 資料來源 | 讀 `EQDashboard_Setting.xlsx` | 呼叫 `/Settings/GetInitialData` 讀 MSSQL |
| 資料保存 | 匯出 `.xlsx` | **CRUD 異動自動靜默寫回 MSSQL**（無「同步至 DB」按鈕） |
| 個人化設定 | LocalStorage | DB (`PersonalSettings` 表) + LocalStorage 快取 |
| 登入統計 | LocalStorage | DB (`Accounts.LoginCount`/`LastLoginTime`)，登入呼叫 `/Settings/UpdateLoginStats` |
| 預設 URL | 本機檔案 | V1: `http://localhost:5242` / V2: `http://localhost:5000`、`5242` |
| 資料庫 | — | V1: `EQDashboard` / V2: `EQDashboardV2`（Server `Sariel`, User `testuser`）|

身份驗證：**雙模式** — Kestrel + Negotiate 自動偵測 Windows 桌機帳號；AD LDAP 手動帳密（登入框 2 個 tab）。登出設 `umc_force_manual_login` 旗標避免 Windows Auth 立刻又拉回。離線開發用 `appsettings.json` 的 `Auth.TestAccounts`（正式環境須關閉）。

---

## 2. 檔案結構 (File Structure)

### 2.1 EQDashboard.V2.Web（主線，模組化）

```
C:\EQDashboard\EQDashboard\EQDashboard.V2.Web\
├── EQDashboard.V2.Web.sln
├── EQDashboard.V2.Web.csproj
├── Program.cs                          # DI 註冊 + middleware pipeline + 健康檢查端點
├── appsettings.json                    # ConnectionStrings:EQDashboard（值的 Initial Catalog=EQDashboardV2）
│   appsettings.json.example            # 範本（appsettings.json 已不進版控）
├── Models\                             # 每個 Entity 獨立檔案 + DTOs\ + Settings\(AuthSettings)
├── Data\
│   ├── AppDbContext.cs                # 用 ApplyConfigurationsFromAssembly
│   └── Configurations\                # 每個 Entity 一個 IEntityTypeConfiguration
├── Services\                           # Service 層 + Interfaces\
│   ├── SettingsService / AccountService / AuthService / MenuAuthService / IconStorageService
│   ├── SchemaBootstrap.cs            # 啟動時 idempotent 補表/補欄位/補索引（無 EF Migrations）
│   ├── ActivityLogger / ActivityLogQueue(滿載告警不丟最舊) / ActivityLogProcessor(BackgroundService，批次 drain 單次 SaveChanges)
│   └── Helpers\ClientIpHelper.cs
├── Controllers\                        # 薄 Controller：Settings / Accounts / Menus / Roles / Fabs / Apps / Auth / ActivityLogs / PersonalSettings
└── wwwroot\
    ├── index.html                      # 唯一進入點 <script type="module" src="js/main.js">
    ├── partials\modals.html            # 10 個 Bootstrap Modal，由 fetch 動態載入
    ├── css\  variables / navbar / sidebar / components
    └── js\
        ├── store.js (狀態中心) / config.js (i18n) / api.js (DB 讀寫) / auth.js / main.js (進入點)
        ├── ui\        layout / navigation / dialogs
        ├── render\    sidebar / sidebar-item / tables / account-ui
        └── admin\     modal-utils / fab-manage / role-manage / account-manage / menu-manage / misc-manage
```

### 2.2 前端 ES Modules（重要）

- `index.html` 只載入 `<script type="module" src="js/main.js?v=...">`，由 main.js `import` 整張模組圖。
- **所有 `import` 必須置於檔案最上方**（header 註解後、第一個宣告前）。切勿塞進函式內 —— 任一模組 SyntaxError 會中止整張圖（畫面卡「載入中…」、登入/登出全失效）。
- 模組內 `function X` 為模組作用域；HTML inline `onclick="X()"` 需顯式 `window.X = X` 暴露。
- 新增模組可用 `node --check`（複製成 `.mjs`）離線驗證語法。
- `partials/modals.html` 由 `fetch(...)` 動態載入，在 JS 初始化前完成。

---

## 3. 技術版本 (Tech Stack)

### 3.1 後端
| 項目 | 版本 / 說明 |
| --- | --- |
| .NET SDK | **.NET 9.0**；Nullable `enable`、ImplicitUsings `enable` |
| Web | ASP.NET Core MVC + Static Files |
| 資料存取 | EF Core 9 + raw ADO.NET（`Microsoft.Data.SqlClient` 7.0.1）|
| Swagger | `Swashbuckle.AspNetCore` 7.2.0（僅 Development 啟用）|
| DB | **MSSQL**（Server `Sariel`, V1 `EQDashboard` / V2 `EQDashboardV2`, User `testuser`）|
| 連線字串 | key 皆 `ConnectionStrings:EQDashboard`（Program.cs 讀 `GetConnectionString("EQDashboard")`）；差異在 value 的 Initial Catalog。可用環境變數 `ConnectionStrings__EQDashboard` 覆寫 |

### 3.2 前端（全走 CDN，無 npm/bundler）
Bootstrap 5.3.2、jQuery 3.7.0、DataTables 1.13.6、Font Awesome 6.4.0、SheetJS(xlsx) 0.18.5（設定檔匯入/匯出 Excel 用）。

### 3.3 啟動 Profile
http `5242` / https `7033;5242` / IIS Express `45686`、SSL `44356`。

---

## 4. 資料模型 (Database Schema)

完整建表 SQL：`參考網頁/MSSQL_DB架構.sql`。**本專案無 EF Migrations** — schema 由 `SchemaBootstrap` 啟動時以 idempotent raw SQL 自我修復（補欄位/補表/補索引），其餘靠 `sql/` 腳本手動管理。

**實體表（7）**：`Menus`、`Fabs`、`Roles`、`Accounts`（含 RoleLevel / CanEditOthers / LoginCount / LastLoginTime）、`Apps`（Base64 圖示）、`Requests`、`PersonalSettings`（複合 PK EmpId+MenuId）。
**關聯表（10）**：`Map_Fab_Role`、`Map_Account_Role`、`Map_Account_ManageMenu`（委派）、`Map_Role_Menu`（含 SortOrder）、`Map_Menu_Structure`（父子，Restrict FK）、`Map_Account_DefaultPage`、`Map_Account_ExtraMenu`、`Map_Account_DenyMenu`、`Map_Menu_AllowAccount`、`Map_Menu_DenyAccount`（後四張 ACL/override 表由 SchemaBootstrap 自動建立）。
**稽核**：`UserActivityLogs`（操作紀錄，SchemaBootstrap 建表 + 效能索引）。

**前端 ↔ DB 欄位對應**：前端 camelCase（`m.id`/`m.displayName`）、DB PascalCase（`MenuId`/`DisplayName`）。轉換集中在 `api.js`：讀取 `getVal(obj,key)` 無視大小寫；寫入 `getDatabasePayload()` 顯式 PascalCase。**Accounts 的 LoginCount/LastLoginTime 必須帶上 payload**，否則全表覆寫會洗成 NULL。

**圖示儲存（Menu.Icon / App.IconBase64）**：一律「**base64 → 實體檔，DB 只存路徑 `/images/icons/{guid}.{ext}`**」。統一走 `IIconStorageService`（`Services/IconStorageService.cs`）：`SaveAsync` 把 data: URI 依 **MIME 白名單**（png/jpg/jpeg/gif/webp/svg/bmp/ico）寫檔、把自我參照的絕對 URL 正規化成相對路徑、FA class（如 `fas fa-folder`）與外部 URL 原樣保留、非白名單 data: 一律丟棄；`DeleteIfLocalUnreferencedAsync` 在 update/delete 後做「參照檢查 + path-traversal 防護」的孤兒清理；`MigrateBase64IconsAsync` 在啟動時一次性把 DB 既有 base64 轉檔（idempotent）。欄位名雖仍叫 `IconBase64`（相容舊資料），實際內容已是路徑字串。

---

## 5. API 規範

- **Legacy（全量）**：`GET /Settings/GetInitialData`（一次取全部表，非 admin 後端按可見性過濾）、`POST /Settings/SaveData`（全量覆寫，DELETE→INSERT 包 Transaction）、`POST /Settings/UpdateLoginStats`。
- **RESTful（主線，逐步取代全量覆寫）**：`Fabs` / `Roles` / `Accounts` / `Menus` Controller 的 POST/PUT/DELETE。每個寫入端點完成後必呼叫 `InvalidateInitialDataCache()` 同步 10s 讀取快取。
- 健康檢查：`GET /health`（liveness、不碰 DB、可公開）、`GET /health/ready`（readiness、含 DB 檢查、僅 loopback/私有網段、其餘 404）。

---

## 6. 開發規範 (Development Conventions) — 必守

### 6.1 通用
- **畫面一致性優先**：UI/互動改動須對照 `參考網頁/TEST_20260429.html`。
- **不破壞 `appState` 結構**（`menus/fabs/roles/accounts/apps/requests`），新增欄位用擴充。
- **禁止引入 build pipeline**（webpack/vite/TypeScript/npm）；前端維持 jQuery + Vanilla + Bootstrap CDN。

### 6.2 後端 (C#)
- Controller 命名 `XxxController : Controller`，保持薄。
- **SQL 安全**：使用者輸入一律走 `SqlParameter`，**禁止字串拼接 SQL 值**。（DDL 內硬編碼的常數表名/欄位例外，可接受。）
- 寫入類一律包 `BeginTransaction()`。
- **Schema/索引**：可自動補的欄位用 `IF COL_LENGTH(...) IS NULL ALTER TABLE`。**所有實體索引集中於 `SchemaBootstrap.EnsureIndexesAsync`（idempotent `IF NOT EXISTS(sys.indexes) CREATE INDEX`）；勿用 EF `HasIndex`** —— 無 Migrations 時它對既有 DB 是 no-op、純 metadata 會誤導。
- 寫入端點必呼叫 `InvalidateInitialDataCache()`（或 volatile 版）；`GetInitialDataAsync` 僅在**全部表載入成功**才 `_cache.Set`（避免快取殘缺資料 10s）。**此呼叫現在是雙重 load-bearing**：除了清 InitialData 快取，它還會 bump `_currentETag`，而 `MenuAuthService.GetVisibleMenuIdsAsync` 的可見集合跨請求快取（key=`visibleMenus:{ETag}:{empId}`）正是靠 ETag 變更來自動作廢。**新增任何會動到權限相關表（Map_Role_Menu / Map_Account_* / Map_Menu_Allow/DenyAccount / Map_Menu_Structure / Menus）的寫入路徑時，務必呼叫 `Invalidate*DataCache()`**，否則使用者會在 60s TTL 內讀到過期可見集合（權限變更不生效）。
- **FK 重新啟用一律用 `WITH CHECK CHECK CONSTRAINT ALL`（重新驗證、constraint 變 trusted），禁止 `WITH NOCHECK CHECK`**（後者既有列不重驗→untrusted→可能殘留孤兒資料且 optimizer 不信任）。`SaveDataAsync` 在交易內重驗，失敗一律 `trans.Rollback()`＋回 `(false,…)`，**不可吞例外硬 commit**（寧可整批失敗也不寫進不完整資料）。
- **禁止**為「加速」把批次參數化 INSERT 改回 `SqlBulkCopy` —— Sariel 僅 6GB RAM，bulk load 需 workspace memory grant，在記憶體壓力下卡 `RESOURCE_SEMAPHORE`（曾達 196s）。
- 取 EmpId **一律走 `ClaimTypes.NameIdentifier`**，**禁止 `User.Identity.Name`**（那是姓名，會讓委派判定全失效）。
- 取 client IP 走 `Helpers/ClientIpHelper.GetClientIp`；XFF 可偽造、**僅供稽核 log、不可用於權限判定**。
- **圖示寫入一律走 `IIconStorageService`，禁止在 Controller 自行存 base64 或拼 icon 路徑**：Create/Update/Delete 都用 `SaveAsync`（存檔回傳路徑）；Update/Delete 必須先 **捕捉 oldIcon → 寫入新值並 SaveChanges 後**，再呼叫 `DeleteIfLocalUnreferencedAsync(oldIcon)` 做孤兒清理（清理在 commit 之後、且帶參照檢查，故安全）。批次端點（`BatchUpdateMenus`/`BatchDeleteMenus`）收集 `oldIcons` list，於交易 commit 後統一清理。
- **Service 層為「部分抽離」**：`Settings`/`Accounts`/`Auth`/`MenuAuth`/`Icon` 已抽成 Service；`Menus`/`Roles`/`Fabs`/`Apps`/`Requests`/`PersonalSettings` 仍把邏輯留在 Controller（單純 CRUD，刻意不過度抽象）。新增複雜邏輯才考慮抽 Service，勿為一致性硬抽。

### 6.3 授權/安全（authz）
- **Class-level `[Authorize]` 一律設成最寬鬆 baseline**；要 admin 的 action 自己加 `[Authorize(Roles="admin")]`。class+action 的 `[Authorize]` 是「累加要求」不是 override —— class 設 admin 會把所有非 admin 擋死、整站無 sidebar。
- 非 admin 的 `GetInitialData`/`GetMenus` **必須後端按可見性過濾**（`IMenuAuthService.GetVisibleMenuIdsAsync` + `SettingsController.FilterTable`），不可只靠前端篩選。`GetVisibleMenuIdsAsync` 結果以 `visibleMenus:{ETag}:{empId}` 跨請求快取（ETag 變更即作廢、回傳防禦性副本）；對外回傳值**只能讀（`Contains`）不可就地改動**（會污染共享快取物件）。其 ACL 查詢靠 `IX_Map_Menu_Allow/DenyAccount_EmpId` 走 index seek。
- Menu 權限優先序 **Menu ACL > Account override > Role**；`MenuAuthService` 走 `Map_Menu_Structure` parent chain（對齊前端 `getMenuPermissions`/`isUnderDelegated`）。
- 寫入時 **path id 為事實來源**（函式開頭 `dto.Id = id;` / `dto.EmpId = empId;`），防 path/body 不一致洗他人 mappings。
- `createdBy` 強制為實際登入者 empId（更新時 immutable），防 mass assignment 偽造。
- 非 admin 編輯 menu 一律清空 `dto.AllowedEmpIds/DeniedEmpIds`（不可改他人可見性）。
- CSRF：POST/PUT/DELETE 需 `X-Requested-With` 標頭，失敗回 JSON `{success,message}`。並走 ASP.NET Antiforgery（header `X-CSRF-TOKEN`，token 由 `GET /api/Auth/CsrfToken` 取得）。
- **CSRF 驗證 middleware 必須放在 `UseAuthentication()`／`UseAuthorization()` 之後**（Program.cs）：ASP.NET antiforgery token **綁定登入者 claims 身分**，`ValidateRequestAsync` 會拿 `context.User` 與 token 內嵌身分比對。若驗證 middleware 放在 `UseAuthentication` 之前，驗證當下 `context.User` 仍是匿名 → 已登入者送來的「身分綁定 token」永遠對不上匿名 context → **一律 `CSRF validation failed: Invalid Token`（無論前端怎麼刷新 token 都救不了）**。安全標頭（nosniff/X-Frame-Options）可留在前段；唯獨 antiforgery 驗證一定要後置。
- **前端兩道配套防線**（搭配上面的後端後置才生效）：(1) `auth.js completeLoginAfterAuth` 一進來就 `await window.refreshCsrfToken()` 重取「綁定當前登入身分」的 token；(2) `api.js` 全域 fetch 攔截器對「寫入請求 400 + body 含 Invalid Token」**自動重取 token 並重試一次**（自我修復，兼容伺服器重啟/DP 金鑰更新）。CSRF 標頭一律經 `applyCsrfHeaders()` 以**覆寫**語意設定（重試不疊加多個 token）。改 CSRF 流程務必維持「後端後置驗證 + 前端刷新/重試」三者一致。

### 6.4 前端 (JavaScript)
- 全域變數已全面收斂至 `store.js` 的 `appState` 物件（`appState.currentUser/currentFab/currentLang` 等），全面捨棄 `window.*`，所有 JS 檔統一透過 `import { appState } from './store.js'` 存取。
- CRUD 結束走對應 RESTful API（`saveXxxAPI`/`batchSaveMenusAPI`…）即可；`syncDataToDB()`（全量覆寫 `/Settings/SaveData`）僅剩 Excel 匯入用，**勿**用於一般 CRUD/拖曳。
- **看板拖曳排序（系統版面＝全域共用）走 `batchSaveMenusAPI()` 只送異動看板**，禁用 `syncDataToDB()` —— 後者 payload 由 admin 自己 localStorage 重建整張 `PersonalSettings`，會用過時快照洗掉所有人的個人版面。樂觀渲染＋失敗 `fetchInitialDataFromDB()` 回滾。BatchUpdateMenus 會從 dto 重建 SortOrder 與（admin）ACL，黑白名單完整保留。
- **自訂版面（個人上方導覽列，per-user）走 `/api/PersonalSettings`**（`savePersonalSettings` 回傳成敗，呼叫端須偵測失敗、不可假報成功），拖曳儲存即時更新且不影響他人。
- **`PersonalSettings` 為 RESTful-only**：後端 `SettingsService.TableNames` 已**移除** `PersonalSettings`，前端 `getDatabasePayload()` 也**不**再組裝它 —— 故 `SaveData`／Excel 匯入皆不會再碰個人版面表（讀取端 `GetInitialDataAsync` 直接以 `_dbContext.PersonalSettings` 取，與此清單無關）。新增/修改個人版面只能走 `/api/PersonalSettings` per-user delete+insert。`PersonalSettings` 無 FK 到 `Menus`（PK-only），故移出 TableNames 不會卡 `DELETE FROM Menus`。
- **Excel 匯出（`createWorkbookData`）不再產 `PersonalSettings` sheet**：匯入端 `processAndSaveWorkbook` 從不讀此 sheet（個人版面靠 localStorage 非 Excel round-trip），O3 後 localStorage 只剩自己一份，硬匯出只會得到殘缺＋無法還原的資料 → 移除以保持「匯出＝可還原備份」的一致性。
- **localStorage 個人版面只快取「登入者自己」一份**：`fetchInitialDataFromDB` 取得 `MyProfile.empId`（fallback `window.currentUser?.id`）後，只 `setItem('umc_personal_menus_'+myEmpId, …)` 自己這份，且每次載入都覆寫成 DB 真實值（含 DB 已清空→本機也清空）；**禁止**把 `psByEmp` 內他人版面寫進本機。
- **App CRUD 一律走 `saveAppAPI`/`deleteAppAPI`**（靜態 import 必為 function），不再有 `else if syncDataToDB()` 全量覆寫後備（已移除死碼）。
- **管理頁 CRUD（選單配置管理）儲存/刪除後一律「就地刷新」、禁止 `goDefaultHome()`**：`menu-manage.js` 的 `saveMenuNodeItem`／`deleteMenuNodeItem` 成功後只 `hideModalSafely` 關掉編輯 Modal，再 `fetchInitialDataFromDB()` + `renderMenuConfigTable()`/`renderWebpageTable()`/`renderSidebarMenus()` 就地更新，**不可**呼叫 `goDefaultHome()`（那會整頁跳去使用者預設看板，使用者在哪個管理頁編輯就該留在哪頁）。參考正確樣板：`saveWebpageItem`、`toggleMenuEnable`。`goDefaultHome()` 僅保留給「切換系統/個人模式」（`ui/layout.js`）、「切換 Fab」（`render/sidebar-item.js`）、初次載入（`main.js`）等真正需要導頁的場景。
- **Excel 匯入（`importConfig`）為破壞性全量覆寫，須二次 `customConfirm`** 後才執行 `runImportConfig`。
- **不用 `localStorage` 存業務資料**，一律走 DB。
- 看板搜尋只讀 `window._currentValidMenus`（已權限過濾）；**絕不退回未過濾 `getCustomMenus()`**。
- 靜態快取：`.js/.css` 為 `no-cache`（走 304）、圖片/字型保留 7 天（main.js 的 import 不帶版號，長快取會卡子模組）。
- **圖示渲染判斷一律用 `iconVal.startsWith('data:') || iconVal.includes('/')` → 出 `<img>`；否則當 FontAwesome class 出 `<i class>`**（FA class 如 `fas fa-folder` 永不含 `/`，路徑 `/images/icons/...` 與 data: URI 才是圖檔）。此判斷散落於 `render/sidebar-item.js`、`render/sidebar.js`、`ui/dialogs.js`(`generateIconHtml`)、`admin/misc-manage.js`(`setIconValToModal`)，改一處要同步四處。（misc-manage.js 另有一處 `startsWith('data:image')` 是 Excel 匯出的長度防呆，**不是**渲染判斷，勿動。）
- **模組底部 `window.X = X` 曝露區塊每檔只保留一份**：曾反覆出現「同一區塊被 append 三遍」的等冪重複死碼（已在 tables.js + 12 個模組清掉）。重複是 no-op 但屬冗餘，新增曝露時直接加進既有那一份、勿再貼整塊。清死碼時「可證明等冪重複」可放心刪；但 window 曝露/ES export 的函式即使疑似沒人呼叫也**不要臆測刪除**（可能被 HTML inline `onclick` 以字串引用、難 100% 靜態追蹤）。

### 6.5 關鍵函式位置（V2 模組化後）
| 函式 | V2 位置 | 用途 |
| --- | --- | --- |
| `getAllowedIdsWithHierarchy` / `getMenuPermissions` / `renderUserDropdown` | `render/sidebar.js` | 權限展開、三層判定、頭像下拉 |
| `filterSidebarMenus` / `setupSidebarSearch` | `render/sidebar.js` | 看板即時搜尋（只讀 `_currentValidMenus`）|
| `toggleSubMenu` | `render/sidebar-item.js` | collapse 開合 |
| `togglePersonalProp` | `render/tables.js` | 個人模式切換 |
| `goDefaultHome` | `ui/navigation.js` | 預設首頁（用過濾後清單做防呆）|
| `customAlert` / `customConfirm` | `ui/dialogs.js` | 全域對話框 |
| `toggleSidebar` / `togglePin` | `ui/layout.js` | 版面控制 |
| `exportConfig` / `importConfig` / `reorderPersonalMenu` / `deleteApplyItem` | `admin/misc-manage.js` | Excel、拖曳排序、撤回刪除 |
| `showModalSafely` / `hideModalSafely` | `admin/modal-utils.js` | Modal 安全開關 |
| `SaveAsync` / `DeleteIfLocalUnreferencedAsync` / `MigrateBase64IconsAsync` | `Services/IconStorageService.cs` | 圖示存實體檔、孤兒清理、啟動遷移 |

---

## 7. 安全現況（snapshot）

歷經多輪 multi-persona 攻擊矩陣審計，已修補並守住：未註冊/無權限帳號（WhoAmI 攔截、不發 Cookie）、一般使用者（前端隱藏管理 UI + 後端 `[Authorize(Roles="admin")]`/`IMenuAuthService` 403）、委派管理員（path-id 事實來源、ParentId/ParentIds 全驗、parent-chain 權限、ACL 欄位 null、createdBy immutable）、資訊外洩（非 admin 列級過濾機敏表）、Super Admin 防護（`AccountService.cs` 強制阻擋 `empId="admin"` 之降級與刪除）。詳細規則見 §6.2/§6.3。

**未結之機敏項（需使用者親自處理）**：DP 金鑰 `App_Data/keys/*` 與 DB 密碼曾進 git 歷史＝已外洩，需輪換（刪舊金鑰讓 DataProtection 重生＝登出所有人；改 `testuser` 密碼並改走環境變數/user-secrets）。

---

## 8. 待辦（open）
- [~] 版控收尾：canonical＝巢狀 `EQDashboard.V2.Web/.git`，已加 `.gitignore`＋`git rm --cached` 停追 bin/obj/.vs/App_Data/appsettings.json/*.csproj.user（staged 未 commit）。**待使用者**：commit（含 `git add` 漏追的源碼）、輪換上述外洩金鑰/密碼、（選擇性）filter-repo/BFG 清歷史。
- [ ] （未來擴展，現無感）看板數量成長到數百~數千時：Menu metadata（分類/標籤）、看板樹 lazy render、管理頁 server-side 分頁。

---

## 🔄 每輪對話自動覆盤協定 (Mandatory Per-Task Update)

你（Claude）必須將「更新專案文件與記憶」視為每個任務不可分割的最後一步。每次回答完使用者、或執行完程式碼修改時，**必須自動**執行（不需等使用者提醒）：

1. **更新 `CLAUDE.md`**：若涉及全新的「常用指令」「程式碼規範」或「禁止事項」，立即寫入對應區塊（保持精簡、現況快照，勿累積逐日日誌）。
2. **更新 `memory.md`**：
   - 在 `## 🛤️ 3. 開發歷史與決策日誌` 依今日日期（`YYYY-MM-DD`）追加一筆簡短記錄。
   - 完成待辦則到 `## 🛠️ 4. 進行中與待辦事項` 標記 `[x]` 並移出優先任務。
   - 隱藏邏輯/隱蔽 Bug 沉澱到 `## 🏗️ 1. 系統核心與隱藏邏輯` 或 `## 🐛 2. 踩坑與填坑紀錄`。
3. **同步 `專案架構.md`（條件性）**：`專案架構.md` 為專案結構/各檔案職責的現況快照。**當新增/刪除/移動檔案、或既有檔案職責有實質變動時**，必須同步更新對應條目（目錄樹、逐檔說明表、關鍵跨檔機制），保持與實際程式碼一致；純邏輯微調未動檔案結構則免。
4. **同步 `DB_Table.md`（條件性）**：`DB_Table.md` 為 EQDashboardV2 全表 CREATE TABLE 架構快照（供他機重建/更新表結構）。**當任何變動動到 DB 架構時**（新增/刪除表、欄位、索引、FK，含 `sql/schema_v2.sql`、`SchemaBootstrap.cs` 補欄位/補表/`EnsureIndexesAsync`、`Data/Configurations/*` 的結構性變更），必須同步更新本檔對應段落；純資料異動不影響結構則免。
5. **執行時機**：在送出「最終答覆文本」之前完成寫入，並在答覆末尾加一行 `*已自動更新 CLAUDE.md 與 memory.md*`（若本輪亦動到 `專案架構.md` 或 `DB_Table.md`，於該行一併列出）。
