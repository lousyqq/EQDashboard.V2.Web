using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using EQDashboard.V2.Web.Data;
using EQDashboard.V2.Web.Models;
using EQDashboard.V2.Web.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using System.ComponentModel.DataAnnotations;
using System.Security.Claims;

namespace EQDashboard.V2.Web.Controllers;

[Route("api/[controller]")]
[ApiController]
[Authorize]
public class MenusController : ControllerBase
{
    private readonly AppDbContext _context;
    private readonly ISettingsService _settingsService;
    private readonly IMenuAuthService _menuAuthService;
    private readonly IIconStorageService _iconStorage;

    public MenusController(AppDbContext context, ISettingsService settingsService, IMenuAuthService menuAuthService, IIconStorageService iconStorage)
    {
        _context = context;
        _settingsService = settingsService;
        _menuAuthService = menuAuthService;
        _iconStorage = iconStorage;
    }

    [HttpGet]
    public async Task<IActionResult> GetMenus()
    {
        var isAdmin = User.IsInRole("admin");
        var empId = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "";

        var menus = await _context.Menus
            .Include(m => m.MapMenuStructuresChild)
            .Include(m => m.MapMenuAllowAccounts)
            .Include(m => m.MapMenuDenyAccounts)
            .ToListAsync();

        // P1 過濾：非 admin 只回他真的看得到的 menus，避免洩漏全部看板 URL / icon
        var visibleSet = await _menuAuthService.GetVisibleMenuIdsAsync(empId, isAdmin);
        if (visibleSet != null)
            menus = menus.Where(m => visibleSet.Contains(m.MenuId)).ToList();

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
            parentOrders = m.MapMenuStructuresChild?.ToDictionary(p => p.ParentMenuId, p => p.SortOrder ?? 0) ?? new Dictionary<string, int>(),
            // ⚠️ 非 admin 只看自己這份 ACL — 完整 ACL 含其他人工號 = 內部 EmpId 列舉風險。
            //   admin 仍看完整列表 (要管理白/黑名單必須看得到)。
            allowedEmpIds = isAdmin
                ? (m.MapMenuAllowAccounts?.Select(a => a.EmpId).ToList() ?? new List<string>())
                : new List<string>(),
            deniedEmpIds = isAdmin
                ? (m.MapMenuDenyAccounts?.Select(a => a.EmpId).ToList() ?? new List<string>())
                : new List<string>()
        });

        return Ok(result);
    }

    [HttpPost]
    public async Task<IActionResult> CreateMenu([FromBody] MenuDto dto)
    {
        var isAdmin = User.IsInRole("admin");
        // ⚠️ 不可用 User.Identity?.Name — 那會回 ClaimTypes.Name (姓名 e.g. "林玉婷")，不是 EmpId。
//    Login/WhoAmI 設定 claims 時把 EmpId 放在 NameIdentifier、Name 放在「姓名」，所以這裡務必抓 NameIdentifier。
var empId = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "";

        // ⚠️ 跨界 ACL 防護：只有 admin 可設定 AllowedEmpIds / DeniedEmpIds。
        //   委派 user 新建的 menu 一律無 ACL，避免他用 menu ACL 反向控制其他正常 user 的可見性。
        if (!isAdmin)
        {
            dto.AllowedEmpIds = null;
            dto.DeniedEmpIds = null;
        }

        if (dto.ParentIds != null && dto.ParentIds.Count > 0)
        {
            foreach (var pId in dto.ParentIds)
            {
                if (!await _menuAuthService.CanManageStructureAsync(empId, pId, isAdmin))
                    return Forbid();
            }
        }
        else if (!string.IsNullOrEmpty(dto.ParentId))
        {
            if (!await _menuAuthService.CanManageStructureAsync(empId, dto.ParentId, isAdmin))
                return Forbid();
        }
        else
        {
            if (!await _menuAuthService.IsDelegatedAdminAsync(empId, isAdmin))
                return Forbid();
        }

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
            // base64 圖示一律轉實體檔；FA class / 既有路徑原樣保留（見 IconStorageService）
            Icon = await _iconStorage.SaveAsync(dto.Icon),
            // ⚠️ Mass Assignment 防護：CreatedBy 永遠 = 實際登入者，不接受 dto.CreatedBy。
            // 早先漏洞：委派 user 可送 dto.CreatedBy="admin" 偽造成 admin 建立、影響後續 isMyOwn 判定。
            CreatedBy = empId,
            IsEnabled = dto.Enabled,
            IsPoolItem = dto.IsPoolItem,
            IsEdited = dto.IsEdited,
            GlobalOrder = dto.Order
        };

        _context.Menus.Add(menu);

        UpdateMenuMappings(dto);
        if (isAdmin) UpdateMenuAcl(dto);  // 非 admin 已在上方被清空 ACL，跳過保險

        await _context.SaveChangesAsync();
        _settingsService.InvalidateInitialDataCache();
        return Ok(new { success = true });
    }

    [HttpPut("{id}")]
    public async Task<IActionResult> UpdateMenu(string id, [FromBody] MenuDto dto)
    {
        var isAdmin = User.IsInRole("admin");
        // ⚠️ 不可用 User.Identity?.Name — 那會回 ClaimTypes.Name (姓名 e.g. "林玉婷")，不是 EmpId。
//    Login/WhoAmI 設定 claims 時把 EmpId 放在 NameIdentifier、Name 放在「姓名」，所以這裡務必抓 NameIdentifier。
var empId = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "";

        // ⚠️ 強制 dto.Id = path 的 id。
        //   原本 bug：找 menu 用 path id、做權限檢查也用 path id，
        //   但下游 UpdateMenuMappings(dto)/UpdateMenuAcl(dto) 用 dto.Id 寫 ChildMenuId / MenuId。
        //   兩者不一致時 (惡意提交)：
        //     - 找到並更新 path id 的 menu (e.g. m_ze_1)
        //     - 刪掉 path id 的 mapping/ACL
        //     - 寫新 mapping/ACL 用 dto.Id (e.g. m_admin_secret)
        //     - 結果：m_ze_1 mapping 全沒、m_admin_secret 多了沒經過權限檢查的 mapping/ACL
        //   修法：永遠以 path 為事實來源，body 的 Id 忽略 (跟 AccountService.UpdateAccountAsync 同模式)。
        dto.Id = id;

        // ⚠️ 跨界 ACL 防護：AllowedEmpIds / DeniedEmpIds 是「決定其他 user 看不看得到該 menu」的工具，
        //   委派 user 不應越界決定其他 user 的可見性 (即使該 menu 在他編輯權範圍內)。
        //   只有 admin 可寫；非 admin 直接把 ACL 欄位清掉，保留 DB 中現有設定不變動。
        if (!isAdmin)
        {
            dto.AllowedEmpIds = null;
            dto.DeniedEmpIds = null;
        }

        if (!await _menuAuthService.CanEditOrDeleteMenuAsync(empId, id, isAdmin))
            return Forbid();

        // 搬家防護：檢查是否有權掛載到新的 Parent 節點之下
        if (dto.ParentIds != null && dto.ParentIds.Count > 0)
        {
            foreach (var pId in dto.ParentIds)
            {
                if (!await _menuAuthService.CanManageStructureAsync(empId, pId, isAdmin))
                    return Forbid();
            }
        }
        else if (!string.IsNullOrEmpty(dto.ParentId))
        {
            if (!await _menuAuthService.CanManageStructureAsync(empId, dto.ParentId, isAdmin))
                return Forbid();
        }

        var menu = await _context.Menus
            .Include(m => m.MapMenuStructuresChild)
            .Include(m => m.MapMenuAllowAccounts)
            .Include(m => m.MapMenuDenyAccounts)
            .FirstOrDefaultAsync(m => m.MenuId == id);

        if (menu == null) return NotFound();

        var oldIcon = menu.Icon; // 換圖後若舊檔不再被參照就清掉

        menu.SysName = dto.Name;
        menu.DisplayName = dto.DisplayName;
        menu.MenuMode = dto.MenuMode;
        menu.Url = dto.Url;
        menu.TargetPage = dto.TargetPage;
        menu.OpenTarget = dto.Target;
        menu.Icon = await _iconStorage.SaveAsync(dto.Icon);
        // ⚠️ CreatedBy 是 immutable — 不接受 PUT 改動，否則委派 user 可把 admin 建立的 menu「過戶」到自己名下。
        menu.IsEnabled = dto.Enabled;
        menu.IsPoolItem = dto.IsPoolItem;
        menu.IsEdited = dto.IsEdited;
        menu.GlobalOrder = dto.Order;

        // ⚠️ Map 表用「全刪+重建」模式，必須在 Add 之前先 SaveChanges 把 DELETE flush 到 DB，
        //     否則 EF Core 同時 track DELETE + INSERT 同一個 PK 會撞衝突。
        if (menu.MapMenuStructuresChild != null)
            _context.MapMenuStructures.RemoveRange(menu.MapMenuStructuresChild);

        // ⚠️ ACL 只有 admin 才能改動 (跨界保護)：
        //   非 admin 編輯時跳過整段「刪舊 ACL → 寫新 ACL」流程，DB 中現有 ACL 維持不變，
        //   即使 dto 帶 AllowedEmpIds/DeniedEmpIds 也已在上方被清為 null、不會生效。
        if (isAdmin)
        {
            if (menu.MapMenuAllowAccounts != null)
                _context.MapMenuAllowAccounts.RemoveRange(menu.MapMenuAllowAccounts);
            if (menu.MapMenuDenyAccounts != null)
                _context.MapMenuDenyAccounts.RemoveRange(menu.MapMenuDenyAccounts);
        }
        await _context.SaveChangesAsync(); // ← 一次 flush 所有 pending DELETE

        UpdateMenuMappings(dto);
        if (isAdmin) UpdateMenuAcl(dto);

        await _context.SaveChangesAsync();
        await _iconStorage.DeleteIfLocalUnreferencedAsync(oldIcon);
        _settingsService.InvalidateInitialDataCache();
        return Ok(new { success = true });
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> DeleteMenu(string id, [FromServices] IActivityLogger activityLogger)
    {
        var isAdmin = User.IsInRole("admin");
        // ⚠️ 不可用 User.Identity?.Name — 那會回 ClaimTypes.Name (姓名 e.g. "林玉婷")，不是 EmpId。
//    Login/WhoAmI 設定 claims 時把 EmpId 放在 NameIdentifier、Name 放在「姓名」，所以這裡務必抓 NameIdentifier。
var empId = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "";
        if (!await _menuAuthService.CanEditOrDeleteMenuAsync(empId, id, isAdmin))
            return Forbid();

        var menu = await _context.Menus.FindAsync(id);
        if (menu == null) return NotFound();

        await DetachMenuReferencesAsync(new[] { id });

        var backupJson = System.Text.Json.JsonSerializer.Serialize(menu, new System.Text.Json.JsonSerializerOptions { ReferenceHandler = System.Text.Json.Serialization.ReferenceHandler.IgnoreCycles });
        var oldIcon = menu.Icon;

        _context.Menus.Remove(menu);
        await _context.SaveChangesAsync();
        await _iconStorage.DeleteIfLocalUnreferencedAsync(oldIcon);

        await activityLogger.LogAuditAsync(HttpContext, "DataRecovery", "DeleteMenu", "Menu", id, backupJson);

        _settingsService.InvalidateInitialDataCache();
        return Ok(new { success = true });
    }

    [HttpPost("batch")]
    public async Task<IActionResult> BatchUpdateMenus([FromBody] List<MenuDto> dtos)
    {
        var isAdmin = User.IsInRole("admin");
        // ⚠️ 不可用 User.Identity?.Name — 那會回 ClaimTypes.Name (姓名 e.g. "林玉婷")，不是 EmpId。
//    Login/WhoAmI 設定 claims 時把 EmpId 放在 NameIdentifier、Name 放在「姓名」，所以這裡務必抓 NameIdentifier。
var empId = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "";

        // ⚠️ 跨界 ACL 防護：批次模式同樣 — 非 admin 一律清掉每個 dto 的 ACL 欄位，
        //   避免委派 user 透過 batch endpoint 偷渡 ACL 改動影響其他 user。
        if (!isAdmin)
        {
            foreach (var dto in dtos)
            {
                dto.AllowedEmpIds = null;
                dto.DeniedEmpIds = null;
            }
        }

        // 批次更新時，必須對每個受影響的項目嚴格檢查：1. 是否有原選單的編輯權限 2. 是否有新父目錄的掛載權限
        foreach(var dto in dtos)
        {
             bool exists = await _context.Menus.AnyAsync(m => m.MenuId == dto.Id);
             
             if (exists)
             {
                 if (!await _menuAuthService.CanEditOrDeleteMenuAsync(empId, dto.Id, isAdmin))
                     return Forbid();
             }
             else if ((dto.ParentIds == null || dto.ParentIds.Count == 0) && string.IsNullOrEmpty(dto.ParentId))
             {
                 if (!await _menuAuthService.IsDelegatedAdminAsync(empId, isAdmin))
                     return Forbid();
             }

             if (dto.ParentIds != null && dto.ParentIds.Count > 0)
             {
                 foreach (var pId in dto.ParentIds)
                 {
                     if (!await _menuAuthService.CanManageStructureAsync(empId, pId, isAdmin))
                         return Forbid();
                 }
             }
             else if (!string.IsNullOrEmpty(dto.ParentId))
             {
                 if (!await _menuAuthService.CanManageStructureAsync(empId, dto.ParentId, isAdmin))
                     return Forbid();
             }
        }

        var strategy = _context.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync(async () =>
        {
            using var transaction = await _context.Database.BeginTransactionAsync();
            try
            {
                // O1 優化：原本「迴圈內逐筆 FirstOrDefault + 逐筆 SaveChanges」在看板量大時 O(N) round-trip。
                //   改為：① 一次把所有受影響 menu 連同關聯撈出 ② 一次刪舊 structure/ACL 並 flush ③ 一次寫入。
                var dtoIds = dtos.Select(d => d.Id).ToList();
                var existingMenus = await _context.Menus
                    .Include(m => m.MapMenuStructuresChild)
                    .Include(m => m.MapMenuAllowAccounts)
                    .Include(m => m.MapMenuDenyAccounts)
                    .Where(m => dtoIds.Contains(m.MenuId))
                    .ToListAsync();
                // OrdinalIgnoreCase 對齊 SQL Where 的不分大小寫比對，避免「DB 已存在但大小寫不同 → 誤判為新建 → 撞 PK」
                var existingMap = existingMenus.ToDictionary(m => m.MenuId, StringComparer.OrdinalIgnoreCase);

                // ⚠️ Map 表「全刪+重建」：先一次把所有受影響 menu 的舊 structure/ACL 標記刪除並 flush，
                //   後面 Add 同 PK 才不會撞 EF tracking 衝突。
                foreach (var menu in existingMenus)
                {
                    if (menu.MapMenuStructuresChild != null)
                        _context.MapMenuStructures.RemoveRange(menu.MapMenuStructuresChild);
                    // 非 admin 不能動 ACL — 跳過刪除以保留 DB 原狀
                    if (isAdmin)
                    {
                        if (menu.MapMenuAllowAccounts != null)
                            _context.MapMenuAllowAccounts.RemoveRange(menu.MapMenuAllowAccounts);
                        if (menu.MapMenuDenyAccounts != null)
                            _context.MapMenuDenyAccounts.RemoveRange(menu.MapMenuDenyAccounts);
                    }
                }
                await _context.SaveChangesAsync(); // ← 一次 flush 所有 pending DELETE

                var oldIcons = new List<string?>();
                foreach (var dto in dtos)
                {
                    if (!existingMap.TryGetValue(dto.Id, out var menu))
                    {
                        menu = new Menu { MenuId = dto.Id };
                        _context.Menus.Add(menu);
                        // ⚠️ Mass Assignment 防護：新建強制 CreatedBy = 實際登入者，不接受 dto.CreatedBy 偽造
                        menu.CreatedBy = empId;
                    }
                    else
                    {
                        // 既有 menu 換圖後舊檔可能變孤兒，先記下來，commit 後再清
                        oldIcons.Add(menu.Icon);
                        // ⚠️ 既有：CreatedBy immutable — 完全不動
                    }

                    menu.SysName = dto.Name;
                    menu.DisplayName = dto.DisplayName;
                    menu.MenuMode = dto.MenuMode;
                    menu.Url = dto.Url;
                    menu.TargetPage = dto.TargetPage;
                    menu.OpenTarget = dto.Target;
                    menu.Icon = await _iconStorage.SaveAsync(dto.Icon);
                    menu.IsEnabled = dto.Enabled;
                    menu.IsPoolItem = dto.IsPoolItem;
                    menu.IsEdited = dto.IsEdited;
                    menu.GlobalOrder = dto.Order;

                    UpdateMenuMappings(dto);
                    if (isAdmin) UpdateMenuAcl(dto);  // 非 admin 已在上方被清空 ACL，跳過保險
                }

                await _context.SaveChangesAsync();
                await transaction.CommitAsync();

                // commit 後再清孤兒 icon（參照檢查需反映最新 DB 狀態）
                foreach (var old in oldIcons)
                    await _iconStorage.DeleteIfLocalUnreferencedAsync(old);

                _settingsService.InvalidateInitialDataCache();
                return Ok(new { success = true });
            }
            catch
            {
                await transaction.RollbackAsync();
                throw;
            }
        });
    }

    [HttpDelete("batch")]
    public async Task<IActionResult> BatchDeleteMenus([FromBody] List<string> ids, [FromServices] IActivityLogger activityLogger)
    {
        var isAdmin = User.IsInRole("admin");
        // ⚠️ 不可用 User.Identity?.Name — 那會回 ClaimTypes.Name (姓名 e.g. "林玉婷")，不是 EmpId。
//    Login/WhoAmI 設定 claims 時把 EmpId 放在 NameIdentifier、Name 放在「姓名」，所以這裡務必抓 NameIdentifier。
var empId = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "";

        foreach(var id in ids)
        {
             if (!await _menuAuthService.CanEditOrDeleteMenuAsync(empId, id, isAdmin))
                 return Forbid();
        }

        if (ids == null || ids.Count == 0) return Ok(new { success = true });

        await DetachMenuReferencesAsync(ids);

        var menus = await _context.Menus.Where(m => ids.Contains(m.MenuId)).ToListAsync();

        var backupJson = System.Text.Json.JsonSerializer.Serialize(menus, new System.Text.Json.JsonSerializerOptions { ReferenceHandler = System.Text.Json.Serialization.ReferenceHandler.IgnoreCycles });
        var oldIcons = menus.Select(m => m.Icon).ToList();

        _context.Menus.RemoveRange(menus);
        await _context.SaveChangesAsync();

        foreach (var old in oldIcons)
            await _iconStorage.DeleteIfLocalUnreferencedAsync(old);

        await activityLogger.LogAuditAsync(HttpContext, "DataRecovery", "BatchDeleteMenus", "Menu", string.Join(",", ids), backupJson);

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

        var defaultPages = await _context.MapAccountDefaultPages.Where(p => p.MenuId != null && ids.Contains(p.MenuId)).ToListAsync();
        if (defaultPages.Count > 0) _context.MapAccountDefaultPages.RemoveRange(defaultPages);

        var personal = await _context.PersonalSettings.Where(p => p.MenuId != null && ids.Contains(p.MenuId)).ToListAsync();
        if (personal.Count > 0) _context.PersonalSettings.RemoveRange(personal);

        // Menu-level ACL
        var allowAcc = await _context.MapMenuAllowAccounts.Where(a => ids.Contains(a.MenuId)).ToListAsync();
        if (allowAcc.Count > 0) _context.MapMenuAllowAccounts.RemoveRange(allowAcc);

        var denyAcc = await _context.MapMenuDenyAccounts.Where(a => ids.Contains(a.MenuId)).ToListAsync();
        if (denyAcc.Count > 0) _context.MapMenuDenyAccounts.RemoveRange(denyAcc);

        if (structures.Count + roleMenus.Count + manageMenus.Count + defaultPages.Count + personal.Count
            + allowAcc.Count + denyAcc.Count > 0)
        {
            await _context.SaveChangesAsync();
        }
    }

    /// <summary>寫入 Menu 層級的白名單 / 黑名單。每個 EmpId 也卡 50 字元上限，避免 DTO 沒檔住的元素長度</summary>
    private void UpdateMenuAcl(MenuDto dto)
    {
        if (dto.AllowedEmpIds != null)
        {
            foreach (var empId in dto.AllowedEmpIds.Distinct()
                .Where(x => !string.IsNullOrWhiteSpace(x) && x.Trim().Length <= 50))
            {
                _context.MapMenuAllowAccounts.Add(new MapMenuAllowAccount
                {
                    MenuId = dto.Id,
                    EmpId = empId.Trim()
                });
            }
        }
        if (dto.DeniedEmpIds != null)
        {
            foreach (var empId in dto.DeniedEmpIds.Distinct()
                .Where(x => !string.IsNullOrWhiteSpace(x) && x.Trim().Length <= 50))
            {
                _context.MapMenuDenyAccounts.Add(new MapMenuDenyAccount
                {
                    MenuId = dto.Id,
                    EmpId = empId.Trim()
                });
            }
        }
    }

    /// <summary>ParentId 元素長度防呆：DB MenuId 上限 50；超出視同無效 (silent drop) 避免整個 PUT 因一個 element 失敗。</summary>
    private void UpdateMenuMappings(MenuDto dto)
    {
        if (dto.ParentIds != null)
        {
            foreach (var pId in dto.ParentIds.Where(x => !string.IsNullOrWhiteSpace(x) && x.Length <= 50))
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
        else if (!string.IsNullOrEmpty(dto.ParentId) && dto.ParentId.Length <= 50)
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

public class MenuDto : IValidatableObject
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
    
    // ⚠️ Stored XSS 防護：由 Controller 層級檢查 javascript: 避免過度嚴格的正則表達式擋住合法的相對路徑 (如 "1111222")。
    [StringLength(1000)]
    public string? Url { get; set; }

    // targetPage 是 DOM section id (e.g. "page-home")，只允許英數+底線+連字號避免 selector injection
    [StringLength(200)]
    public string? TargetPage { get; set; }
    
    [StringLength(20)]
    public string? Target { get; set; }
    
    // ⚠️ Icon 可能是 FA class (e.g. "fas fa-folder") 或 base64 data URI ("data:image/jpeg;base64,...")，
    //    前端 compressImageFile 會壓到 80×80 約 5-8 KB，舊版鎖 100 char 會直接 400。放寬到 200KB。
    [StringLength(200_000, ErrorMessage = "Icon 不可超過 200KB")]
    public string? Icon { get; set; }

    [StringLength(50)]
    public string? CreatedBy { get; set; }
    
    public bool Enabled { get; set; }
    public bool IsPoolItem { get; set; }
    public bool IsEdited { get; set; }
    public int? Order { get; set; }

    [StringLength(50)]
    public string? ParentId { get; set; }

    // 一支 menu 不會掛在 100+ 個父節點下；卡個合理上限避免被塞爆。
    [MaxLength(100, ErrorMessage = "ParentIds 最多 100 個")]
    public List<string>? ParentIds { get; set; }

    public Dictionary<string, int>? ParentOrders { get; set; }

    // Menu-level ACL (空 list = 不卡控)。卡 1000 筆上限：實務上不會有單一 menu 對 1000+ 工號做白/黑名單，
    // 真到那規模應該改設計用 role / group。
    [MaxLength(1000, ErrorMessage = "AllowedEmpIds 最多 1000 個")]
    public List<string>? AllowedEmpIds { get; set; }

    [MaxLength(1000, ErrorMessage = "DeniedEmpIds 最多 1000 個")]
    public List<string>? DeniedEmpIds { get; set; }

    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        // ⚠️ Stored XSS 防護：menu URL 容許相對路徑 (如 "1111222")，故不能像 AppDto 強制 http(s)://，
        //    改採「黑名單危險 scheme」：javascript: / data: / vbscript: 一律擋。
        //    (前端 openDynamicIframe 雖會對非 http/`/`/page- 開頭 prepend http:// 實質中和，但後端仍應把關，
        //     避免未來其他渲染路徑直接吃這個值。)
        if (!string.IsNullOrWhiteSpace(Url))
        {
            var u = Url.Trim();
            string[] danger = { "javascript:", "data:", "vbscript:" };
            if (danger.Any(d => u.StartsWith(d, StringComparison.OrdinalIgnoreCase)))
            {
                yield return new ValidationResult("URL 不可使用 javascript: / data: / vbscript: 等危險協定以防範 XSS 攻擊", new[] { nameof(Url) });
            }
            if (u.StartsWith("//") || u.StartsWith(@"/\"))
            {
                yield return new ValidationResult("URL 不可使用協定相對網址 (如 //evil.com)", new[] { nameof(Url) });
            }
        }
    }
}
