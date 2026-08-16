# 專案記憶庫 (memory.md)

> 給 AI 的 Context：這是專案的「現況快照與狀態追蹤」中心。
> 每次開發完成後，請確實更新此檔案的 Done 與 In Progress 區塊，以保持跨 AI (Gemini/Claude) 的對話上下文連貫。

---

## 1. Context (當前階段前情提要)
**EQDashboard.V2.Web** 目前處於系統重構與功能補齊的優化階段。前端已全面改版為 ES Modules 搭配 App Shell 快速渲染，後端則完成薄 Controller 與 Service 層的職責切割。目前資料庫 Schema 穩定運作（由 `SchemaBootstrap` 控制），權限隔離與快取機制（Global 60s / Volatile 10s + ETag）也已穩固。

近期的重點在於「優化企業用戶操作體驗」與「補齊各項營運管理所需的欄位與功能」（例如：近期加入了 Description/Keywords 供未來擴充，以及最近瀏覽、深色模式等 UX 升級）。

## 2. Done (近期已完成的重要任務)
- [x] **【新增的項目要出現在第一頁最上方】(2026-08-16)** — 使用者反映：在「選單配置管理」按新增後，新資料看不到（`order = menus.length * 10` 排在最後 → 落到第 3 頁）。
  - **機制（集中在 `render/sidebar.js`，與既有的分頁/筆數 session 記憶放在一起）**：`pinNewRow(tableId, id)` 把 id 記進 `appState.dtPinnedNewIds`（最新的排最前）；`applyPinnedNewFirst(tableId, rows)` 在 render 函式排序完後把它搬到陣列最前面。
  - **⚠️ 只搬列還不夠**：`safeDestroyDataTable` 會記住使用者原本停留的頁次並在 `initDataTable` 還原 → 置頂的列會在畫面外。故 `pinNewRow` 另外設 `_dtForceFirstPage[tableId]`，讓**該次**重建略過分頁還原（留在第 1 頁），旗標用完即刪（之後的狀態切換/編輯重繪仍照舊保留頁次）。
  - **刻意設計成「暫時排序」**：只存記憶體，整頁重整就回歸 `order` 排序。**不可改存 localStorage/DB** —— 全域順序的事實來源是「權限管理」的拖曳，管理頁的暫時排序不該影響其他人（同 `renderMenuConfigTable` 停用拖曳的理由）。
  - **套用範圍**：`renderMenuConfigTable`（`dtMenuConfig`）＋ `renderWebpageTable`（`dtWebpage`），呼叫點在 `menu-manage.js` 的 `saveMenuNodeItem` / `saveWebpageItem`，皆只在 `!id`（新增）分支觸發，編輯既有項目不置頂。
  - **實測（localhost:5242，未建立任何測試資料 → 以既有的最後一筆 `Owner` 模擬新增）**：停在第 3 頁 → `pinNewRow` + 重繪後 **page 0、`Owner` 排第一**；之後翻到第 2 頁再重繪 → 頁次保留在第 2 頁且 `Owner` 仍是表格第 1 列（驗證旗標只作用一次）；**F5 重整後 `dtPinnedNewIds` 為空、順序回到原本的 `Audit / N-Sys / AAR`**。`dtWebpage` 同樣通過，console 0 錯誤。
- [x] **【企業內網政策：登入不因時間過期】(2026-08-16)** — 使用者反映「不應該存在時間到就登出、要重登入」。查出來是**三層**成因，只改一層沒用：
  - **① `Program.cs` 的 `options.ExpireTimeSpan = 12 小時`** → 改為可設定的 `Auth:SessionDays`（預設 **3650 天**）＋維持 `SlidingExpiration=true`。
  - **② `AuthController` 兩處 `SignInAsync` 又各自寫死 `ExpiresUtc = UtcNow.AddHours(12)`** —— **這才是真正生效的那個**：`AuthenticationProperties.ExpiresUtc` 一旦指定就會覆蓋 `ExpireTimeSpan`，所以 ① 長年形同虛設。兩處都移除，只留 `IsPersistent = true`。
  - **③ 過期後前端還要使用者手動點一次**：401 → 阻斷式視窗「您的登入時效已過期」→ 使用者得自己按「以此身份進入」。改成 `api.js` 先跑一次靜默 `tryAutoLogin()`（Windows Negotiate 背景換身分），成功就只出 toast、不彈視窗也不顯示登入框；只有連自動偵測都失敗才走舊的 logout 流程。並用 `window._silentReauthKeepPage` 讓 `completeLoginAfterAuth` 改呼叫 `initDashboardUI(true)`，**避免把正在看看板的人硬拉回首頁**。
  - **實測佐證**：`Set-Cookie` 的 `expires` 由 12 小時 → **2036-08-13（3650 天後）**；用 `/api/Auth/Logout` 清掉 cookie 再發寫入請求，實測第一發 401 後**自動復原**——`appState.currentUser` 保住、登入框 `display:none`、無阻斷 modal、toast 顯示「連線已自動恢復」、`stayedOnPage: true`。
  - ⚠️ **副作用（可接受，已知）**：每次靜默重新登入會經過 `UpdateLoginStats` → `LoginCount` +1。因為 session 已實質不過期，這條路徑極少觸發；而且就算走舊的手動重登入流程也一樣會 +1，並沒有變差。
  - ⚠️ **與 session 長度無關的登出成因（別誤判）**：清掉 `App_Data/keys`、改 `Auth:SimulatedAccount`（`OnValidatePrincipal` 會 `SignOutAsync`）、使用者自己按登出。前兩者設多長的 `SessionDays` 都救不了。
- [x] **【第三輪健檢 E6~E14 修復】(2026-08-16)** — E14 經評估後**刻意不改**（理由見下），其餘八項全部完成並實機驗證。
  - **E6｜統計範圍與殭屍看板端點對齊**：`AnalyticsController.GetZombieMenus` 的下限 `days < 30` → `days < 7`，與同頁另外兩個端點（`GetUsageStats`／`GetMenuClickStats`，兩者本來就是 7）一致。實測選「最近 7 天」後面板文字正確顯示「過去 7 天」（原本被靜默改成 90）。
  - **E7｜冷載入不再空打兩趟 401**：`main.js` 只有在 localStorage 有登入者（暖重整）時才先並行預拉 `GetInitialData`；冷載入直接交給 `tryAutoLogin()` 拉一次。**不可改用「有沒有 cookie」判斷**——auth cookie 是 HttpOnly，JS 讀不到。實測冷載入請求序列：CsrfToken → Config → WhoAmI → CsrfToken → MyProfile(200) → GetInitialData(200，**僅一次**)，console 兩行紅字消失。
  - **E8｜帳號表不再每次開頁都建**：`main.js:62` 改為「當前頁是 `page-account-manage` 才 `renderAccountTable()`」。其他進入點本來就都有涵蓋（`navTo`／`changeLanguage`／`api.js` 背景同步）。實測冷載入已無 `GET /api/Accounts`。
  - **E9｜殭屍看板建立日期三態化**：後端新增 `createTimeKind`（`exact`／`inferred`／`unknown`）；`CreatedAt` 為 NULL 時改用「該看板歷來最早一次 `DailyMenuClicks.ClickDate`」當下限，前端顯示 `≤ 日期` 並附 tooltip 說明是推估值，兩者皆無則顯示「未知」。**仍然不寫回 `Menus.CreatedAt`**——舊資料的 NULL 不可用推估值漂白，否則真殭屍會被洗白。（目前線上資料剛好沒有 `inferred` 案例，三態是用攔截回應實測過的。）
  - **E10｜側邊欄可鍵盤操作**：三個 `.menu-item` 樣板（`sidebar.js` 系統設定分頁、`sidebar-item.js` 資料夾與葉節點）補 `role="button"`＋`tabindex="0"`；Enter/Space 的啟動改由 `main.js` 的**委派 keydown** 統一處理（子選單是 lazy 插入的，逐處綁 onkeydown 必然漏掉後來才插入的節點）。**同時移除 index.html 上品牌標題與版面切換鈕的 inline `onkeydown`**，否則會與委派處理器疊加、觸發兩次。實測：可 Tab 聚焦、Enter 觸發 `navTo` 恰好 1 次、`goDefaultHome`／`switchLayoutMode` 也都是 1 次。
  - **E11｜i18n 覆蓋率補齊**：三語 key 由 262 → **395/395/395 對齊**。`modals.html` 的中文文字節點與 placeholder **歸零**；`index.html` 僅剩 11 處，全部是刻意保留（JS 動態填值或父層 `data-i18n` 已涵蓋整句）。同時擴充 `changeLanguage()` 支援 `data-i18n-aria-label` / `data-i18n-title`。實測英/日切換後開 10 個管理 Modal 皆無中文殘留。
  - **E12｜無障礙補完**：無可讀名稱的按鈕 14 → **0**（11 個 `.btn-close` 補 `aria-label`、4 顆圖示分頁鈕補名稱）；無程式化 label 的表單控制項 38 → **0**（46 個 `for=`＋7 個 `aria-label`）；14 個 checkbox 群組補 `role="group"`＋`aria-labelledby`；Modal `aria-labelledby` **12/12** 有效；側欄收合鈕 16×26 → **24×24**。
  - **E13｜對比度全清**：新增 `--pagination-active-bg`（深色主題 `#2563eb`，3.68 → 4.87）；淺色主題把 `.text-secondary`／`.text-primary`／`.text-info`／`.text-danger`／`.text-warning`／`.nav-link`／`.btn-outline-primary`／`.btn-outline-danger` 換成加深一階的色階。**範圍限定 `#main-content` / `.modal` / `.offcanvas`**——這些工具類別也用在永遠深底的 `#top-navbar` 上（品牌標題的 `text-info`、釘選鈕的 `text-danger`），全域壓深會讓導覽列糊掉（實測導覽列 UMC 仍為 `#38bdf8`、內容區才變 `#087990`）。實測 8 個管理頁 × 深淺兩主題 = **0 項未達 AA**。
  - **E14｜刻意不改（sandbox）**：拿掉 `allow-same-origin` 會讓沙箱化文件取得 opaque origin → 廠內需登入態的看板 cookie/storage 全部讀不到、直接白畫面。而該組合的已知風險（同源且不可信的內容可自解沙箱）在本站不成立：跨來源看板本來就碰不到 parent，同源內容是我們自己的檔案或 admin 設定的路徑。**真正的把關點是「誰能設定 `menu.url`」（已限管理權限），不是這個屬性。** 理由已寫進 `index.html` 該行上方的註解，避免後人「順手修掉」而弄壞看板。
  - **連動**：`__APP_VER__` 20260815 → **20260816e**（同日多次迭代用字母後綴，沿用歷史慣例）。驗收：`wwwroot/js` 內 `?v=` = 0、`index.html` `type="module"` = 1、5 個 CSS 檔大括號配對、巢狀 `data-i18n` = 0、`dotnet build` 0 錯 0 警告。
- [x] **【E5 修復：Department 不再被塞角色名稱】(2026-08-16)** — 程式面已修完並驗證；**DB 髒資料清理腳本已產出但尚未執行**。
  - **範圍比原本盤點的大**：不是 2 處而是 **4 處**。`AuthController` 的四個自動建帳分支（`WhoAmI` 的 admin/OpenAccess、`Login` 的 admin/OpenAccess）在 `LookupPersonFromNotesAsync` 查不到部門時，分別把 `"系統管理員"`／`"一般使用者"` 當成部門寫入。四處統一改為 `Department = string.IsNullOrWhiteSpace(lookupDept) ? null : lookupDept`。
  - **為什麼一定要留 NULL 而不是塞字串**：`Department` 是「各部門活躍比率」的分群鍵，且會被 `UpdateLoginStats` 經 `SettingsService` 的 `COALESCE` 鏈抄進 `DailyUserVisits.Department` → 假部門會在報表上長出一個不存在的部門；硬編中文在 en/ja 介面也照樣顯示中文。下游兩端都已能吃 null：`AnalyticsController` 有 `x.Department ?? "未指定/其他"`，前端 `sidebar-item.js:114` 有 `t('dept_unknown', ...)`。
  - **連帶補強**：`render/tables.js` 的 `_accRowData` 原本 `a.department || ''` → 部門為 null 時只留一格空白（看起來像渲染失敗）。改為顯示三語齊備的 `dept_unknown`。實測 zh 顯示「未設定部門」、en 顯示「Dept not set」，有部門的列不受影響。
  - **未改動、刻意保留的兩處**：`AuthController.cs:378` 的 `Department = "系統救援"`（緊急 admin，**純記憶體物件、沒有 `_context.Accounts.Add`**，且 `EnableEmergencyAdmin=false` + Production guard 會擋）；`AuthService.cs:149` 的 `?? "測試環境"`（TestAccounts 專用，值本來就來自 appsettings）。
  - **⚠️ 待人工執行**：`sql/2026-08-16_Fix_Account_Department_RoleNamePollution.sql` —— 把 `Accounts` 與 `DailyUserVisits` 兩表既有的 `一般使用者`／`系統管理員` 改回 NULL（冪等，內含 STEP1 稽核 / STEP4 驗收查詢）。**不在 `SchemaBootstrap` 範圍內**（它只補表/欄位/索引，不做資料清理）。實測線上 `Accounts` 有 3 筆待清（`000058897`、`00058896`、`SARIEL\yu-tinglin`）。
  - 建置：`dotnet build` 成功。⚠️ 順帶更正先前紀錄——「0 錯 0 警告」是增量建置沒有實際重編的結果；完整重編會出現 1 筆**既有**警告 `CS8619 @ Services/IconStorageService.cs:62`（與本輪改動無關，待另行處理）。
- [x] **【第三輪健檢 E1~E4 修復】(2026-08-16)** — 四項皆已實機驗證通過。
  - **E1｜`wwwroot/lib/` 納入版控**：`git add wwwroot/lib` 已把 16 個第三方資產檔（Bootstrap 5.3.2 / FontAwesome 6.4.0 含 8 個 webfont / jQuery 3.7.0 / DataTables 1.13.6 / SheetJS 0.18.5）加入索引。**尚未 commit**（當時工作區另有 38 個修改中的檔案，交由使用者一併提交）。⚠️ `git add` 時出現 8 筆 `LF will be replaced by CRLF` 警告：對 minified JS/CSS 無功能影響，且與 §5「行尾字元不處理」的決定一致，**不要**為此加 `.gitattributes`。
  - **E2｜殭屍看板建立日期**：`traffic-stats.js` 的 `item.createDate` → **`item.createTime`**（對齊 `AnalyticsController.GetZombieMenus` 實際回傳的欄位名）。實測 19 列全部顯示後端回的 `-`，不再空白。
  - **E3｜內部頁面路徑不再渲染成死連結**：`render/tables.js` 的 `renderWebpageTable` 原本把 `url` 與 `targetPage` 併成一個 `mUrl`，改成分開的 `mExtUrl` / `mIntPage`，並依「有 url 走外部 `<a>`、否則 targetPage 走純文字」分流（與 `navigation.js` 的 `activateMenu` 判斷一致）。實測：MNOP 仍是可點的外部連結、BSL / Non Scaling 改純文字，全頁 `href^="page-"` 的死連結歸零。
  - **E4｜窄視窗頂部選單**：`css/navbar.css` 的 `.top-menu-link` 加上 `flex: 0 0 auto`。實測 541px 寬時 `scrollWidth` 338 → **930**（水平捲動生效）、各項寬度 15~21px → **26~83px**；1280px 桌機端 `scrollWidth === clientWidth`（不需捲動）、列高 34px 與導覽列 73px 皆未變、`意見箱` 仍在，**桌機無回歸**。
  - **連動**：因 CSS 有異動，依 CLAUDE.md §4-前端-4 把 `index.html` 的 `__APP_VER__` 與全部 13 處 `?v=` 由 `20260815` → **`20260816`**（殘留 0 筆）。JS 不帶版本碼的規範未破壞（`wwwroot/js` 內 `?v=` 仍為 0 筆、`type="module"` 仍只有 1 個）。
  - **回歸檢查**：console 0 錯誤；深色主題對比度掃描 0 項未達 AA。
- [x] **【第三輪健檢：實機驗證 + 新缺陷盤點】(2026-08-15)** — 本輪只做「檢測」，**未改任何程式碼**；新發現的缺陷見 §3 的「第三輪健檢待修清單」。
  - **驗證方式**：`dotnet build` 0 錯 0 警告 → 以 `dotnet run`（Development, port 5242）連上正式 DB `Sariel/EQDashboardV2` 實機操作，走完首頁 / 9 個系統設定分頁 / 深淺兩主題 / zh-en-ja 三語 / 桌機與窄視窗（541px），逐頁量測 DOM、對比度、network、console。
  - **⚠️ 量測陷阱（下次務必記住）**：預覽面板未顯示（不 compositing）時，**CSS transition 會被凍結**，`getComputedStyle` 讀到的是過渡的「起始值」→ 一度誤判「切換主題後顏色不更新、側欄文字對比 1.05」。注入 `*{transition:none!important}` 後複測即恢復正常。**在無頭/隱藏視窗量顏色前，先關掉 transition。**
  - **確認已修好、可關閉的舊待辦**：
    - ~~「index.html 仍有約 35 處 inline onclick 掛在 div/i 上沒有 role/tabindex」~~ → 實測 index.html 41 個 onclick 中僅 2 個掛在非互動元素、且**都已有 `role`+`tabindex`**；modals.html 5 個 onclick 全在 `<button>` 上。**此項已完成**（仍有殘留的是 JS 動態樣板，見 §3）。
    - ~~「B2 深色模式為本輪唯一視覺回歸風險，需逐頁目視」~~ → 已用 WCAG 對比度掃描（含半透明前景與背景混色）跑遍深/淺兩主題 × 6 個管理頁，**只剩 1 項未達 AA**（DataTables 目前頁碼白字 on `#3b82f6` = 3.68:1）。**視覺回歸風險已排除**。
    - D1（窄視窗麵包屑）實測通過：`#bc-path` 隱藏、只留 `#bc-name`。
  - **確認仍成立的守則**：`grep "?v=" wwwroot/js` = 0 筆；`index.html` 只有 1 個 `type="module"`；實機每次開頁 `MenuClick` **只記 1 筆**（A1 + switchLayoutMode 兩個成因都沒有回退）。i18n 三語 key **262/262/262 對齊**，`index.html`/`modals.html` 的 `data-i18n` 無指向不存在的 key。
- [x] **【第二輪健檢：C1~C3 + D1~D2 + A8 + B1~B8 全修】(2026-08-13)** ⚠️ **尚未實機驗證**（改完時站台已停機）
  - **C1｜401 誤判強制登出**：`api.js` 攔截器原本收到「任何」401 就 `logout()` + 阻斷式 modal。實際觀察到一次：前端被清空並設下 `umc_force_manual_login` 旗標，但同時 `WhoAmI`／`MyProfile`／`GetInitialData` **全部回 200**（伺服器 session 還活著）→ 使用者無故被踢出。已改為**先靜默打一次 MyProfile 複驗身分**，確認真的失效才登出；暫時性失敗只出 toast、不動登入狀態。可能的真實觸發：改 `Auth:SimulatedAccount`（`OnValidatePrincipal` 會 `SignOutAsync`）、App Pool 回收、金鑰輪換、與 SignOut 競態。
  - **C2｜移除「未儲存變更」死機制**：`appState.hasUnsavedChanges` 全專案只被賦值 `false`、從未設為 `true`，而 `updateSyncButtonUI()` 找的 `#btn-sync-excel` 在 HTML 中不存在 → 永遠 no-op。CRUD 已全走 RESTful 即時寫入，沒有這個狀態，故整組移除（store/api/dialogs/misc-manage 四檔）。
  - **C3**：`tables.js` 的 `data-menu-id="${menu.id}"` 補上 `escapeHTML`（同檔其他處都有跳脫，只有這處漏）。
  - **D1｜行動裝置麵包屑**：≤992px 原本 `display:none` 整列隱藏，而該斷點側欄預設也是收起 → 使用者完全失去定位。改為只隱藏上層路徑與裝飾圖示、**保留 `#bc-name`** 並限寬 34vw + ellipsis。
  - **D2｜觸控目標**：工具列圖示鈕實測僅 22~31px（最小的 22px 連 WCAG 2.5.8 AA 的 24px 都沒過）。以 `min-width/min-height:44px` + inline-flex 擴大命中區，**桌機視覺不變**。
  - **A8｜同源 iframe 被擋**：`X-Frame-Options: DENY` → `SAMEORIGIN`，CSP `frame-ancestors 'none'` → `'self'`。⚠️ 兩者必須一起改：現代瀏覽器以 CSP 為準、會忽略 XFO，只改一個沒用。
  - **B1｜看板載入回饋**：`#page-iframe` 新增 loading 指示與逾時（20s）失敗卡片（含「重新載入／另開視窗」兩顆按鈕）。跨來源 iframe 讀不到內部狀態，故以 `onload` 視為成功、逾時視為失敗；離開看板頁時 `navTo` 會清掉覆蓋層與計時器。
  - **B4｜無障礙**：`#main-iframe` 補 `title`（並由 JS 依當前看板動態更新）；`h1.nav-logo-text` 與 `#layout-toggle-wrapper` 這兩個「掛 onclick 的非按鈕元素」補 `role="button"`＋`tabindex="0"`＋Enter/Space 鍵盤啟動；側欄收合鈕補 `aria-label`。（**只做了最高價值的子集**，index.html 仍有多處 inline onclick 掛在 div/i 上未處理。）
  - **B2｜深色模式原生化**：切換主題時**同時**設 `data-theme` 與 `data-bs-theme`（統一走新的 `applyTheme()`），Bootstrap 5.3 的 modal/dropdown/form-control/table/btn-close/tooltip 就會自己正確。`components.css` 那 30+ 條 `!important` 補丁**暫時保留當保險**，未來可逐步移除。
  - **B3｜跟隨系統偏好**：首次造訪（localStorage 無偏好）依 `prefers-color-scheme` 決定深淺；使用者手動切過之後以其選擇為準。index.html 的防閃爍 inline script 同步套用同一邏輯。
  - **B6｜版面切換保留位置**：切換系統/自訂前先記住 `currentActiveSidebarMenuId`，若該看板在新版面的 `_currentValidMenus` 仍可見就 `activateMenu` 回原處，否則才 `goDefaultHome()`。（原本一律跳回預設首頁，誤觸就丟失位置。）
  - **B7**：最近瀏覽卡片 hover 從 inline `onmouseenter/onmouseleave` 移到 `.recent-menu-card:hover` CSS。
  - **B8｜轉義函式收斂**：原本有**三份**實作（`store.js escHtml`、`config.js escapeHTML`、`traffic-stats.js` 私有 `escHtml`）且跳脫字元集不一致（store 版沒處理單引號 `'`）。現統一為 `store.js` 一份（**已補上 `'`**，屬性用單引號包覆時才不會被跳脫出來），另兩處改為別名／指向全域。
  - 靜態驗收：C# 編譯 OK、前端模組 5 項全過、i18n 三語 **258/258/258** 對齊且 `index.html` 所有 `data-i18n` 都有對應 key、5 個 CSS 檔大括號配對、index.html `<div>` 207/207 配對。
- [x] **【A6】`SchemaBootstrap.RunAsync` 重複呼叫 (2026-08-12)**：`EnsureMenusMetadataColumnsAsync()` 被呼叫兩次，移除後者（保留與其他 `Ensure*ColumnsAsync` 同群組的那一次）。冪等所以原本無害，只是每次啟動多一趟 DB round-trip。
- [x] **【A7】升級 Negotiate 套件修補 CVE (2026-08-12)**：`Microsoft.AspNetCore.Authentication.Negotiate` 與 `System.DirectoryServices.Protocols` 皆 `9.0.0` → `9.0.19`，修掉 CVE-2026-47300／CVE-2026-47303（CVSS 8.8 權限提升，修補版 9.0.18+）。兩個專案的 `dotnet list package --vulnerable` 皆已乾淨（原本各 2 筆 High）。
  - ⚠️ **必須兩個套件一起升**：只升 Negotiate 會爆 `NU1605` 降級**錯誤**（Negotiate 9.0.19 要求 `System.DirectoryServices.Protocols >= 9.0.19`，但 csproj 把它釘在 9.0.0）→ 直接建置失敗。Tests 專案需 `dotnet restore` 才會跟上。
  - **與 IIS runtime 版本無關**：此套件不在 shared framework 內（框架目錄裡根本沒有這個組件），DLL 隨應用發佈。升版後 `runtimeconfig.json` 仍只要求 `Microsoft.AspNetCore.App 9.0.0`（**沒有被抬高**），所以主機是 9.0.0 或 9.0.16 都能跑。反面推論同樣成立：**升 runtime 不會修掉這個漏洞，只能升套件**。
  - 副作用：輸出多兩個 app-local DLL（`Microsoft.AspNetCore.Connections.Abstractions`、`Microsoft.Extensions.Features`），它們與框架版的 **AssemblyVersion 都是 `9.0.0.0`**（只有 FileVersion 不同）→ 組件繫結無衝突。**部署要重新 publish，不能只換單一 DLL**。
  - 實測（本機 runtime 9.0.16 = 正式機同版本，假連線字串 + 埠 5999，未動任何 DB）：app 成功啟動、`/health` 200、`/api/Auth/WhoAmI` 正確回 `WWW-Authenticate: Negotiate`、`curl --negotiate` 交握拿到真正的 NTLM Type 2 challenge（即 CVE 所在的 token 解析路徑）、log 中 0 筆組件載入錯誤。未驗到：IIS in-process 託管環境、以及完整登入（需要 DB）。
- [x] **【A9】i18n 缺漏補齊 (2026-08-12)**：三語 key 數 247/245/245 → **253/253/253，完全對齊**。
  - 補 en/ja 缺的 `iframe_fullscreen`、`popup`（開啟方式下拉原本會掉回中文）。
  - 補三語都沒有的 `lbl_recent` —— `index.html:230` 本來就寫了 `data-i18n="lbl_recent"`，但因 key 不存在而**一直失效**（三語都顯示中文）。
  - 同類失效再抓到 3 個：`home_fab_title`、`ts_tab_popular`、`ts_tab_zombie`（`data-i18n` 指向不存在的 key）→ 一併補齊。
  - `openRecentPage` 的 6 處硬編中文改走 `t()`（新增 `recent_login_required`／`recent_empty_title`／`recent_empty_desc`／`recent_count_fmt`／`menu_unnamed`），並在 `changeLanguage` 的作用頁重繪清單補上 `page-recent`（原本切語言時最近瀏覽頁的動態卡片不會跟著換）。
  - 實測確認：`ts_tab_popular` → "Popular Dashboards"、`lbl_recent` → "Recently Viewed"、`home_fab_title` → " Current Fab" 都正確替換。
- [x] **【A10】倉庫衛生 (2026-08-12)**：`git rm` 9 個已進版控的一次性產物（`navigation.js.bak`、`sidebar-item.js.bak`、`old_components.css`、`css_diff.txt`、`css_comments_diff.txt`、`tmp.txt`/`tmp2.txt`/`tmp3.txt`、`scratch_main.py`，合計約 200KB；三個 tmp 檔 md5 完全相同）。`.gitignore` 補 `*.bak`／`tmp*.txt`／`*_diff.txt`／`old_*.css` 防止再犯。修正 `responsive.css` 第 53、85 行的 Big5/UTF-8 亂碼註解（全專案僅此一處）。
  未刪：`test.mjs` 與 `scratch/` 為 **untracked**（刪除無法從 git 復原），留給使用者自行決定；`test.mjs` 的用途已被更完整的模組驗證腳本取代。
- [x] **【A5】移除側邊欄看板搜尋的死碼 (2026-08-12)**：`#sidebar-search-input` / `#sidebar-search-results` 這兩個元素在 HTML 與動態渲染中都不存在（企業 UX 決策已撤掉搜尋框），但相關程式碼全數留著、函式一進去就 early return。已清除四類殘留：
  - `render/sidebar.js`：`filterSidebarMenus()` + `window.setupSidebarSearch()` 整段（124 行）、`renderSidebarMenus()` 內的搜尋狀態重設區塊（連同只被搜尋用到的 `#dynamic-sidebar-menus` display 還原）、`setupSidebarSearch()` 呼叫點、`window.filterSidebarMenus` 匯出。
  - `css/sidebar.css`：`.sidebar-search-box` ~ `.sidebar-search-empty` 共 12 條規則（95 行）。
  - `config.js` i18n：`search_placeholder` / `search_no_result` / `search_clear` ×3 語系（key 數 247/245/245 → 244/242/242）。
  - `ui/navigation.js`：`data-i18n-placeholder` 的過時註解（**機制本身保留**，操作紀錄與流量統計的輸入框仍在用）。
  ⚠️ 現況提醒：`Menus.Description` / `Keywords` 從此變成「**只寫不讀**」—— 選單編輯 Modal 仍可輸入、DB 仍儲存、Excel 也會備份（A3 已補），但沒有任何功能會去讀它們。這是刻意的（見 §5「保留 DB 欄位作為未來擴充彈性」）；若日後決定不再擴充，才一併移除 Modal 欄位與 DB 欄位。
- [x] **【A3+A4】看板 metadata / CreatedAt 保全 (2026-08-12)**
  - **A3｜全量覆寫會洗掉 Description / Keywords / CreatedAt**：`SettingsService.SaveDataAsync` 是「`DELETE FROM` + 依 **DB schema 欄位**重建 INSERT」，payload 沒帶的欄位一律寫成 `DBNull`。修了三個環節（缺一不可）：① `api.js getDatabasePayload()` 的 `payload.Menus` 補上這三欄；② `api.js fetchInitialDataFromDB()` 的 mapper 補讀 `createdAt`（不可用 `String()` 包，否則 null 會變字串 `"null"`）；③ **Excel 匯出/匯入也要補**（`misc-manage.js` 的 `createWorkbookData` 與 V2 匯入 mapping）—— 原本匯出根本沒有這三欄，所以就算修了 payload，一次「匯出→匯入」還是會洗掉。
    設計原則：`CreatedAt` 是系統稽核欄位，前端**只原封不動帶回、不編輯**；`MenuDto` 刻意不含 `CreatedAt`，故 RESTful 路徑無法從外部覆寫（與 `CreatedBy` 同規格）。此模式與 Accounts 的 `LoginCount`/`LastLoginTime` 一致。
  - **A4｜batch 新建路徑漏設 CreatedAt**：`MenuService.BatchSaveMenusAsync` 新建分支只設 `CreatedBy`。而「選單配置管理」樹狀存檔走的正是 batch 端點 → 從樹狀介面新建的看板 `CreatedAt` 全為 NULL → 立刻被 `AnalyticsController` 列為殭屍看板。已補 `menu.CreatedAt = DateTime.Now`（時間基準對齊 `CreateAsync` 與 `cutoffDate`）；既有列維持 immutable，**舊資料的 NULL 不可補 `GETDATE()` 漂白**，否則真殭屍會被洗白。
  - 實測佐證：`GetInitialData` 確實回傳 `CreatedAt` 欄位，但現存 31 筆看板 `CreatedAt` 全為 NULL —— 正是 A4 的活體證據（欄位 8/11 才加，此後沒有任何看板走過 `CreateAsync`）。
- [x] **【額外發現】`MenuClick` 被記兩次的「第二個」成因 (2026-08-12)**：修完 A1 後實機驗證仍看到每次進站兩筆 `MenuClick` → 追出與模組雙載**互相獨立**的第二個成因：`initDashboardUI()` 先呼叫 `switchLayoutMode('system')`（其內部就會 `goDefaultHome()`），接著自己又 `goDefaultHome()` 一次 → `activateMenu` 跑兩遍。
  修法：`switchLayoutMode(mode, navigate = true)` 新增第二參數，`initDashboardUI` 改傳 `false`（只同步模式狀態與 UI，導航交給它自己那一次）。**順帶修好 `initDashboardUI(true)` 的 `stayOnCurrentPage`** —— 它原本被 `switchLayoutMode` 內的導航架空，導致 Excel 匯入後仍被踢回預設首頁（`misc-manage.js:872`／`:1004` 兩處呼叫的原意就是「留在原頁」）。
  ⚠️ 教訓：A1 的 memory 記錄原本把「MenuClick 記兩次」全歸因於模組雙載，這是**不完整的**；同一個症狀有兩個獨立成因，靠實機 Network 紀錄才抓到第二個。
- [x] **【A2】修正 Tracking 400 (Invalid CSRF Token) 的真正根因 (2026-08-12)**：`window._csrfToken` 只在 `auth.js` 的 `fetchAuthConfig()` 內設值，而它只被 `tryAutoLogin()` 呼叫；但 `main.js` 的 `restoreLoginFromStorage()` 成功時（localStorage 已有登入者＝一般 F5 暖重整）**不會**走 `tryAutoLogin` → 該次頁面 `_csrfToken` 全程 `null` → **第一個 POST 必定 400**（通常就是 `goDefaultHome → activateMenu → MenuClick`）。所以「偶發」實為「每次暖重整必發」，與原先研判的「伺服器重啟／金鑰輪換」無關。
  修法：① `main.js` DOMContentLoaded 內把 `fetchAuthConfig()` 與 `fetchInitialDataFromDB()ˋ **並行**發出（皆為 GET、互不相依 → 不增加 RTT），並在 `initDashboardUI()` 之前 `await`，外加 5 秒 `Promise.race` 保底避免 Auth/Config 卡住拖垮初始化；② `fetchAuthConfig()` 加 promise 快取，`tryAutoLogin()` 之後再呼叫不會重複請求；③ 順手移除 `navigation.js` 兩處 `'RequestVerificationToken'` 死碼標頭（後端 HeaderName 是 `X-CSRF-TOKEN`，且頁面根本沒有 `input[name="__RequestVerificationToken"]`，永遠送空字串）—— CSRF 標頭一律由 `api.js` 攔截器統一補上。
  同時修掉的附帶問題：舊路徑也沒跑 `/api/Auth/Config` → `appState.openAccessMode` 未設 → `goDefaultHome()` 的 `isOpenAccess` 判為 false → **OpenAccessMode 環境下「暖重整」與「冷載入」算出的預設首頁／可視看板清單不一致**。
- [x] **【A1】修正 ES Module 雙重載入 (2026-08-12)**：`index.html` 用 `?v=20260811d` 載入 19 支模組，但模組內部 `import` 是 `?v=20260727b`（108 處）＋ traffic-stats `?v=20260718`，共四套版本碼；module map 以「完整 URL 含 query」為 key，導致**每支模組被執行兩次**。實測影響：main.js 被 auth.js 以另一版號 import → 兩個 `DOMContentLoaded` handler → `fetchInitialDataFromDB()`／`initDashboardUI()`／`goDefaultHome()` 各跑兩遍 → **MenuClick 點擊統計每次開頁記兩次**（Popular 看板數據失真）＋多打一份 GetInitialData；`window.fetch` 被包兩層；auth.js 的 `_autoLoginInProgress`／`_whoamiResult` 各有兩份 → guard 失效（即歷史上「LoginCount +2」的真正根因）。
  ⚠️ **訂正**：「MenuClick 記兩次」不是只有這一個成因 —— 修完 A1 實機驗證仍是兩筆，另有一個獨立成因在 `initDashboardUI → switchLayoutMode` 重複導航（見上方獨立條目）。兩者都修掉後實測才降為 1 筆。
  修法：① 剝除全部 108 處 import 的 `?v=`（子模組新鮮度已由 `Cache-Control: no-cache` 保證）；② `index.html` 收斂為唯一入口 `<script type="module" src="js/main.js">`，刪除其餘 18 支 script tag；③ CSS 版號對齊 `__APP_VER__`（`20260813`）。
  ⚠️ 過程中踩到的第二層陷阱：入口那支**也不能帶 `?v=`** —— `auth.js` 與 `admin/misc-manage.js` 有反向 `import './main.js'`（循環相依），`main.js?v=x` 與 `main.js` 會是兩個 URL、main.js 照樣執行兩次。故 JS 全線不帶版本碼，`?v=` 只留給不在 module 圖內的 CSS 與 `modals.html`。
  驗收（5 項全過）：20 檔 ES module 語法通過、108 條 import 全可解析、20/20 模組皆從 main.js 可達、index.html 入口 URL 與模組圖一致、模組圖內 0 個帶 query 的 specifier。
- [x] **看板 Metadata 擴充 (DB 層)**：在 `Menus` 表新增 `Description` 與 `Keywords` 欄位（經由 `SchemaBootstrap` 補齊），並完成 `MenuService` 與 `api.js` (fetchInitialDataFromDB) 的前後端資料綁定。
- [x] **企業 UX 決策修正**：經確認，企業用戶習慣以明確的路徑/模組來找尋看板。因此主動「撤銷」了原先加在左側欄的「全域模糊搜尋框」及「懸停 Tooltip」，並移除 Modal 中的強制輸入欄位，以降低管理負擔並保持介面簡潔。*(保留 DB 欄位作為未來擴充彈性)*
- [x] **本地 Git 版控收尾**：確認 `bin/`、`obj/`、`.vs/` 等不進版控並完成 commit，維持工作目錄乾淨。
- [x] **DataProtection 金鑰輪換**：刪除歷史外洩金鑰，由系統重產新金鑰確保安全。
- [x] **UI/UX 深度優化**：完成跨裝置「最近瀏覽紀錄」同步、深色主題持久化無閃爍載入，並從 UI 中徹底移除了過時的「常用看板」功能。

## 3. In Progress / To-Do (進行中與待辦事項)
- [ ] **使用者操作手冊產出**：針對目前專案網頁所提供的功能，產出一份完整的使用者操作手冊的 PPT 或文件規劃。

### 第三輪健檢 (2026-08-15 盤點 → 2026-08-16 全數處理完畢)

> **E1~E13 已修復、E14 評估後刻意不改**（全部細節見 §2 的三條 Done）。
> **唯一未完成的動作：`sql/2026-08-16_Fix_Account_Department_RoleNamePollution.sql` 尚未人工執行** ——
> 未跑之前，`Accounts` 既有的 3 筆假部門與 `DailyUserVisits` 的歷史紀錄仍會讓「各部門活躍比率」顯示不存在的部門。

**倉庫衛生**
- ~~`sql/` 腳本散在兩個目錄~~ → 2026-08-16 已收斂到 `EQDashboard.V2.Web/sql/` 且全數納入版控（見下方第四輪 F2）。
- ~~`test.mjs`、`scratch/` untracked 殘留~~ → 2026-08-16 已處理：`scratch/` 由 `.gitignore` 涵蓋、`test.mjs` 已隨使用者的 commit 進版控。
  ⚠️ `test.mjs` 只有 1 行（UTF-16、內容是 `import './wwwroot/js/admin/menu-manage.js';`），用途早已被更完整的模組驗證腳本取代 —— 若確定不再需要可直接 `git rm`，現在刪除是可從 git 復原的。
- ~~**【已排除】`changeLanguage()` 過慢**~~：2026-08-12 曾量到 `data-i18n` 迴圈 10.3 秒、整個函式 30 秒逾時，一度列為效能疑慮。**2026-08-13 重測已排除**：頁面穩定後 `changeLanguage('en')` 只需 43ms、切回 zh 11ms，逐元素計時也沒有任何元素超過 20ms。原先的數字是「頁面初載時 iframe 正在載外部看板 + serverSide DataTable ajax」的競用假象。**教訓：初載期間量到的效能數字不可採信，要等頁面 settle 後再量。**
- ~~**無障礙未完成的部分（靜態 HTML 部分）**~~：2026-08-15 實測 `index.html` 的 inline `onclick` 已全部合規（41 個中僅 2 個在非互動元素上、且都有 `role`+`tabindex`），`modals.html` 5 個全在 `<button>` 上。**剩下的是 JS 動態樣板與圖示鈕的 aria-label** → 已改列為 E10 / E12。
- [ ] **深色模式補丁可精簡**：B2 已讓 Bootstrap 原生元件自己正確，`components.css` 內那 30+ 條 `:root[data-theme="dark"] .xxx { … !important }` 現在多為冗餘。確認視覺無回歸後可逐步移除，並把 `modals.html` 的 23 個 `bg-light`／11 個 `text-dark`／9 個 `bg-white` 換成 `bg-body-tertiary`／`text-body`／`bg-body` 語意類別。

### 第四輪健檢 (2026-08-16 盤點 → **同日 F1~F12 全數修復完畢並實機驗證**)

> **驗證方式**：`dotnet build --no-incremental`＋`dotnet test`＋`dotnet run`（Development, port 5242，連正式 DB `Sariel/EQDashboardV2`）實機操作，量測 DOM／對比度／network／console。
> **量色前已注入 `*{transition:none!important}`**（沿用 2026-08-15 的教訓）。
> **修復後總驗收**：`dotnet build` **0 錯 0 警告**（CS8619 已清）｜`dotnet test` **8/8 通過**｜三語 key **465/465/465 對齊**｜`wwwroot/js` 內 `?v=` = 0｜`index.html` `type="module"` = 1｜巢狀 `data-i18n` = 0｜5 個 CSS 檔大括號與註解皆配對｜所有 `data-i18n*` 與 `t('key')` 參照都找得到 key｜`__APP_VER__` `20260816f` → **`20260816g`**（13 處 `?v=` 全部對齊、殘留 0）。
> **回歸確認**：暖重整請求序列仍乾淨 —— CsrfToken → MyProfile → GetInitialData → Config → **MenuClick 只 1 筆** → Preferences，共 6 支、console **0 錯誤**。桌機 1280px 無任何回歸（導覽列 73/38/34 高度不變、cluster 不捲動、品牌文字／釘選鈕／分隔線／意見箱文字都在）。

**~~F1｜六天的成果全部未進版控~~ → 已於 2026-08-16 結案**
- 盤點當下：最後一次 commit 是 `c9cc64e (2026-08-10)`，此後 **40 modified ＋ 25 staged（E1 的 `wwwroot/lib` 16 支第三方資產）＋ 3 untracked** 全在工作區裸奔 —— E1~E14、登入不因時間過期（三層修正）、pinNewRow 置頂機制、Department 污染修復，全部只存在於本機。
- **現況：`696195d 20260816` 已 commit 並 push 到 `origin/main`（`github.com/lousyqq/EQDashboard.V2.Web`），工作區 0 modified / 0 staged / 0 untracked。**

**~~F2｜`sql/` 目錄分裂~~ → 已於 2026-08-16 結案**
- 盤點當下：`EQDashboard.V2.Web/sql/` 4 檔、外層 `EQDashboard/sql/` 2 檔（Preferences、IsFavorite），而 `DB_Table.md` Changelog 一律寫 `sql/xxx.sql` → 依 Changelog 部署遠端 DB 必漏那兩支。
- **現況：6 支全部收斂到 `EQDashboard.V2.Web/sql/` 且皆已納入版控（`git ls-files sql/` = 6）。Changelog 的 `sql/xxx.sql` 路徑現在一律對得上。**

> **版控範圍決策（2026-08-16 定案）**：**唯一的事實來源是 `EQDashboard.V2.Web` 這個 repo**（有獨立 remote `github.com/lousyqq/EQDashboard.V2.Web`）。
> 外層 `EQDashboard` repo 只是本機工作區容器，**刻意不再維護**：它雖把 `EQDashboard.V2.Web` 記成 gitlink（mode 160000）卻沒有 `.gitmodules`（`git submodule status` 會報 `no submodule mapping found`），其 gitlink 也長期落後。
> **不要再把它當 submodule 處理、也不要為此新增 `.gitmodules`** —— 所有程式碼、SQL 腳本與文件一律以內層 repo 為準。

**F3｜語言選擇不持久化 → 已修**（本輪最有感的一項）
- 症狀：`changeLanguage()` 只寫 `appState.currentLang`、無任何 localStorage；而 `initDashboardUI()` 每次進站都無條件 `changeLanguage(fab.defaultLang)` → 英/日文使用者每重整一次就被打回中文（實測：切 en → F5 → `zh`）。三語 465 個 key 的投入等於被架空。
- 修法：新增 `umc_lang_preference`（`ui/navigation.js` 的 `LANG_PREF_KEY` / `getStoredLangPreference()`），`changeLanguage(lang, persist = true)` 寫入偏好；`main.js` 的 `initDashboardUI` 改成 **使用者偏好 > `fab.defaultLang`**，套廠區預設時傳 `persist=false`（那不是使用者的選擇，不可覆寫其偏好）。與主題「首訪跟預設、之後跟使用者」同一套邏輯。
- ⚠️ `changeLanguage` 的第二參數只有「套用廠區預設語言」該傳 `false`；使用者從語言下拉切換一律要落盤，不要為了「少寫一次 localStorage」而省略。
- 實測：切 en → F5 → `currentLang='en'`、`localStorage.umc_lang_preference='en'`、下拉顯示 English。

**F4｜`<html lang>` 與 `document.title` 永不更新 → 已修**
- `changeLanguage()` 開頭同步 `document.documentElement.lang`（`HTML_LANG_TAG` = zh→`zh-TW` / en→`en` / ja→`ja`）與 `document.title`（新 key `page_title`）。
- `index.html` 的防閃爍 inline script 也提早套用 `lang`（讀同一個 localStorage 鍵）—— 模組圖載完前的空窗期不讓螢幕閱讀器用錯發音語系。**該處的 `LANG_TAG` 是 `HTML_LANG_TAG` 的鏡像，改語系代碼時兩邊要一起改。**
- 實測：en → `lang="en"` + `"Main Dashboard - …"`；ja → `lang="ja"` + `"メインダッシュボード - …"`；切回 zh 正確還原。

**F5｜手機/平板頂列水平溢位 → 已修**（`css/responsive.css`）
- 成因：D2/E12 的 `min-width:44px` 讓 `.utility-cluster` 撐到 540px，而 navbar.css 給它 `flex-shrink:0`（永不收縮）、給 `.nav-brand-section` `flex-shrink:1` → 壓力全由品牌區吸收、被擠成 0px，總量仍溢出。
- 修法（≤992px）：① cluster 改 `flex:0 1 auto` + `min-width:0` + `overflow-x:auto`（隱藏捲軸，同 E4 對 `.top-menu-link` 的套路），內部項目 `flex:0 0 auto`；② `.nav-brand-section` 給 **`min-width:150px`** 保底；③ 隱藏 `.util-divider`；④ 隱藏 `#btn-pin`。
  - **`min-width:150px` 是關鍵，只寫 `flex:1 1 auto`無效**：負剩餘空間依「基準寬度」比例分配，cluster 基準遠大於品牌區 → 品牌區照樣被壓到只剩漢堡鈕（第一版就是這樣，`#bc-name` 仍為 0）。
  - **隱藏釘選鈕不是砍功能**：整套自動隱藏/喚醒依賴 `mouseenter`/`mouseleave`（`ui/dialogs.js` + `.edge-trigger`），觸控裝置沒有 hover，那顆鈕本來就按不出正確行為。
- ≤768px 另外隱藏 `.nav-logo-text` —— 手機上「我在哪」比「站台叫什麼」重要（D1 的原意）。
- 實測 375px：`body.scrollWidth` **570 → 375**（＝`clientWidth`，溢出歸零）；`.nav-brand-section` 0 → **150px**；`#bc-name` 0 → **15px 且顯示「ZE」**（D1 的麵包屑終於真的看得到）；cluster 197px、內部可捲動，所有工具鈕仍可取用。768px 亦無溢位、`#bc-name` 正常。**桌機 1280px 零回歸**（cluster 不捲動、logo/釘選/分隔線/意見箱文字全在、導覽列 73/38/34 高度不變）。

**F6｜按 ESC 離開全螢幕後卡在 focus 模式 → 已修**
- `ui/layout.js` 新增 `fullscreenchange` 監聽器：偵測到「瀏覽器已不在全螢幕、但 `body.fullscreen-mode` 還在」就移除該 class。
- ⚠️ **只做單向同步**（移除，不自動加）：看板可以用 `iframe_fullscreen` 進沉浸模式而不要求瀏覽器全螢幕，那是合法狀態，反向自動加 class 會弄壞它。
- 實測：派發 `fullscreenchange` 後 class 已移除、`#top-navbar` 由 `display:none` 回到 `flex`。

**F7｜深色模式 `.badge.bg-info.text-dark` 對比 2.05:1 → 已修**（`css/components.css`）
- 成因是兩條既有規則疊加：`:root[data-theme="dark"] .text-dark { color: var(--text-main) }`（近白字）＋ `:root[data-theme="dark"] .bg-info { background: rgba(56,189,248,.15) }`（幾乎透明的底）。那條 15% 色調是為 alert/區塊背景設計的，套到小面積徽章上就爆掉。
- 修法：新增 `:root[data-theme="dark"] .badge.bg-info` / `.badge.bg-warning` → 實心底 `#38bdf8`/`#fbbf24` + 深色字 `#0b1220`（**8.7:1**）。選擇器帶 `.badge` 多一級具體性才壓得過上面兩條同為 `!important` 的規則。
- 實測（深色主題，量色前已關 transition）：流量與使用率 **5 個分頁全部 0 項未達 AA**（原本光是常用看板就 10+ 筆）。

**F8｜意見箱觸控目標 17×19px → 已修**
- `.feedback-link` 在 ≤768px 補 `min-width:44px; height:34px`。⚠️ **不可寫 `min-height:44px`** —— `.navbar-row-bottom` 是固定 `height:34px`，硬撐會讓連結溢出列外。34×44 已遠超 WCAG 2.5.8 AA 的 24×24。
- 實測 375px：**17×19 → 44×34**，`#top-navbar` 內小於 24px 的可點目標歸零。
- ⚠️ 過程踩到：第一版把說明文字寫在 `*/` **之後**又補一個 `*/`，CSS 解析器直接吃掉整條 `.feedback-link` 規則（量測顯示仍是 17×19 才發現）。**驗收腳本已加「註解 `/*` 與 `*/` 數量配對」與「去註解後不得有殘留 `*/`」兩項檢查。**

**F9｜i18n 第二戰場（JS 動態字串 + 屬性 + 後端）→ 已修**
- **三語 key 397 → 465**（zh/en/ja 完全對齊）。
- **60 處**硬編中文字串改走 `t()`（以逐條斷言命中次數的腳本替換，避免改錯地方）：`misc-manage` 23、`menu-manage` 10、`api` 8、`auth` 4、`traffic-stats` 4、`account/fab` 各 2、`role/tables` 各 1，外加 `main.js` 初始化遮罩／15 秒逾時卡片／未預期錯誤畫面、`layout.js` 的 `navTo(..., '帳號管理'/'需求申請')`、`navigation.js` 的 `${dName} 內容建置中`、`dialogs.js` 的 toast `btn-close`。
- **`index.html` 20 處 `title`/`aria-label`** 補上 `data-i18n-title` / `data-i18n-aria-label`；純圖示一律補 `aria-hidden="true"`。
- **後端顯示字串代碼化**（`AnalyticsController`）：`"已刪除看板"` → `menuName: null`、`GroupBy(x => x.Department ?? "未指定/其他")` → `GroupBy(x => x.Department)`、`department = x.Department ?? "未指定"` → `x.Department`。一律由前端 `t('menu_deleted')` / `t('dept_unspecified_other')` 呈現。
- ⚠️ **`#main-iframe` 刻意不掛 `data-i18n-title`**：`openDynamicIframe` 會動態填當前看板名稱，掛了就會在切語言時被洗回通用字串（正是 §4-9「JS 會動態填值的元素不可掛 data-i18n」的同款陷阱）。翻譯改在 `openDynamicIframe` 內用 `t('iframe_content')` 當 fallback。
- ⚠️ **踩過**：腳本把 `${...}` 插進 `api.js` 一段**單引號**字串（同步遮罩），會原字輸出 `${escHtml(...)}`。改 `t()` 時務必確認目標是樣板字面值。
- 實測（英文）：刪除帳號確認框內文 "Delete this account?"、navbar 五個 tooltip 全英文、toast 關閉鈕 `aria-label="Close"`、`各部門活躍比率` 的 null 部門顯示 "Unspecified / Other"（API 實際回 `null`）、`ZE is under construction`。日文亦全數通過。

**F10｜死碼 `renderLangSwitcher()` → 已移除**
- 它渲染的 `#lang-dropdown-menu` 在 `index.html` / `modals.html` 都不存在（語言下拉是靜態 `<ul>` + `updateLangUI()`），函式一進去就 early return，且 `window.renderLangSwitcher` 被重複匯出兩次。整組移除（含 `dialogs.js` 的呼叫點與 import）。與 A5「撤掉搜尋框卻留著 JS」同一類殘留。

**F11｜技術債 → 已修**
- **CS8619 @ `IconStorageService.cs:62`**：`return Task.FromResult(icon)` 在 null 檢查後 `icon` 被收斂成 `string`，推斷出 `Task<string>` 而 `Task<T>` 不變 → 顯式寫 `Task.FromResult<string?>(icon)`。**`dotnet build` 現為 0 錯 0 警告。**
- **`main.js` 的 `isDev` 判定**：移除 `window.location.port !== ''` —— IIS 內網站台常掛非 80 埠，等於在正式站把 stack trace 印給使用者。改為只認 loopback（`localhost` / `127.0.0.1` / `::1`）。
- **`AnalyticsController` 月趨勢移除 `WITH (NOLOCK)`**：同檔其他三個端點都走 EF + `AsNoTracking`，只有這裡開髒讀。`DailyUserVisits` 是每人每日一列的小表、寫入走單句 UPSERT，鎖持有極短，不值得為此讓對外報告的數字承擔漏列/重複列風險。
- **新增索引 `IX_DailyUserVisits_Date_Emp (VisitDate, EmpId, EmpName)`**：`/api/Analytics/details` 的關鍵字查詢跑 `EmpId/EmpName LIKE '%…%'`（non-sargable），該表原本只有 `(VisitDate, Department)` → 整表掃描。刻意不加 `INCLUDE`（主機僅 6GB RAM，索引寬度優先）。已同步 `SchemaBootstrap.EnsureIndexesAsync`、`DB_Table.md` 快照與 Changelog，並產出 `sql/2026-08-16_Add_DailyUserVisits_Emp_Index.sql`。
  - **已於 2026-08-16 在線上執行並驗證**：查 `sys.indexes`，`dbo.DailyUserVisits` 現有兩條非叢集索引 —— `IX_DailyUserVisits_Date_Dept (VisitDate, Department)` 與 `IX_DailyUserVisits_Date_Emp (VisitDate, EmpId, EmpName)`。
  - 💡 **本機可直接查線上 DB 驗證 schema**：`sqlcmd` 在 `C:\Program Files\Microsoft SQL Server\Client SDK\ODBC\170\Tools\Binn\`，連線資訊從 `appsettings.json` 取。⚠️ 用 PowerShell 讀 `appsettings.json` 必須 `[System.IO.File]::ReadAllText(path, [Text.Encoding]::UTF8)` —— 直接 `Get-Content` 會以 ANSI 解讀，中文註解變亂碼並讓 `ConvertFrom-Json` 解析失敗（本輪踩過，還順帶把連線字串連同明碼密碼印到 console）。
- **E5 的 Department 污染清理已完成並驗證**（使用者於 2026-08-16 手動執行 `2026-08-16_Fix_Account_Department_RoleNamePollution.sql`）：`Accounts` 與 `DailyUserVisits` 兩表的 `一般使用者`／`系統管理員` 假部門皆為 **0 筆**；`DailyUserVisits` 現有 5 筆 `Department IS NULL`（＝正確地留白，前端以 `t('dept_unspecified_other')` 呈現）。

**F12｜功能建議**
- [x] **釘選狀態持久化**：新增 `umc_pin_preference`（`ui/layout.js` 的 `PIN_PREF_KEY`），`syncPinButtonUI()` 一併同步 `is-pinned` class（否則還原成「取消釘選」時樣式會不一致）。實測：取消釘選 → F5 → 仍為未釘選、圖示為 `fa-unlock`。
- [x] **`customConfirm` 按鈕樣式可選**：新增第四參數 `variant`（`'danger'` 預設＝維持既有呼叫端行為不變、`'primary'` ＝一般確認），同時切換標題圖示（驚嘆三角 ↔ 問號）。實測兩種 variant 的 class 與圖示都正確。
- [ ] **「流量與使用率」沒有任何圖表**（未做，使用者決定另案）：六個分頁全是表格＋`progress-bar`。CSP 已收斂為 `script-src 'self'`，不需引外部函式庫，用 inline SVG 畫每日／月度折線圖即可。
- [ ] **統計與操作紀錄無法匯出**（未做，另案）：可比照「設定檔管理」既有的 SheetJS 匯出。
- [ ] **`Menus.Description` / `Keywords` 仍是「只寫不讀」**（未做，另案）：建議接進「看板網頁管理」的表格搜尋 —— 符合 §5「不做全域模糊搜尋、但可放在結構化位置」的決策。

## 4. Known Issues (已知 Bug 或技術債)
- ~~**Tracking API Console Noise**~~：已於 2026-08-12 修復（見 §2 的 A2）。留一句給未來：**若這類「首發 POST 400」再出現，先查 `_csrfToken` 的初始化時序，不要再往「金鑰輪換」方向猜**（當年那個研判是錯的，害這個 bug 掛了很久）。
- **模組雙載陷阱（已修，勿回退）**：`index.html` 的 `<script src>` 與模組 `import` 只要 `?v=` 不一致，同檔就會被載成兩個模組實例。專案內大量 idempotent 防護（`__alertState` 防重複彈窗、`dataset.bound`、`safeDestroyDataTable`、`window.appState = window.appState || {}`、`_autoLoginInProgress`）都是當年雙載症狀的對症貼布 —— 根因已於 2026-08-12 消除，未來勿再為「疑似重複執行」加新貼布，先確認版本碼規範（CLAUDE.md §4-前端-4）是否被破壞。
- **快取一致性邊界**：Raw ADO.NET 寫入路徑（未經 EF Core tracking）無法被 `CacheInvalidationInterceptor` 攔截，開發時若新增這類寫入，極易忘記手動呼叫 `InvalidateInitialDataCache()` 導致畫面資料不同步。
- **`data-i18n` 不可巢狀、也不可掛在 JS 會填值的元素上（2026-08-16 踩過）**：`changeLanguage()` 對每個 `[data-i18n]` 直接覆寫 `innerHTML`。巢狀時父層會把子層整個吃掉（提示文字永久消失）；掛在動態元素上則會在切語言時把資料洗回預設字串。詳見 CLAUDE.md §4-前端-9 的兩條子規則與已知的動態元素名單。驗收腳本要檢查「巢狀 data-i18n = 0」。
- **掃 HTML 文字節點請用 DOM 走訪，不要用 `<tag …>text` 正則（2026-08-16 踩過）**：`<div><i …></i>提示：…</div>` 這種「巢狀元素之後的裸文字」正則完全掃不到，本輪因此先漏了 37 處。另外，**批次改 HTML 的正則若用 `[\s\S]*?` 當內文，會跨越結束標籤配對到不相干的元素** —— 本輪就發生過 `<label>` 被錯配到「另一個 Modal」的 input（產生 7 個指向錯誤控制項的 `for=`）。內文一律寫成 `((?!<\/tag>)[\s\S])*`，並在套用後跑一次「for= 是否指向緊鄰控制項」的複驗。
- **量測顏色前必先關掉 CSS transition（2026-08-15 踩過）**：`variables.css:92` 的 `body { transition: background-color .3s, color .3s }` 在「視窗未顯示 / 不 compositing」的環境（無頭瀏覽器、隱藏的預覽面板）**不會推進**，`getComputedStyle` 會一直讀到過渡的起始值。曾因此誤判「切換主題後 body 沒變色、側欄文字對比只有 1.05」。做自動化視覺/對比度檢測時，先注入 `*,*::before,*::after{transition:none!important;animation:none!important}` 再量。

## 5. Decisions (重要架構與邏輯決策)
- **行尾字元（CRLF/LF）不處理 — 已於 2026-08-13 明確決定不修**：`git diff` 會出現大量行尾雜訊（例：`api.js` 顯示 1927 行，實際只改 59 行；全 repo 3604 行中約 1960 行是雜訊）。
  **不修的理由**：① 對執行期**完全無影響**（JS/C# 對 CRLF/LF 皆無感），成本純粹落在 code review 可讀性；② 有零風險的規避方式（見下）；③ 診斷結果自相矛盾 —— `git cat-file` 顯示 blob 與工作區都是 CRLF（理論上不該有雜訊），但實測加上 `.gitattributes`（`* -text`）後雜訊反而從 3604 暴增到 23380 行，方向相反。代表對這個 repo 的行尾機制**沒有可靠模型**（疑與系統層 `core.autocrlf=true` + 巢狀 repo 的提交歷史交互作用有關）。
  **⚠️ 未來若有人想再處理**：不要在有大量未 commit 變更時動手；先 commit 乾淨、單獨開分支、並且驗證 `git diff --stat` 真的變乾淨才合併。已知 `* -text` 這條路是錯的，別重試。
  **規避方式（要 review 時就用這個，不要再去動設定）**：`git diff --ignore-cr-at-eol` 只顯示真實變更；或 `git config diff.renormalize true`（僅影響顯示、不改檔案）。
- **禁止全域模糊搜尋 UI**：企業用戶已習慣結構化模組導航。不提供扁平化的全站模糊搜尋框，避免打亂使用習慣。
  相關程式碼已於 2026-08-12 完整移除（見 §2 的 A5）—— **勿再「只加一半」**：先前的狀態是「HTML 入口被撤掉、但 JS/CSS/i18n 全留著」，導致後續有人在死碼上繼續加功能（Description/Keywords 比對）卻永遠跑不到。若日後要恢復搜尋，請一次做完入口 + 邏輯，並優先考慮放在「看板網頁管理」表格搜尋等結構化位置，而非左側欄。
- **無 EF Migrations**：為了相容現有資料庫環境，堅決不使用 EF Migrations。所有 Schema 變更一律由 `SchemaBootstrap.cs` 以 `IF NOT EXISTS` 冪等 T-SQL 自我修復。
- **分頁策略**：帳號表（`Accounts`）因數量龐大（可達十萬級），強制走 `serverSide: true` 與後端 API 分頁；其餘設定表（如看板、廠區、群組）因資料量小，一律一次拉回前端做 Client-side 分頁與搜尋，大幅降低 Server loading。
- **權限與關聯寫入策略 (先刪後寫)**：更新複合 PK 的關聯表（如 `Map_Role_Menu`）時，因 EF Identity Map 追蹤限制，一律採 `RemoveRange` + `SaveChanges` 後再 `Add` + `SaveChanges` 兩階段寫入。
