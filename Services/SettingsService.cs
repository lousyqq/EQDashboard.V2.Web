using System.Data;
using Microsoft.Data.SqlClient;
using System.Text.Json;
using EQDashboard.V2.Web.Services.Interfaces;
using Microsoft.Extensions.Caching.Memory;

namespace EQDashboard.V2.Web.Services;

/// <summary>
/// 設定資料服務 - 從 SettingsController 抽出的核心業務邏輯
/// </summary>
public class SettingsService : ISettingsService
{
    private readonly string _connStr;
    private readonly ILogger<SettingsService> _logger;
    private readonly Microsoft.Extensions.Caching.Memory.IMemoryCache _cache;

    private const string InitialDataCacheKey = "InitialData";

    private static readonly string[] TableNames = new[]
    {
        "Menus", "Fabs", "Roles", "Accounts", "Apps", "Requests",
        "Map_Fab_Role", "Map_Account_Role", "Map_Account_ManageMenu",
        "Map_Role_Menu", "Map_Menu_Structure", "Map_Account_DefaultPage", "PersonalSettings"
    };

    public SettingsService(IConfiguration config, ILogger<SettingsService> logger, Microsoft.Extensions.Caching.Memory.IMemoryCache cache)
    {
        _connStr = config.GetConnectionString("EQDashboard")
            ?? throw new InvalidOperationException("Missing connection string 'EQDashboard'");
        _logger = logger;
        _cache = cache;
    }

    public async Task<Dictionary<string, object>> GetInitialDataAsync()
    {
        // 嘗試從快取取得資料
        if (_cache.TryGetValue(InitialDataCacheKey, out Dictionary<string, object>? cachedData))
        {
            _logger.LogInformation("Loaded initial data from cache.");
            return cachedData!;
        }

        var dbData = new Dictionary<string, object>();

        using var conn = new SqlConnection(_connStr);
        await conn.OpenAsync();

        foreach (var tableName in TableNames)
        {
            var tableData = new List<Dictionary<string, object>>();
            try
            {
                // 讀取前先確認資料表是否存在
                using var checkCmd = new SqlCommand(
                    "SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = @tb", conn);
                checkCmd.Parameters.AddWithValue("@tb", tableName);
                if ((int)(await checkCmd.ExecuteScalarAsync())! == 0) continue;

                using var cmd = new SqlCommand($"SELECT * FROM [{tableName}]", conn);
                using var reader = await cmd.ExecuteReaderAsync();
                while (await reader.ReadAsync())
                {
                    var row = new Dictionary<string, object>();
                    for (int i = 0; i < reader.FieldCount; i++)
                    {
                        row[reader.GetName(i)] = reader.IsDBNull(i) ? null! : reader.GetValue(i);
                    }
                    tableData.Add(row);
                }
                dbData[tableName] = tableData;
            }
            catch (Exception tblEx)
            {
                _logger.LogWarning(tblEx, "Failed to load table {TableName}", tableName);
            }
        }

        // 寫入快取，設定 30 分鐘過期
        _cache.Set(InitialDataCacheKey, dbData, TimeSpan.FromMinutes(30));

        return dbData;
    }

    public async Task<(bool success, string message)> SaveDataAsync(
        Dictionary<string, List<Dictionary<string, JsonElement>>> payload)
    {
        int successCount = 0;
        var errorLogs = new List<string>();

        using var conn = new SqlConnection(_connStr);
        await conn.OpenAsync();
        using var trans = conn.BeginTransaction();

        foreach (var tableName in TableNames)
        {
            if (!payload.ContainsKey(tableName) || payload[tableName] == null) continue;
            var tableData = payload[tableName];

            // 檢查是否有真實有效的資料
            bool hasAnyValidData = tableData.Any(row =>
                row != null && row.Count > 0 && row.Any(p =>
                    p.Value.ValueKind != JsonValueKind.Null &&
                    p.Value.ValueKind != JsonValueKind.Undefined &&
                    !string.IsNullOrWhiteSpace(p.Value.ToString())));

            if (!hasAnyValidData) continue;

            // 確認資料表是否存在
            using (var checkCmd = new SqlCommand(
                "SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = @tb", conn, trans))
            {
                checkCmd.Parameters.AddWithValue("@tb", tableName);
                if ((int)(await checkCmd.ExecuteScalarAsync())! == 0) continue;
            }

            // 防呆：比對舊筆數 vs 新筆數
            int oldCount = 0;
            try
            {
                using var countCmd = new SqlCommand($"SELECT COUNT(*) FROM [{tableName}]", conn, trans);
                oldCount = Convert.ToInt32(await countCmd.ExecuteScalarAsync());
            }
            catch { }

            int newCount = tableData.Count(row => row != null && row.Any(p =>
                p.Value.ValueKind != JsonValueKind.Null &&
                p.Value.ValueKind != JsonValueKind.Undefined &&
                !string.IsNullOrWhiteSpace(p.Value.ToString())));

            if (oldCount >= 5 && newCount < oldCount * 0.2)
            {
                errorLogs.Add($"[{tableName}] 拒絕覆寫：原 {oldCount} 筆，新資料僅 {newCount} 筆（縮減超過 80%），本表略過。");
                continue;
            }

            // 清空舊資料
            using (var cmd = new SqlCommand($"DELETE FROM [{tableName}]", conn, trans))
            {
                await cmd.ExecuteNonQueryAsync();
            }

            // 獲取 Schema 資訊
            var columnMaxLengths = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            var columnTypes = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            bool hasIdentity = false;

            try
            {
                using (var idCmd = new SqlCommand(
                    $"SELECT COUNT(*) FROM sys.columns WHERE object_id = OBJECT_ID('[{tableName}]') AND is_identity = 1",
                    conn, trans))
                {
                    hasIdentity = (int)(await idCmd.ExecuteScalarAsync())! > 0;
                }

                using var schemaCmd = new SqlCommand(
                    "SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = @tb",
                    conn, trans);
                schemaCmd.Parameters.AddWithValue("@tb", tableName);
                using var schemaReader = await schemaCmd.ExecuteReaderAsync();
                while (await schemaReader.ReadAsync())
                {
                    string colName = schemaReader.GetString(0);
                    string dataType = schemaReader.GetString(1).ToLower();
                    int maxLen = schemaReader.IsDBNull(2) ? 0 : Convert.ToInt32(schemaReader.GetValue(2));
                    columnMaxLengths[colName] = maxLen;
                    columnTypes[colName] = dataType;
                }
            }
            catch { }

            if (hasIdentity)
            {
                try
                {
                    using var cmdOn = new SqlCommand($"SET IDENTITY_INSERT [{tableName}] ON", conn, trans);
                    await cmdOn.ExecuteNonQueryAsync();
                }
                catch { }
            }

            try
            {
                foreach (var row in tableData)
                {
                    bool hasActualRowData = row.Any(p =>
                        p.Value.ValueKind != JsonValueKind.Null &&
                        p.Value.ValueKind != JsonValueKind.Undefined &&
                        !string.IsNullOrWhiteSpace(p.Value.ToString()));
                    if (!hasActualRowData) continue;

                    var (insertSuccess, errorMsg) = await InsertRowAsync(
                        conn, trans, tableName, row, columnTypes, columnMaxLengths);

                    if (insertSuccess) successCount++;
                    else if (errorMsg != null) errorLogs.Add(errorMsg);
                }
            }
            finally
            {
                if (hasIdentity)
                {
                    try
                    {
                        using var cmdOff = new SqlCommand($"SET IDENTITY_INSERT [{tableName}] OFF", conn, trans);
                        await cmdOff.ExecuteNonQueryAsync();
                    }
                    catch { }
                }
            }
        }

        trans.Commit();

        // 寫入成功後，清除快取
        _cache.Remove(InitialDataCacheKey);
        _logger.LogInformation("Cache cleared after successful save.");

        if (errorLogs.Count > 0)
        {
            string htmlMsg = $"<b>匯入完畢，成功: {successCount} 筆，略過異常: {errorLogs.Count} 筆。</b><br>" +
                "<div style='max-height:250px; overflow-y:auto; text-align:left; font-size:0.8rem; margin-top:10px; padding:10px; background:#f8d7da; color:#721c24; border-radius:5px;'>" +
                string.Join("<br>", errorLogs.Select(e => $"• {e}")) +
                "</div><div style='margin-top:10px; font-size:0.8rem; color:#666;'>請檢查上述資料是否包含不合法的空值或是文字塞入數字欄位。正常的資料已順利寫入資料庫。</div>";
            return (true, htmlMsg);
        }

        return (true, $"全部資料 ({successCount} 筆) 已成功同步至資料庫！");
    }

    public void InvalidateInitialDataCache()
    {
        _cache.Remove(InitialDataCacheKey);
    }

    public async Task<(bool success, int loginCount, string? lastLoginTime, string? errorMessage)> UpdateLoginStatsAsync(string empId)
    {
        if (string.IsNullOrWhiteSpace(empId))
            return (false, 0, null, "EmpId 為必填欄位");

        using var conn = new SqlConnection(_connStr);
        await conn.OpenAsync();

        // 確認欄位存在
        using (var alterCmd = new SqlCommand(@"
            IF COL_LENGTH('Accounts','LoginCount') IS NULL
                ALTER TABLE Accounts ADD LoginCount INT NULL;
            IF COL_LENGTH('Accounts','LastLoginTime') IS NULL
                ALTER TABLE Accounts ADD LastLoginTime DATETIME NULL;", conn))
        {
            await alterCmd.ExecuteNonQueryAsync();
        }

        // UPDATE 累計 +1
        int affected;
        using (var updateCmd = new SqlCommand(@"
            UPDATE Accounts
            SET LoginCount = ISNULL(LoginCount, 0) + 1,
                LastLoginTime = GETDATE()
            WHERE EmpId = @EmpId;", conn))
        {
            updateCmd.Parameters.AddWithValue("@EmpId", empId);
            affected = await updateCmd.ExecuteNonQueryAsync();
        }

        if (affected == 0)
            return (false, 0, null, "找不到帳號 " + empId);

        // SELECT 取回最新值
        using var selectCmd = new SqlCommand(@"
            SELECT ISNULL(LoginCount, 0), LastLoginTime
            FROM Accounts WHERE EmpId = @EmpId;", conn);
        selectCmd.Parameters.AddWithValue("@EmpId", empId);

        using var r = await selectCmd.ExecuteReaderAsync();
        if (await r.ReadAsync())
        {
            int loginCount = Convert.ToInt32(r.GetValue(0));
            DateTime? lastLogin = r.IsDBNull(1) ? null : Convert.ToDateTime(r.GetValue(1));
            return (true, loginCount,
                lastLogin?.ToString("yyyy-MM-dd HH:mm:ss"), null);
        }

        return (false, 0, null, "找不到帳號 " + empId);
    }

    /// <summary>插入單筆資料列（含型別防呆）</summary>
    private async Task<(bool success, string? errorMsg)> InsertRowAsync(
        SqlConnection conn, SqlTransaction trans, string tableName,
        Dictionary<string, JsonElement> row,
        Dictionary<string, string> columnTypes,
        Dictionary<string, int> columnMaxLengths)
    {
        var validColumns = new List<string>();
        var validParams = new List<string>();
        string rowIdentifier = "未知";
        bool idCaptured = false;

        using var insertCmd = new SqlCommand { Connection = conn, Transaction = trans };
        int pIndex = 0;

        try
        {
            foreach (var prop in row)
            {
                string colName = prop.Key;

                if (!idCaptured && prop.Value.ValueKind != JsonValueKind.Null && prop.Value.ValueKind != JsonValueKind.Undefined)
                {
                    string tempStr = prop.Value.ToString();
                    if (!string.IsNullOrWhiteSpace(tempStr)) { rowIdentifier = tempStr; idCaptured = true; }
                }

                if (columnTypes.Count > 0 && !columnTypes.ContainsKey(colName)) continue;

                JsonElement val = prop.Value;
                bool isNull = true;
                object? paramValue = null;

                if (val.ValueKind != JsonValueKind.Null && val.ValueKind != JsonValueKind.Undefined)
                {
                    string strVal = val.ToString();
                    if (!string.IsNullOrEmpty(strVal))
                    {
                        isNull = false;
                        if (columnTypes.ContainsKey(colName))
                        {
                            string dbType = columnTypes[colName];
                            if (dbType.Contains("char") || dbType.Contains("text"))
                            {
                                int maxLen = columnMaxLengths[colName];
                                if (maxLen > 0 && maxLen < 10000000 && strVal.Length > maxLen)
                                    strVal = strVal[..maxLen];
                                paramValue = strVal;
                            }
                            else if (dbType.Contains("bit"))
                            {
                                paramValue = val.ValueKind == JsonValueKind.True ||
                                    strVal.Equals("true", StringComparison.OrdinalIgnoreCase) || strVal == "1";
                            }
                            else if (dbType.Contains("int"))
                            {
                                if (long.TryParse(strVal, out long parsedLong)) paramValue = parsedLong;
                                else isNull = true;
                            }
                            else if (dbType.Contains("float") || dbType.Contains("decimal") || dbType.Contains("numeric"))
                            {
                                if (double.TryParse(strVal, out double parsedDouble)) paramValue = parsedDouble;
                                else isNull = true;
                            }
                            else if (dbType.Contains("date") || dbType.Contains("time"))
                            {
                                if (DateTime.TryParse(strVal, out DateTime parsedDate)) paramValue = parsedDate;
                                else isNull = true;
                            }
                            else paramValue = strVal;
                        }
                        else paramValue = strVal;
                    }
                }

                validColumns.Add($"[{colName}]");
                if (isNull || paramValue == null)
                {
                    validParams.Add("NULL");
                }
                else
                {
                    string paramName = "@p" + pIndex;
                    validParams.Add(paramName);
                    insertCmd.Parameters.AddWithValue(paramName, paramValue);
                    pIndex++;
                }
            }

            if (validColumns.Count > 0)
            {
                insertCmd.CommandText = $"INSERT INTO [{tableName}] ({string.Join(", ", validColumns)}) VALUES ({string.Join(", ", validParams)})";
                string savePoint = "Sp_" + Guid.NewGuid().ToString("N")[..8];
                trans.Save(savePoint);

                try
                {
                    await insertCmd.ExecuteNonQueryAsync();
                    return (true, null);
                }
                catch (Exception sqlRowEx)
                {
                    trans.Rollback(savePoint);
                    return (false, $"[{tableName}] (關鍵字: {rowIdentifier}) 寫入失敗 - {sqlRowEx.Message}");
                }
            }
        }
        catch (Exception preEx)
        {
            return (false, $"[{tableName}] (關鍵字: {rowIdentifier}) 解析失敗 - {preEx.Message}");
        }

        return (true, null);
    }
}
