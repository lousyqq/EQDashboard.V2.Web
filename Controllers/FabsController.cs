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
public class FabsController : ControllerBase
{
    private readonly AppDbContext _context;
    private readonly ISettingsService _settingsService;

    public FabsController(AppDbContext context, ISettingsService settingsService)
    {
        _context = context;
        _settingsService = settingsService;
    }

    [HttpGet]
    public async Task<IActionResult> GetFabs()
    {
        var fabs = await _context.Fabs
            .Include(f => f.MapFabRoles)
            .ToListAsync();

        var result = fabs.Select(f => new
        {
            id = f.FabId,
            fabName = f.FabName,
            displayName = f.DisplayName,
            defaultLang = f.DefaultLang,
            assignedRoles = f.MapFabRoles?.Select(m => m.RoleId).ToList() ?? new List<string>()
        });

        return Ok(result);
    }

    [HttpPost]
    public async Task<IActionResult> CreateFab([FromBody] FabDto dto)
    {
        if (await _context.Fabs.AnyAsync(f => f.FabName == dto.FabName))
            return BadRequest("廠區已存在");

        var fab = new Fab
        {
            FabId = dto.Id,
            FabName = dto.FabName,
            DisplayName = dto.DisplayName,
            DefaultLang = dto.DefaultLang
        };

        _context.Fabs.Add(fab);

        if (dto.AssignedRoles != null)
        {
            foreach (var roleId in dto.AssignedRoles)
            {
                _context.MapFabRoles.Add(new MapFabRole { FabId = fab.FabId, RoleId = roleId });
            }
        }

        await _context.SaveChangesAsync();
        _settingsService.InvalidateInitialDataCache();
        return Ok(new { success = true });
    }

    [HttpPut("{id}")]
    public async Task<IActionResult> UpdateFab(string id, [FromBody] FabDto dto)
    {
        var fab = await _context.Fabs.Include(f => f.MapFabRoles).FirstOrDefaultAsync(f => f.FabId == id);
        if (fab == null) return NotFound();

        fab.DisplayName = dto.DisplayName;
        fab.DefaultLang = dto.DefaultLang;

        // 更新 Roles
        if (fab.MapFabRoles != null)
        {
            _context.MapFabRoles.RemoveRange(fab.MapFabRoles);
            await _context.SaveChangesAsync(); // 強制執行刪除以避免 PK tracking 衝突
        }

        if (dto.AssignedRoles != null)
        {
            foreach (var roleId in dto.AssignedRoles)
            {
                _context.MapFabRoles.Add(new MapFabRole { FabId = id, RoleId = roleId });
            }
        }

        await _context.SaveChangesAsync();
        _settingsService.InvalidateInitialDataCache();
        return Ok(new { success = true });
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> DeleteFab(string id)
    {
        var fab = await _context.Fabs
            .Include(f => f.MapFabRoles)
            .FirstOrDefaultAsync(f => f.FabId == id);
        if (fab == null) return NotFound();

        // 先清掉關聯，避免 FK 限制阻擋刪除
        if (fab.MapFabRoles != null && fab.MapFabRoles.Count > 0)
            _context.MapFabRoles.RemoveRange(fab.MapFabRoles);

        // 同時清掉 Map_Account_DefaultPage 中以該廠區為 key 的設定
        var defaultPages = await _context.MapAccountDefaultPages
            .Where(p => p.FabId == id).ToListAsync();
        if (defaultPages.Count > 0)
            _context.MapAccountDefaultPages.RemoveRange(defaultPages);

        _context.Fabs.Remove(fab);
        await _context.SaveChangesAsync();
        _settingsService.InvalidateInitialDataCache();
        return Ok(new { success = true });
    }
}

public class FabDto
{
    [Required(ErrorMessage = "廠區 ID 必填")]
    [StringLength(50)]
    public string Id { get; set; } = string.Empty;
    
    [Required(ErrorMessage = "廠區代碼必填")]
    [StringLength(50)]
    public string FabName { get; set; } = string.Empty;
    
    [StringLength(100)]
    public string? DisplayName { get; set; }
    
    [StringLength(20)]
    public string? DefaultLang { get; set; }
    
    public List<string>? AssignedRoles { get; set; }
}
