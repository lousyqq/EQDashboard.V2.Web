using Microsoft.Data.SqlClient;
using EQDashboard.V2.Web.Services.Interfaces;

namespace EQDashboard.V2.Web.Services;

public class SchemaBootstrap : ISchemaBootstrap
{
    private readonly string _connStr;
    private readonly IConfiguration _config;
    private readonly ILogger<SchemaBootstrap> _logger;

    public SchemaBootstrap(IConfiguration config, ILogger<SchemaBootstrap> logger)
    {
        _connStr = config.GetConnectionString("EQDashboard")
            ?? throw new InvalidOperationException("Missing connection string 'EQDashboard'");
        _config = config;
        _logger = logger;
    }

    public async Task RunAsync()
    {
        try
        {
            using var conn = new SqlConnection(_connStr);
            await conn.OpenAsync();

            await EnsureAccountStatsColumnsAsync(conn);
            await EnsureOverrideTableAsync(conn, "Map_Account_ExtraMenu");
            await EnsureOverrideTableAsync(conn, "Map_Account_DenyMenu");
            await EnsureMenuAclTableAsync(conn, "Map_Menu_AllowAccount");
            await EnsureMenuAclTableAsync(conn, "Map_Menu_DenyAccount");
            await SeedTestAccountsAsync(conn);

            _logger.LogInformation("✅ SchemaBootstrap 完成");
        }
        catch (Exception ex)
        {
            // 不擋啟動 — 只在 log 大聲喊
            _logger.LogError(ex, "⚠️ SchemaBootstrap 失敗：{Message} (應用會繼續啟動，請手動檢查 DB)", ex.Message);
        }
    }

    /// <summary>確保 Accounts 有 LoginCount / LastLoginTime 欄位 (與舊 SettingsService 自動補齊邏輯一致)</summary>
    private async Task EnsureAccountStatsColumnsAsync(SqlConnection conn)
    {
        const string sql = @"
            IF COL_LENGTH('Accounts','LoginCount') IS NULL
                ALTER TABLE Accounts ADD LoginCount INT NULL;
            IF COL_LENGTH('Accounts','LastLoginTime') IS NULL
                ALTER TABLE Accounts ADD LastLoginTime DATETIME NULL;";
        using var cmd = new SqlCommand(sql, conn);
        await cmd.ExecuteNonQueryAsync();
    }

    /// <summary>確保 Map_Account_ExtraMenu / Map_Account_DenyMenu 兩張覆寫表存在</summary>
    private async Task EnsureOverrideTableAsync(SqlConnection conn, string tableName)
    {
        // 先檢查是否存在
        using (var checkCmd = new SqlCommand(
            "SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = @tb", conn))
        {
            checkCmd.Parameters.AddWithValue("@tb", tableName);
            var exists = (int)(await checkCmd.ExecuteScalarAsync())! > 0;
            if (exists) return;
        }

        // 建表 (FK 到 Accounts ON DELETE CASCADE；FK 到 Menus 預設 NO ACTION 避免多重 cascade path)
        var createSql = $@"
            CREATE TABLE [{tableName}] (
                EmpId  NVARCHAR(50) NOT NULL,
                MenuId NVARCHAR(50) NOT NULL,
                CONSTRAINT PK_{tableName} PRIMARY KEY (EmpId, MenuId),
                CONSTRAINT FK_{tableName}_Acc FOREIGN KEY (EmpId)  REFERENCES Accounts(EmpId) ON DELETE CASCADE,
                CONSTRAINT FK_{tableName}_Mnu FOREIGN KEY (MenuId) REFERENCES Menus(MenuId)
            );";
        using (var cmd = new SqlCommand(createSql, conn))
        {
            await cmd.ExecuteNonQueryAsync();
            _logger.LogInformation("✅ SchemaBootstrap 建立資料表 {Table}", tableName);
        }
    }

    /// <summary>確保 Map_Menu_AllowAccount / Map_Menu_DenyAccount 兩張 menu-level ACL 表存在</summary>
    private async Task EnsureMenuAclTableAsync(SqlConnection conn, string tableName)
    {
        using (var checkCmd = new SqlCommand(
            "SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = @tb", conn))
        {
            checkCmd.Parameters.AddWithValue("@tb", tableName);
            var exists = (int)(await checkCmd.ExecuteScalarAsync())! > 0;
            if (exists) return;
        }

        // PK 順序: (MenuId, EmpId)，跟 Account-side override 的 (EmpId, MenuId) 相反，
        // 因為這兩張表的「主要查詢方向」是「某個 menu 有哪些被特別 allow/deny 的 emp」
        var createSql = $@"
            CREATE TABLE [{tableName}] (
                MenuId NVARCHAR(50) NOT NULL,
                EmpId  NVARCHAR(50) NOT NULL,
                CONSTRAINT PK_{tableName} PRIMARY KEY (MenuId, EmpId),
                CONSTRAINT FK_{tableName}_Menu FOREIGN KEY (MenuId) REFERENCES Menus(MenuId),
                CONSTRAINT FK_{tableName}_Acc  FOREIGN KEY (EmpId)  REFERENCES Accounts(EmpId) ON DELETE CASCADE
            );";
        using (var cmd = new SqlCommand(createSql, conn))
        {
            await cmd.ExecuteNonQueryAsync();
            _logger.LogInformation("✅ SchemaBootstrap 建立資料表 {Table}", tableName);
        }
    }

    /// <summary>把 appsettings.Auth.TestAccounts.Accounts 中所有工號 upsert 進 Accounts 表 (僅在 TestAccounts.Enabled=true 時)</summary>
    private async Task SeedTestAccountsAsync(SqlConnection conn)
    {
        var enabled = _config.GetValue<bool>("Auth:TestAccounts:Enabled");
        if (!enabled) return;

        var section = _config.GetSection("Auth:TestAccounts:Accounts");
        if (!section.Exists()) return;

        foreach (var child in section.GetChildren())
        {
            var empId = child["EmpId"];
            if (string.IsNullOrWhiteSpace(empId)) continue;

            // admin 是緊急通道、不寫 DB；user 與 00058897 之類則寫入便於 UI 管理
            // (admin 寫進去也無妨 — 但保留現狀避免覆寫使用者已調好的 admin Account)
            if (string.Equals(empId, "admin", StringComparison.OrdinalIgnoreCase)) continue;

            var name = child["Name"] ?? empId;
            var dept = child["Department"] ?? "";
            var roleLevel = child["RoleLevel"] ?? "user";
            var canEditOthers = bool.TryParse(child["CanEditOthers"], out var b) && b;

            // 只在不存在時 INSERT (絕不覆寫使用者後續從 UI 改過的 Name/Dept 等欄位)
            const string upsertSql = @"
                IF NOT EXISTS (SELECT 1 FROM Accounts WHERE EmpId = @EmpId)
                BEGIN
                    INSERT INTO Accounts (EmpId, Name, Department, RoleLevel, CanEditOthers, LoginCount, LastLoginTime)
                    VALUES (@EmpId, @Name, @Dept, @RoleLevel, @CanEditOthers, 0, NULL);
                END";
            using var cmd = new SqlCommand(upsertSql, conn);
            cmd.Parameters.AddWithValue("@EmpId", empId);
            cmd.Parameters.AddWithValue("@Name", name);
            cmd.Parameters.AddWithValue("@Dept", dept);
            cmd.Parameters.AddWithValue("@RoleLevel", roleLevel);
            cmd.Parameters.AddWithValue("@CanEditOthers", canEditOthers);

            var affected = await cmd.ExecuteNonQueryAsync();
            if (affected > 0)
            {
                _logger.LogInformation("✅ SchemaBootstrap 種入測試帳號 {EmpId} ({Name})", empId, name);
            }
        }
    }
}
