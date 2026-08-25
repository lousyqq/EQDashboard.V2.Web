# 專案記憶庫 (memory.md)

> 給 AI 的 Context：本檔＝**現況快照｜待辦｜踩過的坑｜決策**。每輪結束請更新 §2 與 §3。
> ⚠️ **通用開發規範一律寫在 `CLAUDE.md` §4（24 條），本檔不重複** —— 本檔只記「目前狀態」與「為什麼是這樣」。
> 📦 **2026-08-25 精簡**：第二～第九輪的逐項修復流水帳（約 470 行）已移除，因為其中的規則都已固化進 `CLAUDE.md` §4。
> 需要當時的細節時：git 內最後一份完整版是 `f84f210:memory.md`（⚠️ 該版本編碼損毀，見 §3）；本次精簡前的乾淨完整版備份在該 session 的 scratchpad `memory.full-before-prune.md`。

---

## 1. Context (現況)

**EQDashboard.V2.Web** 已過了重構期，目前處於**健檢收斂 + 部署維運**階段。

- 前端 ES Modules + App Shell，後端薄 Controller / Service 分層，DB Schema 由 `SchemaBootstrap` 冪等維護，權限隔離與快取（Global 60s / Volatile 10s + ETag）皆穩定。
- 第二～第九輪健檢共 9 輪，**第一～第八輪待辦已全部清空**；第九輪只剩 L5~L9（皆 P3、非阻斷，見 §2）。
- 最近一次全綠基線（2026-08-24，第九輪修復後）：`dotnet build --no-incremental` **0 錯 0 警告**｜`dotnet test` **11/11**｜20 支模組 `node --check` **0 fail**｜三語 key **623/623/623 對齊**、`used-but-missing` 0｜13 頁 × 深淺兩主題 **0 項未達 AA**｜`wwwroot/js` 內 `?v=`／`bg-light`／`bg-white`／`text-dark`／原生 `alert(` 皆為 **0 筆**。
- 線上 DB 與 `DB_Table.md` 快照一致，**無待執行的 SQL 腳本**。
- `__APP_VER__` 目前為 `20260824c`（13~14 處 `?v=` 全對齊）。

---

## 2. 待辦 (依優先序)

### 🔴 P0｜`appsettings.json`（含明碼 DB 密碼）已上傳到「公開」GitHub repo — 待使用者處置

- commit `7467dd4`（2026-08-24 23:22，GitHub 網頁「Add files via upload」）把 `appsettings.json` 整支 84 行推上 `github.com/lousyqq/EQDashboard.V2.Web`。該檔在 `.gitignore` 內**正是為了防止這件事**。
- 未帶認證打 `https://api.github.com/repos/lousyqq/EQDashboard.V2.Web` 回 **HTTP 200 → repo 是公開的**。
- 外洩內容：`Data Source=Sariel;…;User ID=testuser;Password=<明碼>`，以及 `TestAccounts` 的 5 組帳密。
- ⚠️ **改密碼優先於刪 commit**（推上公開 repo 就必須視為已外洩：fork／快取／爬蟲）。順序：① 改 `Sariel` 上 `testuser` 與那 5 組測試帳密 ② repo 改私有或用 `git filter-repo`／BFG 清 blob 後 force push ③ `git check-ignore -v appsettings.json` 複查忽略規則有效。
- 📌 **AI 未動遠端任何東西**（未 push、未改 repo 設定）—— 需使用者決定後才執行。
- ⚠️ 順帶：`appsettings.Production.json` **沒有覆寫 `SimulatedAccount`**，而上傳的那份 `appsettings.json` 是 `"00058897"`。若 IIS 上跑的就是這份，**所有人開站都會被當成 00058897（admin）**。請確認線上該值為 `""`。

### P1｜工作區未 commit（第九輪 L9，承接 K9／F1，仍成立）

- 第七輪 J1~J4 的**權限提升修復**、第八輪 K1~K10、第九輪 L1/L3/L4，以及 2026-08-25 的 iframe sandbox 修復與三份文件重建，**全部只存在於本機工作區**。
- 本機 `main` 目前還**落後 `origin/main` 1 個 commit**（就是上面那個 `7467dd4`），要 push 前得先處理 P0。

### P1｜iframe sandbox 修復待實機確認

- 2026-08-25 已修（見 §3），但 AI 的工作環境**連不到內網 `p58esiap12`**，只驗證到「sandbox 屬性正確」這一層。
- **待使用者在可連內網的機器上確認**：MSD 需求管控表在 `#main-iframe` 內能正確顯示員編、表格有資料。

### P2/P3｜第九輪健檢 L5~L8（未修，皆非阻斷）

- **L5｜JS 動態填值的元素仍掛 `data-i18n`**（`CLAUDE.md` §4-前端-9 已知名單需擴充）：`#configFileName`（選完檔案再切語言 → 顯示回「沒有選擇檔案」，但 input 其實還握著檔案）、`#appIconPreviewTitle` / `#appIconPreviewSub`（切語言後一律被洗回「目前已配置專屬圖示」，狀態顯示錯誤）。
- **L6｜46 個 i18n key 已無任何參照（×3 語 = 138 筆死字典）**：
  - ⚠️ **`dyn_m_*` 那 11 個不可刪** —— `sidebar-item.js:41` 有 `i18n[lang]['dyn_' + menu.id]` 的動態命中機制。
  - 💡 **`chart_trend_aria` 是反向的 G2**：key 準備好了但 `renderTrendChartSVG` 產生的 `<svg>` **沒有 `role="img"` 也沒有 `aria-label`** → 讀螢幕讀不到圖表。這一項該做的是「接上」而非「刪掉」。
- **L7｜`TrackingController.MenuClick` 不驗證 menuId**：任何登入者可 `POST /api/Tracking/MenuClick?menuId=任意值` 灌爆「看板點擊率」，甚至寫入不存在的 MenuId。修法比照 `PersonalSettingsController` 用 `IMenuAuthService.GetVisibleMenuIdsAsync` 過濾。（與 K1 的「ZE 佔位節點累積 397 次假點擊」是同一組統計的可信度問題，只是這次是主動偽造。）
- **L8｜趨勢圖資料變空時留下舊圖**：`traffic-stats.js:42` 的 `if (!container || !data || data.length === 0) return;` 直接返回、**不清空也不隱藏 container**（只有成功路徑才 `display='block'`）→ 改成沒資料的天數區間時，折線圖還是上一次查詢的，數字表格卻是空的。

### 其他

- **使用者操作手冊產出**：針對目前功能產出完整的使用者操作手冊（PPT 或文件規劃）。
- **`normal_user` 的 3 筆「登入預設首頁」需 admin 重設**：第七輪 J3 盤點時被舊程式碼刪除，只擷取到 MenuId（`m_ze_3`／`m_ze_2_2`／`m_12m`），PK 需要的 `FabId` 未擷取 → **無法精確還原**。

---

## 3. 近期完成

### 2026-08-25｜`memory.md` 12,406 個 U+FFFD 亂碼重建、`AGENTS.md` 轉 UTF-8

- **`AGENTS.md`：不是亂碼，是編碼**。整份是合法 Big5/cp950（位元組完好、零遺失），以 `GetEncoding(950)` 解碼後改存 **UTF-8 無 BOM**。
  - 靠 `52bdc73`（2026-08-10）那份**乾淨 UTF-8 舊版**交叉比對，多救回 3 個 Big5 編不出來的字元：`≥`、`≤`、`🔄`（在 Big5 版裡全變 `?`，單看損毀檔救不回來）。
  - 最終與 `52bdc73` 逐行比對只剩 3 行差異，全部是有意的（2 處本輪修掉的過時 CDN 敘述 + 使用者自己勾掉的「DataProtection 金鑰輪換」）。
- **`memory.md`：真的是資料遺失**。636 行有 526 行含 U+FFFD。**U+FFFD 不可逆**（原始位元組在解碼當下就被丟棄）。
  - **成因**：`7e05f9d`（08-24 14:05）乾淨 → `f84f210`（同日 23:11）已損毀；逐字稿最後一次工具寫入是 22:11，且 26 次 `Edit` 內容全部乾淨、無任何 shell 指令寫過此檔 → **損毀發生在 22:11～23:11、在 Claude Code 之外**（編輯器以錯誤編碼開啟後另存）。`AGENTS.md` 轉 Big5 是同一次事故。
  - **重建**：以 `7e05f9d:memory.md` 為底本，依時間序重放逐字稿 19 次 `Edit`，**19 次 anchor 全部精確命中**（任何一步偏差都會讓後續 anchor 對不上，這本身就是正確性的證明）。
  - **驗收**：636 行對 636 行逐行 index 對齊；損毀行的倖存字元**每一行都是重建行的子序列**；反向檢查「重建檔中無對應來源的行」**0 筆**（沒有一行是掰出來的）。
  - **GitHub 交叉比對**：`origin/main`(`7467dd4`) 只多一個 `appsettings.json`、沒動 `memory.md` → 遠端那份與 `f84f210` 同一顆 blob、**一樣損毀**，沒有更好的副本。
  - ⚠️ **4 處是人工重建、文字可能與原句有出入**（使用者 22:11 後自己在編輯器改的，只存在於損毀檔，`git rev-list --all` 全歷史搜尋也確認從未 commit 過）：①「待人工執行」→「已人工執行」那行 ② J2/J3/J4 標題補 ` → 已修` ③ G10/G12/G13/G14 四個 `- [ ]` 勾成 `- [x]` ④ §5 檔尾 3 條「不做」決策（同時刪掉對應的 4 行舊待辦）。
- **救援 SOP 已寫進 `CLAUDE.md` §4 第 24 條**（含每次 commit 前的 U+FFFD 驗收指令）。

### 2026-08-25｜外網相依全面盤點：確認「零外部資產」

- 起因：使用者在另一台主機重新 compile 時漏帶 `wwwroot/lib` → 畫面完全裸奔（`bootstrap.min.css` 404）。
- **`wwwroot/lib` 本來就在版控內**（16 個檔，`git ls-files` 可查），`.gitignore` 刻意沒有 ASP.NET 樣板那條 `wwwroot/lib/`，`.csproj` 也沒排除 → **`git clone` + `dotnet publish` 就是完整的**；手動複製搬機器才會漏。
- **執行期外網相依 = 0**（2026-08-15 那輪就做完了，本輪全庫複驗）：`index.html`／`partials`／`appbase.js`／`css`／`js` 內外部 `http(s)://` 資產連結 **0 筆**；FontAwesome 的 `url()` 全是相對路徑、Bootstrap/DataTables 全是 `data:`；**無任何 Google Fonts / gstatic**。`Program.cs` 的 CSP（`script-src 'self'` 等）是安全網，有人改回 CDN 會被自己擋下。
- 仍會連外但**不是專案資產**的兩項：`frame-src`（看板 iframe 的 `menu.url`，是 DB 資料）、`img-src`（圖示可填外部 URL）→ 要治的是 DB 內容，不是程式碼。
- 修掉 `AGENTS.md` 兩處會誘導後人改回 CDN 的過時敘述（§1「全 CDN」、§6「CSP 必含 CDN 白名單 + `integrity`」）。規則已固化為 `CLAUDE.md` §4 第 23 條。

### 2026-08-25｜內嵌看板抓不到 Windows 帳號 —— iframe `sandbox` 少了 `allow-same-origin`

- 症狀：看板在 `#main-iframe` 內顯示「未識別」、表格 0 筆；**同一 URL 另開分頁完全正常**。
- 根因：`openDynamicIframe()` 的「動態 sandbox」對 cross-origin 拿掉 `allow-same-origin` → 被嵌入頁面掉進 **opaque origin** → Windows 驗證失效、session cookie 送不出去、storage 丟 `SecurityError`。**該威脅模型本來就是錯的**（跨來源 iframe 本就被同源政策擋在 `parent.document` 之外，拿掉是零防護增益）。
- **會被「儀表板與看板同主機」完全掩蓋** —— 那時走 same-origin 那條對的分支。
- 修法：無條件 `sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"`（即專案初版 `026ee47` 寫在 `index.html:806` 的同一組）。規則已固化為 `CLAUDE.md` §4 第 22 條。**待實機確認見 §2。**

### 2026-08-12 ~ 2026-08-24｜第二～第九輪健檢（細節已精簡，規則見 `CLAUDE.md` §4）

| 輪次 | 日期 | 主題 | 產出的規則（`CLAUDE.md` §4） |
|---|---|---|---|
| 一/二 | 08-12~13 | ES module 雙載、CSRF 時序、401 誤判登出、深色模式原生化、觸控目標、轉義收斂 | 前端-1／2／4／5／6 |
| 三 | 08-15~16 | `lib` 納入版控、i18n 覆蓋率、無障礙補完、對比度全清 | 前端-9 |
| 四 | 08-16 | 語言持久化、`<html lang>`、RWD 溢位、i18n 第二戰場（JS 動態字串）、技術債 | 前端-9／10 |
| 五 | 08-24 | 後端訊息代碼化、`Accounts` 排除全量覆寫、語意色類別 | 前端-8 |
| 六 | 08-24 | `t()` 包了沒補字典、原生 `alert` 清除、趨勢圖 | 前端-6／9 |
| 七 | 08-24 | **權限提升（P0）**、委派管理主從關係、兩條登入路徑的 claims | §3 的三方一致／委派主從 |
| 八 | 08-24 | 落點必須「打得開」、動態 a11y 名稱、Modal 焦點、DataTables aria 累加、batch 全有全無、狀態機在後端 | 第 14~20 條 |
| 九 | 08-24 | `#bc-name` 的 `data-i18n` 陷阱、innerHTML 漏 `escHtml`、後端中文字面值 | 前端-5／9 |

> 每一輪的驗收方式都是「靜態驗收腳本 + `dotnet run` 實機操作」，不是只看程式碼推論。
> 第七輪以 4 種權限層級（admin／委派管理者／一般 user／無權限）逐一實機模擬；第八輪 `RequestsController` 狀態機做了兩輪自我測試（測完 DB 已完整還原）。

---

## 4. 踩過的坑（會再犯的那種）

- **🔴 `${t(...)}` 寫進單引號字串 = 整站掛掉**：不只是「原字輸出」——`t('key'` 的那個 `'` 會提前收尾字串 → 裸識別字 → **`SyntaxError`** → 整張 ES module import 圖不執行 → 全站停在初始遮罩。**`dotnet build` / `dotnet test` 完全驗不到。** 批次改前端字串後，一律把 20 支模組複製成 `.mjs` 跑 `node --check`（必須 0 fail）再 commit。同款事故也發生過在「加字典漏一個逗號」。
- **模組雙載陷阱（已修，勿回退）**：`?v=` 不一致會讓同檔載成兩個模組實例。專案內大量 idempotent 防護（`__alertState`、`dataset.bound`、`safeDestroyDataTable`、`_autoLoginInProgress`）都是當年雙載症狀的**對症貼布** —— 根因已消除，**未來勿再為「疑似重複執行」加新貼布**，先確認 `CLAUDE.md` §4-前端-4 是否被破壞。
- **「首發 POST 400」不要往金鑰輪換猜**：真正的根因是 `_csrfToken` 的初始化時序（暖重整不走 `tryAutoLogin` → token 全程 null）。當年那個錯誤研判害這個 bug 掛了很久。
- **同一個症狀可能有兩個獨立成因**：「MenuClick 記兩次」既是模組雙載、**也是** `initDashboardUI → switchLayoutMode` 重複導航。靠實機 Network 紀錄才抓到第二個 —— **不要只看程式碼推論就宣告修好**。
- **快取一致性邊界**：Raw ADO.NET 寫入路徑不經 EF tracking → `CacheInvalidationInterceptor` 攔不到，**必須手動呼叫 `InvalidateInitialDataCache()`**。
- **量測顏色前必先關掉 CSS transition**：`variables.css:92` 的 `body { transition: … }` 在「視窗未顯示 / 不 compositing」的環境**不會推進**，`getComputedStyle` 一直讀到過渡起始值（曾誤判「切主題後沒變色、對比只有 1.05」）。先注入 `*,*::before,*::after{transition:none!important;animation:none!important}` 再量。
- **掃 HTML 文字節點請用 DOM 走訪、不要用正則**：`<div><i …></i>提示：…</div>` 這種「巢狀元素之後的裸文字」正則掃不到（曾因此漏 37 處）。批次改 HTML 的正則若用 `[\s\S]*?` 當內文**會跨越結束標籤配對到不相干的元素**（曾產生 7 個指向錯誤控制項的 `for=`）→ 內文一律寫 `((?!<\/tag>)[\s\S])*` 並複驗。
- **CSS 驗收要連註解配對一起檢查**：曾把說明寫在 `*/` 之後又補一個 `*/` → 解析器直接吃掉整條規則，量測才發現。腳本需檢查 `/*` 與 `*/` 數量相等、且去註解後無殘留 `*/`。
- **判斷「某欄位會不會被 SaveData 洗掉」不能只看 `TableNames`**：`SaveDataAsync` 主迴圈第一行就是 `if (accountScopedTables.Contains(tableName)) continue;` —— 必須確認該表**真的會進入 DELETE/INSERT 迴圈**（第九輪 L2 就是這樣誤報的）。
- 💡 **本機可直接查線上 DB 驗證 schema**：`sqlcmd` 在 `C:\Program Files\Microsoft SQL Server\Client SDK\ODBC\170\Tools\Binn\`，連線資訊從 `appsettings.json` 取。⚠️ 用 PowerShell 讀它必須 `[System.IO.File]::ReadAllText(path, [Text.Encoding]::UTF8)` —— 直接 `Get-Content` 會以 ANSI 解讀，中文註解變亂碼、`ConvertFrom-Json` 解析失敗（還會順帶把明碼密碼印到 console）。

---

## 5. Decisions (架構與產品決策)

### 部署與登入

- **企業 IIS 政策封鎖「手動登入 + LDAP」這條路（2026-08-25 使用者定案）**：`Auth:AllowManualLogin` / `Auth:Ldap` 雖然程式面完整可用（`AuthService.VerifyLdapPasswordAsync`、`AuthController.Login`），但**內網 IIS 環境不允許啟用**。
  **→ 任何「開手動登入／LDAP」的建議都不要再提**；需要非 Windows 身分的情境請改走其他方案。
- **Windows 靜默登入（不跳帳密視窗）只有「用戶端信任站台」一條路**：Negotiate 的 401 挑戰是協定必要步驟，伺服器端無法迴避；瀏覽器只在信任的站台才會靜默回應。
  - 全廠做法：請 IT 推 Edge/Chrome 原則 **`AuthServerAllowlist`**（`HKLM\SOFTWARE\Policies\Microsoft\Edge\AuthServerAllowlist`），比改「網際網路選項」實際；或走 Site to Zone Assignment List（副作用較大）。
  - 💡 **可能免 GPO 的捷徑**：若 IT 已把 `*.umc.com` 之類後綴列入信任，替這台機器加一個該網域下的 DNS 別名即可**繼承既有信任**。
  - ⚠️ **單一標籤主機名（`http://p58esiap12`，不含點）本來就會被自動歸類為近端內部網路** —— 若仍跳視窗，先查「自動偵測內部網路」是否被 GPO 關掉、區域的「登入」是否被設成「提示輸入使用者名稱及密碼」、以及實際用的是不是 FQDN／IP。
- **⚠️ 靜默登入與「投影機上換帳號」互相衝突**：Windows 整合驗證**沒有帳號選擇器**，靜默後 Edge 只會送當下 Windows 工作階段的身分。而 `AllowManualLogin=false` 時 `auth.js:101` 會清掉登出旗標 → 登出後一重整又被自動登入回去。
  可行替代（**不含已被封鎖的手動登入/LDAP**）：① **`runas /netonly` 開一個獨立 Edge**（`--user-data-dir` 必加，否則被既有行程接管）② GPO 分範圍套用、把會議室/投影機那幾台排除 ③ 開發「以其他使用者身分檢視」(admin-only impersonation)。
  ❌ **絕不可用 `SimulatedAccount` 做這件事** —— 它是全域設定，一改就是全廠所有人都變成那個帳號，且 `OnValidatePrincipal` 會作廢所有人的 cookie。
- **登入不因時間過期（企業內網政策，2026-08-16 定案）**：`Auth:SessionDays` 預設 3650 天 + `SlidingExpiration`。**存續期間的唯一事實來源是 `Program.cs` 的 `options.ExpireTimeSpan`**，`SignInAsync` 嚴禁再設 `ExpiresUtc`（歷史坑：兩處寫死 `AddHours(12)` 讓前者形同虛設）。
  ⚠️ **與 session 長度無關的登出成因（別誤判）**：清掉 `App_Data/keys`、改 `Auth:SimulatedAccount`（`OnValidatePrincipal` 會 `SignOutAsync`）、使用者自己按登出。前兩者設多長的 `SessionDays` 都救不了。

### 版控

- **唯一的事實來源是 `EQDashboard.V2.Web` 這個 repo**（remote `github.com/lousyqq/EQDashboard.V2.Web`）。外層 `EQDashboard` repo 只是本機工作區容器，**刻意不維護**：它把內層記成 gitlink（mode 160000）卻沒有 `.gitmodules`、gitlink 也長期落後。**不要當 submodule 處理、也不要為此新增 `.gitmodules`。**
- **行尾字元（CRLF/LF）不處理 — 2026-08-13 明確決定不修**：純 review 可讀性問題、對執行期零影響，且有零風險的規避方式。
  ⚠️ 已知 `.gitattributes` 加 `* -text` 這條路是**錯的**（實測雜訊從 3604 暴增到 23380 行，方向相反），別重試。
  **要 review 時用 `git diff --ignore-cr-at-eol`**，或 `git config diff.renormalize true`（只影響顯示）。
- **第三方資產全部自 host 於 `wwwroot/lib` 且納入版控**，`.gitignore` 刻意沒有 `wwwroot/lib/` 這條。詳見 `CLAUDE.md` §4 第 23 條。

### 產品與架構

- **禁止全域模糊搜尋 UI**：企業用戶已習慣結構化模組導航。相關程式碼已於 2026-08-12 完整移除。
  ⚠️ **勿再「只加一半」** —— 先前是「HTML 入口撤掉、JS/CSS/i18n 全留著」，害後續有人在死碼上繼續加功能卻永遠跑不到。若日後要恢復，請一次做完入口 + 邏輯，並優先放在「看板網頁管理」表格搜尋這類結構化位置。
- **不做 Keywords / Description 搜尋**：基於整體設計理念，確認不適合針對這兩個欄位做模糊搜尋，維持結構化與精確比對機制。（欄位保留作為未來擴充彈性，目前是「只寫不讀」。）
- **不採用全站系統公告 (System Broadcasts)**：使用者屬性差異大，全站公告容易變成雜訊、干擾體驗。
- **不實作統計與操作紀錄匯出**：未來資料的年度與量級都很高，由前端匯出全部資料做報表並不適合；若有大量報表需求，應由更專業的報表管理工具處理。
- **無 EF Migrations**：為相容現有資料庫環境，所有 Schema 變更一律由 `SchemaBootstrap.cs` 以 `IF NOT EXISTS` 冪等 T-SQL 自我修復。
- **分頁策略**：`Accounts` 因數量龐大（可達十萬級）強制 `serverSide: true` + 後端分頁；其餘設定表資料量小，一律一次拉回前端做 client-side 分頁與搜尋。
- **權限與關聯寫入策略（先刪後寫）**：更新複合 PK 的關聯表（如 `Map_Role_Menu`）時，因 EF Identity Map 追蹤限制，一律 `RemoveRange` + `SaveChanges` 後再 `Add` + `SaveChanges` 兩階段寫入。
- **`inferred` 建立日期只套用在「從未被點擊」的看板**：被點過的看板本來就有「最後點擊時間」這個更有用的訊號，而受 `ClickDate >= cutoffDate` 限制的 `Min` 不是真正的最早日。**舊資料的 `CreatedAt` NULL 不可用推估值寫回漂白**，否則真殭屍會被洗白。
