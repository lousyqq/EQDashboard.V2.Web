using EQDashboard.V2.Web.Data;
using EQDashboard.V2.Web.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace EQDashboard.V2.Web.Services;

/// <summary>
/// 後端委派授權檢查，**必須與 wwwroot/js/render/sidebar.js 的 getMenuPermissions 對齊**。
/// 不對齊就會出現「前端讓 user 看到編輯按鈕、後端 403 拒絕」的鬼故事 — 已踩過一次。
///
/// 一個 menu 可被 empId 寫入的條件：
///   1. empId 是 admin
///   2. empId == menu.CreatedBy  (自己建的一律可寫，不需 CanEditOthers)
///   3. menu 自己就在 Map_Account_ManageMenu 委派列表中 (直接委派)
///   4. menu 的任一祖先在委派列表中、且帳號 CanEditOthers=true
///      (委派 folder 等於委派整個子樹；但只有 CanEditOthers=true 才能動別人建的東西)
/// </summary>
public class MenuAuthService : IMenuAuthService
{
    private readonly AppDbContext _context;

    public MenuAuthService(AppDbContext context)
    {
        _context = context;
    }

    private async Task<(bool isMyOwn, bool isDelegatedNode, bool isUnder, bool isAncestor, bool canEditOthers)> GetNodePermissionsAsync(string empId, string menuId)
    {
        var account = await _context.Accounts.AsNoTracking().FirstOrDefaultAsync(a => a.EmpId == empId);
        bool canEditOthers = account?.CanEditOthers == true;

        var menu = await _context.Menus.AsNoTracking().FirstOrDefaultAsync(m => m.MenuId == menuId);
        bool isMyOwn = menu != null && string.Equals(menu.CreatedBy, empId, StringComparison.OrdinalIgnoreCase);

        var manageSet = await _context.MapAccountManageMenus.AsNoTracking().Where(m => m.EmpId == empId).Select(m => m.MenuId).ToListAsync();
        if (manageSet.Count == 0) return (isMyOwn, false, false, false, canEditOthers);

        bool isDelegatedNode = manageSet.Contains(menuId, StringComparer.OrdinalIgnoreCase);
        
        var structures = await _context.MapMenuStructures.AsNoTracking().ToListAsync();
        
        bool isUnder = false;
        if (!isDelegatedNode)
        {
            var q = new Queue<string>();
            var visited = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            q.Enqueue(menuId);
            while(q.Count > 0) {
                var curr = q.Dequeue();
                if (manageSet.Contains(curr, StringComparer.OrdinalIgnoreCase)) { isUnder = true; break; }
                if (!visited.Add(curr)) continue;
                var parents = structures.Where(s => string.Equals(s.ChildMenuId, curr, StringComparison.OrdinalIgnoreCase)).Select(s => s.ParentMenuId);
                foreach(var p in parents) q.Enqueue(p);
            }
        }

        bool isAncestor = false;
        if (!isDelegatedNode && !isUnder)
        {
            var q = new Queue<string>(manageSet);
            var visited = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            while(q.Count > 0) {
                var curr = q.Dequeue();
                if (string.Equals(curr, menuId, StringComparison.OrdinalIgnoreCase)) { isAncestor = true; break; }
                if (!visited.Add(curr)) continue;
                var parents = structures.Where(s => string.Equals(s.ChildMenuId, curr, StringComparison.OrdinalIgnoreCase)).Select(s => s.ParentMenuId);
                foreach(var p in parents) q.Enqueue(p);
            }
        }

        return (isMyOwn, isDelegatedNode, isUnder, isAncestor, canEditOthers);
    }

    public async Task<bool> CanManageStructureAsync(string empId, string menuId, bool isAdmin)
    {
        if (isAdmin) return true;
        if (string.IsNullOrWhiteSpace(empId) || string.IsNullOrWhiteSpace(menuId)) return false;

        var perms = await GetNodePermissionsAsync(empId, menuId);
        if (perms.isMyOwn) return true;
        if (perms.isDelegatedNode || perms.isUnder) return true;

        return false;
    }

    public async Task<bool> CanEditOrDeleteMenuAsync(string empId, string menuId, bool isAdmin)
    {
        if (isAdmin) return true;
        if (string.IsNullOrWhiteSpace(empId) || string.IsNullOrWhiteSpace(menuId)) return false;

        var perms = await GetNodePermissionsAsync(empId, menuId);
        if (perms.isMyOwn) return true;
        if ((perms.isDelegatedNode || perms.isUnder) && perms.canEditOthers) return true;

        return false;
    }

    public async Task<bool> IsDelegatedAdminAsync(string empId, bool isAdmin)
    {
        if (isAdmin) return true;
        if (string.IsNullOrWhiteSpace(empId)) return false;

        var account = await _context.Accounts.AsNoTracking().FirstOrDefaultAsync(a => a.EmpId == empId);
        if (account?.CanEditOthers != true) return false;

        var hasManagedMenus = await _context.MapAccountManageMenus
            .AsNoTracking()
            .AnyAsync(m => m.EmpId == empId);

        return hasManagedMenus;
    }

    public async Task<HashSet<string>?> GetVisibleMenuIdsAsync(string empId, bool isAdmin)
    {
        if (isAdmin) return null;                              // admin 不限
        if (string.IsNullOrWhiteSpace(empId)) return new HashSet<string>();  // 匿名 / 無效 → 空集合

        // ① 抓 user 的 roles → 對應 allowedMenuIds
        var roleIds = await _context.MapAccountRoles.AsNoTracking()
            .Where(m => m.EmpId == empId).Select(m => m.RoleId).ToListAsync();
        var roleAllowed = roleIds.Count == 0
            ? new List<string>()
            : await _context.MapRoleMenus.AsNoTracking()
                .Where(m => roleIds.Contains(m.RoleId)).Select(m => m.MenuId).ToListAsync();

        // ② 帳號層級 extra / deny
        var extras = await _context.MapAccountExtraMenus.AsNoTracking()
            .Where(m => m.EmpId == empId).Select(m => m.MenuId).ToListAsync();
        var accountDeny = await _context.MapAccountDenyMenus.AsNoTracking()
            .Where(m => m.EmpId == empId).Select(m => m.MenuId).ToListAsync();

        // ③ Menu 層級 ACL — 取「會影響 user」的兩種規則
        var menuDeny = await _context.MapMenuDenyAccounts.AsNoTracking()
            .Where(m => m.EmpId == empId).Select(m => m.MenuId).ToListAsync();
        // 白名單：先抓所有有白名單的 menu，再判斷 user 是否在裡面
        var allowsRaw = await _context.MapMenuAllowAccounts.AsNoTracking()
            .Select(m => new { m.MenuId, m.EmpId }).ToListAsync();
        var menusWithWhitelist = allowsRaw.Select(a => a.MenuId).Distinct().ToHashSet(StringComparer.OrdinalIgnoreCase);
        var menuForceAllow = allowsRaw
            .Where(a => string.Equals(a.EmpId, empId, StringComparison.OrdinalIgnoreCase))
            .Select(a => a.MenuId).ToHashSet(StringComparer.OrdinalIgnoreCase);
        // 白名單存在但 user 不在 → 視同 deny
        var aclDeny = new HashSet<string>(menuDeny, StringComparer.OrdinalIgnoreCase);
        foreach (var mid in menusWithWhitelist)
            if (!menuForceAllow.Contains(mid)) aclDeny.Add(mid);

        // ④ 計算 base set
        var allowed = new HashSet<string>(roleAllowed, StringComparer.OrdinalIgnoreCase);
        foreach (var x in extras) allowed.Add(x);
        // account.deny 扣除 (menu force-allow 蓋過)
        foreach (var x in accountDeny)
            if (!menuForceAllow.Contains(x)) allowed.Remove(x);
        // menu ACL — force-allow 強加
        foreach (var x in menuForceAllow) allowed.Add(x);
        // menu ACL — deny 強拿
        foreach (var x in aclDeny) allowed.Remove(x);

        // ⑤ 展開子節點 (沿 Map_Menu_Structure 走 children)，遇 aclDeny 不展開
        var allStructures = await _context.MapMenuStructures.AsNoTracking()
            .Select(s => new { s.ParentMenuId, s.ChildMenuId }).ToListAsync();
        var childrenOf = allStructures
            .GroupBy(s => s.ParentMenuId, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.Select(x => x.ChildMenuId).ToList(), StringComparer.OrdinalIgnoreCase);

        bool added = true;
        while (added)
        {
            added = false;
            foreach (var parent in allowed.ToList())
            {
                if (!childrenOf.TryGetValue(parent, out var kids)) continue;
                foreach (var kid in kids)
                {
                    if (aclDeny.Contains(kid)) continue;
                    if (accountDeny.Contains(kid) && !menuForceAllow.Contains(kid)) continue;
                    if (allowed.Add(kid)) added = true;
                }
            }
        }

        return allowed;
    }
}
