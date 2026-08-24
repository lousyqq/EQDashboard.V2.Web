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
    private readonly IMenuAuthService _menuAuthService;
    private readonly ILogger<AccountService> _logger;

    public AccountService(AppDbContext context, ISettingsService settingsService, IMenuAuthService menuAuthService, ILogger<AccountService> logger)
    {
        _context = context;
        _settingsService = settingsService;
        _menuAuthService = menuAuthService;
        _logger = logger;
    }

    private static bool IsAdminLevel(string? roleLevel)
        => string.Equals(roleLevel, "admin", StringComparison.OrdinalIgnoreCase);

    public async Task<(List<object> items, int total)> GetAccountsPagedAsync(int page, int pageSize, string? q, bool isAdmin)
    {
        // 分頁/搜尋一律下推 DB（WHERE + Skip/Take），不再把全表撈進記憶體再過濾。
        if (page < 1) page = 1;
        if (pageSize < 1) pageSize = 10;
        if (pageSize > 100) pageSize = 100; // 上限保護：避免惡意 pageSize 把全表一次撈出

        var query = _context.Accounts.AsNoTracking();

        // 🛡️ 委派管理者不得檢視 admin 帳號（2026-08-24 第七輪 J1/J2）。
        //   必須在 CountAsync 之前就套用，否則 total 會含被隱藏的列 → 前端分頁出現空白頁。
        if (!isAdmin)
            query = query.Where(a => a.RoleLevel == null || a.RoleLevel.ToLower() != "admin");
        if (!string.IsNullOrWhiteSpace(q))
        {
            var term = q.Trim();
            // 搜尋字串長度上限保護：被比對的欄位最長為 Name/Department=nvarchar(100)，
            //   超過 100 字的 term 不可能是任何欄位的子字串（搜不到東西），故截斷無功能損失；
            //   同時避免過長 term 讓 EF 的 LIKE '%'+@p+'%' 參數超過 nvarchar(4000) → SqlException 8152「字串會被截斷」(500)。
            if (term.Length > 100) term = term.Substring(0, 100);
            // EF 會參數化（無 SQL 注入風險）；EmpId/Name/Department 模糊比對。
            // ⭐️ P2 效能註記：子字串 `Contains` → `LIKE '%term%'`（前置萬用字元）本質 non-sargable，
            //     無法用 B-tree seek、只能掃描（O(N)）。維持子字串 UX 的前提下，已在 SchemaBootstrap
            //     建窄覆蓋索引 IX_Accounts_Search(Name, Department)（葉層自動含 clustered key EmpId）：
            //     不可避免的掃描改讀這條瘦索引而非整個寬 Accounts 表，COUNT(*) 的三欄 OR-of-LIKE 全被涵蓋、免回主表。
            //     若改成 StartsWith/前綴比對才能 index seek（會改變子字串搜尋語意）；真正子線性需 full-text（過度設計、不在範圍）。
            query = query.Where(a =>
                a.EmpId.Contains(term) ||
                (a.Name != null && a.Name.Contains(term)) ||
                (a.Department != null && a.Department.Contains(term)));
        }

        var total = await query.CountAsync();

        // 先用穩定排序 + Skip/Take 取「本頁的 root 帳號」，再 Include 相關的一對多 collection。
        //   3 個 collection-Include → AsSplitQuery 避免 cartesian 相乘（對齊 §6.2 規範）。
        var pageAccounts = await query
            .OrderBy(a => a.EmpId)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Include(a => a.MapAccountRoles)
            .Include(a => a.MapAccountDefaultPages)
            .Include(a => a.MapAccountManageMenus)
            .AsSplitQuery()
            .ToListAsync();

        var items = pageAccounts.Select(a => new
        {
            empId = a.EmpId,
            name = a.Name,
            department = a.Department,
            roleLevel = a.RoleLevel,
            canEditOthers = a.CanEditOthers,
            assignedRoles = a.MapAccountRoles?.Select(m => m.RoleId).ToList() ?? new List<string>(),
            manageableMenus = a.MapAccountManageMenus?.Select(m => m.MenuId).ToList() ?? new List<string>(),
            defaultPages = a.MapAccountDefaultPages?.ToDictionary(m => m.FabId, m => m.MenuId ?? "") ?? new Dictionary<string, string>()
        }).Cast<object>().ToList();

        return (items, total);
    }

    public async Task<List<object>> GetAccountsForExportAsync()
    {
        // Excel 匯出（全量備份）：admin 明確觸發、非熱路徑，故可一次撈全部帳號的完整明細。
        //   3 個 collection-Include → AsSplitQuery 避免 cartesian 相乘。
        var accounts = await _context.Accounts.AsNoTracking()
            .Include(a => a.MapAccountRoles)
            .Include(a => a.MapAccountManageMenus)
            .Include(a => a.MapAccountDefaultPages)
            .AsSplitQuery()
            .OrderBy(a => a.EmpId)
            .ToListAsync();

        return accounts.Select(a => new
        {
            empId = a.EmpId,
            name = a.Name,
            department = a.Department,
            roleLevel = a.RoleLevel,
            canEditOthers = a.CanEditOthers,
            // ⚠️ LoginCount / LastLoginTime 必須一起匯出（2026-08-15 修）：
            //   Excel 匯入走 /Settings/SaveData 的「DELETE + 依 schema 重建 INSERT」全量覆寫，
            //   Excel 沒有的欄位一律寫成 DBNull/0。少了這兩欄＝一次「匯出→匯入」就把全站
            //   登入統計歸零。規格同 Menus.CreatedAt：稽核欄位，前端只原封不動帶回、不編輯。
            loginCount = a.LoginCount ?? 0,
            lastLoginTime = a.LastLoginTime?.ToString("yyyy-MM-dd HH:mm:ss"),
            assignedRoles = a.MapAccountRoles?.Select(m => m.RoleId).ToList() ?? new List<string>(),
            manageableMenus = a.MapAccountManageMenus?.Select(m => m.MenuId).ToList() ?? new List<string>(),
            defaultPages = a.MapAccountDefaultPages?.ToDictionary(m => m.FabId, m => m.MenuId ?? "") ?? new Dictionary<string, string>()
        }).Cast<object>().ToList();
    }

    public async Task<object?> GetAccountDetailsAsync(string empId, bool isAdmin)
    {
        var a = await _context.Accounts
            .AsNoTracking()
            .Include(x => x.MapAccountRoles)
            .Include(x => x.MapAccountManageMenus)
            .Include(x => x.MapAccountDefaultPages)
            .Include(x => x.MapAccountExtraMenus)
            .Include(x => x.MapAccountDenyMenus)
            .AsSplitQuery() // 5 個 collection-Include 避免 cartesian 相乘
            .FirstOrDefaultAsync(x => x.EmpId == empId);

        if (a == null) return null;

        // 🛡️ 委派管理者查 admin 帳號 → 一律當作不存在（回 404 而非 403，不洩漏「這個 admin 存在」）。
        if (!isAdmin && IsAdminLevel(a.RoleLevel)) return null;

        return new
        {
            empId = a.EmpId,
            name = a.Name,
            department = a.Department,
            roleLevel = a.RoleLevel,
            canEditOthers = a.CanEditOthers,
            assignedRoles = a.MapAccountRoles?.Select(m => m.RoleId).ToList() ?? new List<string>(),
            manageableMenus = a.MapAccountManageMenus?.Select(m => m.MenuId).ToList() ?? new List<string>(),
            // per-fab：以 FabId 分組成 { fabId: [menuId,...] }
            extraMenus = GroupOverridesByFab(a.MapAccountExtraMenus?.Select(m => (m.FabId, m.MenuId))),
            denyMenus = GroupOverridesByFab(a.MapAccountDenyMenus?.Select(m => (m.FabId, m.MenuId))),
            defaultPages = a.MapAccountDefaultPages?.ToDictionary(m => m.FabId, m => m.MenuId ?? "") ?? new Dictionary<string, string>()
        };
    }

    /// <summary>把 per-fab 覆寫關聯列 [(FabId, MenuId)] 分組成 { fabId: [menuId,...] }（前端字典形狀）。</summary>
    private static Dictionary<string, List<string>> GroupOverridesByFab(IEnumerable<(string FabId, string MenuId)>? rows)
    {
        var dict = new Dictionary<string, List<string>>();
        if (rows == null) return dict;
        foreach (var (fabId, menuId) in rows)
        {
            var key = fabId ?? string.Empty;
            if (!dict.TryGetValue(key, out var list)) { list = new List<string>(); dict[key] = list; }
            if (!list.Contains(menuId)) list.Add(menuId);
        }
        return dict;
    }

    public async Task<AccountOperationResult> CreateAccountAsync(AccountFullDto dto, bool isAdmin)
    {
        // 🛡️ 新增帳號一律 admin only：建帳等於決定「誰能進系統」，不在委派管理者的職權內。
        if (!isAdmin) return AccountOperationResult.Denied("僅系統管理員可新增帳號");

        if (await _context.Accounts.AnyAsync(a => a.EmpId == dto.EmpId))
            return AccountOperationResult.Bad("帳號工號已存在");

        // ⚠️ 資料完整性：先驗證所有要寫入的 RoleId / MenuId 都存在（對齊 Roles/Fabs controller 的 1.3 預檢），
        //   stale id 直接回 400 + 明確訊息，避免撞 FK 拋 500。
        var (refsOk, refsErr) = await ValidateMappingRefsAsync(dto);
        if (!refsOk) return AccountOperationResult.Bad(refsErr);

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

        // Create 為單一 SaveChanges（本身即原子）；mappings 與 account 同一交易寫入。
        await _context.SaveChangesAsync();
        _settingsService.InvalidateInitialDataCache();
        return AccountOperationResult.Ok();
    }

    /// <summary>
    /// 資料完整性預檢：驗證 DTO 內所有 RoleId / MenuId 參照都存在於 DB。
    ///   Map_Account_Role.RoleId、Map_Account_ManageMenu/DefaultPage/ExtraMenu/DenyMenu.MenuId 皆有 FK，
    ///   stale id 會在寫入時撞 FK。先在這裡查出來回 400，避免到 SaveChanges 才 500。
    ///   （DefaultPages 的 FabId 故意不驗——Extra/Deny 的 FabId 無 FK；DefaultPage 的 FabId 雖有 FK，
    ///     但交給下方 UpdateAccountAsync 的交易保護即可，stale FabId 也只會整批 rollback、不丟資料。）
    /// </summary>
    private async Task<(bool ok, string error)> ValidateMappingRefsAsync(AccountFullDto dto)
    {
        var roleIds = (dto.AssignedRoles ?? new List<string>())
            .Where(x => !string.IsNullOrWhiteSpace(x))
            .Distinct(StringComparer.OrdinalIgnoreCase).ToList();

        var menuIds = new List<string>();
        if (dto.ManageableMenus != null) menuIds.AddRange(dto.ManageableMenus);
        if (dto.DefaultPages != null) menuIds.AddRange(dto.DefaultPages.Values);
        if (dto.ExtraMenus != null)
            foreach (var v in dto.ExtraMenus.Values) if (v != null) menuIds.AddRange(v);
        if (dto.DenyMenus != null)
            foreach (var v in dto.DenyMenus.Values) if (v != null) menuIds.AddRange(v);
        menuIds = menuIds.Where(x => !string.IsNullOrWhiteSpace(x))
            .Distinct(StringComparer.OrdinalIgnoreCase).ToList();

        if (roleIds.Count > 0)
        {
            var existing = (await _context.Roles.Where(r => roleIds.Contains(r.RoleId)).Select(r => r.RoleId).ToListAsync())
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
            var missing = roleIds.Where(r => !existing.Contains(r)).ToList();
            if (missing.Count > 0) return (false, $"下列角色不存在，無法指派：{string.Join(", ", missing)}");
        }
        if (menuIds.Count > 0)
        {
            var existing = (await _context.Menus.Where(m => menuIds.Contains(m.MenuId)).Select(m => m.MenuId).ToListAsync())
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
            var missing = menuIds.Where(m => !existing.Contains(m)).ToList();
            if (missing.Count > 0) return (false, $"下列看板不存在，無法指派：{string.Join(", ", missing)}");
        }
        return (true, string.Empty);
    }

    /// <summary>
    /// 🛡️ 主從關係收斂（2026-08-24 第七輪 J1）：把委派管理者提交的 DTO 就地改寫成
    ///   「呼叫者範圍內的新值 ∪ 呼叫者範圍外的原值」。
    ///
    /// 兩個方向都要擋，缺一不可：
    ///   ① 往上：不可授出自己沒有的權限（子集規則）—— 委派 A 廠區的人最多只能把 A 廠區授權給別人。
    ///   ② 往下：不可拔掉自己範圍外的既有授權 —— Update 是「先刪後寫」全量覆寫，若只做 ①，
    ///      委派者送出一份「看不到 role_3」的表單就會把 admin 給的 role_3 靜默刪掉（降權攻擊）。
    /// 因此範圍外的既有列一律原封抄回 DTO，範圍內的才依提交值重建。
    /// </summary>
    private async Task ApplyDelegationScopeAsync(AccountFullDto dto, Account account, string callerEmpId)
    {
        var callerRoles = (await _context.MapAccountRoles.AsNoTracking()
                .Where(m => m.EmpId == callerEmpId).Select(m => m.RoleId).ToListAsync())
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        // menuId → 呼叫者是否可授出。CanManageStructureAsync 已是「自己建立 ∪ 委派節點 ∪ 委派子樹」的
        //   唯一事實來源（與前端 getMenuPermissions 對齊），此處直接複用、不要另寫一套判斷。
        //   結果快取：同一次更新會對同一 menuId 問很多次（roles/manage/default/extra/deny）。
        var grantCache = new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase);
        async Task<bool> CanGrant(string? menuId)
        {
            if (string.IsNullOrWhiteSpace(menuId)) return false;
            if (grantCache.TryGetValue(menuId, out var cached)) return cached;
            var ok = await _menuAuthService.CanManageStructureAsync(callerEmpId, menuId, false);
            grantCache[menuId] = ok;
            return ok;
        }

        // --- 角色（可視群組版面）---
        var existingRoles = account.MapAccountRoles?.Select(m => m.RoleId).ToList() ?? new List<string>();
        var mergedRoles = existingRoles.Where(r => !callerRoles.Contains(r))                       // 範圍外 → 保留
            .Concat((dto.AssignedRoles ?? new List<string>()).Where(r => callerRoles.Contains(r))) // 範圍內 → 依提交
            .Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        var droppedRoles = (dto.AssignedRoles ?? new List<string>()).Where(r => !callerRoles.Contains(r)).ToList();
        dto.AssignedRoles = mergedRoles;

        // --- 委派目錄（ManageableMenus）---
        var mergedManage = new List<string>();
        foreach (var m in account.MapAccountManageMenus?.Select(x => x.MenuId) ?? Enumerable.Empty<string>())
            if (!await CanGrant(m)) mergedManage.Add(m);
        var droppedManage = new List<string>();
        foreach (var m in dto.ManageableMenus ?? new List<string>())
        {
            if (await CanGrant(m)) mergedManage.Add(m);
            else droppedManage.Add(m);
        }
        dto.ManageableMenus = mergedManage.Distinct(StringComparer.OrdinalIgnoreCase).ToList();

        // --- 各廠區預設首頁（fabId → menuId）---
        //   槽位鎖定：既有值落在呼叫者範圍外時，整個廠區槽位不接受覆寫（那是 admin 指定的首頁）。
        var finalDefaults = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var kv in account.MapAccountDefaultPages ?? Enumerable.Empty<MapAccountDefaultPage>())
        {
            if (string.IsNullOrWhiteSpace(kv.MenuId)) continue;   // 空值不是有效設定，不該把槽位鎖死
            if (!await CanGrant(kv.MenuId)) finalDefaults[kv.FabId] = kv.MenuId;
        }
        foreach (var kv in dto.DefaultPages ?? new Dictionary<string, string>())
        {
            if (finalDefaults.ContainsKey(kv.Key)) continue;      // 鎖住的槽位
            if (!string.IsNullOrWhiteSpace(kv.Value) && await CanGrant(kv.Value)) finalDefaults[kv.Key] = kv.Value;
        }
        dto.DefaultPages = finalDefaults;

        // --- per-fab 個別覆寫 ---
        dto.ExtraMenus = await MergeOverridesAsync(
            account.MapAccountExtraMenus?.Select(m => (m.FabId, m.MenuId)), dto.ExtraMenus, CanGrant);
        dto.DenyMenus = await MergeOverridesAsync(
            account.MapAccountDenyMenus?.Select(m => (m.FabId, m.MenuId)), dto.DenyMenus, CanGrant);

        if (droppedRoles.Count > 0 || droppedManage.Count > 0)
        {
            // 靜默忽略（不回 400）是刻意的：前端挑選器已只呈現範圍內的項目，會走到這裡的多半是
            //   停留過久的舊分頁或直打 API。但必須留紀錄，否則越權嘗試完全沒有痕跡。
            _logger.LogWarning("⚠️ 委派管理者 {Caller} 更新 {Target} 時，超出授權範圍的指派已被忽略：roles=[{Roles}] manageMenus=[{Menus}]",
                callerEmpId, dto.EmpId, string.Join(",", droppedRoles), string.Join(",", droppedManage));
        }
    }

    /// <summary>per-fab 覆寫（extra/deny）的主從合併：範圍外的既有 (fab, menu) 保留、範圍內的依提交值重建。</summary>
    private static async Task<Dictionary<string, List<string>>> MergeOverridesAsync(
        IEnumerable<(string FabId, string MenuId)>? existing,
        Dictionary<string, List<string>>? submitted,
        Func<string?, Task<bool>> canGrant)
    {
        var result = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);

        void Add(string fabId, string menuId)
        {
            if (string.IsNullOrWhiteSpace(fabId) || string.IsNullOrWhiteSpace(menuId)) return;
            if (!result.TryGetValue(fabId, out var list)) { list = new List<string>(); result[fabId] = list; }
            if (!list.Contains(menuId, StringComparer.OrdinalIgnoreCase)) list.Add(menuId);
        }

        foreach (var (fabId, menuId) in existing ?? Enumerable.Empty<(string, string)>())
            if (!await canGrant(menuId)) Add(fabId, menuId);

        foreach (var kv in submitted ?? new Dictionary<string, List<string>>())
            foreach (var menuId in kv.Value ?? new List<string>())
                if (await canGrant(menuId)) Add(kv.Key, menuId);

        return result;
    }

    public async Task<AccountOperationResult> UpdateAccountAsync(string empId, AccountFullDto dto, string callerEmpId, bool isAdmin)
    {
        // ⚠️ 強制 dto.EmpId = path 的 empId。
        //   原本 bug：UpdateAccountMappings 用 dto.EmpId 寫到 Map_Account_*，但找 account 用 path 的 empId。
        //   兩者不一致時 (admin 改錯欄位/惡意提交)：
        //     - 找到的 account = path 的 (e.g., user)，刪掉它的 mappings
        //     - 寫新 mappings 用 dto.EmpId (e.g., 00058897)
        //     - 結果：user 的 mappings 全沒了、00058897 多了不該有的 mappings
        //   修法：永遠以 path 為事實來源，body 的 EmpId 忽略。
        dto.EmpId = empId;

        var account = await _context.Accounts
            .Include(a => a.MapAccountRoles)
            .Include(a => a.MapAccountManageMenus)
            .Include(a => a.MapAccountDefaultPages)
            .Include(a => a.MapAccountExtraMenus)
            .Include(a => a.MapAccountDenyMenus)
            .AsSplitQuery() // 5 個 collection-Include 避免 cartesian 相乘
            .FirstOrDefaultAsync(a => a.EmpId == empId);

        if (account == null) return AccountOperationResult.Missing("找不到指定的帳號"); // 真的不存在 → 404

        // 🛡️ 委派管理者（RoleLevel=user + CanEditOthers=true）的三道護欄（2026-08-24 第七輪 J1）。
        //   在此之前 Service 完全不知道呼叫者是誰，只要通過 CanManageAccounts policy 就能把任何人
        //   （含自己）的 RoleLevel 改成 admin —— 實測可自我提權。
        //   ⚠️ 必須排在下方「admin 帳號防降級」之前：否則委派者對 admin 帳號送出降級請求會先拿到 400，
        //      等於用錯誤碼確認了「這個帳號是內建管理員」。越權一律 403，語意才乾淨。
        if (!isAdmin)
        {
            if (IsAdminLevel(account.RoleLevel))
                return AccountOperationResult.Denied("委派管理者不可編輯系統管理員帳號");

            // 權限欄位一律忽略提交值、強制維持 DB 現值（不回 400：表單本來就不該送這兩欄，
            //   舊分頁或直打 API 送了也只是被無視，不需要讓合法編輯整筆失敗）。
            dto.RoleLevel = account.RoleLevel;
            dto.CanEditOthers = account.CanEditOthers == true;

            await ApplyDelegationScopeAsync(dto, account, callerEmpId);
        }

        if (string.Equals(empId, "admin", StringComparison.OrdinalIgnoreCase))
        {
            if (!IsAdminLevel(dto.RoleLevel))
                return AccountOperationResult.Bad("系統預設管理員 (admin) 不可被降級"); // 策略拒絕、帳號存在 → 400
        }

        // ⚠️ 資料完整性：先驗證所有 RoleId / MenuId 都存在（對齊 Roles/Fabs controller 的 1.3 預檢）。
        //   下方「刪舊 mappings → 寫新 mappings」必須整批原子，否則 stale id 撞 FK 會在刪除已 commit 後失敗 →
        //   帳號 mappings 被清空、權限全失且無法回復。先預檢可把常見 stale id 擋成清楚的 400。
        //   ⚠️ 必須在 ApplyDelegationScopeAsync **之後**跑：收斂後的 DTO 才是真正要寫進 DB 的內容。
        var (refsOk, refsErr) = await ValidateMappingRefsAsync(dto);
        if (!refsOk) return AccountOperationResult.Bad(refsErr); // 驗證失敗（stale id）、帳號存在 → 400

        account.Name = dto.Name;
        account.Department = dto.Department;
        account.RoleLevel = dto.RoleLevel;
        account.CanEditOthers = dto.CanEditOthers;

        // ⚠️ 原子性：原本「刪 mappings→SaveChanges→寫 mappings→SaveChanges」無交易，第二段失敗會留下被清空的帳號。
        //   改包單一交易：任一步失敗整批 rollback、舊 mappings 完整保留。
        //   ⚠️ DbContext 已啟用 EnableRetryOnFailure → 手動交易必須透過 ExecutionStrategy 執行
        //     （同 MenusController.BatchUpdateMenus；否則拋 "does not support user-initiated transactions"）。
        var strategy = _context.Database.CreateExecutionStrategy();
        await strategy.ExecuteAsync(async () =>
        {
            using var transaction = await _context.Database.BeginTransactionAsync();
            try
            {
                if (account.MapAccountRoles != null) _context.MapAccountRoles.RemoveRange(account.MapAccountRoles);
                if (account.MapAccountManageMenus != null) _context.MapAccountManageMenus.RemoveRange(account.MapAccountManageMenus);
                if (account.MapAccountDefaultPages != null) _context.MapAccountDefaultPages.RemoveRange(account.MapAccountDefaultPages);
                if (account.MapAccountExtraMenus != null) _context.MapAccountExtraMenus.RemoveRange(account.MapAccountExtraMenus);
                if (account.MapAccountDenyMenus != null) _context.MapAccountDenyMenus.RemoveRange(account.MapAccountDenyMenus);

                await _context.SaveChangesAsync(); // flush DELETE，避免同 PK 的 DELETE+INSERT tracking 衝突

                UpdateAccountMappings(dto);

                await _context.SaveChangesAsync();
                await transaction.CommitAsync();
            }
            catch
            {
                await transaction.RollbackAsync();
                throw;
            }
        });

        _settingsService.InvalidateInitialDataCache();
        return AccountOperationResult.Ok();
    }

    public async Task<AccountOperationResult> DeleteAccountAsync(string empId, string? currentEmpId, bool isAdmin)
    {
        // 🛡️ 刪除帳號一律 admin only：刪帳號會連帶清掉 Map_Account_* 與 PersonalSettings，
        //   是本系統破壞性最高的單一操作，不在委派管理者的職權內。
        if (!isAdmin) return AccountOperationResult.Denied("僅系統管理員可刪除帳號");

        var account = await _context.Accounts
            .Include(a => a.MapAccountRoles)
            .Include(a => a.MapAccountManageMenus)
            .Include(a => a.MapAccountDefaultPages)
            .Include(a => a.MapAccountExtraMenus)
            .Include(a => a.MapAccountDenyMenus)
            .AsSplitQuery() // 5 個 collection-Include 避免 cartesian 相乘
            .FirstOrDefaultAsync(a => a.EmpId == empId);

        if (account == null) return AccountOperationResult.Missing("找不到該帳號");

        if (string.Equals(empId, "admin", StringComparison.OrdinalIgnoreCase))
            return AccountOperationResult.Bad("系統預設管理員 (admin) 不可被刪除");

        // 🛡️ 擋自刪：避免 admin 把自己刪了之後 cookie 還在但 DB 已查無，後續所有 [Authorize] 查 DB 都會踩 NotFound
        if (!string.IsNullOrEmpty(currentEmpId) && string.Equals(empId, currentEmpId, StringComparison.OrdinalIgnoreCase))
            return AccountOperationResult.Bad("不可刪除目前登入中的帳號");

        // 🛡️ 擋最後一個 admin：刪掉後若整個系統剩 0 個 RoleLevel='admin' 帳號 → 永久失去管理員、需改 DB 救援
        if (string.Equals(account.RoleLevel, "admin", StringComparison.OrdinalIgnoreCase))
        {
            var remainingAdmins = await _context.Accounts
                .Where(a => a.EmpId != empId && a.RoleLevel != null && a.RoleLevel.ToLower() == "admin")
                .CountAsync();
            if (remainingAdmins == 0)
                return AccountOperationResult.Bad("不可刪除系統中唯一的管理員帳號");
        }

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

        var backupJson = System.Text.Json.JsonSerializer.Serialize(account, new System.Text.Json.JsonSerializerOptions { ReferenceHandler = System.Text.Json.Serialization.ReferenceHandler.IgnoreCycles });

        _context.Accounts.Remove(account);
        await _context.SaveChangesAsync();
        _settingsService.InvalidateInitialDataCache();
        return AccountOperationResult.Ok(backupJson);
    }

    private void UpdateAccountMappings(AccountFullDto dto)
    {
        if (dto.AssignedRoles != null)
        {
            // 複合 PK (EmpId+RoleId)：payload 內重複 roleId 會撞 EF identity map「same key already tracked」→ 500。
            foreach (var rId in dto.AssignedRoles.Distinct())
            {
                _context.MapAccountRoles.Add(new MapAccountRole { EmpId = dto.EmpId, RoleId = rId });
            }
        }

        if (dto.ManageableMenus != null)
        {
            // 複合 PK (EmpId+MenuId)：同上，Add 前去重。
            foreach (var mId in dto.ManageableMenus.Distinct())
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

        // per-fab：ExtraMenus/DenyMenus 為 { fabId: [menuId,...] }，逐廠區寫入並帶 FabId。
        //   略過空 fabId（避免寫出沒有廠區歸屬、永遠失效的孤兒列）。
        if (dto.ExtraMenus != null)
        {
            foreach (var kvp in dto.ExtraMenus)
            {
                if (string.IsNullOrWhiteSpace(kvp.Key) || kvp.Value == null) continue;
                foreach (var mId in kvp.Value.Distinct())
                {
                    _context.MapAccountExtraMenus.Add(new MapAccountExtraMenu { EmpId = dto.EmpId, FabId = kvp.Key, MenuId = mId });
                }
            }
        }

        if (dto.DenyMenus != null)
        {
            foreach (var kvp in dto.DenyMenus)
            {
                if (string.IsNullOrWhiteSpace(kvp.Key) || kvp.Value == null) continue;
                foreach (var mId in kvp.Value.Distinct())
                {
                    _context.MapAccountDenyMenus.Add(new MapAccountDenyMenu { EmpId = dto.EmpId, FabId = kvp.Key, MenuId = mId });
                }
            }
        }
    }
}
