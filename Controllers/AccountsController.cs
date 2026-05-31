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
[Authorize(Roles = "admin,user")]
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
            // 🛡️ Lazy Loading：清單頁面不再 Include 詳細權限，減輕負載
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
            assignedRoles = a.MapAccountRoles?.Select(m => m.RoleId).ToList() ?? new List<string>()
        });

        return Ok(result);
    }

    [HttpGet("{id}")]
    public async Task<IActionResult> GetAccountDetails(string id)
    {
        var a = await _context.Accounts
            .Include(x => x.MapAccountRoles)
            .Include(x => x.MapAccountManageMenus)
            .Include(x => x.MapAccountDefaultPages)
            .Include(x => x.MapAccountExtraMenus)
            .Include(x => x.MapAccountDenyMenus)
            .FirstOrDefaultAsync(x => x.EmpId == id);

        if (a == null) return NotFound();

        return Ok(new
        {
            empId = a.EmpId,
            name = a.Name,
            department = a.Department,
            roleLevel = a.RoleLevel,
            canEditOthers = a.CanEditOthers,
            assignedRoles = a.MapAccountRoles?.Select(m => m.RoleId).ToList() ?? new List<string>(),
            manageableMenus = a.MapAccountManageMenus?.Select(m => m.MenuId).ToList() ?? new List<string>(),
            extraMenus = a.MapAccountExtraMenus?.Select(m => m.MenuId).ToList() ?? new List<string>(),
            denyMenus = a.MapAccountDenyMenus?.Select(m => m.MenuId).ToList() ?? new List<string>(),
            defaultPages = a.MapAccountDefaultPages?.ToDictionary(m => m.FabId, m => m.MenuId) ?? new Dictionary<string, string>()
        });
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
            .Include(a => a.MapAccountExtraMenus)
            .Include(a => a.MapAccountDenyMenus)
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
        if (account.MapAccountExtraMenus != null) _context.MapAccountExtraMenus.RemoveRange(account.MapAccountExtraMenus);
        if (account.MapAccountDenyMenus != null) _context.MapAccountDenyMenus.RemoveRange(account.MapAccountDenyMenus);

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
            .Include(a => a.MapAccountExtraMenus)
            .Include(a => a.MapAccountDenyMenus)
            .FirstOrDefaultAsync(a => a.EmpId == id);
        if (account == null) return NotFound();

        // 先清掉關聯，避免 FK 限制阻擋刪除
        if (account.MapAccountRoles != null && account.MapAccountRoles.Count > 0)
            _context.MapAccountRoles.RemoveRange(account.MapAccountRoles);
        if (account.MapAccountManageMenus != null && account.MapAccountManageMenus.Count > 0)
            _context.MapAccountManageMenus.RemoveRange(account.MapAccountManageMenus);
        if (account.MapAccountDefaultPages != null && account.MapAccountDefaultPages.Count > 0)
            _context.MapAccountDefaultPages.RemoveRange(account.MapAccountDefaultPages);
        if (account.MapAccountExtraMenus != null && account.MapAccountExtraMenus.Count > 0)
            _context.MapAccountExtraMenus.RemoveRange(account.MapAccountExtraMenus);
        if (account.MapAccountDenyMenus != null && account.MapAccountDenyMenus.Count > 0)
            _context.MapAccountDenyMenus.RemoveRange(account.MapAccountDenyMenus);

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

        // 個別覆寫 (額外開放 / 個別封鎖) — 同樣是「全清+全寫」模式
        if (dto.ExtraMenus != null)
        {
            foreach (var mId in dto.ExtraMenus.Distinct())
            {
                _context.MapAccountExtraMenus.Add(new MapAccountExtraMenu { EmpId = dto.EmpId, MenuId = mId });
            }
        }

        if (dto.DenyMenus != null)
        {
            foreach (var mId in dto.DenyMenus.Distinct())
            {
                _context.MapAccountDenyMenus.Add(new MapAccountDenyMenu { EmpId = dto.EmpId, MenuId = mId });
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
    public List<string>? ExtraMenus { get; set; }
    public List<string>? DenyMenus { get; set; }
    public Dictionary<string, string>? DefaultPages { get; set; }
}
