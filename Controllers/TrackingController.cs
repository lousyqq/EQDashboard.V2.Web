using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Data.SqlClient;
using System.Security.Claims;
using EQDashboard.V2.Web.Services.Interfaces;

namespace EQDashboard.V2.Web.Controllers;

[Route("api/[controller]")]
[ApiController]
[Authorize]
public class TrackingController : ControllerBase
{
    private readonly string _connStr;
    private readonly ILogger<TrackingController> _logger;
    private readonly IMenuAuthService _menuAuthService;

    public TrackingController(IConfiguration config, ILogger<TrackingController> logger, IMenuAuthService menuAuthService)
    {
        _connStr = config.GetConnectionString("EQDashboard")
            ?? throw new InvalidOperationException("Missing connection string 'EQDashboard'");
        _logger = logger;
        _menuAuthService = menuAuthService;
    }

    [HttpPost("MenuClick")]
    public async Task<IActionResult> MenuClick([FromQuery] string menuId)
    {
        if (string.IsNullOrWhiteSpace(menuId))
            return BadRequest();

        var empId = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrEmpty(empId))
            return Unauthorized();

        // 🛡️ L7：menuId 必須落在此人真正看得到的集合內。
        //   舊版只檢查「非空 + 已登入」→ 任何登入者都能 `POST ?menuId=任意值` 把「看板點擊率」灌到任意數字，
        //   甚至寫入根本不存在的 MenuId（DailyMenuClicks 沒有 FK 到 Menus）。統計是拿來做營運決策的，
        //   可被任意偽造等於整份報表失去意義（對照 K1：一個死頁預設首頁就讓 ZE 累積了 397 次假點擊）。
        //   admin 回 null 代表不限制（與 PersonalSettingsController 同一套判定）。
        //   ⚠️ 不可見時**靜默略過並回 200**，不要回 403 —— 點擊追蹤是背景行為，看板剛被移除權限這類
        //   正常競態不該在使用者的 console 冒紅字；比照 PersonalSettingsController 的 skip 策略。
        var visibleSet = await _menuAuthService.GetVisibleMenuIdsAsync(empId, User.IsInRole("admin"));
        if (visibleSet != null && !visibleSet.Contains(menuId))
        {
            _logger.LogInformation("略過不可見看板的點擊記錄 (EmpId: {EmpId}, MenuId: {MenuId})", empId, menuId);
            return Ok();
        }

        try
        {
            using var conn = new SqlConnection(_connStr);
            await conn.OpenAsync();
            using var cmd = new SqlCommand(@"
                UPDATE DailyMenuClicks
                SET ClickCount = ClickCount + 1,
                    LastClickTime = GETDATE()
                WHERE ClickDate = CONVERT(date, GETDATE()) AND MenuId = @MenuId AND EmpId = @EmpId;

                IF @@ROWCOUNT = 0
                BEGIN
                    INSERT INTO DailyMenuClicks (ClickDate, MenuId, EmpId, ClickCount, FirstClickTime, LastClickTime)
                    VALUES (CONVERT(date, GETDATE()), @MenuId, @EmpId, 1, GETDATE(), GETDATE());
                END", conn);
            cmd.Parameters.AddWithValue("@MenuId", menuId);
            cmd.Parameters.AddWithValue("@EmpId", empId);
            await cmd.ExecuteNonQueryAsync();

            return Ok();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to record menu click (EmpId: {EmpId}, MenuId: {MenuId})", empId, menuId);
            return StatusCode(500);
        }
    }
}
