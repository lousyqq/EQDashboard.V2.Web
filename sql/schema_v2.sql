-- =====================================================================
-- schema_v2.sql
--   完整重建 EQDashboardV2 的所有資料表結構（17 張表）
--   匯出時間：2026-05-31，從 Sariel 上的 EQDashboardV2 實際 schema 反查
--
--   建表順序：父表 (Accounts/Menus/Roles/Fabs/...) 先建，再建 Map_* 子表
--             (Map_* 表對父表有 FK 限制，反過來會建不起來)
--
--   ⚠️ 執行此檔會 DROP 並重建所有表！會徹底清掉資料！
--   要保留資料的話請只取 CREATE TABLE 區塊、跳過 DROP 區塊。
-- =====================================================================

USE EQDashboardV2;
GO

SET NOCOUNT ON;
GO

-- =====================================================================
-- 1) DROP 階段：先拿掉 Map_* 子表 (有 FK)，再拿掉父表
--    用 IF EXISTS 守住、避免首次安裝時噴 "找不到物件"
-- =====================================================================

-- Map_Menu_* (FK to Accounts + Menus)
IF OBJECT_ID('dbo.Map_Menu_AllowAccount', 'U') IS NOT NULL DROP TABLE dbo.Map_Menu_AllowAccount;
IF OBJECT_ID('dbo.Map_Menu_DenyAccount',  'U') IS NOT NULL DROP TABLE dbo.Map_Menu_DenyAccount;

-- Map_Account_* (FK to Accounts + Menus + Fabs)
IF OBJECT_ID('dbo.Map_Account_DefaultPage',  'U') IS NOT NULL DROP TABLE dbo.Map_Account_DefaultPage;
IF OBJECT_ID('dbo.Map_Account_DenyMenu',     'U') IS NOT NULL DROP TABLE dbo.Map_Account_DenyMenu;
IF OBJECT_ID('dbo.Map_Account_ExtraMenu',    'U') IS NOT NULL DROP TABLE dbo.Map_Account_ExtraMenu;
IF OBJECT_ID('dbo.Map_Account_ManageMenu',   'U') IS NOT NULL DROP TABLE dbo.Map_Account_ManageMenu;
IF OBJECT_ID('dbo.Map_Account_Role',         'U') IS NOT NULL DROP TABLE dbo.Map_Account_Role;

-- Map 其他 (Menu/Role/Fab 互關聯)
IF OBJECT_ID('dbo.Map_Fab_Role',       'U') IS NOT NULL DROP TABLE dbo.Map_Fab_Role;
IF OBJECT_ID('dbo.Map_Role_Menu',      'U') IS NOT NULL DROP TABLE dbo.Map_Role_Menu;
IF OBJECT_ID('dbo.Map_Menu_Structure', 'U') IS NOT NULL DROP TABLE dbo.Map_Menu_Structure;

-- PersonalSettings (邏輯上跟 Accounts+Menus 相關但 schema 中沒打 FK)
IF OBJECT_ID('dbo.PersonalSettings', 'U') IS NOT NULL DROP TABLE dbo.PersonalSettings;

-- Apps (邏輯上對 Menus 但 schema 中沒打 FK)
IF OBJECT_ID('dbo.Apps', 'U') IS NOT NULL DROP TABLE dbo.Apps;

-- 實體表
IF OBJECT_ID('dbo.Requests', 'U') IS NOT NULL DROP TABLE dbo.Requests;
IF OBJECT_ID('dbo.Menus',    'U') IS NOT NULL DROP TABLE dbo.Menus;
IF OBJECT_ID('dbo.Fabs',     'U') IS NOT NULL DROP TABLE dbo.Fabs;
IF OBJECT_ID('dbo.Roles',    'U') IS NOT NULL DROP TABLE dbo.Roles;
IF OBJECT_ID('dbo.Accounts', 'U') IS NOT NULL DROP TABLE dbo.Accounts;
GO


-- =====================================================================
-- 2) 父表 (實體)
-- =====================================================================

CREATE TABLE dbo.Accounts (
    EmpId          NVARCHAR(50)  NOT NULL,
    Name           NVARCHAR(100)     NULL,
    Department     NVARCHAR(100)     NULL,
    RoleLevel      NVARCHAR(20)      NULL,  -- 'admin' / 'user'
    CanEditOthers  BIT               NULL,
    LoginCount     INT               NULL,
    LastLoginTime  DATETIME          NULL,
    CONSTRAINT PK_Accounts PRIMARY KEY (EmpId)
);
GO

CREATE TABLE dbo.Fabs (
    FabId        NVARCHAR(50)  NOT NULL,
    FabName      NVARCHAR(50)      NULL,
    DisplayName  NVARCHAR(100)     NULL,
    DefaultLang  NVARCHAR(10)      NULL,  -- 'zh' / 'en' / 'ja'
    CONSTRAINT PK_Fabs PRIMARY KEY (FabId)
);
GO

CREATE TABLE dbo.Roles (
    RoleId     NVARCHAR(50)  NOT NULL,
    GroupName  NVARCHAR(100)     NULL,
    CONSTRAINT PK_Roles PRIMARY KEY (RoleId)
);
GO

CREATE TABLE dbo.Menus (
    MenuId       NVARCHAR(50)  NOT NULL,
    SysName      NVARCHAR(100)     NULL,  -- 系統識別名
    DisplayName  NVARCHAR(100)     NULL,  -- 前台顯示名
    MenuMode     NVARCHAR(20)      NULL,  -- 'folder' / 'link' / 'app_grid'
    Url          NVARCHAR(MAX)     NULL,
    TargetPage   NVARCHAR(100)     NULL,
    OpenTarget   NVARCHAR(20)      NULL,  -- 'iframe' / 'blank' / 'fullscreen'
    Icon         NVARCHAR(MAX)     NULL,  -- FA class 或 base64 圖示
    CreatedBy    NVARCHAR(50)      NULL,
    IsEnabled    BIT               NULL,
    IsPoolItem   BIT               NULL,
    IsEdited     BIT               NULL,
    GlobalOrder  INT               NULL,
    CONSTRAINT PK_Menus PRIMARY KEY (MenuId)
);
GO

CREATE TABLE dbo.Apps (
    AppId       NVARCHAR(50)  NOT NULL,
    MenuId      NVARCHAR(50)      NULL,  -- 邏輯關聯 Menus.MenuId (沒打 FK)
    AppName     NVARCHAR(100)     NULL,
    Url         NVARCHAR(MAX)     NULL,
    IconBase64   VARCHAR(MAX)     NULL,
    Target      NVARCHAR(20)      NULL,  -- '_blank' / 'iframe'
    CONSTRAINT PK_Apps PRIMARY KEY (AppId)
);
GO

CREATE TABLE dbo.Requests (
    RequestId       NVARCHAR(50)  NOT NULL,
    EmpId           NVARCHAR(50)      NULL,
    EmpName         NVARCHAR(100)     NULL,
    Reason          NVARCHAR(MAX)     NULL,
    Timestamp       BIGINT            NULL,  -- JS Date.now() 毫秒戳
    Status          NVARCHAR(20)      NULL,  -- pending / processing / resolved / rejected / withdrawn
    WithdrawReason  NVARCHAR(MAX)     NULL,
    Reply           NVARCHAR(MAX)     NULL,
    ReqType         NVARCHAR(50)      NULL,
    Fab             NVARCHAR(50)      NULL,
    CONSTRAINT PK_Requests PRIMARY KEY (RequestId)
);
GO

CREATE TABLE dbo.PersonalSettings (
    EmpId       NVARCHAR(50)  NOT NULL,
    MenuId      NVARCHAR(50)  NOT NULL,
    IsHidden    BIT               NULL,
    OpenTarget  NVARCHAR(20)      NULL,
    Icon        NVARCHAR(MAX)     NULL,
    SortOrder   INT               NULL,
    CONSTRAINT PK_PersonalSettings PRIMARY KEY (EmpId, MenuId)
);
GO


-- =====================================================================
-- 3) Map_* 關聯表 (依賴父表，所以放後面)
--    這幾張原始表沒在 schema 上打 FK，保留現狀。
-- =====================================================================

CREATE TABLE dbo.Map_Fab_Role (
    FabId   NVARCHAR(50)  NOT NULL,
    RoleId  NVARCHAR(50)  NOT NULL,
    CONSTRAINT PK_Map_Fab_Role PRIMARY KEY (FabId, RoleId)
);
GO

CREATE TABLE dbo.Map_Role_Menu (
    RoleId     NVARCHAR(50)  NOT NULL,
    MenuId     NVARCHAR(50)  NOT NULL,
    SortOrder  INT               NULL,
    CONSTRAINT PK_Map_Role_Menu PRIMARY KEY (RoleId, MenuId)
);
GO

CREATE TABLE dbo.Map_Menu_Structure (
    ParentMenuId  NVARCHAR(50)  NOT NULL,
    ChildMenuId   NVARCHAR(50)  NOT NULL,
    SortOrder     INT               NULL,
    CONSTRAINT PK_Map_Menu_Structure PRIMARY KEY (ParentMenuId, ChildMenuId)
);
GO

CREATE TABLE dbo.Map_Account_Role (
    EmpId   NVARCHAR(50)  NOT NULL,
    RoleId  NVARCHAR(50)  NOT NULL,
    CONSTRAINT PK_Map_Account_Role PRIMARY KEY (EmpId, RoleId)
);
GO

CREATE TABLE dbo.Map_Account_ManageMenu (
    EmpId   NVARCHAR(50)  NOT NULL,
    MenuId  NVARCHAR(50)  NOT NULL,
    CONSTRAINT PK_Map_Account_ManageMenu PRIMARY KEY (EmpId, MenuId)
);
GO

CREATE TABLE dbo.Map_Account_DefaultPage (
    EmpId   NVARCHAR(50)  NOT NULL,
    FabId   NVARCHAR(50)  NOT NULL,
    MenuId  NVARCHAR(50)      NULL,
    CONSTRAINT PK_Map_Account_DefaultPage PRIMARY KEY (EmpId, FabId)
);
GO

-- ---------------------------------------------------------------------
-- 帳號層級個別覆寫 (新增的 — 有 FK 打到 Accounts + Menus)
-- ---------------------------------------------------------------------

CREATE TABLE dbo.Map_Account_ExtraMenu (
    EmpId   NVARCHAR(50)  NOT NULL,
    MenuId  NVARCHAR(50)  NOT NULL,
    CONSTRAINT PK_Map_Account_ExtraMenu PRIMARY KEY (EmpId, MenuId),
    CONSTRAINT FK_Map_Account_ExtraMenu_Acc FOREIGN KEY (EmpId)  REFERENCES dbo.Accounts(EmpId) ON DELETE CASCADE,
    CONSTRAINT FK_Map_Account_ExtraMenu_Mnu FOREIGN KEY (MenuId) REFERENCES dbo.Menus(MenuId)
);
GO

CREATE TABLE dbo.Map_Account_DenyMenu (
    EmpId   NVARCHAR(50)  NOT NULL,
    MenuId  NVARCHAR(50)  NOT NULL,
    CONSTRAINT PK_Map_Account_DenyMenu PRIMARY KEY (EmpId, MenuId),
    CONSTRAINT FK_Map_Account_DenyMenu_Acc FOREIGN KEY (EmpId)  REFERENCES dbo.Accounts(EmpId) ON DELETE CASCADE,
    CONSTRAINT FK_Map_Account_DenyMenu_Mnu FOREIGN KEY (MenuId) REFERENCES dbo.Menus(MenuId)
);
GO

-- ---------------------------------------------------------------------
-- Menu 層級存取控制 (新增的 — 有 FK 打到 Menus + Accounts)
-- ---------------------------------------------------------------------

CREATE TABLE dbo.Map_Menu_AllowAccount (
    MenuId  NVARCHAR(50)  NOT NULL,
    EmpId   NVARCHAR(50)  NOT NULL,
    CONSTRAINT PK_Map_Menu_AllowAccount PRIMARY KEY (MenuId, EmpId),
    CONSTRAINT FK_Map_Menu_AllowAccount_Menu FOREIGN KEY (MenuId) REFERENCES dbo.Menus(MenuId),
    CONSTRAINT FK_Map_Menu_AllowAccount_Acc  FOREIGN KEY (EmpId)  REFERENCES dbo.Accounts(EmpId) ON DELETE CASCADE
);
GO

CREATE TABLE dbo.Map_Menu_DenyAccount (
    MenuId  NVARCHAR(50)  NOT NULL,
    EmpId   NVARCHAR(50)  NOT NULL,
    CONSTRAINT PK_Map_Menu_DenyAccount PRIMARY KEY (MenuId, EmpId),
    CONSTRAINT FK_Map_Menu_DenyAccount_Menu FOREIGN KEY (MenuId) REFERENCES dbo.Menus(MenuId),
    CONSTRAINT FK_Map_Menu_DenyAccount_Acc  FOREIGN KEY (EmpId)  REFERENCES dbo.Accounts(EmpId) ON DELETE CASCADE
);
GO


-- =====================================================================
-- 4) 驗證：列出建好的所有表 + 欄位數
-- =====================================================================

SELECT
    t.name AS TableName,
    (SELECT COUNT(*) FROM sys.columns c WHERE c.object_id = t.object_id) AS ColumnCount,
    (SELECT COUNT(*) FROM sys.foreign_keys f WHERE f.parent_object_id = t.object_id) AS FKCount
FROM sys.tables t
WHERE t.schema_id = SCHEMA_ID('dbo')
ORDER BY t.name;
GO

PRINT '✅ schema_v2.sql 執行完畢，請檢查上方 17 張表是否全部建立';
GO
