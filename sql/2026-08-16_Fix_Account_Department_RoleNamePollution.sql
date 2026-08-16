/* =============================================================================
   2026-08-16 資料修正：清除被誤寫進 Department 的「角色名稱」
   -----------------------------------------------------------------------------
   背景：
     AuthController 的四個自動建帳分支（WhoAmI × 2、Login × 2）在
     LookupPersonFromNotesAsync 查不到部門時，會把**角色名稱**當成部門寫進去：
         isDefaultAdmin      → Department = '系統管理員'
         OpenAccessMode=true → Department = '一般使用者'
     這個欄位是「各部門活躍比率」報表的分群鍵，且會被 UpdateLoginStats
     （SettingsService 的 COALESCE 鏈）抄進 DailyUserVisits.Department
     → 報表上長出根本不存在的部門。另外硬編中文在 en/ja 介面也照樣顯示中文。

   程式面已於 2026-08-16 修正為「查不到就留 NULL」；本腳本只負責清掉**既有**的髒資料。
   NULL 的呈現由前端負責（i18n key `dept_unknown`，三語齊備），
   報表端 AnalyticsController 已有 `x.Department ?? "未指定/其他"` 兜底。

   特性：冪等（重複執行為 no-op）。不涉及任何 Schema 變更，SchemaBootstrap 不會也不該接手，
         請手動執行一次。

   ⚠️ 執行前務必先跑下方「STEP 1 稽核」確認受影響列數與預期相符。
      若貴單位真的有部門叫「一般使用者」或「系統管理員」，請勿執行 STEP 2/3。
   ============================================================================= */

SET NOCOUNT ON;
GO

/* ---------------------------------------------------------------------------
   STEP 1｜稽核：先看會動到哪些列（不修改任何資料）
   --------------------------------------------------------------------------- */
PRINT '--- STEP 1: Accounts 受影響列 ---';
SELECT EmpId, Name, Department, RoleLevel, LoginCount, LastLoginTime
FROM   dbo.Accounts
WHERE  Department IN (N'一般使用者', N'系統管理員')
ORDER  BY EmpId;

PRINT '--- STEP 1: DailyUserVisits 受影響列數（依部門彙總）---';
SELECT Department, COUNT(*) AS RowCnt, MIN(VisitDate) AS FirstDate, MAX(VisitDate) AS LastDate
FROM   dbo.DailyUserVisits
WHERE  Department IN (N'一般使用者', N'系統管理員')
GROUP  BY Department;
GO

/* ---------------------------------------------------------------------------
   STEP 2｜清除 Accounts 的假部門
   --------------------------------------------------------------------------- */
UPDATE dbo.Accounts
SET    Department = NULL
WHERE  Department IN (N'一般使用者', N'系統管理員');

PRINT CONCAT('Accounts 已更新 ', @@ROWCOUNT, ' 列');
GO

/* ---------------------------------------------------------------------------
   STEP 3｜清除 DailyUserVisits 已被抄過去的假部門
          （不清的話，歷史區間的「各部門活躍比率」仍會顯示假部門）
   --------------------------------------------------------------------------- */
UPDATE dbo.DailyUserVisits
SET    Department = NULL
WHERE  Department IN (N'一般使用者', N'系統管理員');

PRINT CONCAT('DailyUserVisits 已更新 ', @@ROWCOUNT, ' 列');
GO

/* ---------------------------------------------------------------------------
   STEP 4｜驗收：兩個查詢都應回 0 列
   --------------------------------------------------------------------------- */
SELECT COUNT(*) AS Remaining_Accounts
FROM   dbo.Accounts
WHERE  Department IN (N'一般使用者', N'系統管理員');

SELECT COUNT(*) AS Remaining_DailyUserVisits
FROM   dbo.DailyUserVisits
WHERE  Department IN (N'一般使用者', N'系統管理員');
GO
