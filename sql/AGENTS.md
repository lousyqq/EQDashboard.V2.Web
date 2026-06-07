# EQ Performance Dashboard - 專案說明文件 (AGENTS.md)

> 本文件提供 AI 助手在此專案下進行開發、修改、除錯時所需的最小必要知識。
> **兩個專案版本：**
> - **EQDashboard**（原版）：單一專案，所有 JS/CSS 為單檔。
> - **EQDashboard.V2.Web**（重構版）：相同功能，後端拆分 Service 層 + DI，前端 JS/CSS 模組化拆分。
> **兩版的版面與功能 100% 一致，V2 僅改善程式碼的可維護性。**

### 目前進展 (2026-05)
- [x] 完成專案重構，建立獨立的 `EQDashboard.V2.sln` 與 `EQDashboard.V2.Web`
- [x] 完成 `DbContext` 與實體模型的修復，支援 13 個關聯資料表
- [x] 完成首頁載入效能最佳化 (Caching) 與記錄 (Logging)
- [x] **逐步淘汰「全量覆寫」，改用 RESTful API (方案A)**
  - 已完成 `FabsController`, `RolesController`, `AccountsController`, `MenusController`
  - 前端已對應更新為呼叫 RESTful APIs (如 `saveFabAPI`, `batchSaveMenusAPI` 等)
- [x] **修復角色權限選單拖曳排序儲存無效問題** (api.js 解析 Map_Role_Menu 時補上 SortOrder 排序)
- [x] **修復畫面操作 (編輯/儲存) 嚴重卡頓問題** (拔除 tables.js, account-ui.js, role-manage.js, sidebar-item.js 中大量的 innerHTML += 以解決 Reflow 瓶頸)
- [x] **修復 V2.Web 編輯/儲存/刪除無效問題** (`ISettingsService.InvalidateInitialDataCache()` 在每個 RESTful 寫入後同步快取；`MenusController` 補 `DetachMenuReferencesAsync` 預先解除 `MapMenuStructure` Restrict FK)
- [x] **導入雙模式身份驗證** (Kestrel + Negotiate 自動偵測 Windows 桌機帳號 + AD LDAP 手動帳密；登入框 2 個 tab；登出設 `umc_force_manual_login` 旗標避免 Windows Auth 立刻又拉回去)
- [x] 前端引入 ES Modules (方案B - 已完成)
- [x] 補齊 API 授權與安全認證 (方案C - 已完成)
- [x] 效能與架構深度優化 (Log Queue, 實體圖檔儲存, URL Regex 強制把關, 廠區權限過濾, Soft Delete 備份至 Log)
- [x] 健康檢查與防護補強 (XSS 修補、Anti-Forgery Token、GetInitialData ETag 快取、前端多分頁 localStorage 同步)
- [x] 撰寫完整操作手冊 `user_manual.md`

---

## 1. 專案定位與運行模式

| 項目 | 舊版 (參考網頁) | 新版 (本專案) |
| --- | --- | --- |
| 啟動方式 | 直接以瀏覽器開啟 `TEST_20260429.html` | 執行 `EQDashboard.sln` → 啟動 ASP.NET Core Kestrel/IIS Express |
| 資料來源 | 開啟後讀取 `EQDashboard_Setting.xlsx` | 啟動後呼叫 `/Settings/GetInitialData` 讀取 MSSQL |
| 資料保存 | 匯出新的 `.xlsx` 檔案 | **任何 CRUD 異動皆自動靜默呼叫 `/Settings/SaveData` 寫回 MSSQL**（已移除頂部「同步至 DB」按鈕） |
| 個人化設定 | LocalStorage | DB (`PersonalSettings` 表) + LocalStorage 快取 |
| 登入統計 | LocalStorage (`umc_user_stats_*`) | DB (`Accounts.LoginCount` / `Accounts.LastLoginTime`)，登入時呼叫 `/Settings/UpdateLoginStats` |
| 預設 URL | 本機檔案 | V1: `http://localhost:5242` / V2: `http://localhost:5000` |
| 資料庫 | — | V1: `EQDashboard` / V2: `EQDashboardV2` |

---

## 2. 檔案結構 (File Structure)

### 2.0 EQDashboard（原版，單檔結構）

```
C:\EQDashboard\EQDashboard\EQDashboard\
├── EQDashboard.csproj
├── Program.cs / appsettings.json
├── Controllers\SettingsController.cs    # 含所有業務邏輯 (473行)
└── wwwroot\
    ├── index.html (836行)               # 含 10 個 Modal
    ├── css\style.css (1221行)           # 全站樣式
    └── js\
        ├── config.js / api.js / auth.js / main.js
        ├── ui.js (800行)                # 所有 UI 互動
        ├── render.js (1515行)           # 所有表格渲染
        └── admin.js (1796行)            # 所有管理邏輯
```

### 2.1 EQDashboard.V2.Web（重構版，模組化結構）

```
C:\EQDashboard\EQDashboard\EQDashboard.V2.Web\
├── EQDashboard.V2.sln                  # Visual Studio 方案檔
├── EQDashboard.V2.Web.csproj
├── Program.cs                          # DI 註冊 + middleware pipeline
├── appsettings.json                    # ConnectionStrings:EQDashboardV2
├── Models\                             # 每個 Entity 獨立檔案
│   ├── Account.cs / Menu.cs / Fab.cs / Role.cs
│   ├── AppItem.cs / Request.cs / PersonalSetting.cs
│   └── DTOs\ (AccountDto.cs, PagedResult.cs)
├── Data\AppDbContext.cs                # EF Core DbContext + Fluent API
├── Services\                           # 業務邏輯抽離
│   ├── ISettingsService.cs → SettingsService.cs
│   └── IAccountService.cs → AccountService.cs
├── Controllers\                        # 薄化 Controller
│   ├── SettingsController.cs (89行)
│   ├── AccountsController.cs (64行)
│   └── (MenusController, RolesController, FabsController, etc.)
└── wwwroot\
    ├── index.html (392行)              # Modal 抽離至 partials/
    ├── favicon.ico
    ├── partials\
    │   └── modals.html (463行)         # 10 個 Bootstrap Modal，由 fetch 動態載入
    ├── css\                            # 從 style.css 拆分
    │   ├── variables.css (58行)        # CSS 變數、全域 reset
    │   ├── navbar.css (217行)          # 雙列導覽列
    │   ├── sidebar.css (201行)         # 側邊欄與內容區
    │   └── components.css (749行)      # 表格、卡片、Badge、Modal、登入
    └── js\
        ├── config.js (148行)           # i18n + 全域變數
        ├── api.js (446行)              # DB 讀寫核心
        ├── auth.js (116行)             # 登入/登出
        ├── main.js (125行)             # 初始化進入點
        ├── ui\                         # 從 ui.js (800行) 拆分
        │   ├── layout.js (170行)       # 側邊欄、全螢幕、釘選、版面切換
        │   ├── navigation.js (473行)   # 語系、選單導航、路由、iframe
        │   └── dialogs.js (160行)      # Alert/Confirm、同步按鈕、圖示
        ├── render\                     # 從 render.js (1515行) 拆分
        │   ├── sidebar.js (371行)      # 側邊欄渲染
        │   ├── sidebar-item.js (239行) # 選單項目產生器
        │   ├── tables.js (483行)       # 管理表格渲染
        │   └── account-ui.js (426行)   # 帳號 Modal UI
        └── admin\                      # 從 admin.js (1796行) 拆分
            ├── modal-utils.js (74行)   # Modal 開關封裝
            ├── fab-manage.js (108行)   # 廠區管理
            ├── role-manage.js (185行)  # 群組管理
            ├── account-manage.js (165行)# 帳號管理
            ├── menu-manage.js (602行)  # 選單/看板管理
            └── misc-manage.js (669行)  # AppGrid/申請/Excel/圖示
```

### 2.2 前端 JS 載入順序（V2 index.html 末端）

```
config.js → api.js → auth.js
→ ui/layout.js → ui/navigation.js → ui/dialogs.js
→ render/sidebar.js → render/sidebar-item.js → render/tables.js → render/account-ui.js
→ admin/modal-utils.js → admin/fab-manage.js → admin/role-manage.js
→ admin/account-manage.js → admin/menu-manage.js → admin/misc-manage.js
→ main.js
```

> **重要**：所有函式宣告在全域作用域（非 ES modules），不使用 `import/export`。
> 載入順序決定函式可用性，新增模組時需注意依賴關係。
> `partials/modals.html` 由 `<script>fetch(...)` 動態載入，在 JS 初始化前完成。

---

## 3. 技術版本 (Tech Stack)

### 3.1 後端

| 項目 | 版本 / 說明 |
| --- | --- |
| .NET SDK | **.NET 9.0** (`<TargetFramework>net9.0</TargetFramework>`) |
| Web 框架 | ASP.NET Core MVC + Static Files |
| Nullable | `enable` |
| ImplicitUsings | `enable` |
| NuGet：`Microsoft.Data.SqlClient` | 7.0.1 (已全面取代 System.Data.SqlClient) |
| DB | **MSSQL**（Server: `Sariel`, V1: `EQDashboard`, V2: `EQDashboardV2`, User: `testuser`）|
| 連線字串 | V1: `appsettings.json` → `ConnectionStrings:EQDashboard`；V2: → `ConnectionStrings:EQDashboardV2` |

### 3.2 前端（全部走 CDN，未使用 npm / bundler）

| 套件 | 版本 | 用途 |
| --- | --- | --- |
| Bootstrap | 5.3.2 | UI 框架 |
| jQuery | 3.7.0 | DataTables 相依 |
| DataTables | 1.13.6 | 表格分頁/排序 |
| Font Awesome | 6.4.0 | 圖示 |
| SheetJS (xlsx) | 0.18.5 | 設定檔管理頁的「匯入」與「匯出 Excel 備份」功能仍使用 |

### 3.3 啟動 Profile (`Properties/launchSettings.json`)

| Profile | URL |
| --- | --- |
| http | `http://localhost:5242` |
| https | `https://localhost:7033;http://localhost:5242` |
| IIS Express | `http://localhost:45686` / SSL `44356` |

---

## 4. 資料模型 (Database Schema)

完整建表 SQL 位於 [參考網頁/MSSQL_DB架構.sql](參考網頁/MSSQL_DB架構.sql)。
共 **13 張表**，分為「實體表」與「關聯表 (Map_*)」：

### 4.1 實體表

- `Menus`：系統選單（含 PoolItem 旗標、全域排序）
- `Fabs`：廠區（12A / 12M / 12i）
- `Roles`：權限群組
- `Accounts`：帳號（admin / user，含 RoleLevel / CanEditOthers / **LoginCount** / **LastLoginTime**）
- `Apps`：應用集合模組項目（含 Base64 圖示）
- `Requests`：需求申請與審核單
- `PersonalSettings`：個人化選單設定（複合主鍵 EmpId + MenuId）

### 4.2 關聯表 (多對多 / 階層)

- `Map_Fab_Role`：廠區 ↔ 角色
- `Map_Account_Role`：帳號 ↔ 角色
- `Map_Account_ManageMenu`：帳號 ↔ 可管理選單（委派）
- `Map_Role_Menu`：角色 ↔ 可看選單（含 SortOrder）
- `Map_Menu_Structure`：選單父子結構（ParentMenuId / ChildMenuId / SortOrder）
- `Map_Account_DefaultPage`：帳號於不同廠區的預設首頁

### 4.3 累計補強的 DDL（需在 SSMS 執行一次）

```sql
USE EQDashboard;
GO

-- Accounts 表新增登入統計欄位（若呼叫 UpdateLoginStats 時欄位不存在，後端會自動補）
IF COL_LENGTH('Accounts','LoginCount') IS NULL
    ALTER TABLE Accounts ADD LoginCount INT NULL;
IF COL_LENGTH('Accounts','LastLoginTime') IS NULL
    ALTER TABLE Accounts ADD LastLoginTime DATETIME NULL;
UPDATE Accounts SET LoginCount = 0 WHERE LoginCount IS NULL;
```

### 4.4 前端 ↔ DB 欄位對應

前端使用 **camelCase**（如 `m.id`, `m.displayName`、`a.loginCount`、`a.lastLoginTime`），DB 使用 **PascalCase**（如 `MenuId`, `DisplayName`、`LoginCount`、`LastLoginTime`）。
雙向轉換集中在 [EQDashboard/wwwroot/js/api.js](EQDashboard/wwwroot/js/api.js)：

- 讀取：`fetchInitialDataFromDB()` 內 `getVal(obj, key)` 工具無視大小寫抓欄位。
- 寫入：`getDatabasePayload()` 內顯式以 PascalCase 命名欄位。**Accounts 的 LoginCount / LastLoginTime 必須在 payload 帶上**，否則自動同步全表覆寫時會把這兩欄洗成 NULL。

---

## 5. API 規範

目前共三支 API：

| Method | Path | 用途 | 回傳格式 |
| --- | --- | --- | --- |
| GET | `/Settings/GetInitialData` | 一次取出 13 張表 | `{ TableName: [ {col: val}, ... ], ... }` |
| POST | `/Settings/SaveData` | 全量覆寫（先 DELETE 再 INSERT，包在 Transaction 內） | `{ success: bool, message: string }` |
| POST | `/Settings/UpdateLoginStats` | 登入時呼叫：`LoginCount += 1` 與 `LastLoginTime = GETDATE()` | `{ success: bool, loginCount: int, lastLoginTime: "yyyy-MM-dd HH:mm:ss" }` |

---

## 6. 開發規範 (Development Conventions)

### 6.1 通用原則

- **畫面一致性優先**：任何 UI / 互動改動，都必須對照 `參考網頁/TEST_20260429.html` 的呈現與行為。
- **不破壞既有資料結構**：`appState` 結構（`menus / fabs / roles / accounts / apps / requests`）已被多處依賴，新增欄位時用擴充而非取代。
- **避免引入 build pipeline**：目前前端為純靜態檔，請勿擅自引入 webpack / vite / TypeScript / npm 等流程。

### 6.2 後端 (C#)

- **Controller 命名**：保持與 URL 對應的 `XxxController : Controller`。
- **SQL 安全**：所有使用者輸入欄位值務必走 `SqlParameter`，**禁止字串拼接** SQL 值。
- **Transaction**：寫入類 API 一律包 `BeginTransaction()`。
- **Schema 異動**：能用 `IF COL_LENGTH(...) IS NULL ALTER TABLE` 在 Controller 自動補欄位的，盡量做。

### 6.3 前端 (JavaScript)

- **不引入框架**：維持 jQuery + Vanilla JS + Bootstrap。
- **全域變數命名**：沿用既有 `currentUser / currentFab / currentLang / currentLayoutMode / modals` 等命名。
- **CRUD 結束後必呼叫 `syncDataToDB()`（靜默版）**：對齊「即改即存」體驗。
- **禁止使用 `location.reload()`**：任何需要刷新畫面的操作，必須呼叫 `fetchInitialDataFromDB()` 後呼叫對應的 `render*` 函式，以避免畫面閃爍與回到無權限預設頁。
- **不要使用 `localStorage` 存業務資料**：新業務一律走 DB。

### 6.4 關鍵函式所在位置（V2 模組化後）

| 函式 | V1 位置 | V2 位置 | 用途 |
| --- | --- | --- | --- |
| `getAllowedIdsWithHierarchy` | `render.js` | `render/sidebar.js` | 遞迴展開允許 ID |
| `getMenuPermissions` | `render.js` | `render/sidebar.js` | 三層權限判定 |
| `toggleSubMenu` | `render.js` | `render/sidebar-item.js` | collapse 開合 |
| `renderUserDropdown` | `render.js` | `render/sidebar.js` | 頭像下拉 |
| `togglePersonalProp` | `render.js` | `render/tables.js` | 個人模式切換 |
| `goDefaultHome` | `ui.js` | `ui/navigation.js` | 預設首頁邏輯 |
| `customAlert` / `customConfirm` | `ui.js` | `ui/dialogs.js` | 全域對話框 |
| `toggleSidebar` / `togglePin` | `ui.js` | `ui/layout.js` | 版面控制 |
| `deleteApplyItem` | `admin.js` | `admin/misc-manage.js` | 撤回後刪除 |
| `exportConfig` / `importConfig` | `admin.js` | `admin/misc-manage.js` | Excel 匯入匯出 |
| `reorderPersonalMenu` | `admin.js` | `admin/misc-manage.js` | 拖曳排序 |
| `showModalSafely` / `hideModalSafely` | `admin.js` | `admin/modal-utils.js` | Modal 安全開關 |

---

## 7. 與舊版 (TEST_20260429.html) 對齊清單

- [x] 全域導覽列、沉浸模式、多語系、個人頁面功能一致
- [x] 看板網頁管理、選單配置管理、廠區與權限、帳號委派
- [x] 需求申請與審核、應用集合模組
- [x] 右上角頭像下拉資訊
- [x] 設定檔管理（Excel 匯入/匯出/強制全量寫入）

---

## 9. 變更紀錄摘要（重大架構/行為調整）

| 主題 | 變更 |
| --- | --- |
| 同步策略 | 移除頂部「同步至 DB」按鈕；所有 CRUD/拖曳結束時自動靜默呼叫 `syncDataToDB()` |
| `currentLayoutMode` | 統一字串為 `'system'` / `'personal'`（曾誤用 `'custom'` 已撤回） |
| `i18n` 物件 | 從舊版移植回 `config.js`（zh / en / ja 三組） |
| 補回的函式 | `toggleSubMenu`、`getAllowedIdsWithHierarchy`、`getMenuPermissions`、`renderUserDropdown`、`deleteApplyItem`、`exportConfig` / `createWorkbookData` |
| Excel 匯出 | 在「設定檔管理」頁加上「匯出 Excel 備份」按鈕（呼叫 `exportConfig()`） |
| 效能 | `enforceSystemModeUI` 的 `MutationObserver` 從監聽整個 `<body>` 改為只監聽 `#dynamic-sidebar-menus` |
| V2 重構 | 建立 `EQDashboard.V2.Web` 專案：後端拆分 Service 層 + DI、前端 JS/CSS 模組化、Modal 抽離至 `partials/modals.html` |
| V2 JS 拆分 | `admin.js` → 6 模組、`render.js` → 4 模組、`ui.js` → 3 模組（全域函式，非 ES modules） |
| V2 CSS 拆分 | `style.css` → `variables.css` + `navbar.css` + `sidebar.css` + `components.css` |
| V2 HTML 拆分 | `index.html` 的 10 個 Modal 抽離至 `partials/modals.html`，由 `fetch()` 動態載入 |
| V2 邊界修正 | JS 拆分時 `menu-manage.js` / `misc-manage.js` 交界的 `};` 被錯誤分割，導致 misc-manage.js 語法錯誤 |
| 安全性修復 | 修正 LDAP 關閉時的驗證繞過漏洞；實作 IAccountService 並收斂 AccountsController 權限為 admin-only；實作 IMenuAuthService 以後端驗證選單委派權限；修正 /Settings/GetInitialData 匿名資料與登入者全量機敏資料外洩問題 (僅過濾回傳個人紀錄)；修正 SettingsService 批次寫入的 Rollback 邏輯；前端實作 CSRF 與 XSS 防護 |
| 後端優化 | 改造 SettingsService 的查詢邏輯，拔除 ADO.NET 全表查詢，替換為精確的 EF Core API 呼叫，並使用 AsNoTracking 增進效能。實作非同步佇列 `ActivityLogQueue` 改善 Logging 瓶頸。實體化儲存圖檔以減輕資料庫負擔。實作快取分流（`InitialData_Global` / `InitialData_Volatile`）以降低全庫重載機率，並以 Reflection 取代雙重序列化，降低 CPU 消耗。 |
| 資料保護 | 實作「Soft Delete 備份至 Log」機制：執行 DELETE 時，自動將整筆 JSON 寫入 `UserActivityLogs` 中備份，不增加資料表的負擔同時具備災難還原能力。 |
| 前端重構 | 引入 ES Modules，將所有 JS 檔案改為 export/import 模組化架構，並透過 `window.` 明確宣告與 HTML handler 的綁定 |

## 🔄 每輪對話自動覆盤協定 (Mandatory Per-Task Update)

你（Codex）必須將「更新專案文件與記憶」視為每個任務不可分割的最後一步。在每一次回答完使用者問題、或執行完程式碼修改時，你**必須自動**執行以下檢查，不需等待使用者提醒：

1. **更新 `AGENTS.md`**：
   - 檢查使用者剛剛的提問或你的修改中，是否涉及全新的「常用指令」、「程式碼規範」或「禁止事項」。
   - 如果有，立刻使用 `write_file` 變更本檔案的對應區塊（總長度需保持在 150 行內）。

2. **更新 `memory.md`**：
   - **新增歷史日誌**：在 `## 🛤️ 3. 開發歷史與決策日誌` 中，依今日日期（格式：`YYYY-MM-DD`）追加一筆簡短記錄，說明你剛剛幫使用者解決了什麼問題或修改了什麼功能。
   - **更新待辦狀態**：如果剛剛的對話完成了一個待辦事項，請去 `## 🛠️ 4. 進行中與待辦事項` 將其標記為 `[x]`，並移出當前優先任務。
   - **沉澱技術細節**：如果使用者剛剛詢問了某個隱藏的系統邏輯、或你們剛修復了一個隱蔽的 Bug，請立刻將其總結並補充到 `## 🏗️ 1. 系統核心與隱藏邏輯` 或 `## 🐛 2. 踩坑與填坑紀錄` 中。

3. **執行時機**：在向使用者發送「最終答覆文本」之前，請先完成上述檔案的寫入。你可以在最終答覆的末尾加上一行提示（例如：`*已自動更新 AGENTS.md 與 memory.md*`）以利確認。

