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

    public RequestsController(AppDbContext context, ISettingsService settingsService)
    {
        _context = context;
        _settingsService = settingsService;
    }

    [HttpGet]
    public async Task<IActionResult> Get()
    {
        var currentUserId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        var isAdmin = User.IsInRole("admin");

        // 🛡️ 權限隔離：Admin 可以看全部，一般 User 只能看自己的
        var query = _context.Requests.AsQueryable();
        if (!isAdmin)
        {
            query = query.Where(r => r.EmpId == currentUserId);
        }

        return Ok(await query.ToListAsync());
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] Request req)
    {
        var currentUserId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (string.IsNullOrEmpty(currentUserId)) return Unauthorized();

        // 🛡️ IDOR 防護：強制覆寫為當前登入者
        req.EmpId = currentUserId;
        req.EmpName = User.FindFirstValue(ClaimTypes.Name) ?? currentUserId;
        
        // 確保新申請預設狀態正確
        req.Status = "pending";
        req.Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        _context.Requests.Add(req);
        await _context.SaveChangesAsync();
        _settingsService.InvalidateInitialDataCache(); // 確保下次快取更新

        return Ok(new { success = true, message = "申請已送出" });
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

        req.Status = "withdrawn";
        req.WithdrawReason = dto.Reason;
        // Timestamp 保留原始時間或更新皆可，原邏輯未改 Timestamp

        await _context.SaveChangesAsync();
        _settingsService.InvalidateInitialDataCache();

        return Ok(new { success = true, message = "申請已撤回" });
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(string id)
    {
        var currentUserId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (string.IsNullOrEmpty(currentUserId)) return Unauthorized();

        var req = await _context.Requests.FindAsync(id);
        if (req == null) return Ok(new { success = true });

        // 🛡️ IDOR 防護：只能刪除自己的申請（原版邏輯是撤回後可以刪除）
        if (req.EmpId != currentUserId) return Forbid();

        _context.Requests.Remove(req);
        await _context.SaveChangesAsync();
        _settingsService.InvalidateInitialDataCache();

        return Ok(new { success = true, message = "紀錄已刪除" });
    }

    [HttpPut("{id}/Audit")]
    [Authorize(Roles = "admin")]
    public async Task<IActionResult> Audit(string id, [FromBody] AuditDto dto)
    {
        var req = await _context.Requests.FindAsync(id);
        if (req == null) return NotFound();

        // 🛡️ 只有 Admin 可以審核回覆
        req.Status = dto.Status;
        req.Reply = dto.Reply;

        await _context.SaveChangesAsync();
        _settingsService.InvalidateInitialDataCache();

        return Ok(new { success = true, message = "審核已儲存" });
    }
}

public class WithdrawDto
{
    public string? Reason { get; set; }
}

public class AuditDto
{
    public string? Status { get; set; }
    public string? Reply { get; set; }
}
