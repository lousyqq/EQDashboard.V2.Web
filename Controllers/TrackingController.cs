using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Data.SqlClient;
using System.Security.Claims;

namespace EQDashboard.V2.Web.Controllers;

[Route("api/[controller]")]
[ApiController]
[Authorize]
public class TrackingController : ControllerBase
{
    private readonly string _connStr;
    private readonly ILogger<TrackingController> _logger;

    public TrackingController(IConfiguration config, ILogger<TrackingController> logger)
    {
        _connStr = config.GetConnectionString("EQDashboard")
            ?? throw new InvalidOperationException("Missing connection string 'EQDashboard'");
        _logger = logger;
    }

    [HttpPost("MenuClick")]
    public async Task<IActionResult> MenuClick([FromQuery] string menuId)
    {
        if (string.IsNullOrWhiteSpace(menuId))
            return BadRequest();

        var empId = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrEmpty(empId))
            return Unauthorized();

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
