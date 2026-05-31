-- =====================================================================
-- seed_account_00058897.sql
--   把 00058897 種入 EQDashboardV2.Accounts 表，作為測試用真實工號。
--   IDEMPOTENT：可重複執行；已存在時只更新非密碼欄位。
--   (密碼不在 DB — 走 appsettings.Auth.TestAccounts 或 AD LDAP)
-- 執行：在 SSMS 對 EQDashboardV2 資料庫執行
-- =====================================================================

USE EQDashboardV2;
GO

-- 先確認 LoginCount/LastLoginTime 欄位存在（早期版本可能沒加）
IF COL_LENGTH('Accounts', 'LoginCount') IS NULL
    ALTER TABLE Accounts ADD LoginCount INT NULL;
IF COL_LENGTH('Accounts', 'LastLoginTime') IS NULL
    ALTER TABLE Accounts ADD LastLoginTime DATETIME NULL;
GO

-- Upsert 00058897
IF NOT EXISTS (SELECT 1 FROM Accounts WHERE EmpId = '00058897')
BEGIN
    INSERT INTO Accounts (EmpId, Name, Department, RoleLevel, CanEditOthers, LoginCount, LastLoginTime)
    VALUES ('00058897', N'林玉婷', N'12A_PTI/ESI/MSD', 'user', 0, 0, NULL);
    PRINT '✅ 已新增帳號 00058897 (林玉婷)';
END
ELSE
BEGIN
    UPDATE Accounts
       SET Name          = N'林玉婷',
           Department    = N'12A_PTI/ESI/MSD',
           RoleLevel     = 'user',
           CanEditOthers = 0
     WHERE EmpId = '00058897';
    PRINT '✅ 已更新帳號 00058897 (除 LoginCount/LastLoginTime 不動)';
END
GO

-- 驗證
SELECT EmpId, Name, Department, RoleLevel, CanEditOthers, LoginCount, LastLoginTime
  FROM Accounts
 WHERE EmpId IN ('admin', '00058897', 'user')
 ORDER BY EmpId;
GO
