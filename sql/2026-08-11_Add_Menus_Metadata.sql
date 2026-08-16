/*
   2026-08-11_Add_Menus_Metadata.sql
   為 Menus 資料表新增 CreatedAt, Description, Keywords 三個欄位
   目的：
   1. CreatedAt 用於修復殭屍看板誤判（新建立且未被點擊的看板不應列為殭屍）。
   2. Description 與 Keywords 用於提升搜尋體驗。
*/

IF COL_LENGTH('dbo.Menus','CreatedAt') IS NULL
    ALTER TABLE dbo.Menus ADD CreatedAt DATETIME2 NULL;

IF COL_LENGTH('dbo.Menus','Description') IS NULL
    ALTER TABLE dbo.Menus ADD Description NVARCHAR(255) NULL;

IF COL_LENGTH('dbo.Menus','Keywords') IS NULL
    ALTER TABLE dbo.Menus ADD Keywords NVARCHAR(255) NULL;
