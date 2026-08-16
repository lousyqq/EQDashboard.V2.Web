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
                cmd.CommandText = @"
                    SELECT LEFT(CONVERT(varchar, VisitDate, 120), 7) AS YearMonth,
                           COUNT(DISTINCT EmpId) AS Mau,
                           SUM(VisitCount) AS Visits
                    FROM DailyUserVisits WITH (NOLOCK)
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
            var deptRaw = await _context.DailyUserVisits.AsNoTracking()
                .Where(x => x.VisitDate >= cutoffDate)
                .GroupBy(x => x.Department ?? "未指定/其他")
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
            return StatusCode(500, new { error = "載入統計失敗，請稍後重試" });
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

            if (!string.IsNullOrWhiteSpace(date) && DateTime.TryParse(date, out var parsedDate))
            {
                query = query.Where(x => x.VisitDate == parsedDate.Date);
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
                    department = x.Department ?? "未指定",
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
            return StatusCode(500, new { error = "查詢失敗，請稍後重試" });
        }
    }

    /// <summary>
    /// 看板使用排行 (Menu Usage Rank)
    /// </summary>
    [HttpGet("MenuClickStats")]
    [Authorize(Roles = "admin")]
    public async Task<IActionResult> GetMenuClickStats([FromQuery] int days = 30)
    {
        if (days < 7 || days > 180) days = 30;
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
                .OrderByDescending(x => x.TotalClicks)
                .ToListAsync();

            var menus = await _context.Menus.AsNoTracking().ToDictionaryAsync(m => m.MenuId, m => m.DisplayName);

            var items = query.Select(x => new
            {
                menuId = x.MenuId,
                menuName = menus.TryGetValue(x.MenuId, out var name) ? name : "已刪除看板",
                totalClicks = x.TotalClicks,
                activeUsers = x.ActiveUsers,
                lastClick = x.LastClick.ToString("yyyy-MM-dd HH:mm:ss")
            }).ToList();

            return Ok(new { items });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "查詢看板使用排行失敗");
            return StatusCode(500, new { error = "查詢失敗，請稍後重試" });
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

            // 取得近 N 天有被點擊過的 MenuId
            var activeMenuIds = await _context.DailyMenuClicks.AsNoTracking()
                .Where(x => x.ClickDate >= cutoffDate)
                .Select(x => x.MenuId)
                .Distinct()
                .ToListAsync();

            // 取得有效的看板 (不包含 AppGrid, Folder, Pool 項目與停用看板)
            // ⚠️ 殭屍防誤判機制：只挑出 CreatedAt 早於 cutoffDate 的看板 (或者舊資料沒有 CreatedAt 的看板)
            var candidates = await _context.Menus.AsNoTracking()
                .Where(m => m.IsEnabled == true &&
                            m.IsPoolItem != true &&
                            m.MenuMode != "folder" &&
                            m.MenuMode != "app_grid")
                .Where(m => m.CreatedAt == null || m.CreatedAt < cutoffDate)
                .Where(m => !activeMenuIds.Contains(m.MenuId))
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
            var firstSeen = unknownIds.Count == 0
                ? new Dictionary<string, DateTime>()
                : await _context.DailyMenuClicks.AsNoTracking()
                    .Where(x => unknownIds.Contains(x.MenuId))
                    .GroupBy(x => x.MenuId)
                    .Select(g => new { MenuId = g.Key, First = g.Min(x => x.ClickDate) })
                    .ToDictionaryAsync(x => x.MenuId, x => x.First);

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
                    createTimeKind = "inferred";   // 前端要標「≤ 此日期即已存在」
                }
                else
                {
                    createTime = null;
                    createTimeKind = "unknown";    // 既無 CreatedAt、也從未被點過 → 真的無從得知
                }
                return new
                {
                    menuId = c.MenuId,
                    menuName = c.DisplayName,
                    creator = c.CreatedBy,
                    createTime,
                    createTimeKind,
                    url = c.Url
                };
            }).ToList();

            return Ok(new { items = zombieMenus, thresholdDays = days });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "查詢殭屍看板清單失敗");
            return StatusCode(500, new { error = "查詢失敗，請稍後重試" });
        }
    }

}
