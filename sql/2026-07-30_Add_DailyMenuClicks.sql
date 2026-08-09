/* 
   2026-07-30_Add_DailyMenuClicks.sql
   新增每日看板點擊統計表 (DailyMenuClicks) 與相關索引
*/

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF OBJECT_ID(N'dbo.DailyMenuClicks', N'U') IS NULL
CREATE TABLE dbo.DailyMenuClicks (
    ClickDate      DATE          NOT NULL,
    MenuId         NVARCHAR(50)  NOT NULL,
    EmpId          NVARCHAR(50)  NOT NULL,
    ClickCount     INT           NOT NULL CONSTRAINT DF_DailyMenuClicks_ClickCount DEFAULT 1,
    FirstClickTime DATETIME2     NOT NULL,
    LastClickTime  DATETIME2     NOT NULL,
    CONSTRAINT PK_DailyMenuClicks PRIMARY KEY (ClickDate, MenuId, EmpId)
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_DailyMenuClicks_Date_MenuId' AND object_id = OBJECT_ID(N'dbo.DailyMenuClicks'))
    CREATE NONCLUSTERED INDEX IX_DailyMenuClicks_Date_MenuId ON dbo.DailyMenuClicks (ClickDate, MenuId);
GO
