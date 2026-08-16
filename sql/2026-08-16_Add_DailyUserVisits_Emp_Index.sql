/*
    2026-08-16 — 第四輪健檢 F11：為 DailyUserVisits 補「日期 + 人」的覆蓋索引。

    背景：
      GET /api/Analytics/details（流量與使用率 → 每日造訪明細）的關鍵字查詢會產生
          WHERE EmpId LIKE N'%term%' OR EmpName LIKE N'%term%'
      前綴萬用字元讓 LIKE 無法 index seek。原本 DailyUserVisits 上只有
      IX_DailyUserVisits_Date_Dept (VisitDate, Department)，該查詢只能整表掃描。
      本索引讓「先以 VisitDate 收斂區間，再於索引內比對 EmpId / EmpName」成為可能。

    設計取捨：
      刻意不加 INCLUDE（VisitCount / FirstVisitTime / LastVisitTime）——
      主機 Sariel 僅 6GB RAM，索引寬度優先於免除 key lookup。

    冪等 (Idempotent)：索引已存在則略過。
    對應程式碼：Services/SchemaBootstrap.cs 的 EnsureIndexesAsync（索引的唯一事實來源）。
*/

IF OBJECT_ID(N'dbo.DailyUserVisits', N'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.indexes
                   WHERE name = N'IX_DailyUserVisits_Date_Emp'
                     AND object_id = OBJECT_ID(N'dbo.DailyUserVisits'))
BEGIN
    CREATE NONCLUSTERED INDEX [IX_DailyUserVisits_Date_Emp]
        ON dbo.DailyUserVisits (VisitDate, EmpId, EmpName);

    PRINT N'✅ 已建立索引 IX_DailyUserVisits_Date_Emp';
END
ELSE
BEGIN
    PRINT N'ℹ️ 索引 IX_DailyUserVisits_Date_Emp 已存在或資料表不存在，略過';
END
GO

/* 驗收查詢：應列出 DailyUserVisits 上的兩條非叢集索引 */
SELECT i.name AS IndexName,
       STUFF((SELECT ', ' + c.name
              FROM sys.index_columns ic
              JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
              WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id
              ORDER BY ic.key_ordinal
              FOR XML PATH('')), 1, 2, '') AS IndexColumns
FROM sys.indexes i
WHERE i.object_id = OBJECT_ID(N'dbo.DailyUserVisits')
  AND i.type_desc = N'NONCLUSTERED';
GO
