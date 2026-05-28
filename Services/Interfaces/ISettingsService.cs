using System.Text.Json;

namespace EQDashboard.V2.Web.Services.Interfaces;

/// <summary>
/// 設定資料服務介面 - 負責讀取/寫入/同步所有設定資料表
/// </summary>
public interface ISettingsService
{
    /// <summary>讀取所有資料表並回傳為字典結構</summary>
    Task<Dictionary<string, object>> GetInitialDataAsync();

    /// <summary>將前端傳來的 JSON payload 寫入資料庫（含批次防呆）</summary>
    Task<(bool success, string message)> SaveDataAsync(Dictionary<string, List<Dictionary<string, JsonElement>>> payload);

    /// <summary>更新登入統計（LoginCount + 1、LastLoginTime）</summary>
    Task<(bool success, int loginCount, string? lastLoginTime, string? errorMessage)> UpdateLoginStatsAsync(string empId);

    /// <summary>
    /// 清除 GetInitialDataAsync 的快取。
    /// 任何 RESTful Controller（Fabs/Roles/Accounts/Menus...）寫入後必須呼叫，
    /// 否則前端下一次 fetchInitialDataFromDB 將拿到舊快照，UI 看起來像「沒儲存成功」。
    /// </summary>
    void InvalidateInitialDataCache();
}
