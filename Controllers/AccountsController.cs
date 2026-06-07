using Microsoft.AspNetCore.Mvc;
using EQDashboard.V2.Web.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using System.ComponentModel.DataAnnotations;

namespace EQDashboard.V2.Web.Controllers;

[Route("api/[controller]")]
[ApiController]
[Authorize(Roles = "admin")]
public class AccountsController : ControllerBase
{
    private readonly IAccountService _accountService;
    private readonly IActivityLogger _activityLogger;

    public AccountsController(IAccountService accountService, IActivityLogger activityLogger)
    {
        _accountService = accountService;
        _activityLogger = activityLogger;
    }

    [HttpGet]
    public async Task<IActionResult> GetAccounts()
    {
        var result = await _accountService.GetAccountsAsync();
        return Ok(result);
    }

    [HttpGet("{id}")]
    public async Task<IActionResult> GetAccountDetails(string id)
    {
        var result = await _accountService.GetAccountDetailsAsync(id);
        if (result == null) return NotFound();
        return Ok(result);
    }

    [HttpPost]
    public async Task<IActionResult> CreateAccount([FromBody] AccountFullDto dto)
    {
        var (success, errorMessage) = await _accountService.CreateAccountAsync(dto);
        if (!success) return BadRequest(errorMessage);
        return Ok(new { success = true });
    }

    [HttpPut("{id}")]
    public async Task<IActionResult> UpdateAccount(string id, [FromBody] AccountFullDto dto)
    {
        var (success, errorMessage) = await _accountService.UpdateAccountAsync(id, dto);
        if (!success) return NotFound(errorMessage);
        return Ok(new { success = true });
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> DeleteAccount(string id)
    {
        // 取 cookie claim 中的 EmpId 傳給 service，用於擋「刪自己」
        var currentEmpId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        var (success, errorMessage, backupJson) = await _accountService.DeleteAccountAsync(id, currentEmpId);
        if (!success) return BadRequest(errorMessage);  // 改回 400 — 拒絕原因應該明確（NotFound 只適用「真的找不到」）
        
        if (backupJson != null)
        {
            await _activityLogger.LogAuditAsync(HttpContext, "Accounts", "Delete", id, "Soft Delete Backup", backupJson);
        }
        
        return Ok(new { success = true });
    }
}

public class AccountFullDto
{
    [Required(ErrorMessage = "工號必填")]
    [StringLength(50)]
    public string EmpId { get; set; } = string.Empty;

    [StringLength(100)]
    public string? Name { get; set; }

    [StringLength(100)]
    public string? Department { get; set; }

    // 必須限定枚舉：否則可建出 RoleLevel='superuser' 等奇怪字串，混亂 sidebar/權限判定。
    // 系統只認 'admin' 與 'user'（不分大小寫，AuthController 會 .ToLower() 寫入 claim）。
    [Required(ErrorMessage = "RoleLevel 必填")]
    [RegularExpression("^(admin|user|ADMIN|USER|Admin|User)$", ErrorMessage = "RoleLevel 只能是 admin 或 user")]
    [StringLength(20)]
    public string? RoleLevel { get; set; }

    public bool CanEditOthers { get; set; }
    public List<string>? AssignedRoles { get; set; }
    public List<string>? ManageableMenus { get; set; }
    public List<string>? ExtraMenus { get; set; }
    public List<string>? DenyMenus { get; set; }
    public Dictionary<string, string>? DefaultPages { get; set; }
}
