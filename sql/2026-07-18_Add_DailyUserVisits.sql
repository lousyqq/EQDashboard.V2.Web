-- ============================================================================
-- 增量 SQL 腳本：建立每日帳號造訪活躍統計表 (DailyUserVisits) 與對應索引
-- 建立日期：2026-07-18
-- 對應檔案：Services/SchemaBootstrap.cs (EnsureDailyUserVisitsAsync & EnsureIndexesAsync)
-- 說明：提供 DAU / MAU / 各部門使用率分析之底層統計結構
-- ============================================================================

IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'DailyUserVisits')
BEGIN
    CREATE TABLE [dbo].[DailyUserVisits] (
        [VisitDate]      DATE          NOT NULL,
        [EmpId]          NVARCHAR(50)  NOT NULL,
        [EmpName]        NVARCHAR(100) NULL,
        [Department]     NVARCHAR(100) NULL,
        [VisitCount]     INT           NOT NULL DEFAULT 1,
        [FirstVisitTime] DATETIME2     NOT NULL,
        [LastVisitTime]  DATETIME2     NOT NULL,
        CONSTRAINT [PK_DailyUserVisits] PRIMARY KEY CLUSTERED ([VisitDate] ASC, [EmpId] ASC)
    );
    PRINT '建立資料表 DailyUserVisits 成功。';
END
ELSE
BEGIN
    PRINT '資料表 DailyUserVisits 已存在，略過。';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_DailyUserVisits_Date_Dept' AND object_id = OBJECT_ID('DailyUserVisits'))
BEGIN
    CREATE NONCLUSTERED INDEX [IX_DailyUserVisits_Date_Dept]
        ON [dbo].[DailyUserVisits] ([VisitDate] ASC, [Department] ASC);
    PRINT '建立索引 IX_DailyUserVisits_Date_Dept 成功。';
END
ELSE
BEGIN
    PRINT '索引 IX_DailyUserVisits_Date_Dept 已存在，略過。';
END
GO
