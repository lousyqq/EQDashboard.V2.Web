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

    public async Task<bool> CanManageMenuAsync(string empId, string menuId, bool isAdmin)
    {
        if (isAdmin) return true;
        if (string.IsNullOrWhiteSpace(empId) || string.IsNullOrWhiteSpace(menuId)) return false;

        // ① 直接委派？
        var directDelegated = await _context.MapAccountManageMenus
            .AnyAsync(m => m.EmpId == empId && m.MenuId == menuId);
        if (directDelegated) return true;

        // ② 自己建立的？(新建 menu 時 menuId 可能還不在 DB，所以 menu 可能為 null，這時走不到這 branch 沒關係)
        var menu = await _context.Menus.AsNoTracking().FirstOrDefaultAsync(m => m.MenuId == menuId);
        if (menu != null && string.Equals(menu.CreatedBy, empId, StringComparison.OrdinalIgnoreCase))
            return true;

        // ③ 取得帳號的 CanEditOthers + 委派列表
        var account = await _context.Accounts.AsNoTracking().FirstOrDefaultAsync(a => a.EmpId == empId);
        if (account?.CanEditOthers != true) return false;

        var manageableSet = await _context.MapAccountManageMenus
            .AsNoTracking()
            .Where(m => m.EmpId == empId)
            .Select(m => m.MenuId)
            .ToListAsync();
        if (manageableSet.Count == 0) return false;
        var manageableHash = new HashSet<string>(manageableSet, StringComparer.OrdinalIgnoreCase);

        // ④ 從 menuId 沿 Map_Menu_Structure.ParentMenuId 往上走，碰到 manageable 就放行
        var visited = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var queue = new Queue<string>();
        queue.Enqueue(menuId);

        while (queue.Count > 0)
        {
            var curr = queue.Dequeue();
            if (manageableHash.Contains(curr)) return true;
            if (!visited.Add(curr)) continue;

            var parents = await _context.MapMenuStructures
                .AsNoTracking()
                .Where(s => s.ChildMenuId == curr)
                .Select(s => s.ParentMenuId)
                .ToListAsync();
            foreach (var p in parents)
            {
                if (!visited.Contains(p)) queue.Enqueue(p);
            }
        }
        return false;
    }
}
