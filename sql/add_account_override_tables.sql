-- =====================================================================
-- add_account_override_tables.sql
--   建立兩張帳號層級的可視覆寫表，補上 RBAC 之外的個別調整能力：
--
--   Map_Account_ExtraMenu : 在 Role 給予的可視範圍之外，「額外開放」單一 menu
--   Map_Account_DenyMenu  : 從 Role 給予的可視範圍中，「個別封鎖」單一 menu
--
--   權限計算 (前端 sidebar.js)：
--     effective = (union of role.allowedMenuIds) ∪ account.extraMenus
--     effective -= account.denyMenus
--
--   IDEMPOTENT：可重複執行
-- =====================================================================

USE EQDashboardV2;
GO

-- Map_Account_ExtraMenu
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'Map_Account_ExtraMenu')
BEGIN
    CREATE TABLE Map_Account_ExtraMenu (
        EmpId  NVARCHAR(50) NOT NULL,
        MenuId NVARCHAR(50) NOT NULL,
        CONSTRAINT PK_Map_Account_ExtraMenu PRIMARY KEY (EmpId, MenuId),
        CONSTRAINT FK_Map_Account_ExtraMenu_Acc FOREIGN KEY (EmpId)  REFERENCES Accounts(EmpId) ON DELETE CASCADE,
        CONSTRAINT FK_Map_Account_ExtraMenu_Mnu FOREIGN KEY (MenuId) REFERENCES Menus(MenuId)
    );
    PRINT '✅ 建立 Map_Account_ExtraMenu';
END
ELSE
    PRINT 'ℹ️  Map_Account_ExtraMenu 已存在，略過';
GO

-- Map_Account_DenyMenu
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'Map_Account_DenyMenu')
BEGIN
    CREATE TABLE Map_Account_DenyMenu (
        EmpId  NVARCHAR(50) NOT NULL,
        MenuId NVARCHAR(50) NOT NULL,
        CONSTRAINT PK_Map_Account_DenyMenu PRIMARY KEY (EmpId, MenuId),
        CONSTRAINT FK_Map_Account_DenyMenu_Acc FOREIGN KEY (EmpId)  REFERENCES Accounts(EmpId) ON DELETE CASCADE,
        CONSTRAINT FK_Map_Account_DenyMenu_Mnu FOREIGN KEY (MenuId) REFERENCES Menus(MenuId)
    );
    PRINT '✅ 建立 Map_Account_DenyMenu';
END
ELSE
    PRINT 'ℹ️  Map_Account_DenyMenu 已存在，略過';
GO

-- 驗證
SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
  FROM INFORMATION_SCHEMA.COLUMNS
 WHERE TABLE_NAME IN ('Map_Account_ExtraMenu', 'Map_Account_DenyMenu')
 ORDER BY TABLE_NAME, ORDINAL_POSITION;
GO
