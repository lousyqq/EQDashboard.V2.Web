using System.Security.Claims;
using EQDashboard.V2.Web.Data;
using EQDashboard.V2.Web.Models;
using EQDashboard.V2.Web.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace EQDashboard.V2.Web.Services;

public class ActivityLogger : IActivityLogger
{
    private readonly AppDbContext _context;
    private readonly ILogger<ActivityLogger> _logger;

    public ActivityLogger(AppDbContext context, ILogger<ActivityLogger> logger)
    {
        _context = context;
        _logger = logger;
    }

    public async Task LogAsync(UserActivityLog log)
    {
        try
        {
            // 保險截斷，避免 user-agent 超長等情況直接 throw
            log.UserAgent = Truncate(log.UserAgent, 500);
            log.Path = Truncate(log.Path, 500);
            log.QueryString = Truncate(log.QueryString, 500);
            log.ErrorMessage = Truncate(log.ErrorMessage, 500);
            log.IpAddress = Truncate(log.IpAddress, 45);

            if (log.Timestamp == default) log.Timestamp = DateTime.UtcNow;

            _context.UserActivityLogs.Add(log);
            await _context.SaveChangesAsync();
        }
        catch (Exception ex)
        {
            // 不能讓 log 寫入失敗反過來打掛使用者的請求
            _logger.LogWarning(ex, "ActivityLog 寫入失敗: {Action}", log.Action);
        }
    }

    public Task LogLoginAsync(HttpContext ctx, string empId, string? empName, string loginSource, bool success, string? errorMessage = null, string? detail = null)
    {
        return LogAsync(new UserActivityLog
        {
            EmpId = empId,
            EmpName = empName,
            LoginSource = loginSource,
            IpAddress = GetClientIp(ctx),
            UserAgent = ctx.Request.Headers.UserAgent.ToString(),
            HttpMethod = ctx.Request.Method,
            Path = ctx.Request.Path.Value,
            QueryString = ctx.Request.QueryString.Value,
            Category = "Login",
            Action = success ? $"LoginSuccess ({loginSource})" : $"LoginFail ({loginSource})",
            IsSuccess = success,
            ErrorMessage = errorMessage,
            Detail = detail
        });
    }

    public Task LogLogoutAsync(HttpContext ctx, string? empId, string? empName)
    {
        return LogAsync(new UserActivityLog
        {
            EmpId = empId,
            EmpName = empName,
            IpAddress = GetClientIp(ctx),
            UserAgent = ctx.Request.Headers.UserAgent.ToString(),
            HttpMethod = ctx.Request.Method,
            Path = ctx.Request.Path.Value,
            Category = "Logout",
            Action = "Logout",
            IsSuccess = true
        });
    }

    public Task LogAuthDeniedAsync(HttpContext ctx, string action, string? targetType = null, string? targetId = null, string? reason = null)
    {
        return LogAsync(new UserActivityLog
        {
            EmpId = ctx.User.FindFirstValue(ClaimTypes.NameIdentifier),
            EmpName = ctx.User.FindFirstValue(ClaimTypes.Name),
            LoginSource = ctx.User.FindFirst("LoginSource")?.Value,
            IpAddress = GetClientIp(ctx),
            UserAgent = ctx.Request.Headers.UserAgent.ToString(),
            HttpMethod = ctx.Request.Method,
            Path = ctx.Request.Path.Value,
            QueryString = ctx.Request.QueryString.Value,
            Category = "Auth",
            Action = action,
            TargetType = targetType,
            TargetId = targetId,
            IsSuccess = false,
            ErrorMessage = reason ?? "權限不足"
        });
    }

    public Task LogAuditAsync(HttpContext ctx, string category, string action, string? targetType = null, string? targetId = null, string? detail = null, bool success = true, string? errorMessage = null)
    {
        return LogAsync(new UserActivityLog
        {
            EmpId = ctx.User.FindFirstValue(ClaimTypes.NameIdentifier),
            EmpName = ctx.User.FindFirstValue(ClaimTypes.Name),
            LoginSource = ctx.User.FindFirst("LoginSource")?.Value,
            IpAddress = GetClientIp(ctx),
            UserAgent = ctx.Request.Headers.UserAgent.ToString(),
            HttpMethod = ctx.Request.Method,
            Path = ctx.Request.Path.Value,
            QueryString = ctx.Request.QueryString.Value,
            Category = category,
            Action = action,
            TargetType = targetType,
            TargetId = targetId,
            Detail = detail,
            IsSuccess = success,
            ErrorMessage = errorMessage
        });
    }

    public async Task<(List<UserActivityLog> rows, int total)> QueryAsync(
        string? empId = null,
        string? category = null,
        DateTime? fromUtc = null,
        DateTime? toUtc = null,
        bool? successOnly = null,
        string? keyword = null,
        int page = 1,
        int pageSize = 50)
    {
        var q = _context.UserActivityLogs.AsNoTracking().AsQueryable();

        if (!string.IsNullOrWhiteSpace(empId))
            q = q.Where(l => l.EmpId == empId);
        if (!string.IsNullOrWhiteSpace(category))
            q = q.Where(l => l.Category == category);
        if (fromUtc.HasValue)
            q = q.Where(l => l.Timestamp >= fromUtc.Value);
        if (toUtc.HasValue)
            q = q.Where(l => l.Timestamp <= toUtc.Value);
        if (successOnly.HasValue)
            q = q.Where(l => l.IsSuccess == successOnly.Value);
        if (!string.IsNullOrWhiteSpace(keyword))
        {
            var kw = keyword.Trim();
            q = q.Where(l =>
                (l.Path != null && l.Path.Contains(kw)) ||
                (l.Action != null && l.Action.Contains(kw)) ||
                (l.TargetId != null && l.TargetId.Contains(kw)) ||
                (l.EmpId != null && l.EmpId.Contains(kw)) ||
                (l.EmpName != null && l.EmpName.Contains(kw)));
        }

        var total = await q.CountAsync();

        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 10, 500);

        var rows = await q.OrderByDescending(l => l.Timestamp)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync();

        return (rows, total);
    }

    public async Task<int> PurgeOlderThanAsync(int days)
    {
        if (days < 1) days = 1;
        var cutoff = DateTime.UtcNow.AddDays(-days);
        return await _context.UserActivityLogs.Where(l => l.Timestamp < cutoff).ExecuteDeleteAsync();
    }

    /// <summary>
    /// 取真實 client IP。in-proc IIS 下 RemoteIpAddress 通常就是真實 IP；
    /// 若前面有反向代理 (ARR/Nginx)，會帶 X-Forwarded-For，這裡優先用第一個非空值。
    /// </summary>
    private static string? GetClientIp(HttpContext ctx)
    {
        var xff = ctx.Request.Headers["X-Forwarded-For"].ToString();
        if (!string.IsNullOrWhiteSpace(xff))
        {
            var first = xff.Split(',')[0].Trim();
            if (!string.IsNullOrEmpty(first)) return first;
        }
        return ctx.Connection.RemoteIpAddress?.ToString();
    }

    private static string? Truncate(string? s, int max)
    {
        if (s == null) return null;
        return s.Length <= max ? s : s.Substring(0, max);
    }
}
