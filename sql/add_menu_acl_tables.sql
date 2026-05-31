-- =====================================================================
-- add_menu_acl_tables.sql
--   建立兩張「Menu 層級」的存取控制表，補上 Account-side 之外的另一個彈性：
--
--   Map_Menu_AllowAccount : 此 Menu 僅允許列表中的工號瀏覽 (白名單)
--   Map_Menu_DenyAccount  : 此 Menu 禁止列表中的工號瀏覽 (黑名單)
--
--   權限計算優先序 (sidebar.js)：
--     1. allowedSet = ∪ role.allowedMenuIds  ∪ account.extraMenus  − account.denyMenus
--     2. 對 allowedSet 中每個 menu 再套用：
--          若 m.allowedEmpIds 非空 且 currentUser ∉ 列表 → 移除
--          若 currentUser ∈ m.deniedEmpIds              → 移除
--
--   IDEMPOTENT：可重複執行；SchemaBootstrap 啟動時也會自動補建。
-- =====================================================================

USE EQDashboardV2;
GO

-- Map_Menu_AllowAccount (白名單)
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'Map_Menu_AllowAccount')
BEGIN
    CREATE TABLE Map_Menu_AllowAccount (
        MenuId NVARCHAR(50) NOT NULL,
        EmpId  NVARCHAR(50) NOT NULL,
        CONSTRAINT PK_Map_Menu_AllowAccount PRIMARY KEY (MenuId, EmpId),
        CONSTRAINT FK_Map_Menu_AllowAccount_Menu FOREIGN KEY (MenuId) REFERENCES Menus(MenuId),
        CONSTRAINT FK_Map_Menu_AllowAccount_Acc  FOREIGN KEY (EmpId)  REFERENCES Accounts(EmpId) ON DELETE CASCADE
    );
    PRINT '✅ 建立 Map_Menu_AllowAccount';
END
ELSE
    PRINT 'ℹ️  Map_Menu_AllowAccount 已存在，略過';
GO

-- Map_Menu_DenyAccount (黑名單)
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'Map_Menu_DenyAccount')
BEGIN
    CREATE TABLE Map_Menu_DenyAccount (
        MenuId NVARCHAR(50) NOT NULL,
        EmpId  NVARCHAR(50) NOT NULL,
        CONSTRAINT PK_Map_Menu_DenyAccount PRIMARY KEY (MenuId, EmpId),
        CONSTRAINT FK_Map_Menu_DenyAccount_Menu FOREIGN KEY (MenuId) REFERENCES Menus(MenuId),
        CONSTRAINT FK_Map_Menu_DenyAccount_Acc  FOREIGN KEY (EmpId)  REFERENCES Accounts(EmpId) ON DELETE CASCADE
    );
    PRINT '✅ 建立 Map_Menu_DenyAccount';
END
ELSE
    PRINT 'ℹ️  Map_Menu_DenyAccount 已存在，略過';
GO

SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
  FROM INFORMATION_SCHEMA.COLUMNS
 WHERE TABLE_NAME IN ('Map_Menu_AllowAccount', 'Map_Menu_DenyAccount')
 ORDER BY TABLE_NAME, ORDINAL_POSITION;
GO
