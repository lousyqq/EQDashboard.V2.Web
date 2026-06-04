-- =========================================================================
-- 診斷 Menus 表結構與 SaveData 失敗原因
-- =========================================================================
-- 用途：當 Excel 匯入 (/Settings/SaveData) 在 [Menus] 失敗時拿來對照
-- 用法：在 SSMS 連到 EQDashboardV2 後執行整支
-- =========================================================================

USE EQDashboardV2;
GO

PRINT '=== 1. Menus 表的所有 column 與 NOT NULL 限制 ===';
SELECT
    COLUMN_NAME            AS [欄位名稱],
    DATA_TYPE              AS [型別],
    CHARACTER_MAXIMUM_LENGTH AS [長度],
    IS_NULLABLE            AS [可否 NULL],
    COLUMN_DEFAULT         AS [預設值]
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'Menus'
ORDER BY ORDINAL_POSITION;

PRINT '';
PRINT '=== 2. 期望的欄位 (對齊 Model & schema_v2.sql) ===';
PRINT '   MenuId      NVARCHAR(50)  NOT NULL  PK';
PRINT '   SysName     NVARCHAR(100) NULL';
PRINT '   DisplayName NVARCHAR(100) NULL';
PRINT '   MenuMode    NVARCHAR(20)  NULL';
PRINT '   Url         NVARCHAR(MAX) NULL';
PRINT '   TargetPage  NVARCHAR(100) NULL';
PRINT '   OpenTarget  NVARCHAR(20)  NULL';
PRINT '   Icon        NVARCHAR(MAX) NULL';
PRINT '   CreatedBy   NVARCHAR(50)  NULL';
PRINT '   IsEnabled   BIT           NULL';
PRINT '   IsPoolItem  BIT           NULL';
PRINT '   IsEdited    BIT           NULL';
PRINT '   GlobalOrder INT           NULL';

PRINT '';
PRINT '=== 3. 偵測常見問題 ===';

-- 3a. 有沒有舊版的 ParentId NOT NULL column (V1 schema 殘留)
IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'Menus' AND COLUMN_NAME = 'ParentId' AND IS_NULLABLE = 'NO')
    PRINT '⚠️  問題 A：Menus 仍有 V1 殘留欄位 ParentId NOT NULL → bulk insert 會塞 NULL 失敗';
ELSE
    PRINT '✓  Menus 沒有 V1 殘留欄位 ParentId NOT NULL';

-- 3b. Url 是否仍是 NVARCHAR(1000) 而非 NVARCHAR(MAX)
IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'Menus' AND COLUMN_NAME = 'Url'
      AND CHARACTER_MAXIMUM_LENGTH IS NOT NULL AND CHARACTER_MAXIMUM_LENGTH < 4000)
    PRINT '⚠️  問題 B：Url 不是 NVARCHAR(MAX)，過長字串會被擋';
ELSE
    PRINT '✓  Url 是 NVARCHAR(MAX) 或可接受長度';

-- 3c. 有沒有 CHECK constraint
SELECT
    cc.CONSTRAINT_NAME AS [Check 限制],
    cc.CHECK_CLAUSE   AS [規則]
FROM INFORMATION_SCHEMA.CHECK_CONSTRAINTS cc
JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc ON cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
WHERE tc.TABLE_NAME = 'Menus';

-- 3d. Menus 既有資料中是否有 MenuId 重複 (PK 防呆)
SELECT
    MenuId, COUNT(*) AS [重複次數]
FROM Menus
GROUP BY MenuId
HAVING COUNT(*) > 1;

-- 3e. 統計目前 Menus 列數，跟 Excel 對照
SELECT COUNT(*) AS [Menus 表現有列數] FROM Menus;

PRINT '';
PRINT '=== 4. 若有「ParentId NOT NULL」殘留 → 直接執行以下 ALTER 修正 ===';
PRINT '    ALTER TABLE Menus ALTER COLUMN ParentId NVARCHAR(50) NULL;';
PRINT '';
PRINT '=== 5. 若 Url 長度受限 → 升級到 NVARCHAR(MAX) ===';
PRINT '    ALTER TABLE Menus ALTER COLUMN Url NVARCHAR(MAX) NULL;';
PRINT '    ALTER TABLE Menus ALTER COLUMN Icon NVARCHAR(MAX) NULL;';
