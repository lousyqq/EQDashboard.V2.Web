using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using EQDashboard.V2.Web.Services.Interfaces;

namespace EQDashboard.V2.Web.Controllers;

/// <summary>
/// 操作紀錄查詢 — admin only。
/// </summary>
[Route("api/[controller]")]
[ApiController]
[Authorize(Roles = "admin")]
public class ActivityLogsController : ControllerBase
{
    private readonly IActivityLogger _activityLogger;

    public ActivityLogsController(IActivityLogger activityLogger)
    {
        _activityLogger = activityLogger;
    }

    /// <summary>
    /// 查詢操作紀錄。
    /// 範例：GET /api/ActivityLogs?empId=00058897&amp;category=Login&amp;page=1&amp;pageSize=50
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> Query(
        [FromQuery] string? empId = null,
        [FromQuery] string? category = null,
        [FromQuery] string? from = null,         // yyyy-MM-dd or yyyy-MM-ddTHH:mm:ss (local time)
        [FromQuery] string? to = null,
        [FromQuery] bool? successOnly = null,
        [FromQuery] string? keyword = null,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 50)
    {
        DateTime? fromUtc = ParseLocalToUtc(from);
        DateTime? toUtc = ParseLocalToUtc(to);

        var (rows, total) = await _activityLogger.QueryAsync(empId, category, fromUtc, toUtc, successOnly, keyword, page, pageSize);

        return Ok(new
        {
            total,
            page,
            pageSize,
            rows = rows.Select(r => new
            {
                logId = r.LogId,
                timestampUtc = r.Timestamp,
                empId = r.EmpId,
                empName = r.EmpName,
                loginSource = r.LoginSource,
                ipAddress = r.IpAddress,
                userAgent = r.UserAgent,
                httpMethod = r.HttpMethod,
                path = r.Path,
                queryString = r.QueryString,
                statusCode = r.StatusCode,
                durationMs = r.DurationMs,
                category = r.Category,
                action = r.Action,
                targetType = r.TargetType,
                targetId = r.TargetId,
                detail = r.Detail,
                isSuccess = r.IsSuccess,
                errorMessage = r.ErrorMessage
            })
        });
    }

    /// <summary>
    /// 清掉指定天數以前的紀錄 (預設保留 90 天，避免資料庫越長越大)。
    /// </summary>
    [HttpDelete("Purge")]
    public async Task<IActionResult> Purge([FromQuery] int days = 90)
    {
        var deleted = await _activityLogger.PurgeOlderThanAsync(days);

        // ⭐️ 2026-08-24 第八輪（第七輪 J11 / 同 G13）：Purge 是破壞性且不可還原的操作，卻是全站唯一
        //    **沒有留下任何軌跡**的一支 —— 諷刺的是它清的正是操作紀錄本身，出事後連「誰在什麼時候清掉多少筆」
        //    都查不到。這裡補上稽核；⚠️ **必須在 PurgeOlderThanAsync 之後才寫**，否則這筆稽核紀錄
        //    會落在自己要清除的時間範圍外／內都說不準，先寫先被自己清掉。
        //    （`PurgeOlderThanAsync` 本身已有 `days < 1 → 1` 的下限保護，不會被 days=0 清空整張表。）
        //    參數順序 = (ctx, category, action, targetType, targetId, detail)
        await _activityLogger.LogAuditAsync(HttpContext, "ActivityLogs", "Purge", "ActivityLog", days.ToString(),
            System.Text.Json.JsonSerializer.Serialize(new { days, deleted }));

        return Ok(new { success = true, deleted, days });
    }

    private static DateTime? ParseLocalToUtc(string? s)
    {
        if (string.IsNullOrWhiteSpace(s)) return null;
        if (!DateTime.TryParse(s, out var local)) return null;
        // 視為本地時間 → 轉 UTC
        return DateTime.SpecifyKind(local, DateTimeKind.Local).ToUniversalTime();
    }
}
