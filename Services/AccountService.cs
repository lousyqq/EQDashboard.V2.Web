using EQDashboard.V2.Web.Data;
using EQDashboard.V2.Web.DTOs;
using EQDashboard.V2.Web.Models;
using EQDashboard.V2.Web.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace EQDashboard.V2.Web.Services;

public class AccountService : IAccountService
{
    private readonly AppDbContext _context;

    public AccountService(AppDbContext context)
    {
        _context = context;
    }

    public async Task<PagedResult<AccountDto>> GetAccountsAsync(int page, int pageSize, string? search)
    {
        var query = _context.Accounts.AsQueryable();

        if (!string.IsNullOrEmpty(search))
        {
            query = query.Where(a => a.EmpId.Contains(search) || (a.Name != null && a.Name.Contains(search)));
        }

        int totalCount = await query.CountAsync();
        int totalPages = (int)Math.Ceiling(totalCount / (double)pageSize);

        var accounts = await query
            .OrderBy(a => a.EmpId)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(a => new AccountDto
            {
                Id = 0,
                EmpId = a.EmpId,
                Name = a.Name ?? "",
                Email = "",
                LoginCount = a.LoginCount ?? 0,
                LastLoginTime = a.LastLoginTime,
                IsActive = true
            })
            .ToListAsync();

        return new PagedResult<AccountDto>
        {
            TotalCount = totalCount,
            TotalPages = totalPages,
            CurrentPage = page,
            PageSize = pageSize,
            Data = accounts
        };
    }

    public async Task<(bool success, string message)> CreateAccountAsync(AccountDto dto)
    {
        if (await _context.Accounts.AnyAsync(a => a.EmpId == dto.EmpId))
            return (false, "該員工編號已存在。");

        _context.Accounts.Add(new Account
        {
            EmpId = dto.EmpId,
            Name = dto.Name,
            RoleLevel = "user",
            CanEditOthers = false
        });

        await _context.SaveChangesAsync();
        return (true, "帳號建立成功");
    }

    public async Task<(bool success, string message)> UpdateAccountAsync(string id, AccountDto dto)
    {
        var account = await _context.Accounts.FindAsync(id);
        if (account == null) return (false, "找不到帳號");

        account.Name = dto.Name;
        await _context.SaveChangesAsync();
        return (true, "更新成功");
    }

    public async Task<(bool success, string message)> DeleteAccountAsync(string id)
    {
        var account = await _context.Accounts.FindAsync(id);
        if (account == null) return (false, "找不到帳號");

        _context.Accounts.Remove(account);
        await _context.SaveChangesAsync();
        return (true, "刪除成功");
    }

    public async Task<(bool success, string message)> BatchImportAsync(List<AccountDto> accounts)
    {
        if (accounts == null || !accounts.Any())
            return (false, "無資料可匯入");

        int inserted = 0, updated = 0;

        foreach (var dto in accounts)
        {
            if (string.IsNullOrWhiteSpace(dto.EmpId)) continue;

            var existing = await _context.Accounts.FirstOrDefaultAsync(a => a.EmpId == dto.EmpId);

            if (existing == null)
            {
                _context.Accounts.Add(new Account
                {
                    EmpId = dto.EmpId,
                    Name = dto.Name,
                    RoleLevel = "user",
                    CanEditOthers = false
                });
                inserted++;
            }
            else
            {
                existing.Name = dto.Name;
                updated++;
            }
        }

        await _context.SaveChangesAsync();
        return (true, $"匯入成功。新增 {inserted} 筆，更新 {updated} 筆。");
    }
}
