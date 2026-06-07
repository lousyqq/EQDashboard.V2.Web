-- =========================================================================
-- 驗證 LoginCount / LastLoginTime 是否真的有寫入 DB
-- =========================================================================
-- 用途：當你懷疑「登入次數只寫 local 沒寫 DB」時，跑這支看 DB 真實狀態
-- 用法：SSMS 連到 EQDashboardV2 → 跑這支
-- =========================================================================
USE EQDashboardV2;
GO

PRINT '=== 1. 各帳號目前的 LoginCount / LastLoginTime ===';
SELECT
    EmpId,
    Name,
    Department,
    RoleLevel,
    LoginCount     AS [累積登入次數],
    LastLoginTime  AS [最後登入時間]
FROM Accounts
ORDER BY LastLoginTime DESC;

PRINT '';
PRINT '=== 2. 最近 24 小時的登入事件（從 UserActivityLogs 撈出） ===';
SELECT
    Timestamp      AS [UTC 時間],
    EmpId,
    EmpName        AS [姓名快照],
    LoginSource    AS [登入來源],
    Action         AS [事件],
    IsSuccess      AS [成功?],
    ErrorMessage   AS [失敗原因],
    IpAddress      AS [來源 IP],
    UserAgent      AS [瀏覽器]
FROM UserActivityLogs
WHERE Category IN ('Login', 'Logout')
  AND Timestamp > DATEADD(HOUR, -24, GETUTCDATE())
ORDER BY Timestamp DESC;

PRINT '';
PRINT '=== 3. 統計：每個帳號 24 小時內的登入次數（活動紀錄角度） ===';
SELECT
    EmpId,
    SUM(CASE WHEN Action LIKE 'LoginSuccess%' THEN 1 ELSE 0 END) AS [成功登入次數],
    SUM(CASE WHEN Action LIKE 'LoginFail%'    THEN 1 ELSE 0 END) AS [失敗嘗試次數],
    SUM(CASE WHEN Action = 'Logout'           THEN 1 ELSE 0 END) AS [登出次數],
    MAX(Timestamp)                                                AS [最後活動時間]
FROM UserActivityLogs
WHERE Category IN ('Login', 'Logout')
  AND Timestamp > DATEADD(HOUR, -24, GETUTCDATE())
  AND EmpId IS NOT NULL
GROUP BY EmpId
ORDER BY [最後活動時間] DESC;

PRINT '';
PRINT '=== 4. 比對：Accounts.LoginCount 與 UserActivityLogs 是否一致 ===';
PRINT '   理想狀況：Accounts.LoginCount = 該帳號從 UserActivityLogs 起算累計的成功登入次數';
PRINT '   若不一致：表示 UpdateLoginStats 有時失敗（或 admin TestAccount 走特例不寫 DB）';
SELECT
    a.EmpId,
    a.LoginCount                              AS [Accounts 表的 LoginCount],
    COUNT(l.LogId)                            AS [UserActivityLogs 內成功登入次數],
    a.LoginCount - COUNT(l.LogId)             AS [差異]
FROM Accounts a
LEFT JOIN UserActivityLogs l
       ON l.EmpId = a.EmpId
      AND l.Category = 'Login'
      AND l.Action LIKE 'LoginSuccess%'
GROUP BY a.EmpId, a.LoginCount
ORDER BY ABS(ISNULL(a.LoginCount, 0) - COUNT(l.LogId)) DESC;
