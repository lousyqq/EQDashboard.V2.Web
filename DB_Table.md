# EQDashboardV2 資料庫 Table 架構檔 (DB_Table.md)

> 本檔為 **EQDashboardV2** 資料庫的現況快照（CREATE TABLE 全量腳本），供在其他主機上「建立／更新」資料表結構使用。
> **資料來源**：本檔第 2 節 CREATE TABLE 快照（19 張表）＋ `Services/SchemaBootstrap.cs`（自動補表/補欄位與全部索引）＋對線上 `EQDashboardV2` 實際結構逐表驗證（欄位/型別/PK/FK/索引/定序）。（原始參考腳本 `sql/schema_v2.sql` 已自專案移除，本檔即為建表唯一快照。）
> **若專案任何變動動到 DB 架構（新增/修改表、欄位、索引、FK），務必同步更新本檔。**

---

## 0. 使用說明（在另一台主機更新結構）

1. **定序（Collation）**：來源資料庫定序為 `Chinese_Taiwan_Stroke_CI_AS`（**大小寫不敏感 CI**）。應用程式倚賴 PK 的 CI 比對（搭配程式內 `OrdinalIgnoreCase`），請在**目標主機建立資料庫時採用同一個（或其他 CI）定序**，勿用 CS（大小寫敏感）定序，否則 EmpId/MenuId 等主鍵比對行為會改變。

   ```sql
   CREATE DATABASE EQDashboardV2
       COLLATE Chinese_Taiwan_Stroke_CI_AS;
   GO
   USE EQDashboardV2;
   GO
   ```

2. **執行順序**：本檔已依 **FK 相依順序**排好 —— 先建父表（`Accounts` / `Menus` / `Fabs` / `Roles`），再建關聯表，最後 `UserActivityLogs`。直接由上而下執行即可。

3. **等冪（idempotent）**：每個 `CREATE TABLE` 都包了 `IF OBJECT_ID(...) IS NULL`，索引用 `IF NOT EXISTS (sys.indexes)`，故**可重複執行**、只補缺、不覆蓋既有表。
   - 本檔**只建結構、不刪表、不改既有欄位**。若既有表「缺欄位」需補，請另以 `IF COL_LENGTH(...) IS NULL ALTER TABLE` 處理（與專案 `SchemaBootstrap` 同策略），本檔不負責 ALTER。

4. **與專案啟動自我修復的關係**：正式專案啟動時 `SchemaBootstrap` 會 idempotent 補表/補欄位/補索引，故「跑專案」本身即可長出結構。本檔用途是**離線/手動**在無法啟動專案的主機上重建結構，或做結構對照基準。

---

## 1. 表清單（共 20 張）

| 類別 | 表 | PK |
| --- | --- | --- |
| 實體 | `Accounts` | EmpId |
| 實體 | `Menus` | MenuId |
| 實體 | `Fabs` | FabId |
| 實體 | `Roles` | RoleId |
| 實體 | `Apps` | AppId |
| 實體 | `Requests` | RequestId |
| 實體 | `PersonalSettings` | (EmpId, MenuId) |
| 關聯 | `Map_Fab_Role` | (FabId, RoleId) |
| 關聯 | `Map_Role_Menu` | (RoleId, MenuId) |
| 關聯 | `Map_Menu_Structure` | (ParentMenuId, ChildMenuId) |
| 關聯 | `Map_Account_Role` | (EmpId, RoleId) |
| 關聯 | `Map_Account_ManageMenu` | (EmpId, MenuId) |
| 關聯 | `Map_Account_DefaultPage` | (EmpId, FabId) |
| 關聯/ACL | `Map_Account_ExtraMenu` | (EmpId, FabId, MenuId) ＋FK(EmpId/MenuId) |
| 關聯/ACL | `Map_Account_DenyMenu` | (EmpId, FabId, MenuId) ＋FK(EmpId/MenuId) |
| 關聯/ACL | `Map_Menu_AllowAccount` | (MenuId, EmpId) ＋FK |
| 關聯/ACL | `Map_Menu_DenyAccount` | (MenuId, EmpId) ＋FK |
| 稽核 | `UserActivityLogs` | LogId (IDENTITY) |
| 統計 | `DailyUserVisits` | (VisitDate, EmpId) |
| 統計 | `DailyMenuClicks` | (ClickDate, MenuId, EmpId) |

> **FK 現況**：線上資料庫中**只有 4 張 override/ACL 表**（`Map_Account_ExtraMenu` / `Map_Account_DenyMenu` / `Map_Menu_AllowAccount` / `Map_Menu_DenyAccount`）帶 FK 約束；其餘 6 張關聯表與 `Map_Menu_Structure` **無 FK**（靠應用層維持參照完整性）。
> **per-fab 覆寫（綁廠區）**：`Map_Account_ExtraMenu` / `Map_Account_DenyMenu` 的 PK 為 `(EmpId, FabId, MenuId)` —— `FabId` 表示「此額外開放/封鎖只在哪個廠區生效」。`FabId` **刻意不加 FK 到 Fabs**（避免 Account/Menu/Fab 多重 cascade 路徑衝突，且讓舊資料遷移列 `FabId=''` 能存活）；FK 仍只在 EmpId→Accounts(CASCADE) 與 MenuId→Menus。舊版「帳號全域」資料經 `SchemaBootstrap` 補欄位時 `FabId` 補預設 `''`（inert，不對應任何真實廠區），下次存帳號時被 RemoveRange→per-fab 重寫清掉。

---

## 2. CREATE TABLE 腳本

```sql
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

/* =========================================================
   父表（被 FK 參照者）：Accounts / Menus / Fabs / Roles
   ========================================================= */

IF OBJECT_ID(N'dbo.Accounts', N'U') IS NULL
CREATE TABLE dbo.Accounts (
    EmpId         NVARCHAR(50)  NOT NULL,
    Name          NVARCHAR(100) NULL,
    Department    NVARCHAR(100) NULL,
    RoleLevel     NVARCHAR(20)  NULL,
    CanEditOthers BIT           NULL,
    LoginCount    INT           NULL,
    LastLoginTime DATETIME      NULL,
    Preferences   NVARCHAR(MAX) NULL,
    CONSTRAINT PK_Accounts PRIMARY KEY (EmpId)
);
GO

IF OBJECT_ID(N'dbo.Menus', N'U') IS NULL
CREATE TABLE dbo.Menus (
    MenuId      NVARCHAR(50)  NOT NULL,
    SysName     NVARCHAR(100) NULL,
    DisplayName NVARCHAR(100) NULL,
    MenuMode    NVARCHAR(20)  NULL,
    Url         NVARCHAR(MAX) NULL,
    TargetPage  NVARCHAR(100) NULL,
    OpenTarget  NVARCHAR(20)  NULL,
    Icon        NVARCHAR(MAX) NULL,
    CreatedBy   NVARCHAR(50)  NULL,
    IsEnabled   BIT           NULL,
    IsPoolItem  BIT           NULL,
    IsEdited    BIT           NULL,
    GlobalOrder INT           NULL,
    CreatedAt   DATETIME2     NULL,
    Description NVARCHAR(255) NULL,
    Keywords    NVARCHAR(255) NULL,
    CONSTRAINT PK_Menus PRIMARY KEY (MenuId)
);
GO

IF OBJECT_ID(N'dbo.Fabs', N'U') IS NULL
CREATE TABLE dbo.Fabs (
    FabId       NVARCHAR(50)  NOT NULL,
    FabName     NVARCHAR(50)  NULL,
    DisplayName NVARCHAR(100) NULL,
    DefaultLang NVARCHAR(10)  NULL,
    CONSTRAINT PK_Fabs PRIMARY KEY (FabId)
);
GO

IF OBJECT_ID(N'dbo.Roles', N'U') IS NULL
CREATE TABLE dbo.Roles (
    RoleId    NVARCHAR(50)  NOT NULL,
    GroupName NVARCHAR(100) NULL,
    CONSTRAINT PK_Roles PRIMARY KEY (RoleId)
);
GO

/* =========================================================
   其餘實體表：Apps / Requests / PersonalSettings
   ========================================================= */

IF OBJECT_ID(N'dbo.Apps', N'U') IS NULL
CREATE TABLE dbo.Apps (
    AppId      NVARCHAR(50)  NOT NULL,
    MenuId     NVARCHAR(50)  NULL,
    AppName    NVARCHAR(100) NULL,
    Url        NVARCHAR(MAX) NULL,
    IconBase64 VARCHAR(MAX)  NULL,   -- 欄名沿用舊稱，內容實為圖示路徑字串
    Target     NVARCHAR(20)  NULL,
    CONSTRAINT PK_Apps PRIMARY KEY (AppId)
);
GO

IF OBJECT_ID(N'dbo.Requests', N'U') IS NULL
CREATE TABLE dbo.Requests (
    RequestId      NVARCHAR(50)  NOT NULL,
    EmpId          NVARCHAR(50)  NULL,
    EmpName        NVARCHAR(100) NULL,
    Reason         NVARCHAR(MAX) NULL,
    Timestamp      BIGINT        NULL,
    Status         NVARCHAR(20)  NULL,
    WithdrawReason NVARCHAR(MAX) NULL,
    Reply          NVARCHAR(MAX) NULL,
    ReqType        NVARCHAR(50)  NULL,
    Fab            NVARCHAR(50)  NULL,
    CONSTRAINT PK_Requests PRIMARY KEY (RequestId)
);
GO

IF OBJECT_ID(N'dbo.PersonalSettings', N'U') IS NULL
CREATE TABLE dbo.PersonalSettings (
    EmpId      NVARCHAR(50) NOT NULL,
    MenuId     NVARCHAR(50) NOT NULL,
    IsHidden   BIT          NULL,
    IsFavorite BIT          NULL,
    OpenTarget NVARCHAR(20) NULL,
    Icon       NVARCHAR(MAX) NULL,
    SortOrder  INT          NULL,
    CONSTRAINT PK_PersonalSettings PRIMARY KEY (EmpId, MenuId)
);
GO

/* =========================================================
   關聯表（無 FK）
   ========================================================= */

IF OBJECT_ID(N'dbo.Map_Fab_Role', N'U') IS NULL
CREATE TABLE dbo.Map_Fab_Role (
    FabId  NVARCHAR(50) NOT NULL,
    RoleId NVARCHAR(50) NOT NULL,
    CONSTRAINT PK_Map_Fab_Role PRIMARY KEY (FabId, RoleId)
);
GO

IF OBJECT_ID(N'dbo.Map_Role_Menu', N'U') IS NULL
CREATE TABLE dbo.Map_Role_Menu (
    RoleId    NVARCHAR(50) NOT NULL,
    MenuId    NVARCHAR(50) NOT NULL,
    SortOrder INT          NULL,
    CONSTRAINT PK_Map_Role_Menu PRIMARY KEY (RoleId, MenuId)
);
GO

IF OBJECT_ID(N'dbo.Map_Menu_Structure', N'U') IS NULL
CREATE TABLE dbo.Map_Menu_Structure (
    ParentMenuId NVARCHAR(50) NOT NULL,
    ChildMenuId  NVARCHAR(50) NOT NULL,
    SortOrder    INT          NULL,
    CONSTRAINT PK_Map_Menu_Structure PRIMARY KEY (ParentMenuId, ChildMenuId)
);
GO

IF OBJECT_ID(N'dbo.Map_Account_Role', N'U') IS NULL
CREATE TABLE dbo.Map_Account_Role (
    EmpId  NVARCHAR(50) NOT NULL,
    RoleId NVARCHAR(50) NOT NULL,
    CONSTRAINT PK_Map_Account_Role PRIMARY KEY (EmpId, RoleId)
);
GO

IF OBJECT_ID(N'dbo.Map_Account_ManageMenu', N'U') IS NULL
CREATE TABLE dbo.Map_Account_ManageMenu (
    EmpId  NVARCHAR(50) NOT NULL,
    MenuId NVARCHAR(50) NOT NULL,
    CONSTRAINT PK_Map_Account_ManageMenu PRIMARY KEY (EmpId, MenuId)
);
GO

IF OBJECT_ID(N'dbo.Map_Account_DefaultPage', N'U') IS NULL
CREATE TABLE dbo.Map_Account_DefaultPage (
    EmpId  NVARCHAR(50) NOT NULL,
    FabId  NVARCHAR(50) NOT NULL,
    MenuId NVARCHAR(50) NULL,
    CONSTRAINT PK_Map_Account_DefaultPage PRIMARY KEY (EmpId, FabId)
);
GO

/* =========================================================
   override / ACL 表（帶 FK；須在 Accounts、Menus 之後建立）
   FK 規則：EmpId -> Accounts(EmpId) ON DELETE CASCADE
            MenuId -> Menus(MenuId)  ON DELETE NO ACTION
   （兩條 FK 不可同時 CASCADE，避免多重串聯路徑）
   ─ per-fab 覆寫：Extra/Deny 兩表 PK 含 FabId（綁廠區），表示此額外開放/封鎖
     只在該廠區生效。FabId 為一般欄位、刻意不加 FK 到 Fabs（避免 Account/Menu/Fab
     多重 cascade 路徑衝突，且讓遷移列 FabId='' 存活）；DEFAULT('') 供舊資料補欄位。
   ========================================================= */

IF OBJECT_ID(N'dbo.Map_Account_ExtraMenu', N'U') IS NULL
CREATE TABLE dbo.Map_Account_ExtraMenu (
    EmpId  NVARCHAR(50) NOT NULL,
    FabId  NVARCHAR(50) NOT NULL CONSTRAINT DF_Map_Account_ExtraMenu_FabId DEFAULT(''),
    MenuId NVARCHAR(50) NOT NULL,
    CONSTRAINT PK_Map_Account_ExtraMenu PRIMARY KEY (EmpId, FabId, MenuId),
    CONSTRAINT FK_Map_Account_ExtraMenu_Acc
        FOREIGN KEY (EmpId)  REFERENCES dbo.Accounts(EmpId) ON DELETE CASCADE,
    CONSTRAINT FK_Map_Account_ExtraMenu_Mnu
        FOREIGN KEY (MenuId) REFERENCES dbo.Menus(MenuId)
);
GO

IF OBJECT_ID(N'dbo.Map_Account_DenyMenu', N'U') IS NULL
CREATE TABLE dbo.Map_Account_DenyMenu (
    EmpId  NVARCHAR(50) NOT NULL,
    FabId  NVARCHAR(50) NOT NULL CONSTRAINT DF_Map_Account_DenyMenu_FabId DEFAULT(''),
    MenuId NVARCHAR(50) NOT NULL,
    CONSTRAINT PK_Map_Account_DenyMenu PRIMARY KEY (EmpId, FabId, MenuId),
    CONSTRAINT FK_Map_Account_DenyMenu_Acc
        FOREIGN KEY (EmpId)  REFERENCES dbo.Accounts(EmpId) ON DELETE CASCADE,
    CONSTRAINT FK_Map_Account_DenyMenu_Mnu
        FOREIGN KEY (MenuId) REFERENCES dbo.Menus(MenuId)
);
GO

IF OBJECT_ID(N'dbo.Map_Menu_AllowAccount', N'U') IS NULL
CREATE TABLE dbo.Map_Menu_AllowAccount (
    MenuId NVARCHAR(50) NOT NULL,
    EmpId  NVARCHAR(50) NOT NULL,
    CONSTRAINT PK_Map_Menu_AllowAccount PRIMARY KEY (MenuId, EmpId),
    CONSTRAINT FK_Map_Menu_AllowAccount_Menu
        FOREIGN KEY (MenuId) REFERENCES dbo.Menus(MenuId),
    CONSTRAINT FK_Map_Menu_AllowAccount_Acc
        FOREIGN KEY (EmpId)  REFERENCES dbo.Accounts(EmpId) ON DELETE CASCADE
);
GO

IF OBJECT_ID(N'dbo.Map_Menu_DenyAccount', N'U') IS NULL
CREATE TABLE dbo.Map_Menu_DenyAccount (
    MenuId NVARCHAR(50) NOT NULL,
    EmpId  NVARCHAR(50) NOT NULL,
    CONSTRAINT PK_Map_Menu_DenyAccount PRIMARY KEY (MenuId, EmpId),
    CONSTRAINT FK_Map_Menu_DenyAccount_Menu
        FOREIGN KEY (MenuId) REFERENCES dbo.Menus(MenuId),
    CONSTRAINT FK_Map_Menu_DenyAccount_Acc
        FOREIGN KEY (EmpId)  REFERENCES dbo.Accounts(EmpId) ON DELETE CASCADE
);
GO

/* =========================================================
   稽核表：UserActivityLogs（LogId 為 IDENTITY 主鍵）
   ========================================================= */

IF OBJECT_ID(N'dbo.UserActivityLogs', N'U') IS NULL
CREATE TABLE dbo.UserActivityLogs (
    LogId        BIGINT IDENTITY(1,1) NOT NULL,
    Timestamp    DATETIME2     NOT NULL,
    EmpId        NVARCHAR(50)  NULL,
    EmpName      NVARCHAR(100) NULL,
    LoginSource  NVARCHAR(20)  NULL,
    IpAddress    NVARCHAR(45)  NULL,
    UserAgent    NVARCHAR(500) NULL,
    HttpMethod   NVARCHAR(10)  NULL,
    Path         NVARCHAR(500) NULL,
    QueryString  NVARCHAR(500) NULL,
    StatusCode   INT           NULL,
    DurationMs   INT           NULL,
    Category     NVARCHAR(50)  NULL,
    Action       NVARCHAR(100) NULL,
    TargetType   NVARCHAR(50)  NULL,
    TargetId     NVARCHAR(100) NULL,
    Detail       NVARCHAR(MAX) NULL,
    IsSuccess    BIT           NULL,
    ErrorMessage NVARCHAR(500) NULL,
    CONSTRAINT PK_UserActivityLogs PRIMARY KEY (LogId)
);
GO

/* =========================================================
   2.3 統計分析表 (Analytics)
   ========================================================= */

IF OBJECT_ID(N'dbo.DailyUserVisits', N'U') IS NULL
CREATE TABLE dbo.DailyUserVisits (
    VisitDate      DATE          NOT NULL,
    EmpId          NVARCHAR(50)  NOT NULL,
    EmpName        NVARCHAR(100) NULL,
    Department     NVARCHAR(100) NULL,
    VisitCount     INT           NOT NULL DEFAULT 1,
    FirstVisitTime DATETIME2     NOT NULL,
    LastVisitTime  DATETIME2     NOT NULL,
    CONSTRAINT PK_DailyUserVisits PRIMARY KEY (VisitDate, EmpId)
);
GO

IF OBJECT_ID(N'dbo.DailyMenuClicks', N'U') IS NULL
CREATE TABLE dbo.DailyMenuClicks (
    ClickDate      DATE          NOT NULL,
    MenuId         NVARCHAR(50)  NOT NULL,
    EmpId          NVARCHAR(50)  NOT NULL,
    ClickCount     INT           NOT NULL CONSTRAINT DF_DailyMenuClicks_ClickCount DEFAULT 1,
    FirstClickTime DATETIME2     NOT NULL,
    LastClickTime  DATETIME2     NOT NULL,
    CONSTRAINT PK_DailyMenuClicks PRIMARY KEY (ClickDate, MenuId, EmpId)
);
GO
```

---

## 3. 非主鍵索引（對齊 `SchemaBootstrap.EnsureIndexesAsync`）

> 索引的唯一事實來源是 `Services/SchemaBootstrap.cs` 的 `EnsureIndexesAsync`（專案啟動時 idempotent 建立）。以下為**手動重建**時等價腳本。

```sql
/* Accounts：依角色等級過濾 */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Accounts_RoleLevel' AND object_id = OBJECT_ID(N'dbo.Accounts'))
    CREATE NONCLUSTERED INDEX IX_Accounts_RoleLevel ON dbo.Accounts (RoleLevel);
GO

/* Accounts：帳號清單搜尋 (GetAccountsPagedAsync 的 q 對 EmpId/Name/Department 做 LIKE '%term%') 的窄覆蓋索引。
   子字串 LIKE 前置萬用字元本質 non-sargable、必掃描；此索引讓掃描改讀瘦索引而非寬主表，
   葉層自動含 clustered key EmpId 作 row locator → COUNT(*) 的三欄 OR-of-LIKE 完全被涵蓋免回主表。 */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Accounts_Search' AND object_id = OBJECT_ID(N'dbo.Accounts'))
    CREATE NONCLUSTERED INDEX IX_Accounts_Search ON dbo.Accounts (Name, Department);
GO

/* Requests：依狀態過濾 */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Requests_Status' AND object_id = OBJECT_ID(N'dbo.Requests'))
    CREATE NONCLUSTERED INDEX IX_Requests_Status ON dbo.Requests (Status);
GO

/* UserActivityLogs：時間倒序、人員+時間、分類+時間 */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_UserActivityLogs_Timestamp' AND object_id = OBJECT_ID(N'dbo.UserActivityLogs'))
    CREATE NONCLUSTERED INDEX IX_UserActivityLogs_Timestamp ON dbo.UserActivityLogs (Timestamp DESC);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_UserActivityLogs_EmpId_Timestamp' AND object_id = OBJECT_ID(N'dbo.UserActivityLogs'))
    CREATE NONCLUSTERED INDEX IX_UserActivityLogs_EmpId_Timestamp ON dbo.UserActivityLogs (EmpId, Timestamp DESC);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_UserActivityLogs_Category_Time' AND object_id = OBJECT_ID(N'dbo.UserActivityLogs'))
    CREATE NONCLUSTERED INDEX IX_UserActivityLogs_Category_Time ON dbo.UserActivityLogs (Category, Timestamp DESC);
GO

/* Menu ACL：以 EmpId 做 index seek（可見性查詢） */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Map_Menu_AllowAccount_EmpId' AND object_id = OBJECT_ID(N'dbo.Map_Menu_AllowAccount'))
    CREATE NONCLUSTERED INDEX IX_Map_Menu_AllowAccount_EmpId ON dbo.Map_Menu_AllowAccount (EmpId);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Map_Menu_DenyAccount_EmpId' AND object_id = OBJECT_ID(N'dbo.Map_Menu_DenyAccount'))
    CREATE NONCLUSTERED INDEX IX_Map_Menu_DenyAccount_EmpId ON dbo.Map_Menu_DenyAccount (EmpId);
GO

/* DailyUserVisits：以日期與部門組合查詢 (AnalyticsController.GetUsageStats) */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_DailyUserVisits_Date_Dept' AND object_id = OBJECT_ID(N'dbo.DailyUserVisits'))
    CREATE NONCLUSTERED INDEX IX_DailyUserVisits_Date_Dept ON dbo.DailyUserVisits (VisitDate, Department);
GO

/* DailyMenuClicks：以日期與看板組合查詢 */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_DailyMenuClicks_Date_MenuId' AND object_id = OBJECT_ID(N'dbo.DailyMenuClicks'))
    CREATE NONCLUSTERED INDEX IX_DailyMenuClicks_Date_MenuId ON dbo.DailyMenuClicks (ClickDate, MenuId);
GO
```

---

## 4. 變動同步提醒

- 本檔須與下列來源保持一致，任一處改動 DB 結構即同步本檔：
  - `Services/SchemaBootstrap.cs`（自動補表/補欄位、`UserActivityLogs`、`DailyUserVisits`、`EnsureIndexesAsync` 全部索引）
  - 方案根目錄 `sql\` 之增量異動腳本（與本檔第 5 節 Changelog 一一對應）
  - `Data/Configurations/*`（EF 對應；注意 `HasIndex` 對線上 DB 為 no-op，索引以 SchemaBootstrap 為準）
- 欄名 `Apps.IconBase64` / `Menus.Icon` 內容已是「圖示路徑字串」（`/images/icons/{guid}.{ext}`），非 base64；欄名為相容舊資料保留。
- `Map_Menu_Structure` 在線上 DB **無 FK**（CLAUDE.md 所述 "Restrict FK" 為 EF 設計意圖、未實際套用），本檔比照線上現況不建 FK。

---

## 5. 架構異動與增量 SQL 紀錄 (Schema Changelog)

> **使用說明**：為方便判定遠端主機資料庫是否已同步最新結構，日後只要有任何資料庫架構變更（新增/修改 Table、欄位、索引等），**AI 助手（Gemini / Claude）必會在下方依日期 (`YYYY-MM-DD`) 順序往下追加紀錄**，同時標示對應的 SQL 異動腳本檔名與摘要。您可以依據最後執行日期對照此列表，決定要同步執行哪些增量 SQL。

- **2026-07-13 [基準檢核]**：經連線至線上 SQL Server (`EQDashboardV2`) 對全庫 18 張表、92 欄位、主外鍵及 8 個非主鍵索引進行完整比對，確認線上實體 DB 與本文件及 `SchemaBootstrap.cs` 100% 完全一致。
- **2026-07-18 [新增每日活躍造訪統計表]** (`sql/2026-07-18_Add_DailyUserVisits.sql`)：新增 `DailyUserVisits` 實體表與對應索引 (`IX_DailyUserVisits_Date_Dept`)，作為全站每日活躍訪客 (DAU)、月度活躍訪客 (MAU) 與各廠區/部門比率統計使用；已同步於 `SchemaBootstrap.cs` 自動冪等建立。
- **2026-07-19 [文件整理檢核，無架構異動]**：本次僅文件整理、**無任何資料庫結構變更、無需執行任何 SQL**。同步修正本檔快照區：表清單補列 `DailyUserVisits`（總表數 18→19，2026-07-18 已建者），並更新已移除之 `sql/schema_v2.sql` 來源參照（本檔第 2 節即為建表唯一快照）。
- **2026-07-30 [新增每日看板點擊統計表]** (`sql/2026-07-30_Add_DailyMenuClicks.sql`)：新增 `DailyMenuClicks` 實體表與對應索引 (`IX_DailyMenuClicks_Date_MenuId`)，同步修正本檔快照區表清單總表數 19→20。
- **2026-08-09 [新增我的最愛功能欄位]** (`sql/2026-08-09_Add_PersonalSettings_IsFavorite.sql`)：於 `PersonalSettings` 表新增 `IsFavorite` 欄位供釘選常用看板功能使用，已同步於 `SchemaBootstrap.cs` 自動冪等建立。
- **2026-08-09 [新增帳號偏好設定欄位]** (`sql/2026-08-09_Add_Accounts_Preferences.sql`)：於 `Accounts` 表新增 `Preferences` 欄位供存放跨裝置同步之個人化設定 (如最近瀏覽紀錄 JSON)，已同步於 `SchemaBootstrap.cs` 自動冪等建立。
- **2026-08-11 [新增看板 Metadata 欄位]** (`sql/2026-08-11_Add_Menus_Metadata.sql`)：於 `Menus` 表新增 `CreatedAt`、`Description`、`Keywords` 欄位供過濾殭屍看板與優化搜尋體驗使用，已同步於 `SchemaBootstrap.cs` 自動冪等建立。
- **2026-08-16 [資料修正：清除 Department 內的角色名稱污染]** (`sql/2026-08-16_Fix_Account_Department_RoleNamePollution.sql`)：**無 Schema 變更，純資料清理**。`AuthController` 四個自動建帳分支在查不到部門時，曾把角色名稱（`一般使用者` / `系統管理員`）當成部門寫入 `Accounts.Department`，並經 `UpdateLoginStats` 抄進 `DailyUserVisits.Department` → 「各部門活躍比率」報表長出不存在的部門。程式面已於同日改為「查不到就留 `NULL`」；本腳本把既有的兩表髒資料一併改回 `NULL`（冪等，含稽核與驗收查詢）。⚠️ 此腳本**不在** `SchemaBootstrap` 的冪等修復範圍內（它只補表/欄位/索引，不做資料清理），**必須手動執行一次**。
