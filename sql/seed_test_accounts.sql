-- =====================================================================
-- seed_test_accounts.sql
--   寫入兩組測試帳號的 DB 實體列（搭配 appsettings.json 的 Auth.TestAccounts，
--   後者只負責「登入密碼比對」，真正的角色/委派權限必須在此寫入 DB）。
--
--   ① subadmin_user — 委派管理 m_ze（ZE 強化防禦群組）的委派管理員
--        - Accounts.CanEditOthers = 1（委派管理員的必要條件之一）
--        - Map_Account_Role        = role_1（fab_12a 的角色；role_1 授予 m_ze 可見性。
--                                     系統內無「只給 m_ze」的角色，故以 role_1 提供 12A 廠區可見性，
--                                     使用者切到 12A 即可看到並進入 ZE 強化防禦群組）
--        - Map_Account_ManageMenu  = m_ze（委派；委派 folder 等於委派整個子樹 →
--                                     可編輯/新增/刪除 m_ze / m_ze_1 / m_ze_2 / m_ze_3 / m_ze_2_1 / m_ze_2_2）
--        → IsDelegatedAdminAsync = true（CanEditOthers=1 且 ≥1 筆 Map_Account_ManageMenu）
--
--   ② normal_user — 無任何 role 的一般使用者（僅 Accounts 列，無任何 Map_Account_Role）
--        → 登入後無可存取廠區、無可視看板（中性空狀態），用以驗證「無權限」行為。
--
--   IDEMPOTENT：可重複執行（全部以 IF NOT EXISTS 包覆）。
-- =====================================================================

USE EQDashboardV2;
GO

-- =========================== ① subadmin_user ===========================
IF NOT EXISTS (SELECT 1 FROM Accounts WHERE EmpId = N'subadmin_user')
BEGIN
    INSERT INTO Accounts (EmpId, Name, Department, RoleLevel, CanEditOthers, LoginCount, LastLoginTime)
    VALUES (N'subadmin_user', N'委派管理測試帳號', N'測試環境', N'user', 1, 0, NULL);
    PRINT '✅ 建立 Accounts: subadmin_user';
END
ELSE
BEGIN
    -- 既存則確保 CanEditOthers=1（委派管理員必要條件），不動其它欄位
    UPDATE Accounts SET CanEditOthers = 1 WHERE EmpId = N'subadmin_user' AND (CanEditOthers IS NULL OR CanEditOthers = 0);
    PRINT 'ℹ️  Accounts subadmin_user 已存在，已確保 CanEditOthers=1';
END
GO

-- 角色：role_1（fab_12a），提供 12A 廠區與 m_ze 可見性
IF NOT EXISTS (SELECT 1 FROM Map_Account_Role WHERE EmpId = N'subadmin_user' AND RoleId = N'role_1')
BEGIN
    INSERT INTO Map_Account_Role (EmpId, RoleId) VALUES (N'subadmin_user', N'role_1');
    PRINT '✅ 建立 Map_Account_Role: subadmin_user → role_1';
END
ELSE
    PRINT 'ℹ️  Map_Account_Role subadmin_user→role_1 已存在，略過';
GO

-- 委派：m_ze（委派整個 ZE 強化防禦群組子樹）
IF NOT EXISTS (SELECT 1 FROM Map_Account_ManageMenu WHERE EmpId = N'subadmin_user' AND MenuId = N'm_ze')
BEGIN
    INSERT INTO Map_Account_ManageMenu (EmpId, MenuId) VALUES (N'subadmin_user', N'm_ze');
    PRINT '✅ 建立 Map_Account_ManageMenu: subadmin_user → m_ze';
END
ELSE
    PRINT 'ℹ️  Map_Account_ManageMenu subadmin_user→m_ze 已存在，略過';
GO

-- =========================== ② normal_user ===========================
IF NOT EXISTS (SELECT 1 FROM Accounts WHERE EmpId = N'normal_user')
BEGIN
    INSERT INTO Accounts (EmpId, Name, Department, RoleLevel, CanEditOthers, LoginCount, LastLoginTime)
    VALUES (N'normal_user', N'Normal User', N'QA', N'user', 0, 0, NULL);
    PRINT '✅ 建立 Accounts: normal_user（無任何 role）';
END
ELSE
    PRINT 'ℹ️  Accounts normal_user 已存在，略過';
GO
-- normal_user 刻意不寫任何 Map_Account_Role（無 role 即為其測試目的）

-- =========================== 驗證 ===========================
SELECT a.EmpId, a.Name, a.RoleLevel, a.CanEditOthers,
       (SELECT COUNT(*) FROM Map_Account_Role r       WHERE r.EmpId = a.EmpId) AS Roles,
       (SELECT COUNT(*) FROM Map_Account_ManageMenu m  WHERE m.EmpId = a.EmpId) AS ManagedMenus
  FROM Accounts a
 WHERE a.EmpId IN (N'subadmin_user', N'normal_user')
 ORDER BY a.EmpId;
GO
