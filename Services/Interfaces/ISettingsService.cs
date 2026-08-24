using System.Text.Json;

namespace EQDashboard.V2.Web.Services.Interfaces;

/// <summary>
/// SaveData 過程中「某張表被防呆擋下、整表略過」的紀錄。
/// 只帶代碼與數字，句子由前端 <c>t()</c> 組（§4-前端-9：後端不回可直接顯示的中文）。
/// </summary>
/// <param name="Code">略過原因代碼：<c>skip_empty</c>（新資料 0 筆）／<c>skip_shrink</c>（縮減超過 80%）</param>
public record SaveDataSkip(string Code, string Table, int OldCount, int NewCount);

/// <summary>
/// SaveData 的結果。
/// <para>
/// ⚠️ <paramref name="MessageCode"/> 是 i18n key（前端以 <c>t()</c> 呈現）；
/// <paramref name="Detail"/> 則是**刻意不翻譯**的診斷字串（SQL 例外訊息、資料表名），
/// 給 admin 定位問題用 —— 這類內容本來就沒有對應的譯文，硬塞代碼只會失去資訊。
/// </para>
/// </summary>
public record SaveDataResult(
    bool Success,
    string MessageCode,
    string? Detail = null,
    int Count = 0,
    IReadOnlyList<SaveDataSkip>? Skipped = null);

/// <summary>
/// 設定資料服務介面 - 負責讀取/寫入/同步所有設定資料表
/// </summary>
public interface ISettingsService
{
    /// <summary>取得目前的 ETag 值</summary>
    string GetCurrentETag();

    /// <summary>
    /// 讀取所有資料表並回傳為字典結構。
    /// 全域表（不隨帳號數成長）走共享快取；「帳號相關表」(Accounts / PersonalSettings / Map_Account_*)
    /// 改以 <paramref name="empId"/> 做 per-caller 點查（只回呼叫者自己這列、不快取），避免 10 萬帳號時整包常駐記憶體 (P1)。
    /// </summary>
    /// <param name="empId">呼叫者工號（取自 ClaimTypes.NameIdentifier）；帳號相關表只回此工號的列。</param>
    Task<Dictionary<string, object>> GetInitialDataAsync(string empId);

    /// <summary>將前端傳來的 JSON payload 寫入資料庫（含批次防呆）</summary>
    Task<SaveDataResult> SaveDataAsync(Dictionary<string, List<Dictionary<string, JsonElement>>> payload);

    /// <summary>更新登入統計（LoginCount + 1、LastLoginTime）。errorCode 為 i18n key，非可顯示文字。</summary>
    Task<(bool success, int loginCount, string? lastLoginTime, string? errorCode)> UpdateLoginStatsAsync(string empId);

    /// <summary>
    /// 清除 GetInitialDataAsync 的快取 (全域與個人快取)。
    /// 任何 RESTful Controller（Fabs/Roles/Menus...）寫入後必須呼叫。
    /// </summary>
    void InvalidateInitialDataCache();

    /// <summary>
    /// 僅清除容易變動的個人資料快取 (PersonalSettings, Accounts, Requests 等)。
    /// 適用於單一使用者更新自己的版面或登入次數時。
    /// </summary>
    void InvalidateVolatileDataCache();
}
