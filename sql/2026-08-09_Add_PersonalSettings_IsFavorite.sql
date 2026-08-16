-- 2026-08-09 Add IsFavorite to PersonalSettings
-- 新增 IsFavorite 欄位供「我的最愛 (釘選)」功能使用

IF COL_LENGTH('dbo.PersonalSettings', 'IsFavorite') IS NULL
BEGIN
    ALTER TABLE dbo.PersonalSettings ADD IsFavorite BIT NULL;
    PRINT 'Added IsFavorite column to PersonalSettings table.';
END
ELSE
BEGIN
    PRINT 'Column IsFavorite already exists in PersonalSettings table.';
END
GO
