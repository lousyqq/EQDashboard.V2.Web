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
[Authorize]
public class MenusController : ControllerBase
{
    private readonly AppDbContext _context;
    private readonly ISettingsService _settingsService;

    public MenusController(AppDbContext context, ISettingsService settingsService)
    {
        _context = context;
        _settingsService = settingsService;
    }

    [HttpGet]
    public async Task<IActionResult> GetMenus()
    {
        var menus = await _context.Menus
            .Include(m => m.MapMenuStructuresChild)
            .ToListAsync();

        var result = menus.Select(m => new
        {
            id = m.MenuId,
            name = m.SysName,
            displayName = m.DisplayName,
            menuMode = m.MenuMode,
            url = m.Url,
            targetPage = m.TargetPage,
            target = m.OpenTarget,
            icon = m.Icon,
            createdBy = m.CreatedBy,
            enabled = m.IsEnabled ?? true,
            isPoolItem = m.IsPoolItem ?? false,
            isEdited = m.IsEdited ?? false,
            order = m.GlobalOrder,
            parentIds = m.MapMenuStructuresChild?.Select(p => p.ParentMenuId).ToList() ?? new List<string>(),
            parentOrders = m.MapMenuStructuresChild?.ToDictionary(p => p.ParentMenuId, p => p.SortOrder ?? 0) ?? new Dictionary<string, int>()
        });

        return Ok(result);
    }

    [HttpPost]
    public async Task<IActionResult> CreateMenu([FromBody] MenuDto dto)
    {
        if (await _context.Menus.AnyAsync(m => m.MenuId == dto.Id))
            return BadRequest("選單ID已存在");

        var menu = new Menu
        {
            MenuId = dto.Id,
            SysName = dto.Name,
            DisplayName = dto.DisplayName,
            MenuMode = dto.MenuMode,
            Url = dto.Url,
            TargetPage = dto.TargetPage,
            OpenTarget = dto.Target,
            Icon = dto.Icon,
            CreatedBy = dto.CreatedBy,
            IsEnabled = dto.Enabled,
            IsPoolItem = dto.IsPoolItem,
            IsEdited = dto.IsEdited,
            GlobalOrder = dto.Order
        };

        _context.Menus.Add(menu);

        UpdateMenuMappings(dto);

        await _context.SaveChangesAsync();
        _settingsService.InvalidateInitialDataCache();
        return Ok(new { success = true });
    }

    [HttpPut("{id}")]
    public async Task<IActionResult> UpdateMenu(string id, [FromBody] MenuDto dto)
    {
        var menu = await _context.Menus
            .Include(m => m.MapMenuStructuresChild)
            .FirstOrDefaultAsync(m => m.MenuId == id);

        if (menu == null) return NotFound();

        menu.SysName = dto.Name;
        menu.DisplayName = dto.DisplayName;
        menu.MenuMode = dto.MenuMode;
        menu.Url = dto.Url;
        menu.TargetPage = dto.TargetPage;
        menu.OpenTarget = dto.Target;
        menu.Icon = dto.Icon;
        menu.CreatedBy = dto.CreatedBy;
        menu.IsEnabled = dto.Enabled;
        menu.IsPoolItem = dto.IsPoolItem;
        menu.IsEdited = dto.IsEdited;
        menu.GlobalOrder = dto.Order;

        if (menu.MapMenuStructuresChild != null)
        {
            _context.MapMenuStructures.RemoveRange(menu.MapMenuStructuresChild);
            await _context.SaveChangesAsync(); // 強制執行刪除以避免 PK tracking 衝突
        }

        UpdateMenuMappings(dto);

        await _context.SaveChangesAsync();
        _settingsService.InvalidateInitialDataCache();
        return Ok(new { success = true });
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> DeleteMenu(string id)
    {
        var menu = await _context.Menus.FindAsync(id);
        if (menu == null) return NotFound();

        await DetachMenuReferencesAsync(new[] { id });

        _context.Menus.Remove(menu);
        await _context.SaveChangesAsync();
        _settingsService.InvalidateInitialDataCache();
        return Ok(new { success = true });
    }

    [HttpPost("batch")]
    public async Task<IActionResult> BatchUpdateMenus([FromBody] List<MenuDto> dtos)
    {
        // 為了簡單且安全地處理批次異動，我們先清空所有受影響的選單與關聯，再重新建立
        // 或是較安全的作法：逐一比對更新。
        // 考慮到前端送來的是完整的 menus 列表（或是被修改過的部分），我們採用逐一 Upsert。
        foreach (var dto in dtos)
        {
            var menu = await _context.Menus
                .Include(m => m.MapMenuStructuresChild)
                .FirstOrDefaultAsync(m => m.MenuId == dto.Id);

            if (menu == null)
            {
                menu = new Menu { MenuId = dto.Id };
                _context.Menus.Add(menu);
            }
            else
            {
                if (menu.MapMenuStructuresChild != null)
                {
                    _context.MapMenuStructures.RemoveRange(menu.MapMenuStructuresChild);
                    await _context.SaveChangesAsync(); // 強制執行刪除以避免 PK tracking 衝突
                }
            }

            menu.SysName = dto.Name;
            menu.DisplayName = dto.DisplayName;
            menu.MenuMode = dto.MenuMode;
            menu.Url = dto.Url;
            menu.TargetPage = dto.TargetPage;
            menu.OpenTarget = dto.Target;
            menu.Icon = dto.Icon;
            menu.CreatedBy = dto.CreatedBy;
            menu.IsEnabled = dto.Enabled;
            menu.IsPoolItem = dto.IsPoolItem;
            menu.IsEdited = dto.IsEdited;
            menu.GlobalOrder = dto.Order;

            UpdateMenuMappings(dto);
        }

        await _context.SaveChangesAsync();
        _settingsService.InvalidateInitialDataCache();
        return Ok(new { success = true });
    }

    [HttpDelete("batch")]
    public async Task<IActionResult> BatchDeleteMenus([FromBody] List<string> ids)
    {
        if (ids == null || ids.Count == 0) return Ok(new { success = true });

        await DetachMenuReferencesAsync(ids);

        var menus = await _context.Menus.Where(m => ids.Contains(m.MenuId)).ToListAsync();
        _context.Menus.RemoveRange(menus);
        await _context.SaveChangesAsync();
        _settingsService.InvalidateInitialDataCache();
        return Ok(new { success = true });
    }

    /// <summary>
    /// 刪除 Menu 前，先清掉所有 FK 關聯：
    /// - Map_Menu_Structure 對 Parent / Child 兩端都是 Restrict，若不先清會被 FK 擋住。
    /// - Map_Role_Menu、Map_Account_ManageMenu、Map_Account_DefaultPage 雖然預設 Cascade，
    ///   但統一在這裡明確處理，避免 EF 在多重 cascade path 下報錯，並順便清掉孤兒 PersonalSettings。
    /// </summary>
    private async Task DetachMenuReferencesAsync(IEnumerable<string> menuIds)
    {
        var ids = menuIds.ToList();
        if (ids.Count == 0) return;

        var structures = await _context.MapMenuStructures
            .Where(s => ids.Contains(s.ParentMenuId) || ids.Contains(s.ChildMenuId))
            .ToListAsync();
        if (structures.Count > 0) _context.MapMenuStructures.RemoveRange(structures);

        var roleMenus = await _context.MapRoleMenus.Where(m => ids.Contains(m.MenuId)).ToListAsync();
        if (roleMenus.Count > 0) _context.MapRoleMenus.RemoveRange(roleMenus);

        var manageMenus = await _context.MapAccountManageMenus.Where(m => ids.Contains(m.MenuId)).ToListAsync();
        if (manageMenus.Count > 0) _context.MapAccountManageMenus.RemoveRange(manageMenus);

        var defaultPages = await _context.MapAccountDefaultPages.Where(p => ids.Contains(p.MenuId)).ToListAsync();
        if (defaultPages.Count > 0) _context.MapAccountDefaultPages.RemoveRange(defaultPages);

        var personal = await _context.PersonalSettings.Where(p => ids.Contains(p.MenuId)).ToListAsync();
        if (personal.Count > 0) _context.PersonalSettings.RemoveRange(personal);

        if (structures.Count + roleMenus.Count + manageMenus.Count + defaultPages.Count + personal.Count > 0)
        {
            await _context.SaveChangesAsync();
        }
    }

    private void UpdateMenuMappings(MenuDto dto)
    {
        if (dto.ParentIds != null)
        {
            foreach (var pId in dto.ParentIds)
            {
                int order = 0;
                if (dto.ParentOrders != null && dto.ParentOrders.ContainsKey(pId))
                {
                    order = dto.ParentOrders[pId];
                }
                
                _context.MapMenuStructures.Add(new MapMenuStructure 
                { 
                    ParentMenuId = pId, 
                    ChildMenuId = dto.Id, 
                    SortOrder = order 
                });
            }
        }
        else if (!string.IsNullOrEmpty(dto.ParentId))
        {
            _context.MapMenuStructures.Add(new MapMenuStructure 
            { 
                ParentMenuId = dto.ParentId, 
                ChildMenuId = dto.Id, 
                SortOrder = dto.Order ?? 0 
            });
        }
    }
}

public class MenuDto
{
    [Required(ErrorMessage = "ID 必填")]
    [StringLength(50)]
    public string Id { get; set; } = string.Empty;
    
    [Required(ErrorMessage = "名稱必填")]
    [StringLength(100)]
    public string? Name { get; set; }
    
    [StringLength(100)]
    public string? DisplayName { get; set; }
    
    [StringLength(20)]
    public string? MenuMode { get; set; }
    
    [StringLength(1000)]
    public string? Url { get; set; }
    
    [StringLength(200)]
    public string? TargetPage { get; set; }
    
    [StringLength(20)]
    public string? Target { get; set; }
    
    [StringLength(100)]
    public string? Icon { get; set; }
    
    [StringLength(50)]
    public string? CreatedBy { get; set; }
    
    public bool Enabled { get; set; }
    public bool IsPoolItem { get; set; }
    public bool IsEdited { get; set; }
    public int? Order { get; set; }
    public string? ParentId { get; set; }
    public List<string>? ParentIds { get; set; }
    public Dictionary<string, int>? ParentOrders { get; set; }
}
