using System.Security.Claims;
using System.Text.Json;
using EQDashboard.V2.Web.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace EQDashboard.V2.Web.Controllers;

/// <summary>
/// 設定 Controller - 薄化版，業務邏輯已抽到 SettingsService
///
/// ⚠️ class-level [Authorize] 是最寬鬆的 baseline (只要登入就好)。
///    需要 admin 的 action 自己加 [Authorize(Roles="admin")]。
///    千萬不要把 class-level 設成 [Authorize(Roles="admin")] 再去 action level 想用 [Authorize] override —
///    ASP.NET Core 的 [Authorize] 是**累加要求**而非 override，會讓所有非 admin user 無法載入 appState、
///    整個 app 對非 admin 完全壞掉 (歷史教訓)。
/// </summary>
[Authorize]
public class SettingsController : Controller
{
    private readonly ISettingsService _settingsService;

    public SettingsController(ISettingsService settingsService)
    {
        _settingsService = settingsService;
    }

    [HttpGet]
    // 不再加 action-level [Authorize] — 繼承 class-level [Authorize] 即可。
    // 所有登入者都要拿這份資料才能組 appState。
    public async Task<JsonResult> GetInitialData()
    {
        try
        {
            var data = await _settingsService.GetInitialDataAsync();
            return Json(data);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"GetInitialData 錯誤: {ex}");
            return Json(new { error = true, message = "讀取初始資料時發生錯誤，請聯繫系統管理員。" });
        }
    }

    [HttpPost]
    [Authorize(Roles = "admin")] // legacy 全量覆寫，極危險 → 鎖死 admin
    public async Task<JsonResult> SaveData()
    {
        try
        {
            using var reader = new StreamReader(Request.Body);
            string json = await reader.ReadToEndAsync();
            var payload = JsonSerializer.Deserialize<Dictionary<string, List<Dictionary<string, JsonElement>>>>(json);

            if (payload == null)
                return Json(new { success = false, message = "無效的 JSON 資料" });

            var (success, message) = await _settingsService.SaveDataAsync(payload);
            return Json(new { success, message });
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"SaveData 錯誤: {ex}");
            return Json(new { success = false, message = "伺服器寫入發生錯誤，請聯繫系統管理員。" });
        }
    }

    [HttpPost]
    // 繼承 class-level [Authorize] (登入即可)；EmpId 從 cookie claim 取、不信 body。
    // 千萬不要回到 [AllowAnonymous] — 那會讓任何人匿名灌任意工號的 LoginCount。
    public async Task<JsonResult> UpdateLoginStats()
    {
        try
        {
            // EmpId 從 Cookie 的 NameIdentifier claim 取，不信前端 body — 否則登入後仍可冒名灌別人的計數
            var empId = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "";
            if (string.IsNullOrWhiteSpace(empId))
                return Json(new { success = false, message = "未登入" });

            // Drain body 即可 (不再使用其內容)
            using var reader = new StreamReader(Request.Body);
            _ = await reader.ReadToEndAsync();

            var (success, loginCount, lastLoginTime, errorMessage) =
                await _settingsService.UpdateLoginStatsAsync(empId);

            if (success)
                return Json(new { success, loginCount, lastLoginTime });
            else
                return Json(new { success, message = errorMessage });
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"UpdateLoginStats 錯誤: {ex}");
            return Json(new { success = false, message = "更新登入紀錄失敗，請聯繫系統管理員。" });
        }
    }
}
