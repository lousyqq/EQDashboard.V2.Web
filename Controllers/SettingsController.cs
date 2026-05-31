using System.Text.Json;
using EQDashboard.V2.Web.Services.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace EQDashboard.V2.Web.Controllers;

/// <summary>
/// 設定 Controller - 薄化版，業務邏輯已抽到 SettingsService
/// </summary>
[Authorize(Roles = "admin")]
public class SettingsController : Controller
{
    private readonly ISettingsService _settingsService;

    public SettingsController(ISettingsService settingsService)
    {
        _settingsService = settingsService;
    }

    [HttpGet]
    [AllowAnonymous] // 前端登入流程需要讀取帳號資料進行比對
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

    public class LoginStatsRequest
    {
        public string? EmpId { get; set; }
    }

    [HttpPost]
    [AllowAnonymous]
    public async Task<JsonResult> UpdateLoginStats()
    {
        try
        {
            using var reader = new StreamReader(Request.Body);
            string json = await reader.ReadToEndAsync();
            string empId = "";

            if (!string.IsNullOrWhiteSpace(json))
            {
                var req = JsonSerializer.Deserialize<LoginStatsRequest>(json,
                    new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                empId = req?.EmpId ?? "";
            }

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
