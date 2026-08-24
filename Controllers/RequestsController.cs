using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using EQDashboard.V2.Web.Data;
using EQDashboard.V2.Web.Models;
using System.Security.Claims;
using EQDashboard.V2.Web.Services.Interfaces;

namespace EQDashboard.V2.Web.Controllers;

[Route("api/[controller]")]
[ApiController]
[Authorize]
public class RequestsController : ControllerBase
{
    private readonly AppDbContext _context;
    private readonly ISettingsService _settingsService;
    private readonly IActivityLogger _activityLogger;

    public RequestsController(AppDbContext context, ISettingsService settingsService, IActivityLogger activityLogger)
    {
        _context = context;
        _settingsService = settingsService;
        _activityLogger = activityLogger;
    }

    // ⭐️ 2026-08-24 第八輪 K6：申請單的合法狀態流轉。
    //   後端過去只擋 IDOR（是不是自己的），**完全不看目前狀態** → 直打 API 就能把已完成的申請撤回、
    //   或用同一個 RequestId 重送把 resolved 打回 pending（而且不清 Reply/WithdrawReason，
    //   畫面會同時出現「待審核」徽章與舊的管理員回覆）。這裡把規則明寫出來，與前端
    //   `render/tables.js` 的 renderApplyTable 三方一致（CLAUDE.md §3「權限判定必須三方一致」的同款要求）：
    //     pending    → 可撤回（前端顯示「撤回」鈕）
    //     withdrawn  → 可刪除、可重新送出（前端顯示「刪除紀錄」鈕）
    //     rejected   → 可重新送出（讓被駁回的人補件再送）
    //     processing / resolved → 一律鎖定（前端顯示「審核中/已鎖定」徽章）
    private static readonly HashSet<string> WithdrawableStatuses = new(StringComparer.OrdinalIgnoreCase) { "pending" };
    private static readonly HashSet<string> DeletableStatuses = new(StringComparer.OrdinalIgnoreCase) { "withdrawn" };
    private static readonly HashSet<string> ResubmittableStatuses = new(StringComparer.OrdinalIgnoreCase) { "withdrawn", "rejected" };

    /// <summary>
    /// 申請清單。
    /// ⚠️ 2026-08-24 第八輪 K8：原本無條件 `ToListAsync()` 整張表回傳（admin 拿全部），與「Accounts 因量大
    ///    強制 serverSide 分頁」的既有決策不一致，資料一多就會拖慢。改為分頁回傳。
    ///    **契約變更是安全的**：全站沒有任何前端呼叫端（申請資料一律走 `GetInitialData`），
    ///    此端點目前只供外部工具/除錯使用。
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> Get([FromQuery] int page = 1, [FromQuery] int pageSize = 50)
    {
        if (page < 1) page = 1;
        if (pageSize < 1 || pageSize > 200) pageSize = 50;

        var currentUserId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        var isAdmin = User.IsInRole("admin");

        // 🛡️ 權限隔離：Admin 可以看全部，一般 User 只能看自己的
        var query = _context.Requests.AsNoTracking().AsQueryable();
        if (!isAdmin)
        {
            query = query.Where(r => r.EmpId == currentUserId);
        }

        var total = await query.CountAsync();
        var items = await query
            .OrderByDescending(r => r.Timestamp)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync();

        return Ok(new { items, total, page, pageSize });
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateRequestDto dto)
    {
        var currentUserId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (string.IsNullOrEmpty(currentUserId)) return Unauthorized();

        var existingReq = await _context.Requests.FindAsync(dto.RequestId);
        if (existingReq != null)
        {
            // 🛡️ IDOR 防護：只能重新送出自己的申請
            if (existingReq.EmpId != currentUserId) return Forbid();

            // ⭐️ K6：只有「已撤回 / 已駁回」的申請可以重新送出。
            //    舊版無條件 `Status = "pending"` → 已完成(resolved)的申請可被打回待審核，管理員的結案被無聲推翻。
            if (!ResubmittableStatuses.Contains(existingReq.Status ?? ""))
                return Conflict(new { success = false, errorCode = "err_req_not_resubmittable", status = existingReq.Status });

            existingReq.ReqType = dto.ReqType;
            existingReq.Fab = dto.Fab;
            existingReq.Reason = dto.Reason;
            existingReq.Status = "pending";
            // ⭐️ K6：重新送出＝開新一輪，上一輪的審核回覆與撤回原因必須清掉。
            //    舊版只改 Status → 畫面會同時出現「待審核」徽章與上一輪的管理員回覆／撤回原因，自相矛盾。
            existingReq.Reply = null;
            existingReq.WithdrawReason = null;
            existingReq.Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            _context.Requests.Update(existingReq);
        }
        else
        {
            var req = new Request
            {
                RequestId = string.IsNullOrWhiteSpace(dto.RequestId) ? ("req_" + Guid.NewGuid().ToString("N")) : dto.RequestId,
                ReqType = dto.ReqType,
                Fab = dto.Fab,
                Reason = dto.Reason,
                EmpId = currentUserId,
                EmpName = User.FindFirstValue(ClaimTypes.Name) ?? currentUserId,
                Status = "pending",
                Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
            };
            _context.Requests.Add(req);
        }

        await _context.SaveChangesAsync();
        // Requests 表只在 Volatile(10s) bucket → 用 volatile 失效即可，不必連帶清掉 Global(60s) 9 張權限表快取。
        // (兩變體都會 bump ETag，故 visibleMenus 與 HTTP-304 正確性不受影響。)
        _settingsService.InvalidateVolatileDataCache();

        // ⚠️ G10：不回中文字面值。後端回代碼、由前端 t() 呈現（同 M1/M2 對 Auth/Analytics 的處理）。
        return Ok(new { success = true, messageCode = "apply_submitted" });
    }

    [HttpPut("{id}/Withdraw")]
    public async Task<IActionResult> Withdraw(string id, [FromBody] WithdrawDto dto)
    {
        var currentUserId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (string.IsNullOrEmpty(currentUserId)) return Unauthorized();

        var req = await _context.Requests.FindAsync(id);
        if (req == null) return NotFound();

        // 🛡️ IDOR 防護：只能撤回自己的申請
        if (req.EmpId != currentUserId) return Forbid();

        // ⭐️ K6：只有待審核的申請可以撤回（前端也只在 pending 時顯示「撤回」鈕）。
        //    舊版不看狀態 → 直打 API 可以把 resolved / rejected 的申請改成 withdrawn。
        if (!WithdrawableStatuses.Contains(req.Status ?? ""))
            return Conflict(new { success = false, errorCode = "err_req_not_withdrawable", status = req.Status });

        var beforeStatus = req.Status;
        req.Status = "withdrawn";
        req.WithdrawReason = dto.Reason;
        // Timestamp 保留原始時間或更新皆可，原邏輯未改 Timestamp

        await _context.SaveChangesAsync();

        // ⭐️ G13：撤回是有爭議性的狀態變更（申請人可能事後主張「我沒撤回過」），必須留軌跡。
        //    原本只有 Delete 有稽核，撤回與審核反而沒有。
        await _activityLogger.LogAuditAsync(HttpContext, "Requests", "Withdraw", "Request", id,
            System.Text.Json.JsonSerializer.Serialize(new { from = beforeStatus, to = "withdrawn", reason = dto.Reason }));

        _settingsService.InvalidateVolatileDataCache(); // Requests 僅在 Volatile bucket，免清 Global 權限快取

        return Ok(new { success = true, messageCode = "apply_withdrawn" });
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(string id)
    {
        var currentUserId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (string.IsNullOrEmpty(currentUserId)) return Unauthorized();

        var req = await _context.Requests.FindAsync(id);
        if (req == null) return Ok(new { success = true });

        // 🛡️ IDOR 防護：只能刪除自己的申請
        if (req.EmpId != currentUserId) return Forbid();

        // ⭐️ K6：註解一直寫著「原版邏輯是撤回後可以刪除」，但程式**從來沒有這個檢查** ——
        //    任何狀態都刪得掉，包括管理員正在處理中的 pending / processing。現在真的擋起來，
        //    與前端「只有 withdrawn 才顯示『刪除紀錄』鈕」一致。
        if (!DeletableStatuses.Contains(req.Status ?? ""))
            return Conflict(new { success = false, errorCode = "err_req_not_deletable", status = req.Status });

        var backupJson = System.Text.Json.JsonSerializer.Serialize(req, new System.Text.Json.JsonSerializerOptions { ReferenceHandler = System.Text.Json.Serialization.ReferenceHandler.IgnoreCycles });

        _context.Requests.Remove(req);
        await _context.SaveChangesAsync();

        // ⚠️ 參數順序是 (ctx, category, action, targetType, targetId, detail) —— 舊版把 id 塞進 targetType、
        //    把說明文字塞進 targetId，導致操作紀錄查詢頁的「目標」欄位對不上（同檔其他兩處已按正確順序寫）。
        await _activityLogger.LogAuditAsync(HttpContext, "Requests", "Delete", "Request", id, backupJson);

        _settingsService.InvalidateVolatileDataCache(); // Requests 僅在 Volatile bucket，免清 Global 權限快取

        return Ok(new { success = true, messageCode = "request_deleted" });
    }

    [HttpPut("{id}/Audit")]
    [Authorize(Roles = "admin")]
    public async Task<IActionResult> Audit(string id, [FromBody] AuditDto dto)
    {
        var req = await _context.Requests.FindAsync(id);
        if (req == null) return NotFound();

        // 🛡️ 只有 Admin 可以審核回覆
        var beforeStatus = req.Status;
        var beforeReply = req.Reply;
        req.Status = dto.Status;
        req.Reply = dto.Reply;

        await _context.SaveChangesAsync();

        // ⭐️ G13：審核是最有爭議性的操作（誰把誰駁回、回覆內容被改成什麼），一定要留軌跡。
        await _activityLogger.LogAuditAsync(HttpContext, "Requests", "Audit", "Request", id,
            System.Text.Json.JsonSerializer.Serialize(new
            {
                from = beforeStatus,
                to = dto.Status,
                replyBefore = beforeReply,
                replyAfter = dto.Reply
            }));

        _settingsService.InvalidateVolatileDataCache(); // Requests 僅在 Volatile bucket，免清 Global 權限快取

        return Ok(new { success = true, messageCode = "audit_reply_saved" });
    }
}

public class CreateRequestDto
{
    [StringLength(50)]
    public string? RequestId { get; set; }

    [Required(ErrorMessage = "val_reqtype_required")]
    [StringLength(50)]
    public string? ReqType { get; set; }

    [Required(ErrorMessage = "val_fab_required")]
    [StringLength(50)]
    public string? Fab { get; set; }

    [Required(ErrorMessage = "val_reason_required")]
    [StringLength(1000)]
    public string? Reason { get; set; }
}

public class WithdrawDto
{
    [StringLength(1000)]
    public string? Reason { get; set; }
}

public class AuditDto
{
    // ⚠️ 必須對齊前端 tables.js 的 statusMap 與 admin/user 流程實際送的值，
    //    否則 admin 從 UI 按「已完成」(resolved) 等會被 400 擋掉、審核功能斷掉。
    [Required]
    [RegularExpression("^(pending|processing|resolved|rejected|withdrawn)$", ErrorMessage = "val_status_invalid")]
    [StringLength(20)]
    public string? Status { get; set; }

    [StringLength(1000)]
    public string? Reply { get; set; }
}
