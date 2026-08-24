using Microsoft.AspNetCore.Mvc;
using EQDashboard.V2.Web.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using System.ComponentModel.DataAnnotations;
using System.Security.Claims;

namespace EQDashboard.V2.Web.Controllers;

/// <summary>
/// ⚠️ class-level policy 是 <c>CanManageAccounts</c> = <c>admin || CanEditOthers</c>，
///    也就是「委派管理者」也進得來 —— 但**進得來不等於什麼都能做**。
///    真正的分級判斷一律下放到 <see cref="IAccountService"/>（它會收 callerEmpId + isAdmin），
///    Controller 只負責把 <see cref="AccountOpStatus"/> 映射成 HTTP 狀態碼。
///    千萬不要在這裡用「前端有沒有顯示按鈕」當作安全邊界（2026-08-24 第七輪 J1 的教訓：
///    Service 不知道呼叫者是誰，委派管理者可直接 PUT 自己的 RoleLevel='admin' 完成提權）。
/// </summary>
[Route("api/[controller]")]
[ApiController]
[Authorize(Policy = "CanManageAccounts")]
public class AccountsController : ControllerBase
{
    private readonly IAccountService _accountService;
    private readonly IActivityLogger _activityLogger;

    public AccountsController(IAccountService accountService, IActivityLogger activityLogger)
    {
        _accountService = accountService;
        _activityLogger = activityLogger;
    }

    // ⚠️ 不可用 User.Identity?.Name — 那是姓名不是 EmpId（同 MenusController 的註解）。
    private string CurrentEmpId => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "";
    private bool IsAdmin => User.IsInRole("admin");

    /// <summary>把 Service 的 <see cref="AccountOperationResult"/> 映射成對應 HTTP 狀態碼（授權測試依賴 403）。</summary>
    private IActionResult MapResult(AccountOperationResult r) => r.Status switch
    {
        AccountOpStatus.Success => Ok(new { success = true }),
        AccountOpStatus.Forbidden => Forbid(),
        AccountOpStatus.NotFound => NotFound(r.Message),
        AccountOpStatus.BadRequest => BadRequest(r.Message),
        _ => StatusCode(500)
    };

    // 帳號清單 server-side 分頁端點：帳號管理表格按需向這裡取「單頁」基本資料，
    //   不再隨 GetInitialData 把全部帳號一次塞給 admin（10 萬帳號也只回一頁，前端不致崩潰）。
    [HttpGet]
    public async Task<IActionResult> GetAccounts([FromQuery] int page = 1, [FromQuery] int pageSize = 10, [FromQuery] string? q = null)
    {
        // isAdmin=false → Service 會把 admin 帳號整批濾掉（委派管理者看不到也編不到管理員）。
        var (items, total) = await _accountService.GetAccountsPagedAsync(page, pageSize, q, IsAdmin);
        return Ok(new { items, total, page, pageSize });
    }

    // Excel 匯出備份：一次性回全部帳號的完整明細（admin 明確觸發、非熱路徑）。
    //   ⚠️ 路由 literal "export" 在 ASP.NET 路由優先序高於 "{id}"，不會被當成 id。
    //   ⚠️ admin-only：這支繞過分頁與 admin 過濾，會把全站帳號明細一次吐出，
    //      委派管理者不得取用（否則 GetAccounts 的過濾等於白做）。
    [HttpGet("export")]
    [Authorize(Roles = "admin")]
    public async Task<IActionResult> GetAccountsForExport()
    {
        var result = await _accountService.GetAccountsForExportAsync();
        return Ok(result);
    }

    [HttpGet("{id}")]
    public async Task<IActionResult> GetAccountDetails(string id)
    {
        var result = await _accountService.GetAccountDetailsAsync(id, IsAdmin);
        if (result == null) return NotFound();
        return Ok(result);
    }

    [HttpPost]
    public async Task<IActionResult> CreateAccount([FromBody] AccountFullDto dto)
        => MapResult(await _accountService.CreateAccountAsync(dto, IsAdmin));

    [HttpPut("{id}")]
    public async Task<IActionResult> UpdateAccount(string id, [FromBody] AccountFullDto dto)
        // NotFound 只適用「帳號真的不存在」；策略拒絕（super-admin 防降級、stale mapping id）回 400、
        // 越權（委派者改 admin 帳號）回 403 —— 三者語意分明，授權測試依賴 403。
        => MapResult(await _accountService.UpdateAccountAsync(id, dto, CurrentEmpId, IsAdmin));

    [HttpDelete("{id}")]
    public async Task<IActionResult> DeleteAccount(string id)
    {
        // 取 cookie claim 中的 EmpId 傳給 service，用於擋「刪自己」
        var result = await _accountService.DeleteAccountAsync(id, CurrentEmpId, IsAdmin);

        if (result.IsSuccess && result.BackupJson != null)
        {
            await _activityLogger.LogAuditAsync(HttpContext, "Accounts", "Delete", id, "Soft Delete Backup", result.BackupJson);
        }

        return MapResult(result);
    }
}

public class AccountFullDto
{
    [Required(ErrorMessage = "val_empid_required")]
    [StringLength(50)]
    public string EmpId { get; set; } = string.Empty;

    [StringLength(100)]
    public string? Name { get; set; }

    [StringLength(100)]
    public string? Department { get; set; }

    // 必須限定枚舉：否則可建出 RoleLevel='superuser' 等奇怪字串，混亂 sidebar/權限判定。
    // 系統只認 'admin' 與 'user'（不分大小寫，AuthController 會 .ToLower() 寫入 claim）。
    [Required(ErrorMessage = "val_rolelevel_required")]
    [RegularExpression("^(admin|user|ADMIN|USER|Admin|User)$", ErrorMessage = "val_rolelevel_invalid")]
    [StringLength(20)]
    public string? RoleLevel { get; set; }

    public bool CanEditOthers { get; set; }
    public List<string>? AssignedRoles { get; set; }
    public List<string>? ManageableMenus { get; set; }
    // per-fab 個別覆寫：key = FabId、value = 該廠區的 MenuId 清單。
    // （與 DefaultPages 同樣以「廠區為 key」的字典形狀傳遞。）
    public Dictionary<string, List<string>>? ExtraMenus { get; set; }
    public Dictionary<string, List<string>>? DenyMenus { get; set; }
    public Dictionary<string, string>? DefaultPages { get; set; }
}
