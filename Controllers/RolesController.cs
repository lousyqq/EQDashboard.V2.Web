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
public class RolesController : ControllerBase
{
    private readonly AppDbContext _context;
    private readonly ISettingsService _settingsService;

    public RolesController(AppDbContext context, ISettingsService settingsService)
    {
        _context = context;
        _settingsService = settingsService;
    }

    [HttpGet]
    public async Task<IActionResult> GetRoles()
    {
        var roles = await _context.Roles
            .Include(r => r.MapRoleMenus)
            .ToListAsync();

        var result = roles.Select(r => new
        {
            id = r.RoleId,
            groupName = r.GroupName,
            allowedMenuIds = r.MapRoleMenus?.Select(m => m.MenuId).ToList() ?? new List<string>()
        });

        return Ok(result);
    }

    [HttpPost]
    public async Task<IActionResult> CreateRole([FromBody] RoleDto dto)
    {
        if (await _context.Roles.AnyAsync(r => r.RoleId == dto.Id))
            return BadRequest("權限群組 ID 已存在");

        var role = new Role
        {
            RoleId = dto.Id,
            GroupName = dto.GroupName
        };

        _context.Roles.Add(role);

        if (dto.AllowedMenuIds != null)
        {
            int sortOrder = 0;
            foreach (var menuId in dto.AllowedMenuIds)
            {
                _context.MapRoleMenus.Add(new MapRoleMenu { RoleId = role.RoleId, MenuId = menuId, SortOrder = sortOrder });
                sortOrder += 10;
            }
        }

        await _context.SaveChangesAsync();
        _settingsService.InvalidateInitialDataCache();
        return Ok(new { success = true });
    }

    [HttpPut("{id}")]
    public async Task<IActionResult> UpdateRole(string id, [FromBody] RoleDto dto)
    {
        var role = await _context.Roles.Include(r => r.MapRoleMenus).FirstOrDefaultAsync(r => r.RoleId == id);
        if (role == null) return NotFound();

        role.GroupName = dto.GroupName;

        // 更新 MapRoleMenus
        if (role.MapRoleMenus != null)
        {
            _context.MapRoleMenus.RemoveRange(role.MapRoleMenus);
            await _context.SaveChangesAsync(); // 強制執行刪除以避免 PK tracking 衝突
        }

        if (dto.AllowedMenuIds != null)
        {
            int sortOrder = 0;
            foreach (var menuId in dto.AllowedMenuIds)
            {
                _context.MapRoleMenus.Add(new MapRoleMenu { RoleId = id, MenuId = menuId, SortOrder = sortOrder });
                sortOrder += 10;
            }
        }

        await _context.SaveChangesAsync();
        _settingsService.InvalidateInitialDataCache();
        return Ok(new { success = true });
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> DeleteRole(string id)
    {
        var role = await _context.Roles
            .Include(r => r.MapRoleMenus)
            .FirstOrDefaultAsync(r => r.RoleId == id);
        if (role == null) return NotFound();

        // 先解除所有引用本 Role 的關聯，避免 FK 限制阻擋刪除
        if (role.MapRoleMenus != null && role.MapRoleMenus.Count > 0)
            _context.MapRoleMenus.RemoveRange(role.MapRoleMenus);

        var fabLinks = await _context.MapFabRoles.Where(m => m.RoleId == id).ToListAsync();
        if (fabLinks.Count > 0) _context.MapFabRoles.RemoveRange(fabLinks);

        var accLinks = await _context.MapAccountRoles.Where(m => m.RoleId == id).ToListAsync();
        if (accLinks.Count > 0) _context.MapAccountRoles.RemoveRange(accLinks);

        _context.Roles.Remove(role);
        await _context.SaveChangesAsync();
        _settingsService.InvalidateInitialDataCache();
        return Ok(new { success = true });
    }
}

public class RoleDto
{
    [Required(ErrorMessage = "ID 必填")]
    [StringLength(50)]
    public string Id { get; set; } = string.Empty;
    
    [Required(ErrorMessage = "群組名稱必填")]
    [StringLength(100)]
    public string GroupName { get; set; } = string.Empty;
    
    public List<string>? AllowedMenuIds { get; set; }
}
