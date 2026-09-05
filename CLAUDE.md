# EQ Performance Dashboard - 專案說明文件 (CLAUDE.md)

> 給 AI 助手的明確指令：
> **每次對話開始時，請務必先讀取 `memory.md` 與 `系統架構.md` 掌握當前最新進度與架構。**
> **每次修改或決策後，請務必同步更新 `memory.md`（與必要時的 `系統架構.md`、`DB_Table.md`）。**

---

## 1. 專案簡介與核心目標
**EQDashboard.V2.Web**（現役主線重構版）是專為 UMC（聯電）廠區設計的效能看板入口系統。
**核心目標**：依據使用者的廠區與職務權限，結構化地呈現並管理可存取的各項效能報表與看板連結。提供極致流暢的使用者體驗（App Shell 快取、SPA 級路由切換）與嚴謹的權限隔離。

## 2. 當前最高優先級開發任務 (Current Focus)

> 逐項細節、驗收數據與歷史脈絡一律看 `memory.md`；本節只列「現在還要做什麼」。

- 🔴 **P0｜`appsettings.json`（含明碼 DB 密碼）已上傳到「公開」GitHub repo，尚未處置（2026-08-25 發現）**：commit `7467dd4`（網頁「Add files via upload」）把該檔推上 `github.com/lousyqq/EQDashboard.V2.Web`，而 `.gitignore` 忽略它正是為了防這件事；未帶認證的 GitHub API 回 200 → **repo 是公開的**。外洩 `User ID=testuser;Password=<明碼>` 與 `TestAccounts` 5 組帳密。
  **處置順序：① 先改 `Sariel` 上 `testuser` 與那 5 組測試帳密（推上公開 repo 就必須視為已外洩，刪 commit 不等於沒外流）② 再把 repo 改私有或用 `git filter-repo`／BFG 清 blob + force push ③ `git check-ignore -v appsettings.json` 複查忽略規則有效。**
  （`SimulatedAccount = "00058897"` 是使用者刻意的測試設定，**不是本項的一部分**，見 §3。）
- ⚠️ **P1｜工作區成果仍未 commit**（承接 L9／K9／F1「成果裸奔」）：第七輪 J1~J4 的權限提升修復、第八輪 K1~K10、第九輪 L1/L3/L4，2026-08-25 的 iframe sandbox 修復與三份文件重建，以及 **2026-09-05 的「另開分頁」提示卡（`page-external-opened`，見 §4 第 22-1 條）**，**全部只存在於本機工作區**。本機 `main` 另外還落後 `origin/main` 1 個 commit（即上面那個 `7467dd4`），push 前要先處理 P0。
- ⚠️ **P1｜iframe sandbox 修復待實機確認**：2026-08-25 已改為無條件保留 `allow-same-origin`（見 §4 第 22 條），但 AI 環境連不到內網 `p58esiap12`，只驗到「sandbox 屬性正確」這一層。**待使用者在可連內網的機器上確認 MSD 需求管控表能顯示員編與資料。**
- **P3｜第九輪健檢 L5~L8（未修，皆非阻斷）**：`#configFileName`／`#appIconPreview*` 的 `data-i18n` 陷阱｜46 個死字典 key（其中 `chart_trend_aria` 是「key 備好但趨勢圖 SVG 缺 `role="img"`+`aria-label`」，該接上而非刪掉；⚠️ `dyn_m_*` 是動態命中的，**不可刪**）｜`TrackingController.MenuClick` 不驗證 menuId 可被灌點擊數｜趨勢圖資料變空時留下舊圖。
- ✅ **使用者操作手冊已產出（2026-08-27）**：`使用者操作手冊.html`（單檔、零外部相依、15 章 61 節）。**日後改程式碼務必依 §5 第 4 條同步更新它。** 剩下的 PPT 版簡報尚未製作。
- **`normal_user` 的 3 筆「登入預設首頁」需 admin 在「帳號管理」重設** —— 第七輪 J3 盤點時被舊程式碼刪除，`FabId` 未擷取而無法精確還原。
- **目前線上 DB 與 `DB_Table.md` 快照一致，無待執行的 SQL 腳本。**

> **已結案（第一～第八輪待辦全數清空、第九輪僅剩 L5~L8）**：九輪健檢的規則產出都已固化在下方 §4；逐輪索引與踩坑紀錄見 `memory.md` §3／§4。
> **版控範圍**：唯一事實來源是本 repo（`EQDashboard.V2.Web`，remote `github.com/lousyqq/EQDashboard.V2.Web`）。外層 `EQDashboard` 只是本機容器，**不維護、不視為 submodule**（詳見 `memory.md` §5）。

---

## 3. 專案概況與運行模式
- **架構**：ASP.NET Core .NET 9.0 (Kestrel/IIS) + ES Modules 前端 (Bootstrap 5/Vanilla JS，全 CDN 無 bundler)。
- **資料庫**：MSSQL (`EQDashboardV2` @ `Sariel`)。無 EF Migrations，由 `SchemaBootstrap` 啟動時以 T-SQL 冪等修復 (補表/欄位/索引)。CRUD 靜默寫入 DB，個人版面存 `PersonalSettings`。
- **身分驗證 (`AuthSettings`)**：Windows Negotiate 自動偵測，前端無手動帳密表單。
  - **`SimulatedAccount`：這是使用者刻意使用的「模擬他人帳號」測試工具，不是 bug、不是誤設，任何盤點都不要再把它列為缺陷（2026-08-25 使用者明確指示）。** 指定帳號本地模擬驗證，變更時即時作廢舊 Cookie (`SignOutAsync`)。
    - 需要知道的**事實邊界**（供選擇部署在哪個站台，不是要你去修掉它）：它是**全域**設定 → 生效期間**該站台所有訪客都會是那個帳號**，且每次變更會作廢所有人的 cookie。故適合掛在測試站（如 `EQDashboard_TEST`），正式站請留空。
    - **Production guard 預設會擋它**（非空即拒絕啟動）→ 2026-08-25 新增顯式旗標 **`Auth:AllowSimulatedAccountInProduction`**（預設 false）：設 true 後 guard 改印一則 WRN、不擋啟動，**且只放行這一項**（`TestAccounts` / `EnableEmergencyAdmin` / 連線字串弱密碼 / LDAP placeholder 四項照擋）。`web.config` 的「設定區 B-2」已備妥註解範例。
    - **不要因為 guard 擋了就去刪 `SimulatedAccount`**，也不要為此把整站降成 `Development` —— 用那個旗標。
    - **📌 IIS 上「切成模擬 / 切回自動偵測」的實際操作步驟、驗收方式與踩坑，全部集中在 §4 第 26 條** —— `appsettings.Production.json` 已把 `Auth:SimulatedAccount` 釘成 `""`，唯一開關是 `web.config` 的「設定區 B-2」。**不要在別處各自寫一套切換方式，也不要為了切回自動偵測去改 `appsettings.json`。**
  - `DefaultAdmins`：名單內帳號自動建帳升級為 admin，防系統鎖死。
  - `OpenAccessMode`：開啟時開放瀏覽，自動建帳綁定全廠區；關閉時嚴格限制名單。
  - **🔴 「手動登入 + LDAP」被企業 IIS 政策封鎖，不是可行選項（2026-08-25 使用者定案）**：`Auth:AllowManualLogin` / `Auth:Ldap` 程式面完整可用（`AuthService.VerifyLdapPasswordAsync`、`AuthController.Login`），但**內網 IIS 環境不允許啟用**。**不要再把「開手動登入／LDAP」當成解法提出。**
  - **Windows 靜默登入（不跳瀏覽器帳密視窗）只有「用戶端信任站台」一條路**：Negotiate 的 401 挑戰是協定必要步驟，伺服器端無法迴避；瀏覽器只在信任的站台才會靜默回應。全廠做法是請 IT 推 Edge/Chrome 原則 `AuthServerAllowlist`（比改「網際網路選項」實際）。⚠️ 單一標籤主機名（`http://p58esiap12`，不含點）本來就會被自動歸類為近端內部網路 —— 仍跳視窗時先查「自動偵測內部網路」是否被 GPO 關掉、區域「登入」是否被設成提示、以及實際用的是不是 FQDN／IP。
  - ⚠️ **靜默登入與「投影機上換帳號」衝突**：Windows 整合驗證沒有帳號選擇器。可行替代見 `memory.md` §5（`runas /netonly`／GPO 分範圍／admin-only 代理檢視）。使用者目前是用 `SimulatedAccount` 在**測試站**做這件事（見上方說明）—— 在**正式站**才不適用（全域生效，會讓所有人變成同一個帳號）。
- **權限隔離 (App Grid)**：無管理權限者，前端 UI 一律隱藏編輯/刪除圖示與端點。操作開啟方式全站一致。
- **🔴 權限判定必須「三方一致」，改一處就要對齊另外兩處（2026-08-24 第七輪 J1/J2）**：同一個功能的可用性寫在三個地方 ——
  ① 側欄顯示條件（`render/sidebar.js` 的 `sysMenus[].display`）② 後端授權（`[Authorize(Roles/Policy)]` + Service 內的細粒度判斷）③ 表格/頁面的渲染條件（`render/tables.js`）。
  「帳號管理」就是三者不一致的活體案例：①③ 一個寫 `admin || canEditOthers`、一個寫 `admin`，② 的 policy 又是 `admin || CanEditOthers` → 委派者側欄看得到、API 回得了資料、畫面卻永遠空白。
  **另外：Service 層若會寫入權限相關欄位（`RoleLevel`、`CanEditOthers`、ACL、委派範圍），簽章就必須收 caller 的 `EmpId` + `IsAdmin`**（比照 `MenuService` / `MenuAuthService` 的作法）。`AccountService` 沒收 → 只要 policy 放行就能任意改任何人的 `RoleLevel`，等同權限提升。
- **🔴 委派管理的「主從關係」（2026-08-24 第七輪 J1 定案，唯一實作在 `AccountService.ApplyDelegationScopeAsync`）**：
  委派管理者（`RoleLevel=user` + `CanEditOthers=true`）能授出的權限，**不得超過他自己擁有的**。
  例：只被委派 A 廠區的人，把別人升成委派管理者時最多也只能授到 A 廠區。
  - **角色**以「呼叫者自己的 `Map_Account_Role`」為上界；**看板**（委派目錄／預設首頁／額外開放／個別封鎖）以 `MenuAuthService.CanManageStructureAsync` 為上界（＝前端 `getMenuPermissions` 的同一套判定，兩邊必須對齊）。
  - **兩個方向都要擋，缺一不可**：① 不可授出自己沒有的 ② **不可拔掉自己範圍外的既有授權** —— `UpdateAccountAsync` 是「先刪後寫」全量覆寫，只做 ① 的話，委派者送出一份「看不到 role_3」的表單就會把 admin 給的 role_3 靜默刪掉（降權攻擊）。故範圍外的既有列一律原封抄回 DTO。
  - `RoleLevel` / `CanEditOthers` 對非 admin **一律忽略提交值、強制寫回 DB 現值**（不回 400 —— 表單本來就不該送這兩欄，讓合法編輯整筆失敗只會擾民）；新增/刪除帳號、編輯任何 admin 帳號、`GET /api/Accounts/export` 則是 admin only。
  - 前端挑選器（`render/account-ui.js` 的 `isRoleGrantableByCurrentUser` / `isMenuGrantableByCurrentUser`）只是把「選了也不會生效」的選項先擋掉，**不是安全邊界**；超出範圍但目標帳號已擁有的項目一律以 `disabled` 鎖定呈現，不可直接隱藏（隱藏會讓人誤以為那些權限不存在）。
- **兩條登入路徑各自組 claims，新增 claim 時兩處都要加（2026-08-24 第七輪）**：`AuthController` 的 `WhoAmI`（Windows/模擬）與 `Login`（手動/LDAP）各有一段 `new List<Claim>{...}`。`CanEditOthers` claim 長期只加在 `WhoAmI` → 走手動登入的委派管理者拿不到 → `CanManageAccounts` policy 不成立 → 帳號管理整頁 403。這是靠整合測試（TestServer 只能走 `Login`）才抓到的，實機模擬 Windows 登入永遠測不出來。
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
   - **原生 `alert()` / `confirm()` 一律禁用，也不要留作「後備」（2026-08-24 第六輪 G3）**：`customAlert` 在各檔案都是**靜態 import**、必然存在，`typeof customAlert === 'function' ? … : alert(…)` 的後備分支根本不可達，只會養出兩句沒人翻譯的硬編中文。驗收：`wwwroot/js` 內原生 `alert(` 必須是 0 筆。
   - **按鈕載入狀態只有 `setButtonLoading()` 一份實作（`ui/dialogs.js`）**：它已支援傳入 `<form>` 自動找 `button[type=submit]`，全站 6 個表單存檔都在用。**不要再另開 `lockSubmitButton` 之類的第二套**（2026-08-24 曾出現過、且完全沒有呼叫端，同 A5/F10 的死碼模式）。
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
   - **JS 會動態填值的元素不可掛 `data-i18n`**：同樣因為切語言會把 innerHTML 洗回預設字串。已知名單：`#current-lang-display`、`#user-name`/`#user-role`、`#dropdown-user-*`、`#tsZombieDesc`、`#app-grid-title`、`#under-construction-text`、`#whoami-status`、**`#bc-name`（2026-08-24 第九輪 L1 新增）**。這些請改在 JS 內用 `t('key', '中文預設')`。
     - **🔴 `#bc-name` 這一條特別容易再犯，因為它「拿掉屬性」只做了一半**：麵包屑是 `navTo()` 依當前頁面填的，拿掉 `data-i18n` 之後就再也沒有人在切語言時更新它 → 必須由 `changeLanguage()` 呼叫 `refreshBreadcrumb()`（`ui/navigation.js`）補上。
       該呼叫的位置被夾在**步驟 6 之後、步驟 7 之前**，兩邊都是硬性條件：① 要在 `renderSidebarMenus()` 之後，`refreshBreadcrumb` 才讀得到新語系的側欄文字；② 要在頁面重繪之前，因為 `page-under-construction` 分支是**讀 `#bc-name` 的 innerText** 來組「{0} 內容建置中」。
       另外 `refreshBreadcrumb` 只有在「當初真的是從側欄項目進來」時才可以讀 `.menu-item.active`（`_lastBc.hadElement`）—— `renderSidebarMenus()` 會依 `currentActiveSidebarMenuId` 還原 active，而 `layout.js` 那兩處 `navTo('page-account-manage', null, …)` 沒有對應側欄節點，誤讀會拿到**別頁**的名稱。
       **凡是傳「`t()` 翻出來的字串」給 `navTo` 的呼叫端，都必須一併傳第 4 參數 `subTitleKey`**（`sidebar.js` 的系統設定分頁、`layout.js` 的兩處）；傳 DB 名稱的（看板、應用集合）則不用。
   - **`aria-label` / `title` 也要翻譯**：2026-08-16 起 `changeLanguage()` 支援 `data-i18n-aria-label` 與 `data-i18n-title`。純圖示按鈕新增 `aria-label` 時請一併掛上，否則英日文使用者用讀螢幕聽到的仍是中文。
   - **JS 動態字串一律走 `t(key, '中文預設')`，包含 `customAlert`／`customConfirm`／`showToast`（2026-08-16 第四輪補完 60 處）**：前三輪的掃描只看靜態 HTML 文字節點，導致「英文介面下按刪除，按鈕是 OK/Cancel、內文卻是中文」長期沒被發現。動態建立的節點（如 toast 的 `.btn-close`）掛不了 `data-i18n-*`（`changeLanguage` 掃不到還不存在的節點），一律在建立當下用 `t()`。
   - **後端不准回傳「要直接顯示給使用者」的中文字面值**：`AnalyticsController` 曾回 `"已刪除看板"`／`"未指定/其他"`／`"未指定"`，前端無從翻譯。一律回 `null` 或代碼，由前端 `t()` 呈現（現有 key：`menu_deleted`／`dept_unspecified_other`／`unspecified`）。
     - **`ErrorMessage = "…"` 的 DataAnnotations 也算（2026-08-24 第九輪 L3）**：ModelState 400 會把它原樣回給前端。22 個驗證訊息已全部改成 `val_*` i18n key。
     - **失敗回應一律用 `readApiError(response)` 讀（`api.js`，全站唯一實作）**：它會依序處理 `errorCode` → ModelState 的 `errors`（逐條 `t()`）→ `title`。**不要再寫 `await res.text()` 當錯誤訊息** —— 那會把整包 JSON（`{"errors":{"FabId":["…"]}}`）丟到使用者臉上，曾在 `api.js` 出現 12 次。
     - **可翻譯的句子走代碼，不可翻譯的診斷走 `Detail`**：`SaveDataResult` 就是這個分工 —— `MessageCode` 是 i18n key，`Detail` 放 SQL 例外訊息與資料表名（本來就沒有譯文，硬塞代碼只會失去 admin 定位問題的資訊）。**也不要在後端組 HTML**：`SaveDataAsync` 舊版直接回一段帶 `background:#f8d7da` 寫死顏色的中文 HTML，除了翻不了，深色主題下也整片走鐘。
     - ⚠️ **代碼化與補字典是同一件事的兩半**：第五輪 M1/M2 把 `AuthController`／`AnalyticsController` 代碼化後，6 個 key（`err_no_access`、`err_manual_login_disabled`、`err_auth_failed`、`err_account_verify_failed`、`err_load_stats_failed`、`err_invalid_date`）**從來沒進過 `config.js`**，直到第九輪才補上 —— 和 G2 是同一種半套修法，只是發生在後端側。驗收腳本要把 C# 內的 `"xxx_yyy"` 代碼一起納入「用了但字典沒有」的掃描。
   - **語系偏好的事實來源是 `umc_lang_preference`**：`changeLanguage(lang, persist = true)` 會落盤；`initDashboardUI` 的順序是 **使用者偏好 > `fab.defaultLang`**，套廠區預設語言時必須傳 `persist=false`。**不要退回「每次進站無條件套 `fab.defaultLang`」的舊行為** —— 那會讓英/日文使用者每重整一次就被打回中文。`changeLanguage` 同時負責 `<html lang>` 與 `document.title`（`index.html` 的防閃爍 inline script 有一份 `LANG_TAG` 鏡像，改語系代碼要兩邊一起改）。
   - **掃描器要用 DOM 走訪、不要只用正則**：`<div><i class="…"></i>提示：…</div>` 這種「巢狀元素之後的裸文字」，用 `<tag …>text` 的正則會完全掃不到（本輪就是這樣先漏了 37 處）。
   - **「包 `t()`」與「補字典」是同一件事的兩半，缺一等於沒做（2026-08-24 第六輪 G2）**：第五輪把 55 處硬編中文包成 `t('key','中文')` 卻沒把 key 加進 `config.js`，結果 38 個 key 一直走中文 fallback —— 英/日介面的管理頁面**整片還是中文**，而且不會有任何錯誤。驗收腳本要掃出所有 `t('key')` 與 `data-i18n*` 參照，逐一比對字典（「用了但字典沒有」必須為 0）。
   - **🔴 把 `t()` 包進字串時，外層引號必須改成反引號（2026-08-24 第六輪，站台整個掛掉）**：批次把硬編中文換成 `${t('key','中文')}` 時，若外層仍是**單引號/雙引號**字串，`${...}` 不會插值 —— 而且因為 `t('key'` 的那個 `'` 會提前把字串收尾，接著的 key 名變成裸識別字，直接是 **`SyntaxError`**。ES module 只要有**任何一支**解析失敗，整張 import 圖就不會執行、`main.js` 從不啟動 → **全站停在初始遮罩、console 只有一行紅字**。第五輪 H1/H7 就這樣在 `render/tables.js`（6 處）與 `admin/menu-manage.js`（1 處）留下 7 個語法錯誤並 commit 上去。
     - **驗收（新增，必跑）**：把 `wwwroot/js` 內 20 支模組複製成 `.mjs` 後逐一 `node --check`，必須 **0 fail**。`dotnet build` 完全驗不到前端語法，別把它當通過條件。
     - 偵測法：搜尋「`${` 出現在單/雙引號字串內」的行（判斷該位置的引號脈絡，不要只看整行有沒有反引號）。
10. **RWD 版面：`.utility-cluster` 不可再設 `flex-shrink: 0`（2026-08-16 F5）**：D2/E12 給工具鈕加的 `min-width:44px` 會把整條 cluster 撐到 540px，配上 `flex-shrink:0` 就會在 375px 下讓整頁水平溢出 195px，並把 `.nav-brand-section` 壓成 0px（D1 保留麵包屑的修法因此完全失效）。現況：≤992px 時 cluster 為 `flex:0 1 auto` + `overflow-x:auto`（內部捲動），`.nav-brand-section` 靠 **`min-width:150px`** 保底。**只寫 `flex:1 1 auto` 不夠** —— 負剩餘空間依基準寬度比例分配，品牌區照樣被壓扁。
    - **CSS 驗收要連「註解配對」一起檢查**：本輪曾把說明文字寫在 `*/` 之後又補一個 `*/`，CSS 解析器直接吃掉整條規則、量測才發現。驗收腳本需檢查 `/*` 與 `*/` 數量相等，且去除註解後不得有殘留的 `*/`。
    - 版面數字以實機量測為準（`documentElement.clientWidth` vs `body.scrollWidth`、目標元素的 `getBoundingClientRect()`），不要只看程式碼推論。

11. **導航所有權單一化**：`initDashboardUI()` 是唯一負責初始導航的地方（依 `stayOnCurrentPage` 決定是否 `goDefaultHome()`）。呼叫 `switchLayoutMode(mode, navigate)` 時若只是要同步版面模式狀態，**必須傳 `navigate=false`**，否則它內部也會 `goDefaultHome()` → `activateMenu` 跑兩遍（MenuClick 統計膨脹一倍）並架空 `stayOnCurrentPage`。判斷「是否重複執行」請以實機 Network 紀錄為準，不要只看程式碼推論。

12. **JS 樣板禁止再用 `bg-white` / `bg-light` / `text-dark`（2026-08-24 第七輪 J7）**：深色主題把 `.text-dark` 覆寫成近白字，但 Bootstrap 原生的 `bg-white` / `bg-light` 底色**沒有**被覆寫 → `.badge.bg-light.text-dark` 實測 **1.01:1，等同隱形**（操作紀錄的來源徽章整片消失）。
    - 第五輪 H6 已把 `modals.html` 換成語意類別 `bg-body` / `bg-body-tertiary` / `text-body`，但**動態產生 HTML 的 JS 樣板一個都沒換**（`tables.js` / `account-ui.js` / `traffic-stats.js` / `activity-log.js` / `menu-manage.js` / `sidebar-item.js` 合計 11 個 `bg-white`、12 個 `bg-light`、37 個 `text-dark`）。**「改了 HTML 就要一起改 JS 樣板」與 G2「包 `t()` 與補字典」是同一類的半套修法。**
    - **對比度驗收必須每輪重跑**：第三輪 E13 掃出「0 項未達 AA」，本輪同一組頁面卻是 **47 項** —— 因為這些徽章是 E13 之後才長出來的。舊的通過紀錄不能當作現況。
    - **語意類別怎麼挑（2026-08-24 類型欄實測）**：實心徽章用 `bg-body-tertiary` + `text-body`；**外框徽章一律 `bg-transparent`，不要用 `bg-body`** —— 深色下 Bootstrap 的 `--bs-body-bg` 是 `#212529`（暖灰），而卡片是 `--card-bg: #1e293b`（藍調 slate），填上去會在卡片裡浮出一塊色差方塊；透明底才會吃到卡片色。
    - `components.css` 已有 `.badge.bg-light` / `.badge.bg-white` 的深色**安全網**（`background-color:#334155`，**只改背景不改前景**，避免蓋掉 `.text-primary`/`.text-success` 的語意色）。它是給還沒改完的樣板兜底用的，**不是放行條件** —— 新寫的樣板照樣不准用這三個類別。

13. **權限相關的「可操作性」要一起關掉，不只是隱藏按鈕（2026-08-24 第七輪 J6）**：`tables.js` 三張表無條件輸出 `draggable="true"` + `ondrop="handleDrop(...)"`，僅檢視的使用者照樣能拖 → 樂觀渲染先換位、`POST /api/Menus/batch` 回 403 → 阻斷式視窗。後端有擋所以資料安全，但**提供一個必定失敗的操作本身就是缺陷**。新增任何互動（拖曳、雙擊、右鍵選單、快捷鍵）時，一律比照按鈕去查 `getMenuPermissions()`。

14. **🔴「可以被選為落點」的清單，必須先過「真的打得開」這一關（2026-08-24 第八輪 K1）**：本站多數 root 是 `menuMode='link'` 但 `url` 與 `targetPage` **皆為空字串**的「群組佔位節點」。J4 只把 `_isOpenable` / `_rendersInPage` 加在 `goDefaultHome()` 的**自動挑選**（步驟 2/3），步驟 1 的 `defaultPages` 與 `render/account-ui.js` 的**預設首頁挑選器**都沒過濾 → admin 在帳號管理選到佔位節點，使用者每次登入就停在「XXX 內容建置中」。
    - 「admin 明確指定＝明示意圖，不覆寫」這個原則**不適用於證明打不開的節點**（非 folder、無 `url`、無 `targetPage`、非 `app_grid`）—— 那筆設定本來就沒有任何可呈現的內容，尊重它只會給出死頁。
    - **連鎖污染**：死頁落點照樣會 `activateMenu → POST MenuClick`，實測讓「看板點擊率」的 ZE 累積到 **397 次**。**看到某個看板點擊數異常高，先確認它是不是誰的預設首頁。**
    - 通則：任何「挑一個東西當落點」的 UI（預設首頁、快捷、最近瀏覽的還原）都要用同一組 `_isOpenable` + `_rendersInPage` 判定，不要各自寫一套。

15. **動態渲染的表單控制項也要有可及名稱（2026-08-24 第八輪 K2／J10，已修）**：E12 補的是 `modals.html` 與 `index.html` 的靜態控制項；`tables.js` 動態產生的 24 個啟用/停用 `input.form-check-input` 全靠一句共用的 `title="顯示/隱藏"`（選單配置管理那 10 顆連 title 都沒有）→ 讀螢幕連續聽到 10 個一模一樣的名稱，分不出在切換誰。**可及名稱一定要指名對象**（現為 `aria_toggle_visible_fmt` / `aria_toggle_enable_fmt` / `aria_edit_fmt` 三組帶 `{0}` 的 key）。
    - **觸控尺寸：放大「命中區」而不是控制項本體**。同一批開關 375px 實測 **29×14px**（低於 WCAG 2.5.8 AA 的 24×24），但 **`input` 是 replaced element**，Bootstrap 的 switch 靠 `background-image` 畫圓鈕 —— 動它的 `width`/`height`/`padding` 會讓圓鈕位置與比例整個跑掉。正解是把外層 `<div class="form-check form-switch">` 改成 **`<label>`**（隱式關聯，點命中區任一處都會切換），再由 `responsive.css` 的 `label.form-check.form-switch { min-height:44px }`（≤992px）撐開。實測命中區 36×44、開關視覺完全不變、桌機零回歸。同 D2「用 padding 擴大命中區」的精神。

16. **關窗要先搬焦點再蓋 `aria-hidden`，而且三條關窗路徑都要顧（2026-08-24 第八輪 J9，已修）**：`hideModalSafely` 舊版直接 `setAttribute('aria-hidden','true')`，焦點還留在 `#fabNameInput` 裡 → 焦點停在對輔助技術隱藏的子樹內（WCAG 違規，Chrome 會告警），鍵盤使用者也失去位置。
    - 順序：**先 `blur()` → 再還焦點給觸發元素 → 最後才蓋 `aria-hidden`**。
    - ⚠️ **ESC／點背景／`data-bs-dismiss` 這三條路不會經過 `hideModalSafely`**，所以還原邏輯必須**同時**掛在 `hidden.bs.modal`（`{once:true}`）。只改 `hideModalSafely` 等於只修了三分之一。**Bootstrap 5.3 不會自己還原焦點，別指望它。**
    - 觸發元素可能已隨重繪消失（編輯完某列後整張表重畫）→ 還原前要檢查 `document.contains(trigger) && trigger.offsetParent !== null`。

17. **DataTables 的 `destroy()` 不會清 `<th>` 的 `aria-label`／`aria-sort`（2026-08-24 第八輪 J8，已修）**：下次 init 是直接在既有值後面「再接一段」→ 實測重繪 3 次累加到 5 段、zh→en→ja→zh 往返後 **8 段**，而且**欄名永遠停在初次初始化時的語言**（切英日文仍念中文）。所有 client-side DataTable 都中招。
    - 修法：`render/sidebar.js` 的 `clearDtHeaderAria(tableId)`，在 `safeDestroyDataTable` **與** `initDataTable` 內建的 destroy 分支**兩處都呼叫** —— 少數 render 路徑沒先呼叫前者，只補一處會漏掉。

18. **🔴 後端 batch 是「任一筆不合格就整批拒絕」，所以前端不可送出使用者管不到的列（2026-08-24 第八輪 J5，已修）**：`MenuService.BatchUpdateMenusAsync` 逐筆檢查、任一筆越權就 `Forbidden()` —— 只要 payload 混進一列使用者無權編輯的資料，他**所有合法變更都會一起失敗**，而且畫面只出現一句「儲存失敗」，完全查不出原因。
    - 因此「唯讀」不能只做視覺：`applyNodeModalScope()` 把欄位 `disabled` 之外，`saveMenuNodeItem` 還必須 ① 唯讀時不把表單值寫回物件、也**不標 `_wasTouched`** ② 送出前再濾一次無編輯權的既有節點（被濾掉要出 toast 告知）。
    - 委派**子資料夾**的人在管理頁只看得到祖先那一列 → 用 `getMenuPermissions().canManageDescendants` 給一個**明確標示為「管理子項目」**的入口（不叫「編輯」，避免誤導成可以改該列本身）。

19. **狀態機規則要寫在後端，不能只靠前端不顯示按鈕（2026-08-24 第八輪 K6，已修）**：`RequestsController` 過去只擋 IDOR（是不是自己的），完全不看目前狀態 → 直打 API 就能撤回已完成的申請、或用同一個 `RequestId` 把 resolved 打回 pending。前端只在 `pending` 顯示「撤回」鈕不是防線，那只是 UI。
    - 現行規則（**與 `render/tables.js` 的 `renderApplyTable` 三方一致**）：`pending` 可撤回｜`withdrawn` 可刪除｜`withdrawn`/`rejected` 可重新送出｜`processing`/`resolved` 鎖定。違反回 **409 + `errorCode`**。
    - **重新送出必須同時清 `Reply` 與 `WithdrawReason`** —— 只改 Status 會讓畫面同時出現「待審核」徽章與上一輪的管理員回覆。
    - **前端收到非 2xx 一定要顯示原因**：`deleteApplyItem` 舊版完全不看回應就重新整理，後端擋掉時使用者會以為刪掉了。統一走 `readApiError(response)` 把 `errorCode` 交給 `t()`。

20. **`LogAuditAsync` 的參數順序是 `(ctx, category, action, targetType, targetId, detail)`（2026-08-24 第八輪）**：`RequestsController.Delete` 長期把 id 塞進 `targetType`、把說明文字塞進 `targetId`，操作紀錄頁的「目標」欄位因此對不上。新增呼叫時照抄 `DeleteApp` 那種寫法（`"AppItem", id, backupJson`）。
    - **破壞性操作一律要有稽核**：`ActivityLogsController.Purge` 是全站唯一沒有的一支（諷刺的是它清的正是操作紀錄本身）。⚠️ 稽核必須寫在 `PurgeOlderThanAsync` **之後**，先寫會被自己清掉。

21. **用 PowerShell 寫任何 `.md` 一律加 `-Encoding utf8`（2026-08-24 第八輪 K9）**：`memory.md` 檔尾曾被 6 行 UTF-16LE 位元組污染（`>>` / `Add-Content` 的預設編碼），在 UTF-8 檔案裡顯示成 `U p d a t e d ...` 的亂碼，`git diff` 也一併被污染。已清除並改寫回 UTF-8。同理，**讀** `appsettings.json` 之類的 UTF-8 檔要用 `[System.IO.File]::ReadAllText(path, [Text.Encoding]::UTF8)`（見 `memory.md` §4 的踩坑紀錄）。

22. **🔴 `#main-iframe` 的 `sandbox` **永遠**要含 `allow-same-origin`，禁止再依 same/cross-origin 分流（2026-08-25）**：`openDynamicIframe()` 曾對 cross-origin URL 拿掉 `allow-same-origin`，理由是「避免外部頁面透過 `parent.document` 操作本站 DOM」——**這個威脅模型是錯的**：跨來源 iframe 本來就被同源政策擋在 `parent.document` 之外，拿掉它是**零防護增益**。
    - 代價是被嵌入的頁面被丟進 **opaque origin**：① Windows 整合驗證（Negotiate/NTLM）不再帶身分 → 看板顯示「未識別」② 它自己的 session cookie 送不出去 → 後端 API 全部 401、表格空白 ③ `localStorage`/`sessionStorage` 丟 `SecurityError`。實測就是 MSD 需求管控表在 iframe 內抓不到 Windows 帳號、跳「無法讀取需求資料」，而同一個 URL **另開分頁完全正常**。
    - **🔴 這個 bug 會被「儀表板與看板同主機」完全掩蓋**（那時走 same-origin 分支）。只有本機開發（`localhost:5242` 嵌內網看板）或看板部署在另一台時才現形。**不要因為正式站看起來好好的就把分流改回去。**
    - 現行唯一實作（`ui/navigation.js` 的 `openDynamicIframe`）：無條件 `sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"`，與 `index.html:806` 的靜態屬性同一組。**保留 sandbox 屬性本身**——未給 `allow-top-navigation`，被嵌入頁面仍無法劫持整個分頁。
    - Console 的 `allow-scripts + allow-same-origin ... can escape its sandboxing` 警告是**預期且無害**的，不要為了消掉它而拿掉 `allow-same-origin`。
    - 通則：**「看板在 iframe 內壞掉、另開分頁正常」＝先查 sandbox 與 opaque origin，不要先懷疑後端或 DB。**
    - ⚠️ 另一個同情境的坑（非本規則、但會咬人）：儀表板與看板**不同主機**時，看板的 session cookie 在 iframe 內屬第三方 cookie，`SameSite=Lax` 一樣送不出去。靠 cookie session 的看板請與儀表板部署在同一 host；走 Windows 整合驗證的不受影響。

22-1. **🔴 「開到本頁之外」的開啟方式，必須同時把內嵌區換成提示卡，不可只 `window.open`（2026-09-05）**：`activateMenu` 對 `blank` / `ie` / `fullscreen` / `popup` 舊版只做 `window.open`、**完全不動 `.page-section`** → 內嵌區原封不動留著**上一個**看板的畫面。使用者從新分頁切回本頁時，會把那個殘影當成剛點的看板。
    - **點上方導覽列時最容易中招**：`selectTopMenu()` 會在 50ms 後自動 `firstLeafEl.click()` 開啟該分類的第一個看板 —— 那個殘影**根本不是使用者自己選的**，所以連「我剛剛看過這頁」的線索都沒有。
    - 現行：外開的同時 `showExternalOpenedPage()` 導到 **`page-external-opened`** 提示卡（`「{0}」已在新分頁開啟` / `已在新視窗開啟` ＋「重新開啟分頁／視窗」按鈕，供快顯被封鎖或分頁被誤關時重開）。**清掉殘影靠的是 `navTo` 的 `pageId !== 'page-iframe'` 分支會把 `#main-iframe.src` 設回 `about:blank`** —— 不要為了「保留上一頁」而繞過 `navTo` 自己切 class。
    - **開窗參數只有一份實作**：`openExternalTarget(safeUrl, target)`。`activateMenu` 與提示卡的「重新開啟」都走它，不要為了重開再寫第二套 `window.open`（同 §4-前端-6 `setButtonLoading` 的單一實作原則）。
    - **`EXTERNAL_TARGETS` 是模組級單一事實來源**（`ui/navigation.js`）：`activateMenu` 的外開分支、`goDefaultHome` 的 `_rendersInPage`、提示卡的「分頁 vs 視窗」文案三處共用。新增開啟方式只改這一份。
    - ⚠️ `#external-opened-title` / `-desc` / `-btn-text` 三個都是 **JS 動態填值 → 一律不可掛 `data-i18n`**（§4-前端-9 的同款陷阱），且 `changeLanguage()` 步驟 7 必須呼叫 `refreshExternalOpenedPage()` 才會跟著切語系。
    - ⚠️ 樣式用自訂的 `.external-opened-box`（`flex:1` 置中），**不要沿用 `.iframe-status-overlay`** —— 那是 `position:absolute` 的覆蓋層，本頁沒有定位基準會貼到整個 `main-content` 上。
    - `goDefaultHome` 的 `_rendersInPage` 仍然排除這四種目標：**使用者主動點擊時外開＋提示卡是正確行為，但拿它當開站落點只會讓人一進站就看到提示卡而不是內容。**

23. **🔴 第三方資產一律自 host 於 `wwwroot/lib`，且 `lib/` 是版控的一部分（2026-08-15 定案，2026-08-25 複驗）**：Bootstrap 5.3.2 / FontAwesome 6.4.0 / jQuery 3.7.0 / DataTables 1.13.6 / SheetJS 0.18.5 共 16 個檔全部在 repo 內，**`.gitignore` 刻意沒有 ASP.NET 樣板那條 `wwwroot/lib/`**，`.csproj` 也沒有排除它 → `git clone` + `dotnet publish` 就是完整的。
    - **搬機器請用 `git clone`／`git checkout`，不要手動複製檔案** —— 漏掉 `wwwroot/lib` 的症狀是「畫面完全裸奔」：`bootstrap.min.css` 404 → 純 HTML 預設樣式、FontAwesome 圖示變空框、DataTables 表格不 render、所有 Modal 按了沒反應。**看到裸奔畫面先查 `wwwroot/lib` 在不在，不要先懷疑 CSS 被改壞。**
    - **執行期外網相依必須維持 0**。驗收：`wwwroot` 的 `index.html` / `partials` / `appbase.js` / `css` / `js` 內**外部 `http(s)://` 資產連結 0 筆**；`all.min.css` 的 `url()` 全為 `../webfonts/*` 相對路徑、Bootstrap/DataTables 的 `url()` 全為 `data:`；無任何 Google Fonts / gstatic 參照。`Program.cs` 的 CSP（`script-src 'self'` / `style-src 'self'` / `font-src 'self' data:`）是安全網 —— 有人改回 CDN 會被自己的 CSP 擋掉，**請改回自 host 而非放寬政策**。
    - 版本升級要「連檔案一起換」並更新 `index.html` 的版本註記；**不要加 `integrity`/`crossorigin`**（SRI 防的是第三方主機被竄改，同源檔案不適用，留著反而會因任何位元差異整支資產被擋）。
    - 兩項「仍會連外」但**不是專案資產**的：`frame-src http: https:`（看板 iframe 的 `menu.url`，是 DB 資料）與 `img-src ... http: https:`（圖示可填外部圖檔 URL）。要治的是 DB 內容 —— 圖示請改用上傳到 `wwwroot/images/icons/` 的本地檔，不是改程式碼。
    - ⚠️ **`AGENTS.md` 是 2026-07-19 的舊快照**，與 `CLAUDE.md` 衝突時**一律以 `CLAUDE.md` 為準**。已修掉其中「CSP 必含 CDN 白名單 + `integrity`」與 §1「全 CDN」這兩處會誘導後人把外網相依加回去的過時敘述。（該檔原為 Big5/cp950，2026-08-25 已轉為 UTF-8，見第 24 條。）

24. **🔴 專案內所有 `.md` 一律 UTF-8（無 BOM）+ CRLF；用編輯器開啟時務必確認編碼（2026-08-25）**：`memory.md` 曾在 2026-08-24 22:11～23:11 之間被以錯誤編碼開啟後另存，**全檔 636 行有 526 行、合計 12,406 個字元變成 U+FFFD**，並就這樣 commit 進 `f84f210`。同期 `AGENTS.md` 整份是 Big5/cp950（位元組完好、只是編碼不同），2026-08-25 已轉為 UTF-8。
    - **U+FFFD 是不可逆的**：它代表原始位元組在解碼當下就被丟棄，**任何編碼轉換都救不回來**，只能從 git 或逐字稿重建。第 21 條講的是「用 PowerShell 寫檔要加 `-Encoding utf8`」，這一條講的是「**用編輯器開檔也會出事**」—— 後者更難察覺，因為存檔當下沒有任何錯誤訊息。
    - **每次 commit 前的驗收（`.md` 只要有動就跑）**：
      `node -e "const fs=require('fs');for(const f of ['CLAUDE.md','memory.md','AGENTS.md','系統架構.md','DB_Table.md']){const t=fs.readFileSync(f,'utf8');console.log(f,'FFFD=',(t.match(/\uFFFD/g)||[]).length)}"` —— **每個檔都必須是 0**（`\uFFFD` 用跳脫寫法，避免驗收腳本本身變成偽陽性）。
    - **真的壞掉時的救援順序**：① `git log -- <file>` 逐個 commit 算 FFFD 數，找出最後一個乾淨版本 ② 以它為底本，把之後的 `Edit` 從 Claude Code 逐字稿（`~/.claude/projects/<slug>/*.jsonl`，工具輸入是乾淨的原文）依時間序重放 ③ **每一步的 `old_string` 都必須精確命中**，那就是重建正確的證明 ④ 最後拿損毀檔逐行比對：損毀行的「非 U+FFFD、非 `?` 倖存字元」必須是重建行的**子序列**，且反向檢查「重建檔中無對應來源的行」為 0（確保沒有一行是掰出來的）。
    - ⑤ **最後一定要對一次 GitHub**：`git fetch origin` 後比對 `origin/main` —— 本機落後時遠端可能留著更乾淨的版本（本次沒有，但 `AGENTS.md` 就是靠 `52bdc73` 那份乾淨 UTF-8 版**多救回 3 個 Big5 編不出來的字元**：`≥`、`≤`、`🔄`，只看損毀檔絕對救不回來）。**另一個 repo 內的舊版本，價值等同備份，先找過再認賠。**
    - ⚠️ **只有 Claude Code 的工具寫入與 git 歷史救得回來；使用者自己在編輯器裡改、又還沒 commit 的內容沒有任何備份**，只能照殘存字元人工推回（本次有 4 處是這樣重建的，已在 `memory.md` §3 標注請抽查）。用 `git rev-list --all` + `git grep` 逐個 commit 確認過「本 repo 與外層 repo 從未有過該字串」之後，再認定它無法還原。

25. **IIS 上切換 DB（正式區／測試區）：改 `appsettings.json` 現在就會生效（2026-08-31 修正，取代 2026-08-25 的舊結論）**
    - **現行行為**：`Hosting:RestartOnConnectionStringChange` 改為**依宿主自動判斷** —— IIS/ANCM 下**預設開啟**（偵測 `ASPNETCORE_IIS_PHYSICAL_PATH`），`dotnet run` 下預設關閉；明確設值一律優先。所以在 IIS 上**改 `appsettings.json` 的 `ConnectionStrings` 存檔即生效**，不需要手動回收 App Pool，也不再需要繞道 `web.config`。
    - **為什麼是「換進程」而不是「就地換連線」**：換進程才會一併重跑 `SchemaBootstrap`（新 DB 可能缺表）、清掉 `SettingsService` 的快取與 ETag（否則會拿舊 DB 的資料回應最多 60 秒）、重印 DB banner。就地換連線這三件事都要各自補，漏一處就是「資料看起來是舊的」這種最難查的 bug。**不要為了省一次重啟而改成就地換連線。**
    - **保護機制（都已實作，不要拿掉）**：① 比對前用 `SqlConnectionStringBuilder` **正規化**，純排版編輯（空白、鍵順序）不觸發重啟 ② 連線字串被**清空或改壞時不重啟**，只記 ERR、站台維持用舊連線服務（重啟只會撞上啟動守衛變成空白 500.30，更難救）③ `Interlocked` 擋掉檔案監看器對一次存檔觸發兩次。
    - **`AddDbContextPool` 的限制仍然成立**（這是「為什麼需要換進程」的根因，不是可以修掉的 bug）：連線字串在建 options 時就被讀走、之後不再重讀；`reloadOnChange` 只更新 `IConfiguration`，換不掉已建好的 `DbContextOptions`。**連線池的前提就是 options 固定不變，「維持 pooling」與「現讀現用」本質互斥。**（對照組 `C:\Gantt` 是每個端點 `new SqlConnection(ConnStr())` 現讀現用，所以它存檔就生效 —— 架構不同，**不要再問「為什麼 Gantt 可以」**。）
    - **`Scoped` 的服務其實一直都是現讀現用**：`SettingsService` / `SchemaBootstrap` / `TrackingController` 都是每請求 `config.GetConnectionString(...)`。**被凍住的只有 `AddDbContextPool` 與健康檢查的 `AddSqlServer`** —— 盤點時不要把 Scoped 那三個也列進去。
    - **🔴 啟動 banner 必須排在 `SchemaBootstrap` 之前**（2026-08-31）：bootstrap 是啟動時第一個真正連 DB 的動作，連不上就直接拋例外中止進程。banner 排在它後面的話，「切到一個打不通的 DB」這個**最需要診斷的情境反而什麼都印不出來**（IIS 上只剩空白的 500.30）。**不要為了「等連線確認成功再印」而把它挪回去。**
    - **banner 會印出「設定來源」**（`DescribeConnectionStringSource`，反查 `IConfigurationRoot.Providers`）：`appsettings.json` / `appsettings.Production.json` / 環境變數。「我改了 `appsettings.json` 卻沒換 DB」最常見的兩個成因是 ① 值被更高優先序來源蓋掉 ② 改到原始碼資料夾而不是 IIS 站台目錄那一份 —— 兩者都看不出來，只能靠 provider 反推。**排查時先看這個欄位，不要先懷疑程式。**
    - 仍然成立的兩個舊坑（與上面無關，改 `appsettings.json` 時照樣要注意）：
      - **會被 publish 蓋掉**：`appsettings*.json` 是 content 檔，下次 `dotnet publish` 覆蓋部署就把手改的值洗掉，且不會有任何提示。要長期固定用某個 DB，仍建議寫在 `web.config`「設定區 A」的 `ConnectionStrings__EQDashboard`。
      - **可能整個起不來**：Production guard 對 `Password=test`／`Password=password`、`Auth:SimulatedAccount` 非空、`TestAccounts:Enabled`、`EnableEmergencyAdmin`、LDAP placeholder 一律**拒絕啟動**，而 `web.config` 預設 `stdoutLogEnabled="false"` → 只看得到一個空白的 **HTTP 500.30**。
    - **確認真的換過去了**：看 `logs/log-*.txt` 的 `🗄️ 使用中的資料庫：Server=… / Catalog=… ｜設定來源：…`（**只印 Server/Catalog/驗證方式/來源，不印密碼**）。觸發自動重啟時另有一則 `🔄 偵測到 ConnectionStrings:EQDashboard 變更（新目標 Catalog=…）`。
    - ⚠️ 正式站若不希望「改個檔案」就能無聲換掉全站資料來源，在 `web.config` 明確設 `Hosting__RestartOnConnectionStringChange=false` 關掉（設定區 A-2 已備妥註解範例）。

    <details><summary>（歷史）2026-08-25 的舊結論，已被上面取代</summary>

    - 舊結論是「請改 `web.config` 設定區 A，不要改 `appsettings.json`」，理由是改 `appsettings.json` 有三個坑：**① 不會生效**：連線字串在 `Program.cs` 的 `AddDbContextPool`／`AddSqlServer` 建 options 時就被讀走，之後**不再重讀**。`reloadOnChange` 只更新 `IConfiguration`，換不掉已建好的 `DbContextOptions` → **必須回收 App Pool（或 `iisreset`）才會換 DB**，光存檔沒有任何作用。
    - **② 會被 publish 蓋掉**：`appsettings*.json` 是 content 檔，下次 `dotnet publish` 覆蓋部署就把手改的值洗掉，且不會有任何提示。
    - **③ 可能整個起不來**：Production guard（`Program.cs`）對 `Password=test`／`Password=password`、`Auth:SimulatedAccount` 非空、`TestAccounts:Enabled`、`EnableEmergencyAdmin`、LDAP placeholder 一律**拒絕啟動**。而 `web.config` 預設 `stdoutLogEnabled="false"` → 只看得到一個空白的 **HTTP 500.30**。
    - **根因是架構差異，不是設定漏了**：對照組 `C:\Gantt` 是 `string ConnStr() => app.Configuration.GetConnectionString("Gantt")` + 每個端點 `new SqlConnection(ConnStr())` **現讀現用**，配上 `reloadOnChange:true` 所以存檔就生效。本專案走 EF Core `AddDbContextPool`，**連線池的前提就是 options 固定不變**，兩者本質互斥。**不要再問「為什麼 Gantt 可以」。**
    - **正解（建議）**：用 `web.config` `<aspNetCore><environmentVariables>` 內既有的 `ConnectionStrings__EQDashboard`（檔內「設定區 A」已備妥註解範例）。環境變數優先序高於 `appsettings.json`，而且 **ANCM 會監看 `web.config`，存檔即自動回收 App Pool** —— 一步同時解決①與②。或設在 IIS Manager → App Pool → 進階設定 → 環境變數（同樣蓋過 appsettings，且不受 publish 影響）。
    - **若堅持要「改 `appsettings.json` 就生效」**：2026-08-25 新增 **`Hosting:RestartOnConnectionStringChange`**（預設 false，`web.config`「設定區 A-2」有註解範例）。開啟後以 `ChangeToken.OnChange` 監看設定重載，**只在連線字串真的變動時**呼叫 `StopApplication()`，IIS 下一個請求就會拉起讀到新字串的新進程。
      - **刻意只認連線字串**：改 `Auth` 等其他設定不會重啟（否則存個檔就把所有人踢下線）。且用 `Interlocked` 擋掉「檔案監看器一次存檔觸發兩次」。
      - ⚠️ **只有在 IIS/ANCM 這類會自動拉起新進程的宿主下才有意義**；直接 `dotnet run` 會直接結束、不會再啟動。
      - ⚠️ **正式站維持關閉**：重啟會中斷當下所有請求，且等於讓「改個檔案」可以無聲換掉全站資料來源。
    - **確認真的換過去了**：啟動時會寫一行 `🗄️ 使用中的資料庫：Server=… / Catalog=… / …（環境 =…）` 到 `logs/log-*.txt`（**只印 Server/Catalog/驗證方式，不印密碼**）。**看到舊的 Catalog 就代表沒有真的重啟**，別再猜。連線字串格式寫錯（少引號/分號）也會在同一處以 `LogError` 現形。
    - ⚠️ `Password=test` 被 guard 擋是對的，測試 DB 的密碼本來就該改掉（何況它已隨 `appsettings.json` 外洩到公開 repo，見 §2 P0）。**但 `Auth:SimulatedAccount` 那一項不該擋** —— 它是使用者刻意要用的測試工具，已改由 `Auth:AllowSimulatedAccountInProduction=true` 顯式放行（見 §3），不要刪掉它、也不要把整站降成 `Development`。

    </details>

26. **📌 IIS 上切換「模擬他人帳號 ⇄ Windows 自動偵測」的標準操作（2026-08-27 定案，唯一開關在 `web.config`）**
    設定優先序是 `appsettings.json` → `appsettings.{Env}.json` → **環境變數（最高）**。`appsettings.Production.json` 已把 `Auth:SimulatedAccount` 釘成 `""`，所以 **Production 的預設恆為「不模擬」，切換完全由 `web.config` 的「設定區 B-2」決定**。

    **① 切成模擬他人帳號**（例：要看 `00058896` 的畫面與權限）——「設定區 B-2」取消註解、填工號，兩條都要有：
    ```xml
    <environmentVariable name="Auth__SimulatedAccount"                    value="00058896" />
    <environmentVariable name="Auth__AllowSimulatedAccountInProduction"   value="true" />
    ```

    **② 切回 Windows 自動偵測** —— 把上面兩條**整段註解掉**（或刪掉），存檔。

    - **兩者都不必手動 `iisreset`**：ANCM 監看 `web.config`，存檔即自動回收 App Pool。
    - **驗收看 `logs\log-*.txt`**：出現 `⚠️ 模擬帳號已啟用：Auth:SimulatedAccount = "…"` ＝ 模擬中；**沒有這行** ＝ 已回到 Windows 自動偵測。**看到的工號不是你剛填的，就代表進程沒真的重啟**，別再猜（同第 25 條「看 Catalog 判斷有沒有重啟」的手法）。
    - **前端不用做任何事**：`SimulatedAccount` 一變動，`OnValidatePrincipal` 會 `SignOutAsync` 作廢所有 cookie，`api.js` 的 401 會靜默重新自動登入（見 §3），使用者只會看到一個 toast。
    - **🔴 這件事之所以需要一條規則，是因為「切回去」曾經是個陷阱**：`appsettings.Production.json` 補上 `"SimulatedAccount": ""` **之前**，把 B-2 註解掉會讓設定**往下退回 `appsettings.json` 的 `"00058897"`**，同時旗標也回到預設 `false` → **guard 再次拒絕啟動，畫面是空白的 HTTP 500.30**。
      - **通則：任何「靠註解掉環境變數來關掉某功能」的操作，都要先確認 `appsettings*.json` 的底值是安全的**，否則關掉的瞬間會退回一個你沒預期的值。
      - **不要為了切回自動偵測去改 `appsettings.json`** —— 那是 Development 用的值，而且 `dotnet publish` 會蓋回去（同第 25 條②）。
      - 現場臨時切回、又不確定環境時，寧可把 `Auth__SimulatedAccount` 的 `value` 清成 `""` 並**保留旗標 `true`**，也不要整段註解掉：萬一空字串沒吃到，站台至少還會啟動、從 log 的 WRN 一眼看得出來，而不是給你一片查不出原因的 500.30。
    - ⚠️ **模擬是全域的**：生效期間該站台**所有訪客**都會是那個帳號 → **只能掛測試站**（如 `EQDashboard_TEST`），正式站兩條都必須留空 / 註解。
    - ⚠️ **被模擬的工號若不在 `Accounts` 表、又不在 `DefaultAdmins`、且 `OpenAccessMode=false`**，會看到「無權限」畫面（`AuthController.WhoAmI`）—— 那是權限判定正常運作，**不是模擬失敗**，先去「帳號管理」把人建起來。
    - ⚠️ **改完仍 500.30 時先看 guard 列了哪幾項**：`Password=test` 那項是獨立的（`appsettings.json` 的連線字串），與模擬帳號無關，正式部署本來就要改走「設定區 A」的 `ConnectionStrings__EQDashboard`。**不要把弱密碼那項誤判成「模擬帳號沒關掉」。** `web.config` 預設 `stdoutLogEnabled="false"`，看不到原因時暫時改 `true`。

---

## 5. 每輪對話文件同步規範 (Mandatory Protocol)
1. **同步 `CLAUDE.md` 與 `memory.md`**：寫入新確定的規範/坑點，移除過時任務。
2. **同步 `系統架構.md`**：檔案增刪、移動或核心職責調整時更新架構樹。
3. **DB 架構異動 (嚴格遵從)**：凡涉及資料庫 Schema 或結構變動，必須：
   - 同步修改 `DB_Table.md` 上方的結構快照。
   - 於方案根目錄 `sql\` **往下新增**增量的 `.sql` 腳本檔案。
   - **絕對禁止修改目前既有的 DB 資料與舊有腳本，只能透過往下新增 SQL 指令來進行架構修改。**
   - 於 `DB_Table.md` 末端的 Changelog **只增不刪**追加當日日期與新增的 `.sql` 檔名。
4. **🔴 同步 `使用者操作手冊.html`（2026-08-27 使用者指示）**：這是給**第一次使用的人**看的完整操作手冊（單檔 HTML、無外部相依、可離線開啟）。
   **凡是改到「使用者或管理員實際看得到／操作得到的東西」，就必須在同一輪把手冊對應章節一起改掉**，不可只改程式碼。
   - **判斷法**：問自己「這個改動會讓手冊裡某一句話變成錯的嗎？」會 → 就要改。手冊寫錯比沒有手冊更糟。
   - **觸發對照表**（左邊動了 → 右邊必改）：

     | 你動的東西 | 手冊要更新的章節 |
     | --- | --- |
     | `AuthSettings` 旗標、`web.config` 設定區 A/B/B-2/C/D、`Program.cs` 啟動守衛 | §3 登入運作、§4 模擬帳號切換、§5 本機 LDAP、§5.5 守衛清單、§15.1 旗標速查 |
     | `render/sidebar.js` 的 `sysMenus[].display`（哪個角色看得到哪一頁） | §2.4 系統設定頁權限對照表 |
     | `index.html` / `partials/modals.html` 的管理頁欄位、按鈕、流程 | §2 畫面導覽、§6 內容管理、§7.4 帳號設定逐欄說明 |
     | `MenuAuthService` / `AccountService` / `getMenuPermissions` 的權限判定 | §7.1 三層模型、§7.6 排錯 SOP、§8 委派管理者 |
     | `RequestsController` 的狀態機規則 | §9.3 狀態轉換表 |
     | 開啟方式選項、iframe sandbox 行為 | §6.1 開啟方式五種、§6.1 iframe 排錯紅框 |
     | `SHOW_DB_SYNC_PAGE`、Excel 匯入匯出的欄位 mapping | §11 設定檔管理 |
     | 部署步驟、連線字串切換、IIS 設定 | §12 部署與維運、§14 上線檢查清單 |
     | API 端點新增／改名／權限變更 | §15.2 API 端點表 |
     | 目錄結構、模組職責（同時要改 `系統架構.md`） | §1.2 技術架構總覽的目錄樹 |
   - **手冊本身的技術限制（改的時候不要踩）**：① 單檔、**零外部相依**（CSS/JS 全內嵌，不可加 CDN）② `code` 標籤**不可**設 `white-space:nowrap`（長設定鍵會撐破表格、窄畫面被裁掉讀不到）③ 複製鈕要掛在 `.prewrap` 包層上，**不可**掛在 `pre` 上（`pre` 是捲動容器，絕對定位子元素會以「捲動內容寬」為基準，把整份文件撐出水平捲軸）④ 行動版側欄用 `left` 位移做 off-canvas，不要改回 `transform`。
   - **驗收**：改完在瀏覽器開一次，桌機與 375px 都必須 `documentElement.scrollWidth === clientWidth`（零水平溢出），且 console 無錯誤。
   - 目錄與章節錨點是 **JS 依 `h2[id]`/`h3[id]` 自動生成**的，新增章節只要給 `id` 就會自動進目錄，不必手動維護 TOC。
5. **回覆通知**：對話末尾註明 `*已自動更新 CLAUDE.md 與 memory.md*`。
