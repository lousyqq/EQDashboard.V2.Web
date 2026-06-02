USE EQDashboardV2;
GO

SET NOCOUNT ON;
GO

-- =====================================================================
-- 實體表 (父表)
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
-- 關聯表 (Map_* 子表)
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