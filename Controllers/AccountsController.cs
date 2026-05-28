using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using EQDashboard.V2.Web.Data;
using EQDashboard.V2.Web.Models;
using EQDashboard.V2.Web.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using System.ComponentModel.DataAnnotations;

namespace EQDashboard.V2.Web.Controllers;

[Route("api/[controller]")]
[ApiController]
[Authorize(Roles = "admin")]
public class AccountsController : ControllerBase
{
    private readonly AppDbContext _context;
    private readonly ISettingsService _settingsService;

    public AccountsController(AppDbContext context, ISettingsService settingsService)
    {
        _context = context;
        _settingsService = settingsService;
    }

    [HttpGet]
    public async Task<IActionResult> GetAccounts()
    {
        var accounts = await _context.Accounts
            .Include(a => a.MapAccountRoles)
            .Include(a => a.MapAccountManageMenus)
            .Include(a => a.MapAccountDefaultPages)
            .ToListAsync();

        var result = accounts.Select(a => new
        {
            empId = a.EmpId,
            name = a.Name,
            department = a.Department,
            roleLevel = a.RoleLevel,
            canEditOthers = a.CanEditOthers,
            loginCount = a.LoginCount,
            lastLoginTime = a.LastLoginTime,
            assignedRoles = a.MapAccountRoles?.Select(m => m.RoleId).ToList() ?? new List<string>(),
            manageableMenus = a.MapAccountManageMenus?.Select(m => m.MenuId).ToList() ?? new List<string>(),
            defaultPages = a.MapAccountDefaultPages?.ToDictionary(m => m.FabId, m => m.MenuId) ?? new Dictionary<string, string>()
        });

        return Ok(result);
    }

    [HttpPost]
    public async Task<IActionResult> CreateAccount([FromBody] AccountFullDto dto)
    {
        if (await _context.Accounts.AnyAsync(a => a.EmpId == dto.EmpId))
            return BadRequest("帳號工號已存在");

        var account = new Account
        {
            EmpId = dto.EmpId,
            Name = dto.Name,
            Department = dto.Department,
            RoleLevel = dto.RoleLevel,
            CanEditOthers = dto.CanEditOthers
        };

        _context.Accounts.Add(account);

        UpdateAccountMappings(dto);

        await _context.SaveChangesAsync();
        _settingsService.InvalidateInitialDataCache();
        return Ok(new { success = true });
    }

    [HttpPut("{id}")]
    public async Task<IActionResult> UpdateAccount(string id, [FromBody] AccountFullDto dto)
    {
        var account = await _context.Accounts
            .Include(a => a.MapAccountRoles)
            .Include(a => a.MapAccountManageMenus)
            .Include(a => a.MapAccountDefaultPages)
            .FirstOrDefaultAsync(a => a.EmpId == id);

        if (account == null) return NotFound();

        account.Name = dto.Name;
        account.Department = dto.Department;
        account.RoleLevel = dto.RoleLevel;
        account.CanEditOthers = dto.CanEditOthers;

        // 移除舊有 Mapping
        if (account.MapAccountRoles != null) _context.MapAccountRoles.RemoveRange(account.MapAccountRoles);
        if (account.MapAccountManageMenus != null) _context.MapAccountManageMenus.RemoveRange(account.MapAccountManageMenus);
        if (account.MapAccountDefaultPages != null) _context.MapAccountDefaultPages.RemoveRange(account.MapAccountDefaultPages);

        await _context.SaveChangesAsync(); // 強制執行刪除以避免 PK tracking 衝突

        UpdateAccountMappings(dto);

        await _context.SaveChangesAsync();
        _settingsService.InvalidateInitialDataCache();
        return Ok(new { success = true });
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> DeleteAccount(string id)
    {
        var account = await _context.Accounts
            .Include(a => a.MapAccountRoles)
            .Include(a => a.MapAccountManageMenus)
            .Include(a => a.MapAccountDefaultPages)
            .FirstOrDefaultAsync(a => a.EmpId == id);
        if (account == null) return NotFound();

        // 先清掉關聯，避免 FK 限制阻擋刪除
        if (account.MapAccountRoles != null && account.MapAccountRoles.Count > 0)
            _context.MapAccountRoles.RemoveRange(account.MapAccountRoles);
        if (account.MapAccountManageMenus != null && account.MapAccountManageMenus.Count > 0)
            _context.MapAccountManageMenus.RemoveRange(account.MapAccountManageMenus);
        if (account.MapAccountDefaultPages != null && account.MapAccountDefaultPages.Count > 0)
            _context.MapAccountDefaultPages.RemoveRange(account.MapAccountDefaultPages);

        // PersonalSettings 不使用 FK 關聯，需要明確刪除避免遺留孤兒紀錄
        var pSettings = await _context.PersonalSettings.Where(p => p.EmpId == id).ToListAsync();
        if (pSettings.Count > 0) _context.PersonalSettings.RemoveRange(pSettings);

        _context.Accounts.Remove(account);
        await _context.SaveChangesAsync();
        _settingsService.InvalidateInitialDataCache();
        return Ok(new { success = true });
    }

    private void UpdateAccountMappings(AccountFullDto dto)
    {
        if (dto.AssignedRoles != null)
        {
            foreach (var rId in dto.AssignedRoles)
            {
                _context.MapAccountRoles.Add(new MapAccountRole { EmpId = dto.EmpId, RoleId = rId });
            }
        }

        if (dto.ManageableMenus != null)
        {
            foreach (var mId in dto.ManageableMenus)
            {
                _context.MapAccountManageMenus.Add(new MapAccountManageMenu { EmpId = dto.EmpId, MenuId = mId });
            }
        }

        if (dto.DefaultPages != null)
        {
            foreach (var kvp in dto.DefaultPages)
            {
                _context.MapAccountDefaultPages.Add(new MapAccountDefaultPage { EmpId = dto.EmpId, FabId = kvp.Key, MenuId = kvp.Value });
            }
        }
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
    
    [StringLength(20)]
    public string? RoleLevel { get; set; }
    
    public bool CanEditOthers { get; set; }
    public List<string>? AssignedRoles { get; set; }
    public List<string>? ManageableMenus { get; set; }
    public Dictionary<string, string>? DefaultPages { get; set; }
}
