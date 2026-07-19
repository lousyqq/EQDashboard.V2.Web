using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using EQDashboard.V2.Web.Data;
using System.Data;

namespace EQDashboard.V2.Web.Controllers;

[Route("api/[controller]")]
[ApiController]
[Authorize(Roles = "admin")]
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
}
