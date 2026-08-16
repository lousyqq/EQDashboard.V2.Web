# EQ Performance Dashboard - 專案說明文件 (CLAUDE.md)

> 給 AI 助手的明確指令：
> **每次對話開始時，請務必先讀取 `memory.md` 與 `系統架構.md` 掌握當前最新進度與架構。**
> **每次修改或決策後，請務必同步更新 `memory.md`（與必要時的 `系統架構.md`、`DB_Table.md`）。**

---

## 1. 專案簡介與核心目標
**EQDashboard.V2.Web**（現役主線重構版）是專為 UMC（聯電）廠區設計的效能看板入口系統。
**核心目標**：依據使用者的廠區與職務權限，結構化地呈現並管理可存取的各項效能報表與看板連結。提供極致流暢的使用者體驗（App Shell 快取、SPA 級路由切換）與嚴謹的權限隔離。

## 2. 當前最高優先級開發任務 (Current Focus)
- 產出完整的使用者操作手冊 (PPT 規劃)。
- 第四輪健檢 F12 未做的三項功能建議（另案）：流量統計 inline SVG 圖表、統計/操作紀錄 CSV 匯出、`Description`/`Keywords` 接進看板網頁管理的表格搜尋。
- ~~`sql/2026-08-16_Fix_Account_Department_RoleNamePollution.sql`~~ → 已於 2026-08-16 執行並查 DB 驗證：`Accounts` / `DailyUserVisits` 的假部門（`一般使用者`／`系統管理員`）皆為 **0 筆**。
- ~~`sql/2026-08-16_Add_DailyUserVisits_Emp_Index.sql`~~ → 已於 2026-08-16 執行並查 `sys.indexes` 驗證：`IX_DailyUserVisits_Date_Emp (VisitDate, EmpId, EmpName)` 已存在於線上 `EQDashboardV2`。
- **目前線上 DB 與 `DB_Table.md` 快照一致，無待執行的 SQL 腳本。**
- ~~第四輪健檢 F3~F12 待修清單~~ → 2026-08-16 全數修復並實機驗證（細節見 `memory.md` §3）。
- ~~工作區未 commit（六天成果裸奔）~~ → 2026-08-16 已 commit + push（`696195d`），`sql/` 6 支亦全數收斂進本 repo 並納入版控。
- ~~`TrackingController` 點擊統計偶發 `400 (Invalid CSRF Token)`~~ → 已於 2026-08-12 由 A2 修復（根因是 `_csrfToken` 初始化時序，非金鑰輪換）；2026-08-16 實機複驗暖重整請求序列乾淨、MenuClick 只 1 筆。

> **版控範圍**：唯一事實來源是本 repo（`EQDashboard.V2.Web`，remote `github.com/lousyqq/EQDashboard.V2.Web`）。外層 `EQDashboard` 只是本機容器，**不維護、不視為 submodule**（詳見 `memory.md` §3 F1/F2 下方的決策註記）。

---

## 3. 專案概況與運行模式
- **架構**：ASP.NET Core .NET 9.0 (Kestrel/IIS) + ES Modules 前端 (Bootstrap 5/Vanilla JS，全 CDN 無 bundler)。
- **資料庫**：MSSQL (`EQDashboardV2` @ `Sariel`)。無 EF Migrations，由 `SchemaBootstrap` 啟動時以 T-SQL 冪等修復 (補表/欄位/索引)。CRUD 靜默寫入 DB，個人版面存 `PersonalSettings`。
- **身分驗證 (`AuthSettings`)**：Windows Negotiate 自動偵測，前端無手動帳密表單。
  - `SimulatedAccount`：指定帳號本地模擬驗證。變更時即時作廢舊 Cookie (`SignOutAsync`)。
  - `DefaultAdmins`：名單內帳號自動建帳升級為 admin，防系統鎖死。
  - `OpenAccessMode`：開啟時開放瀏覽，自動建帳綁定全廠區；關閉時嚴格限制名單。
- **權限隔離 (App Grid)**：無管理權限者，前端 UI 一律隱藏編輯/刪除圖示與端點。操作開啟方式全站一致。
- **登入不因時間過期（企業內網政策，2026-08-16 定案）**：`Auth:SessionDays` 預設 **3650 天**＋`SlidingExpiration`，實務上等同不過期。
  - **存續期間的唯一事實來源是 `Program.cs` 的 `options.ExpireTimeSpan`**。`SignInAsync` 的 `AuthenticationProperties` **嚴禁再設 `ExpiresUtc`** —— 它會覆蓋前者（歷史坑：兩處寫死 `AddHours(12)`，讓 `ExpireTimeSpan` 形同虛設，使用者隔夜回來必被登出）。
  - **401 一律先靜默重新自動登入**：`api.js` 收到 401、且 MyProfile 複驗確認失效後，會先跑一次 `tryAutoLogin()`（Windows Negotiate 背景換身分）。成功 → 只出 toast、**不彈視窗、不顯示登入框、且留在原頁**（靠 `window._silentReauthKeepPage` 讓 `completeLoginAfterAuth` 改呼叫 `initDashboardUI(true)`）；只有連自動偵測都失敗才 `logout()` + 阻斷式提示。**不要退回「401 就彈視窗要人重登入」的舊行為。**
  - ⚠️ 不論 `SessionDays` 設多久，**清掉 `App_Data/keys`（DataProtection 金鑰）等於所有人一起被登出** —— cookie 是用它加密的。部署/搬機器時務必保留該目錄。

---

## 4. 技術開發規範與 Coding Style

### C# 與 MSSQL (必 100% 嚴格遵循)
1. **薄 Controller**：統一 `XxxController : Controller`，業務邏輯封裝至 `Services/`。
2. **SQL 參數化**：原生 ADO.NET 對外部輸入一律 `SqlParameter`，嚴禁字串拼接。
3. **交易與執行策略**：多步驟寫入包原子交易，因 `EnableRetryOnFailure`，手動交易必經 `CreateExecutionStrategy().ExecuteAsync(...)`。
4. **複合 PK 先刪後寫**：替換映射表（如 `Map_Role_Menu`）時，同回合先 `RemoveRange` + `SaveChanges`，再 `Add` + `SaveChanges` 防止追蹤衝突。
5. **索引唯一事實來源**：`SchemaBootstrap.EnsureIndexesAsync`（冪等 T-SQL），嚴禁 EF `HasIndex`。
6. **UPDATE + OUTPUT**：更新並取新值單次往返，單一 SQL 配 `OUTPUT INSERTED.*`。
7. **快取作廢與 ETag**：異動核心表後必呼叫 `IInitialDataCacheInvalidator.InvalidateInitialDataCache()`。EF 有 `CacheInvalidationInterceptor` 安全網，但 raw SQL 寫入必須手動呼叫。
8. **禁用 `SqlBulkCopy`**：主機僅 6GB RAM，維持參數化批次 INSERT 防卡死 `RESOURCE_SEMAPHORE`。
9. **DbContext 池化**：建構子只收 `DbContextOptions`；嚴禁注入 Scoped 服務、嚴禁可變實例欄位。
10. **身分與 IP**：EmpId 唯一取自 `User.FindFirst(ClaimTypes.NameIdentifier)`；IP 走 `ClientIpHelper.GetClientIp`。

### 前端開發與安全規範
1. **CSRF**：`api.js` 攔截器對 400 + `Invalid Token` 自動刷新重試 1 次；Antiforgery Middleware 置於驗證後；**標頭一律由攔截器統一補上（`X-Requested-With` + `X-CSRF-TOKEN`），呼叫端不准自己帶** 。
   - **初始化時序（必守）**：`window._csrfToken` 只有 `auth.js` 的 `fetchAuthConfig()` 會設值，而 `main.js` 的 DOMContentLoaded 必須在 `initDashboardUI()` **之前** `await` 它完成（與 `fetchInitialDataFromDB()` 並行發出、不增加 RTT）。原因：`initDashboardUI → goDefaultHome → activateMenu → POST MenuClick` 是每次開頁的第一個寫入請求；若 token 未就位就會 400，且 `appState.openAccessMode` 未設會讓預設首頁判定在「暖重整 vs 冷載入」之間不一致。**嚴禁把 token 取得綁在 `tryAutoLogin()` 內**（暖重整路徑不會經過它）。
2. **ES Modules**：`import` 絕對置頂；inline 事件函數必 `window.X = X` 暴露；狀態走 `store.js` (`appState`)。
3. **App Shell 快取防禦**：RESTful 存檔後必呼叫 `window.clearAppCache(preserveCurrentUser)` 清除 LocalStorage 畫面暫存。
4. **單一 JS 入口，且 JS 一律不帶版本碼 (`?v=`)**：`index.html` 只准有 **一支** `<script type="module" src="js/main.js">`（不帶 query；main.js 的 import 圖已涵蓋全部 20 支模組），模組內的 `import` 也**全部不帶 `?v=`**。
   - 理由：module map 以「完整 URL 含 query」為 key，同一檔案只要出現兩種 URL 就會被載成**兩個模組實例** → `window.fetch` 被包兩層、`DOMContentLoaded` 跑兩遍（GetInitialData 雙打、MenuClick 統計記兩次）、模組層級 guard 變數各有兩份而失效。
   - ⚠️ 入口那支也不能帶 `?v=`：`auth.js` 與 `admin/misc-manage.js` 有反向 `import './main.js'`（循環相依），`main.js?v=x` 與 `main.js` 會變成兩個 URL、main.js 照樣執行兩次。
   - JS 的新鮮度改由 `Program.cs` 對 `.js/.css/.html` 設 `Cache-Control: no-cache`（每次帶 ETag 重新驗證、未變更回 304）保證。`?v=` 只保留給**不在 module 圖內**的資源：CSS `<link>` 與 `partials/modals.html`，其值一律對齊 `index.html` 內的 `__APP_VER__`（唯一事實來源）。
   - 驗收：`index.html` 內 `type="module"` 只能有 1 個；`grep -r "?v=" wwwroot/js` 必須是 0 筆。
5. **轉義三件套**：ID 進 JS `onclick` 必 `_jsArg()`；DB 資料進 DOM 必 `escHtml()`；URL ID 必 `encodeURIComponent()`。
6. **訊息分流**：成功/資訊走右下角 `showToast`；錯誤/決策走 `customAlert`/`customConfirm`。禁止為成功訊息加阻斷 Modal。**暫時性失敗（連線中斷、可重試的 401）也走 toast，不得阻斷**。
   - **401 不可直接登出**：`api.js` 收到 401 時必須先打一次 `/api/Auth/MyProfile` 複驗；只有確認身分真的失效才 `logout()`。401 有多種「session 其實還活著」的成因（改 `SimulatedAccount` 觸發 `OnValidatePrincipal` 的 `SignOutAsync`、App Pool 回收、金鑰輪換、與 SignOut 競態），舊版無條件登出會把人無故踢出。
   - **主題切換**：一律走 `ui/layout.js` 的 `applyTheme()`，它會同時設 `data-theme`（自訂變數）與 `data-bs-theme`（Bootstrap 5.3 原生元件）。**不要在別處各自 `setAttribute`**，否則兩個屬性會不同步、Bootstrap 元件卡在淺色。
   - **轉義只有一份實作**：`store.js` 的 `escHtml`（含 `'`）。`escapeHTML`／`escapeHtml` 都是它的別名，不要再新增私有副本。
7. **表格/挑選器**：`renderAccountTable` 是唯一 `serverSide:true` 的 DataTable，嚴禁改為記憶體分頁。
   - **「剛新增的必須在第一頁最上方」（2026-08-16 定案）**：新資料的 `order` 是接在最後（`menus.length * 10`），照排序渲染會掉到最後一頁，使用者按完新增看不到成果。統一機制在 `render/sidebar.js`：新增成功後呼叫 `pinNewRow(tableId, id)`（記在 `appState.dtPinnedNewIds`，**且會讓該次 `initDataTable` 略過分頁還原、留在第 1 頁**），render 函式排序完再套 `applyPinnedNewFirst(tableId, rows)` 把它搬到最前面。
   - **置頂只是「本次 session 的暫時排序」**：記憶體變數，整頁重整即消失、回歸 `order` 排序 —— 這是刻意的，不可改存 localStorage/DB，否則等於偷偷竄改全域順序（該順序的事實來源是「權限管理」的拖曳）。編輯既有項目**不置頂**（只有 `!id` 的新增路徑才呼叫）。
8. **新增 DB 欄位時必須同步「全量覆寫」三條路徑**：`/Settings/SaveData` 是 `DELETE FROM` + 依 **DB schema 欄位**重建 INSERT，**payload 沒帶到的欄位會被寫成 NULL**。所以每加一個欄位，都要同時補：① `api.js getDatabasePayload()`、② `api.js fetchInitialDataFromDB()` 的 mapper、③ `misc-manage.js` 的 Excel 匯出 + 匯入 mapping。少補任何一處，使用者按一次「匯入並覆蓋」就會靜默清空該欄。稽核欄位（`CreatedAt`/`CreatedBy`/`LoginCount`…）的規格是「前端只原封不動帶回、不編輯，且不放進 DTO」。
9. **i18n 三語必須同時新增**：新增 `data-i18n` 屬性或 `t('key')` 呼叫時，**zh/en/ja 三個語系都要補齊**。`data-i18n` 指向不存在的 key 不會報錯、只會靜默保留原本的中文硬字 —— 專案曾因此有 4 個 key（`lbl_recent`、`home_fab_title`、`ts_tab_popular`、`ts_tab_zombie`）長期失效而沒人發現。驗收：三語 key 數必須相等，且 `index.html` 內所有 `data-i18n` / `data-i18n-placeholder` 都要在 i18n 表中找得到。動態產生的畫面（如最近瀏覽卡片）還要記得加進 `changeLanguage()` 的作用頁重繪清單，否則切語言不會更新。
   - **`data-i18n` 絕對不可巢狀（2026-08-16 血淚）**：`changeLanguage()` 是對每個 `[data-i18n]` 直接 `el.innerHTML = 譯文`。若父元素有 `data-i18n`、內部又有帶 `data-i18n` 的子元素，**切語言時子元素會被整個覆寫掉、文字永久消失**（例：`<label data-i18n="X">套用權限群組 <span data-i18n="Y">(單選…)</span></label>` 切一次語言後那句提示就不見了）。
     正確作法：把 key 下移到「包住父層自身裸文字」的 `<span>`，父層不掛 `data-i18n`。驗收腳本要檢查「巢狀 data-i18n = 0」。
   - **JS 會動態填值的元素不可掛 `data-i18n`**：同樣因為切語言會把 innerHTML 洗回預設字串。已知名單：`#current-lang-display`、`#user-name`/`#user-role`、`#dropdown-user-*`、`#tsZombieDesc`、`#app-grid-title`、`#under-construction-text`、`#whoami-status`。這些請改在 JS 內用 `t('key', '中文預設')`。
   - **`aria-label` / `title` 也要翻譯**：2026-08-16 起 `changeLanguage()` 支援 `data-i18n-aria-label` 與 `data-i18n-title`。純圖示按鈕新增 `aria-label` 時請一併掛上，否則英日文使用者用讀螢幕聽到的仍是中文。
   - **JS 動態字串一律走 `t(key, '中文預設')`，包含 `customAlert`／`customConfirm`／`showToast`（2026-08-16 第四輪補完 60 處）**：前三輪的掃描只看靜態 HTML 文字節點，導致「英文介面下按刪除，按鈕是 OK/Cancel、內文卻是中文」長期沒被發現。動態建立的節點（如 toast 的 `.btn-close`）掛不了 `data-i18n-*`（`changeLanguage` 掃不到還不存在的節點），一律在建立當下用 `t()`。
   - **後端不准回傳「要直接顯示給使用者」的中文字面值**：`AnalyticsController` 曾回 `"已刪除看板"`／`"未指定/其他"`／`"未指定"`，前端無從翻譯。一律回 `null` 或代碼，由前端 `t()` 呈現（現有 key：`menu_deleted`／`dept_unspecified_other`／`unspecified`）。
   - **語系偏好的事實來源是 `umc_lang_preference`**：`changeLanguage(lang, persist = true)` 會落盤；`initDashboardUI` 的順序是 **使用者偏好 > `fab.defaultLang`**，套廠區預設語言時必須傳 `persist=false`。**不要退回「每次進站無條件套 `fab.defaultLang`」的舊行為** —— 那會讓英/日文使用者每重整一次就被打回中文。`changeLanguage` 同時負責 `<html lang>` 與 `document.title`（`index.html` 的防閃爍 inline script 有一份 `LANG_TAG` 鏡像，改語系代碼要兩邊一起改）。
   - **掃描器要用 DOM 走訪、不要只用正則**：`<div><i class="…"></i>提示：…</div>` 這種「巢狀元素之後的裸文字」，用 `<tag …>text` 的正則會完全掃不到（本輪就是這樣先漏了 37 處）。
10. **RWD 版面：`.utility-cluster` 不可再設 `flex-shrink: 0`（2026-08-16 F5）**：D2/E12 給工具鈕加的 `min-width:44px` 會把整條 cluster 撐到 540px，配上 `flex-shrink:0` 就會在 375px 下讓整頁水平溢出 195px，並把 `.nav-brand-section` 壓成 0px（D1 保留麵包屑的修法因此完全失效）。現況：≤992px 時 cluster 為 `flex:0 1 auto` + `overflow-x:auto`（內部捲動），`.nav-brand-section` 靠 **`min-width:150px`** 保底。**只寫 `flex:1 1 auto` 不夠** —— 負剩餘空間依基準寬度比例分配，品牌區照樣被壓扁。
    - **CSS 驗收要連「註解配對」一起檢查**：本輪曾把說明文字寫在 `*/` 之後又補一個 `*/`，CSS 解析器直接吃掉整條規則、量測才發現。驗收腳本需檢查 `/*` 與 `*/` 數量相等，且去除註解後不得有殘留的 `*/`。
    - 版面數字以實機量測為準（`documentElement.clientWidth` vs `body.scrollWidth`、目標元素的 `getBoundingClientRect()`），不要只看程式碼推論。

11. **導航所有權單一化**：`initDashboardUI()` 是唯一負責初始導航的地方（依 `stayOnCurrentPage` 決定是否 `goDefaultHome()`）。呼叫 `switchLayoutMode(mode, navigate)` 時若只是要同步版面模式狀態，**必須傳 `navigate=false`**，否則它內部也會 `goDefaultHome()` → `activateMenu` 跑兩遍（MenuClick 統計膨脹一倍）並架空 `stayOnCurrentPage`。判斷「是否重複執行」請以實機 Network 紀錄為準，不要只看程式碼推論。

---

## 5. 每輪對話文件同步規範 (Mandatory Protocol)
1. **同步 `CLAUDE.md` 與 `memory.md`**：寫入新確定的規範/坑點，移除過時任務。
2. **同步 `系統架構.md`**：檔案增刪、移動或核心職責調整時更新架構樹。
3. **DB 架構異動 (嚴格遵從)**：凡涉及資料庫 Schema 或結構變動，必須：
   - 同步修改 `DB_Table.md` 上方的結構快照。
   - 於方案根目錄 `sql\` **往下新增**增量的 `.sql` 腳本檔案。
   - **絕對禁止修改目前既有的 DB 資料與舊有腳本，只能透過往下新增 SQL 指令來進行架構修改。**
   - 於 `DB_Table.md` 末端的 Changelog **只增不刪**追加當日日期與新增的 `.sql` 檔名。
4. **回覆通知**：對話末尾註明 `*已自動更新 CLAUDE.md 與 memory.md*`。
