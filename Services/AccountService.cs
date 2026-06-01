using EQDashboard.V2.Web.Controllers;
using EQDashboard.V2.Web.Data;
using EQDashboard.V2.Web.Models;
using EQDashboard.V2.Web.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace EQDashboard.V2.Web.Services;

public class AccountService : IAccountService
{
    private readonly AppDbContext _context;
    private readonly ISettingsService _settingsService;

    public AccountService(AppDbContext context, ISettingsService settingsService)
    {
        _context = context;
        _settingsService = settingsService;
    }

    public async Task<List<object>> GetAccountsAsync()
    {
        var accounts = await _context.Accounts
            .Include(a => a.MapAccountRoles)
            .ToListAsync();

        return accounts.Select(a => new
        {
            empId = a.EmpId,
            name = a.Name,
            department = a.Department,
            roleLevel = a.RoleLevel,
            canEditOthers = a.CanEditOthers,
            loginCount = a.LoginCount,
            lastLoginTime = a.LastLoginTime,
            assignedRoles = a.MapAccountRoles?.Select(m => m.RoleId).ToList() ?? new List<string>()
        }).Cast<object>().ToList();
    }

    public async Task<object?> GetAccountDetailsAsync(string empId)
    {
        var a = await _context.Accounts
            .Include(x => x.MapAccountRoles)
            .Include(x => x.MapAccountManageMenus)
            .Include(x => x.MapAccountDefaultPages)
            .Include(x => x.MapAccountExtraMenus)
            .Include(x => x.MapAccountDenyMenus)
            .FirstOrDefaultAsync(x => x.EmpId == empId);

        if (a == null) return null;

        return new
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
        };
    }

    public async Task<(bool success, string errorMessage)> CreateAccountAsync(AccountFullDto dto)
    {
        if (await _context.Accounts.AnyAsync(a => a.EmpId == dto.EmpId))
            return (false, "帳號工號已存在");

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
        return (true, string.Empty);
    }

    public async Task<(bool success, string errorMessage)> UpdateAccountAsync(string empId, AccountFullDto dto)
    {
        var account = await _context.Accounts
            .Include(a => a.MapAccountRoles)
            .Include(a => a.MapAccountManageMenus)
            .Include(a => a.MapAccountDefaultPages)
            .Include(a => a.MapAccountExtraMenus)
            .Include(a => a.MapAccountDenyMenus)
            .FirstOrDefaultAsync(a => a.EmpId == empId);

        if (account == null) return (false, "找不到指定的帳號");

        account.Name = dto.Name;
        account.Department = dto.Department;
        account.RoleLevel = dto.RoleLevel;
        account.CanEditOthers = dto.CanEditOthers;

        if (account.MapAccountRoles != null) _context.MapAccountRoles.RemoveRange(account.MapAccountRoles);
        if (account.MapAccountManageMenus != null) _context.MapAccountManageMenus.RemoveRange(account.MapAccountManageMenus);
        if (account.MapAccountDefaultPages != null) _context.MapAccountDefaultPages.RemoveRange(account.MapAccountDefaultPages);
        if (account.MapAccountExtraMenus != null) _context.MapAccountExtraMenus.RemoveRange(account.MapAccountExtraMenus);
        if (account.MapAccountDenyMenus != null) _context.MapAccountDenyMenus.RemoveRange(account.MapAccountDenyMenus);

        await _context.SaveChangesAsync(); 

        UpdateAccountMappings(dto);

        await _context.SaveChangesAsync();
        _settingsService.InvalidateInitialDataCache();
        return (true, string.Empty);
    }

    public async Task<(bool success, string errorMessage)> DeleteAccountAsync(string empId)
    {
        var account = await _context.Accounts
            .Include(a => a.MapAccountRoles)
            .Include(a => a.MapAccountManageMenus)
            .Include(a => a.MapAccountDefaultPages)
            .Include(a => a.MapAccountExtraMenus)
            .Include(a => a.MapAccountDenyMenus)
            .FirstOrDefaultAsync(a => a.EmpId == empId);
            
        if (account == null) return (false, "找不到指定的帳號");

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

        var pSettings = await _context.PersonalSettings.Where(p => p.EmpId == empId).ToListAsync();
        if (pSettings.Count > 0) _context.PersonalSettings.RemoveRange(pSettings);

        _context.Accounts.Remove(account);
        await _context.SaveChangesAsync();
        _settingsService.InvalidateInitialDataCache();
        return (true, string.Empty);
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
