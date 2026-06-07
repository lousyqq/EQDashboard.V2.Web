# EQDashboardV2 資料庫 Table 架構檔 (DB_Table.md)

> 本檔為 **EQDashboardV2** 資料庫的現況快照（CREATE TABLE 全量腳本），供在其他主機上「建立／更新」資料表結構使用。
> **資料來源**：`sql/schema_v2.sql`（17 張實體＋關聯表）＋ `Services/SchemaBootstrap.cs`（UserActivityLogs 與全部索引）＋對線上 `EQDashboardV2` 實際結構逐表驗證（欄位/型別/PK/FK/索引/定序）。
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

## 1. 表清單（共 18 張）

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
| 關聯/ACL | `Map_Account_ExtraMenu` | (EmpId, MenuId) ＋FK |
| 關聯/ACL | `Map_Account_DenyMenu` | (EmpId, MenuId) ＋FK |
| 關聯/ACL | `Map_Menu_AllowAccount` | (MenuId, EmpId) ＋FK |
| 關聯/ACL | `Map_Menu_DenyAccount` | (MenuId, EmpId) ＋FK |
| 稽核 | `UserActivityLogs` | LogId (IDENTITY) |

> **FK 現況**：線上資料庫中**只有 4 張 override/ACL 表**（`Map_Account_ExtraMenu` / `Map_Account_DenyMenu` / `Map_Menu_AllowAccount` / `Map_Menu_DenyAccount`）帶 FK 約束；其餘 6 張關聯表與 `Map_Menu_Structure` **無 FK**（靠應用層維持參照完整性）。

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
   ========================================================= */

IF OBJECT_ID(N'dbo.Map_Account_ExtraMenu', N'U') IS NULL
CREATE TABLE dbo.Map_Account_ExtraMenu (
    EmpId  NVARCHAR(50) NOT NULL,
    MenuId NVARCHAR(50) NOT NULL,
    CONSTRAINT PK_Map_Account_ExtraMenu PRIMARY KEY (EmpId, MenuId),
    CONSTRAINT FK_Map_Account_ExtraMenu_Acc
        FOREIGN KEY (EmpId)  REFERENCES dbo.Accounts(EmpId) ON DELETE CASCADE,
    CONSTRAINT FK_Map_Account_ExtraMenu_Mnu
        FOREIGN KEY (MenuId) REFERENCES dbo.Menus(MenuId)
);
GO

IF OBJECT_ID(N'dbo.Map_Account_DenyMenu', N'U') IS NULL
CREATE TABLE dbo.Map_Account_DenyMenu (
    EmpId  NVARCHAR(50) NOT NULL,
    MenuId NVARCHAR(50) NOT NULL,
    CONSTRAINT PK_Map_Account_DenyMenu PRIMARY KEY (EmpId, MenuId),
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
```

---

## 3. 非主鍵索引（對齊 `SchemaBootstrap.EnsureIndexesAsync`）

> 索引的唯一事實來源是 `Services/SchemaBootstrap.cs` 的 `EnsureIndexesAsync`（專案啟動時 idempotent 建立）。以下為**手動重建**時等價腳本。

```sql
/* Accounts：依角色等級過濾 */
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Accounts_RoleLevel' AND object_id = OBJECT_ID(N'dbo.Accounts'))
    CREATE NONCLUSTERED INDEX IX_Accounts_RoleLevel ON dbo.Accounts (RoleLevel);
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
```

---

## 4. 變動同步提醒

- 本檔須與下列來源保持一致，任一處改動 DB 結構即同步本檔：
  - `sql/schema_v2.sql`（實體＋關聯表 CREATE TABLE）
  - `Services/SchemaBootstrap.cs`（自動補欄位、`UserActivityLogs`、`EnsureIndexesAsync` 全部索引）
  - `Data/Configurations/*`（EF 對應；注意 `HasIndex` 對線上 DB 為 no-op，索引以 SchemaBootstrap 為準）
- 欄名 `Apps.IconBase64` / `Menus.Icon` 內容已是「圖示路徑字串」（`/images/icons/{guid}.{ext}`），非 base64；欄名為相容舊資料保留。
- `Map_Menu_Structure` 在線上 DB **無 FK**（CLAUDE.md 所述 "Restrict FK" 為 EF 設計意圖、未實際套用），本檔比照線上現況不建 FK。
