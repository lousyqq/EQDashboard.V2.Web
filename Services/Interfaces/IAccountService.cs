using EQDashboard.V2.Web.Controllers;

namespace EQDashboard.V2.Web.Services.Interfaces;

/// <summary>
/// 帳號操作結果狀態（對齊 <see cref="MenuOpStatus"/> 的模式，讓 Controller 能薄薄地映射成 HTTP 狀態碼）。
///   Forbidden 必須是獨立狀態 —— 授權測試依賴 403，不能與 400 混用。
/// </summary>
public enum AccountOpStatus
{
    Success,
    BadRequest,
    NotFound,
    Forbidden
}

/// <summary>帳號寫入操作的結果。<see cref="BackupJson"/> 僅在刪除成功時有值（供 Controller 寫稽核還原備份）。</summary>
public sealed class AccountOperationResult
{
    public AccountOpStatus Status { get; init; }
    public string? Message { get; init; }
    public string? BackupJson { get; init; }

    public bool IsSuccess => Status == AccountOpStatus.Success;

    public static AccountOperationResult Ok(string? backupJson = null)
        => new() { Status = AccountOpStatus.Success, BackupJson = backupJson };
    public static AccountOperationResult Bad(string message)
        => new() { Status = AccountOpStatus.BadRequest, Message = message };
    public static AccountOperationResult Missing(string message)
        => new() { Status = AccountOpStatus.NotFound, Message = message };
    public static AccountOperationResult Denied(string message)
        => new() { Status = AccountOpStatus.Forbidden, Message = message };
}

public interface IAccountService
{
    /// <summary>
    /// 帳號清單 server-side 分頁（供「帳號管理」表格按需載入）。
    ///   只回每列「基本顯示資料」（empId/name/department/roleLevel + assignedRoles + defaultPages），
    ///   不含 manageableMenus/extra/deny 等明細（那些只在編輯時透過 GetAccountDetailsAsync lazy-load）。
    ///   q：以 EmpId / Name / Department 模糊比對；分頁直接下推 DB（Skip/Take），避免全表撈進記憶體。
    ///   ⚠️ <paramref name="isAdmin"/>=false（委派管理者）時**不回傳任何 admin 帳號** ——
    ///     委派者不得檢視或編輯管理員帳號（2026-08-24 第七輪 J1/J2）。
    /// </summary>
    Task<(List<object> items, int total)> GetAccountsPagedAsync(int page, int pageSize, string? q, bool isAdmin);

    /// <summary>
    /// 一次性匯出全部帳號的完整明細（供 Excel 匯出備份用，admin 明確觸發、非熱路徑）。
    ///   含 assignedRoles / manageableMenus / defaultPages（對齊 createWorkbookData 會用到的 sheet 欄位）。
    ///   ⚠️ 端點層已鎖 admin-only（全量帳號明細不得外流給委派管理者）。
    /// </summary>
    Task<List<object>> GetAccountsForExportAsync();

    /// <summary>單一帳號完整明細。非 admin 查 admin 帳號一律回 null（Controller 轉 404，不洩漏存在性）。</summary>
    Task<object?> GetAccountDetailsAsync(string empId, bool isAdmin);

    /// <summary>建立帳號 —— **admin only**（委派管理者不得新增帳號）。</summary>
    Task<AccountOperationResult> CreateAccountAsync(AccountFullDto dto, bool isAdmin);

    /// <summary>
    /// 更新帳號。<paramref name="callerEmpId"/> / <paramref name="isAdmin"/> 決定可寫範圍：
    ///   - admin：全開。
    ///   - 委派管理者（RoleLevel=user + CanEditOthers=true）：
    ///       ① 不可編輯 admin 帳號（403）
    ///       ② `RoleLevel` / `CanEditOthers` 的異動一律忽略（維持 DB 現值）
    ///       ③ 主從關係：只能授出「自己委派子樹內的看板」與「自己已擁有的角色」；
    ///          目標帳號原有、但落在呼叫者範圍外的授權一律**原封保留**（不得被降權）。
    /// </summary>
    Task<AccountOperationResult> UpdateAccountAsync(string empId, AccountFullDto dto, string callerEmpId, bool isAdmin);

    /// <summary>刪除帳號 —— **admin only**（委派管理者不得刪除帳號）。<paramref name="currentEmpId"/> 用於擋「刪自己」。</summary>
    Task<AccountOperationResult> DeleteAccountAsync(string empId, string? currentEmpId, bool isAdmin);
}
