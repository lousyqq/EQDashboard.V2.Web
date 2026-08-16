/*
    新增 Accounts 表的 Preferences 欄位，供儲存個人跨裝置 UI 偏好設定（如：最近瀏覽紀錄、自訂佈景等 JSON 格式字串）。
    冪等操作 (Idempotent)：若欄位已存在則略過。
*/

IF COL_LENGTH('dbo.Accounts', 'Preferences') IS NULL
BEGIN
    ALTER TABLE dbo.Accounts
    ADD Preferences NVARCHAR(MAX) NULL;
    
    PRINT 'Column [Preferences] added to [Accounts] table successfully.';
END
ELSE
BEGIN
    PRINT 'Column [Preferences] already exists in [Accounts] table.';
END
GO
