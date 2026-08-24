using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using EQDashboard.V2.Web.Data;
using System.Data;
using System.Security.Claims;

namespace EQDashboard.V2.Web.Controllers;

[Route("api/[controller]")]
[ApiController]
[Authorize] // Allow all authenticated users; restrict admin methods individually
public class AnalyticsController : ControllerBase
{
    private readonly AppDbContext _context;
    private readonly ILogger<AnalyticsController> _logger;

    public AnalyticsController(AppDbContext context, ILogger<AnalyticsController> logger)
    {
        _context = context;
        _logger = logger;
    }

    /// <summary>
    /// 取得全站瀏覽與活躍統計趨勢 (DAU / MAU / 各部門分布)
    /// </summary>
    [HttpGet("UsageStats")]
    [Authorize(Roles = "admin")]
    public async Task<IActionResult> GetUsageStats([FromQuery] int days = 30)
    {
        if (days < 7 || days > 180) days = 30;

        try
        {
            // ⭐ 使用 SQL Server 端的 GETDATE() 作為「今天」，與 RecordDailyUserVisitAsync 的
            //    CONVERT(date, GETDATE()) 保持一致，避免 App/DB 跨時區時 DAU 查不到今天的紀錄。
            var sqlToday = await _context.Database
                .SqlQueryRaw<DateTime>("SELECT CONVERT(date, GETDATE()) AS [Value]")
                .FirstOrDefaultAsync();
            var today = sqlToday != default ? sqlToday.Date : DateTime.Now.Date;
            var firstDayOfMonth = new DateTime(today.Year, today.Month, 1);
            var cutoffDate = today.AddDays(-days + 1);

            // 1. Summary Cards
            var todayDau = await _context.DailyUserVisits.AsNoTracking()
                .Where(x => x.VisitDate == today)
                .Select(x => x.EmpId).Distinct()
                .CountAsync();
            var todayVisits = await _context.DailyUserVisits.AsNoTracking()
                .Where(x => x.VisitDate == today)
                .SumAsync(x => (int?)x.VisitCount) ?? 0;

            var monthMau = await _context.DailyUserVisits.AsNoTracking()
                .Where(x => x.VisitDate >= firstDayOfMonth)
                .Select(x => x.EmpId).Distinct()
                .CountAsync();
            var monthVisits = await _context.DailyUserVisits.AsNoTracking()
                .Where(x => x.VisitDate >= firstDayOfMonth)
                .SumAsync(x => (int?)x.VisitCount) ?? 0;

            var totalAccounts = await _context.Accounts.AsNoTracking().CountAsync();

            // 2. Daily Trend (DAU & Visits by Day)
            var dailyRaw = await _context.DailyUserVisits.AsNoTracking()
                .Where(x => x.VisitDate >= cutoffDate)
                .GroupBy(x => x.VisitDate)
                .Select(g => new
                {
                    Date = g.Key,
                    Dau = g.Select(x => x.EmpId).Distinct().Count(),
                    Visits = g.Sum(x => x.VisitCount)
                })
                .OrderBy(x => x.Date)
                .ToListAsync();

            var dailyTrend = dailyRaw.Select(x => new
            {
                date = x.Date.ToString("yyyy-MM-dd"),
                dau = x.Dau,
                visits = x.Visits
            }).ToList();

            // 3. Monthly Trend (MAU & Visits for past 12 months via high-performance raw SQL)
            //    ⭐ 不使用 using 包裝 GetDbConnection()，避免 Dispose 掉 DbContext 管理的連線。
            var monthlyTrend = new List<object>();
            var conn = _context.Database.GetDbConnection();
            if (conn.State != ConnectionState.Open)
                await conn.OpenAsync();
            using (var cmd = conn.CreateCommand())
            {
                // ⚠️ 2026-08-16 移除 WITH (NOLOCK)：本檔另外三個端點都走 EF + AsNoTracking，只有這裡開髒讀，
                //    是不必要的例外。NOLOCK 除了讀到未提交資料，還可能在頁面分裂時漏列/重複列 ——
                //    對「月度活躍人數」這種要拿去對外報告的數字，換來的那點鎖競爭節省並不划算
                //    （DailyUserVisits 是每人每日一列的小表，且寫入走單句 UPSERT、鎖持有時間極短）。
                cmd.CommandText = @"
                    SELECT LEFT(CONVERT(varchar, VisitDate, 120), 7) AS YearMonth,
                           COUNT(DISTINCT EmpId) AS Mau,
                           SUM(VisitCount) AS Visits
                    FROM DailyUserVisits
                    WHERE VisitDate >= DATEADD(month, -12, CONVERT(date, GETDATE()))
                    GROUP BY LEFT(CONVERT(varchar, VisitDate, 120), 7)
                    ORDER BY YearMonth ASC;";
                using var reader = await cmd.ExecuteReaderAsync();
                while (await reader.ReadAsync())
                {
                    monthlyTrend.Add(new
                    {
                        month = reader.GetString(0),
                        mau = reader.IsDBNull(1) ? 0 : reader.GetInt32(1),
                        visits = reader.IsDBNull(2) ? 0 : reader.GetInt32(2)
                    });
                }
            }

            // 4. Department Breakdown (for selected days window)
            // ⚠️ 分群鍵維持「原始的 Department（可為 null）」，**不要**在後端塞中文預設值（2026-08-16 F9 修）：
            //    這個值會直接被前端渲染出來，硬編中文的話英/日文介面照樣顯示中文。
            //    null 由前端以 t('dept_unspecified_other') 呈現。
            var deptRaw = await _context.DailyUserVisits.AsNoTracking()
                .Where(x => x.VisitDate >= cutoffDate)
                .GroupBy(x => x.Department)
                .Select(g => new
                {
                    Department = g.Key,
                    ActiveUsers = g.Select(x => x.EmpId).Distinct().Count(),
                    Visits = g.Sum(x => x.VisitCount)
                })
                .OrderByDescending(x => x.Visits)
                .ToListAsync();

            var departmentBreakdown = deptRaw.Select(x => new
            {
                department = x.Department,
                activeUsers = x.ActiveUsers,
                visits = x.Visits
            }).ToList();

            return Ok(new
            {
                summary = new
                {
                    todayDau,
                    todayVisits,
                    monthMau,
                    monthVisits,
                    totalAccounts
                },
                dailyTrend,
                monthlyTrend,
                departmentBreakdown
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "取得全站統計趨勢失敗");
            return StatusCode(500, new { success = false, errorCode = "err_load_stats_failed" });
        }
    }

    /// <summary>
    /// 分頁查詢每日帳號活躍造訪明細
    /// </summary>
    [HttpGet("details")]
    [Authorize(Roles = "admin")]
    public async Task<IActionResult> GetDetails(
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20,
        [FromQuery] string? date = null,
        [FromQuery] string? dept = null,
        [FromQuery] string? q = null)
    {
        if (page < 1) page = 1;
        if (pageSize < 1 || pageSize > 100) pageSize = 20;

        try
        {
            var query = _context.DailyUserVisits.AsNoTracking().AsQueryable();

            if (!string.IsNullOrWhiteSpace(date))
            {
                if (DateTime.TryParse(date, out var parsedDate))
                {
                    query = query.Where(x => x.VisitDate == parsedDate.Date);
                }
                else
                {
                    return BadRequest(new { success = false, errorCode = "err_invalid_date" });
                }
            }
            if (!string.IsNullOrWhiteSpace(dept))
            {
                // ⭐ 使用 Contains 模糊搜尋（非精確匹配），讓使用者輸入 "12A" 也能匹配 "12A_PTI/ESI/MSD"
                var deptTerm = dept.Trim();
                if (deptTerm.Length > 100) deptTerm = deptTerm.Substring(0, 100);
                query = query.Where(x => x.Department != null && x.Department.Contains(deptTerm));
            }
            if (!string.IsNullOrWhiteSpace(q))
            {
                // 防禦 SqlException 8152 截斷錯誤上限
                var term = q.Trim();
                if (term.Length > 100) term = term.Substring(0, 100);
                query = query.Where(x => x.EmpId.Contains(term) || (x.EmpName != null && x.EmpName.Contains(term)));
            }

            var total = await query.CountAsync();
            var items = await query
                .OrderByDescending(x => x.VisitDate)
                .ThenByDescending(x => x.VisitCount)
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .Select(x => new
                {
                    visitDate = x.VisitDate.ToString("yyyy-MM-dd"),
                    empId = x.EmpId,
                    empName = x.EmpName ?? x.EmpId,
                    // null 原樣回傳，由前端 t('unspecified') 呈現（見上方 departmentBreakdown 的說明）
                    department = x.Department,
                    visitCount = x.VisitCount,
                    firstVisitTime = x.FirstVisitTime.ToString("HH:mm:ss"),
                    lastVisitTime = x.LastVisitTime.ToString("HH:mm:ss")
                })
                .ToListAsync();

            return Ok(new { items, total, page, pageSize });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "查詢每日造訪明細失敗");
            return StatusCode(500, new { success = false, errorCode = "err_load_stats_failed" });
        }
    }

    /// <summary>
    /// 看板使用排行 (Menu Usage Rank)
    /// </summary>
    [HttpGet("MenuClickStats")]
    [Authorize(Roles = "admin")]
    public async Task<IActionResult> GetMenuClickStats([FromQuery] int days = 30)
    {
        if (days < 7 || days > 365) days = 30;
        try
        {
            var sqlToday = await _context.Database
                .SqlQueryRaw<DateTime>("SELECT CONVERT(date, GETDATE()) AS [Value]")
                .FirstOrDefaultAsync();
            var today = sqlToday != default ? sqlToday.Date : DateTime.Now.Date;
            var cutoffDate = today.AddDays(-days + 1);

            var query = await _context.DailyMenuClicks.AsNoTracking()
                .Where(x => x.ClickDate >= cutoffDate)
                .GroupBy(x => x.MenuId)
                .Select(g => new
                {
                    MenuId = g.Key,
                    TotalClicks = g.Sum(x => x.ClickCount),
                    ActiveUsers = g.Select(x => x.EmpId).Distinct().Count(),
                    LastClick = g.Max(x => x.LastClickTime)
                })
                .ToListAsync();

            var clickedIds = query.Select(x => x.MenuId).ToHashSet();

            // ⚠️ 2026-08-24 第八輪 K7：原本這裡查了 Menus **兩次** —— 先撈 activeMenus（MenuId/DisplayName/CreatedBy），
            //    再用 allMenuIds 對同一張表撈一次 menuDict。兩者的差集只有「被點過但現在已停用／已是 pool／已刪」的看板，
            //    而那些用 clickedIds 就能直接表達 → 合併成一次查詢（少一趟 round-trip，也順帶避掉 allMenuIds
            //    這個會隨看板數線性成長的 IN 參數清單，G12 的風險同時降低）。
            // ⚠️ G12（2026-08-24 第八輪收尾）：這裡刻意寫成**子查詢**而不是 `clickedIds.Contains(m.MenuId)`。
            //    後者會把「這段期間被點過的所有 MenuId」展開成 SQL 的 IN 參數清單，超過 EF Core 的參數上限
            //    （約 2100）就會直接爆掉。改成 EXISTS 子查詢後，參數量與看板數完全脫鉤（沿用 H4 對
            //    GetZombieMenus 的同一套修法）。
            var menuRows = await _context.Menus.AsNoTracking()
                .Where(m => (m.IsEnabled == true && m.IsPoolItem != true && m.MenuMode != "folder" && m.MenuMode != "app_grid")
                            || _context.DailyMenuClicks.Any(c => c.ClickDate >= cutoffDate && c.MenuId == m.MenuId))
                .Select(m => new
                {
                    m.MenuId,
                    m.DisplayName,
                    m.CreatedBy,
                    m.CreatedAt,
                    IsActive = m.IsEnabled == true && m.IsPoolItem != true && m.MenuMode != "folder" && m.MenuMode != "app_grid"
                })
                .ToListAsync();

            var menuDict = menuRows.ToDictionary(m => m.MenuId, m => m);
            var activeMenus = menuRows.Where(m => m.IsActive).ToList();

            // ⭐️ 2026-08-24 第八輪 K3：殭屍看板分頁併進「看板點擊率」後，E9 做的「建立日期三態」在 UI 上整個消失，
            //    未被點擊的看板最後一欄一律顯示「未知」→ 管理者無法分辨「上週剛建的」與「兩年沒人碰」。
            //    這裡把 GetZombieMenus 的同一套推估搬過來（**邏輯必須與該端點保持一致，改一邊要改兩邊**）：
            //      exact    = Menus.CreatedAt 有值
            //      inferred = 沒有 CreatedAt，改用「歷來最早一次點擊日」當『至少在這天之前就存在』的下限
            //      unknown  = 兩者皆無
            //    ⚠️ 一樣**不寫回 Menus.CreatedAt** —— 舊資料的 NULL 不可用推估值漂白，否則真殭屍會被洗白。
            var neverClickedUnknownIds = activeMenus
                .Where(m => !clickedIds.Contains(m.MenuId) && m.CreatedAt == null)
                .Select(m => m.MenuId).ToList();
            var firstSeen = new Dictionary<string, DateTime>();
            foreach (var chunk in neverClickedUnknownIds.Chunk(1000))
            {
                var batch = await _context.DailyMenuClicks.AsNoTracking()
                    .Where(x => chunk.Contains(x.MenuId))
                    .GroupBy(x => x.MenuId)
                    .Select(g => new { MenuId = g.Key, First = g.Min(x => x.ClickDate) })
                    .ToDictionaryAsync(x => x.MenuId, x => x.First);
                foreach (var kvp in batch) firstSeen[kvp.Key] = kvp.Value;
            }

            var creatorEmpIds = menuDict.Values.Where(v => !string.IsNullOrEmpty(v.CreatedBy)).Select(v => v.CreatedBy!).Distinct().ToList();
            var accountNames = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            if (creatorEmpIds.Count > 0)
            {
                accountNames = await _context.Accounts.Where(a => creatorEmpIds.Contains(a.EmpId))
                    .ToDictionaryAsync(a => a.EmpId, a => a.EmpId, StringComparer.OrdinalIgnoreCase);
            }

            // ⚠️ K7：原本用 List<dynamic> + 排序時逐欄 cast（(int)x.TotalClicks…）——
            //    型別全靠執行期繫結，加一個欄位就得改三處 cast，且完全沒有編譯期保護。改用具名 record。
            string ResolveCreator(string? createdBy)
            {
                if (string.IsNullOrEmpty(createdBy)) return "";
                return accountNames.TryGetValue(createdBy, out var name) ? name : createdBy;
            }

            var rawItems = new List<MenuClickStatRow>();
            foreach (var click in query)
            {
                menuDict.TryGetValue(click.MenuId, out var m);
                rawItems.Add(new MenuClickStatRow(
                    click.MenuId,
                    m?.DisplayName,
                    ResolveCreator(m?.CreatedBy),
                    click.TotalClicks,
                    click.ActiveUsers,
                    click.LastClick.ToString("yyyy-MM-dd HH:mm:ss"),
                    // 被點過的看板不需要推估建立日（最後點擊時間本身就是有效訊號），
                    // 但 CreatedAt 有值時照樣回報，讓前端「建立日期」欄位不必分兩種樣式。
                    m?.CreatedAt?.ToString("yyyy-MM-dd"),
                    m?.CreatedAt != null ? "exact" : "unknown"));
            }

            foreach (var m in activeMenus.Where(m => !clickedIds.Contains(m.MenuId)))
            {
                string? createTime;
                string createTimeKind;
                if (m.CreatedAt != null) { createTime = m.CreatedAt.Value.ToString("yyyy-MM-dd"); createTimeKind = "exact"; }
                else if (firstSeen.TryGetValue(m.MenuId, out var f)) { createTime = f.ToString("yyyy-MM-dd"); createTimeKind = "inferred"; }
                else { createTime = null; createTimeKind = "unknown"; }

                rawItems.Add(new MenuClickStatRow(
                    m.MenuId, m.DisplayName, ResolveCreator(m.CreatedBy),
                    0, 0, null, createTime, createTimeKind));
            }

            var items = rawItems
                .OrderByDescending(x => x.TotalClicks)
                .ThenBy(x => x.MenuName ?? "")
                .Select(x => new
                {
                    menuId = x.MenuId,
                    menuName = x.MenuName,
                    creator = x.Creator,
                    totalClicks = x.TotalClicks,
                    activeUsers = x.ActiveUsers,
                    lastClick = x.LastClick,
                    createTime = x.CreateTime,
                    createTimeKind = x.CreateTimeKind
                }).ToList();

            return Ok(new { items });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "查詢看板使用排行失敗");
            return StatusCode(500, new { success = false, errorCode = "err_load_stats_failed" });
        }
    }

    /// <summary>
    /// 殭屍看板清單 (Zombie Menus)
    /// 定義：指定天數內完全無人點擊的有效看板 (不含目錄)
    /// </summary>
    [HttpGet("ZombieMenus")]
    [Authorize(Roles = "admin")]
    public async Task<IActionResult> GetZombieMenus([FromQuery] int days = 90)
    {
        // ⚠️ 下限必須與 GetUsageStats / GetMenuClickStats 一致（皆為 7）：
        //    「流量與使用率」頁只有一個 #tsDaysSelect（7/30/60/90），同一個 days 會送給四個端點。
        //    原本這裡是 `days < 30`，使用者選「最近 7 天」時會被靜默改成 90 →
        //    畫面上其他三塊是 7 天、殭屍看板卻是 90 天，且面板文字直接寫「過去 90 天」自打嘴巴。
        if (days < 7 || days > 365) days = 90;
        try
        {
            var sqlToday = await _context.Database
                .SqlQueryRaw<DateTime>("SELECT CONVERT(date, GETDATE()) AS [Value]")
                .FirstOrDefaultAsync();
            var today = sqlToday != default ? sqlToday.Date : DateTime.Now.Date;
            var cutoffDate = today.AddDays(-days + 1);

            // 取得有效的看板 (不包含 AppGrid, Folder, Pool 項目與停用看板)
            // ⚠️ 殭屍防誤判機制：只挑出 CreatedAt 早於 cutoffDate 的看板 (或者舊資料沒有 CreatedAt 的看板)
            var candidates = await _context.Menus.AsNoTracking()
                .Where(m => m.IsEnabled == true &&
                            m.IsPoolItem != true &&
                            m.MenuMode != "folder" &&
                            m.MenuMode != "app_grid")
                .Where(m => m.CreatedAt == null || m.CreatedAt < cutoffDate)
                .Where(m => !_context.DailyMenuClicks.Any(c => c.ClickDate >= cutoffDate && c.MenuId == m.MenuId))
                .Select(m => new
                {
                    m.MenuId,
                    m.DisplayName,
                    m.CreatedBy,
                    m.CreatedAt,
                    m.Url
                })
                .ToListAsync();

            // ⚠️ CreatedAt 為 NULL 的舊看板（欄位是 2026-08-11 才加的，之前建立的通通沒有值）
            //    原本一律回 "-"，管理員無法分辨「真的長期沒人用」與「單純沒有建檔時間」。
            //    這裡用「歷來最早一次點擊日」當作『至少在這天之前就存在』的下限，
            //    並以 createTimeKind 標示資料來源，讓前端能誠實標註是推估值。
            //    ⚠️ 仍然不寫回 Menus.CreatedAt —— 舊資料的 NULL 不可用推估值漂白，否則真殭屍會被洗白。
            var unknownIds = candidates.Where(c => c.CreatedAt == null).Select(c => c.MenuId).ToList();
            var firstSeen = new Dictionary<string, DateTime>();
            if (unknownIds.Count > 0)
            {
                foreach (var chunk in unknownIds.Chunk(1000))
                {
                    var batchFirstSeen = await _context.DailyMenuClicks.AsNoTracking()
                        .Where(x => chunk.Contains(x.MenuId))
                        .GroupBy(x => x.MenuId)
                        .Select(g => new { MenuId = g.Key, First = g.Min(x => x.ClickDate) })
                        .ToDictionaryAsync(x => x.MenuId, x => x.First);
                    
                    foreach (var kvp in batchFirstSeen)
                    {
                        firstSeen[kvp.Key] = kvp.Value;
                    }
                }
            }

            var creatorEmpIds = candidates.Where(c => !string.IsNullOrEmpty(c.CreatedBy)).Select(c => c.CreatedBy!).Distinct().ToList();
            var accountNames = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            if (creatorEmpIds.Count > 0)
            {
                accountNames = await _context.Accounts
                    .Where(a => creatorEmpIds.Contains(a.EmpId))
                    .ToDictionaryAsync(a => a.EmpId, a => a.EmpId, StringComparer.OrdinalIgnoreCase);
            }

            var zombieMenus = candidates.Select(c =>
            {
                string? createTime;
                string createTimeKind;
                if (c.CreatedAt != null)
                {
                    createTime = c.CreatedAt.Value.ToString("yyyy-MM-dd");
                    createTimeKind = "exact";
                }
                else if (firstSeen.TryGetValue(c.MenuId, out var f))
                {
                    createTime = f.ToString("yyyy-MM-dd");
                    createTimeKind = "inferred";   // 前端要標示「≤ 此日期即已存在」
                }
                else
                {
                    createTime = null;
                    createTimeKind = "unknown";    // 舊看板無 CreatedAt，從未被點擊，故無從得知
                }
                
                string creatorName = c.CreatedBy ?? "";
                if (!string.IsNullOrEmpty(c.CreatedBy) && accountNames.TryGetValue(c.CreatedBy, out var name))
                {
                    creatorName = name;
                }
                
                return new
                {
                    menuId = c.MenuId,
                    menuName = c.DisplayName,
                    creator = creatorName,
                    createTime,
                    createTimeKind,
                    url = c.Url
                };
            }).ToList();

            // ℹ️ 2026-08-24 第八輪 K3：本端點的 UI 入口（流量與使用率的「殭屍看板」分頁）已併入
            //    「看板點擊率」（GetMenuClickStats 會回傳 totalClicks=0 的看板並帶上同一套 createTime/createTimeKind）。
            //    端點本身保留：它的 thresholdDays 語意（「N 天內完全沒被點過」）與點擊率頁的排行不同，
            //    仍可能被外部工具或後續報表使用。**若之後確定不再需要，連同 zombieCreateCell 的來源一併移除。**
            return Ok(new { items = zombieMenus, thresholdDays = days });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "查詢殭屍看板清單失敗");
            return StatusCode(500, new { success = false, errorCode = "err_load_stats_failed" });
        }
    }

    /// <summary>
    /// GetMenuClickStats 的中間結果列（2026-08-24 第八輪 K7：取代原本的 List&lt;dynamic&gt;）。
    /// CreateTimeKind：exact｜inferred（以最早點擊日推估的下限）｜unknown —— 與 GetZombieMenus 同一套語意。
    /// </summary>
    private sealed record MenuClickStatRow(
        string MenuId,
        string? MenuName,
        string Creator,
        int TotalClicks,
        int ActiveUsers,
        string? LastClick,
        string? CreateTime,
        string CreateTimeKind);
}
