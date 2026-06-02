using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using EQDashboard.V2.Web.Data;
using EQDashboard.V2.Web.Models;
using EQDashboard.V2.Web.Services.Interfaces;
using System.Security.Claims;

namespace EQDashboard.V2.Web.Controllers;

[Route("api/[controller]")]
[ApiController]
[Authorize]
public class PersonalSettingsController : ControllerBase
{
    private readonly AppDbContext _context;
    private readonly ISettingsService _settingsService;
    private readonly IMenuAuthService _menuAuthService;

    public PersonalSettingsController(AppDbContext context, ISettingsService settingsService, IMenuAuthService menuAuthService)
    {
        _context = context;
        _settingsService = settingsService;
        _menuAuthService = menuAuthService;
    }

    /// <summary>
    /// 儲存當前登入使用者的個人選單設定
    /// </summary>
    [HttpPost]
    public async Task<IActionResult> SavePersonalSettings([FromBody] List<PersonalSettingDto> settings)
    {
        var currentUserId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (string.IsNullOrEmpty(currentUserId))
        {
            return Unauthorized();
        }

        // 🛡️ MenuId 必須屬於 user 可見集合，否則：
        //   1. user 可塞「不存在的 MenuId」或「無權看的 MenuId」累積 DB 垃圾
        //   2. 雖然 sidebar 過濾後不會真的顯示，但會在 PersonalSettings 表留下不可信的 row
        //   admin 沒限制 (GetVisibleMenuIdsAsync(_, true) 回 null 跳過過濾)
        var isAdmin = User.IsInRole("admin");
        var visibleSet = await _menuAuthService.GetVisibleMenuIdsAsync(currentUserId, isAdmin);

        // 1. 為了確保資料乾淨，先刪除該使用者的舊有設定
        var existingSettings = await _context.PersonalSettings
            .Where(p => p.EmpId == currentUserId)
            .ToListAsync();

        if (existingSettings.Any())
        {
            _context.PersonalSettings.RemoveRange(existingSettings);
        }

        // 2. 寫入新設定 (強制 EmpId 為當前使用者，防禦 IDOR 越權竄改)
        foreach (var dto in settings)
        {
            if (string.IsNullOrEmpty(dto.MenuId)) continue;
            // 🛡️ 跳過不可見的 MenuId — admin (visibleSet==null) 全放行
            if (visibleSet != null && !visibleSet.Contains(dto.MenuId)) continue;

            _context.PersonalSettings.Add(new PersonalSetting
            {
                EmpId = currentUserId, // 🛡️ 強制綁定，不信任前端傳來的 EmpId
                MenuId = dto.MenuId,
                IsHidden = dto.IsHidden,
                OpenTarget = dto.OpenTarget,
                Icon = dto.Icon,
                SortOrder = dto.SortOrder
            });
        }

        await _context.SaveChangesAsync();
        // ⚠️ 必須 invalidate /Settings/GetInitialData 的快取：PersonalSettings 是該回應的一部分，
        //     若不 invalidate，個人模式拖曳排序後緊接的 fetchInitialDataFromDB 會拿到舊快照，
        //     反而把使用者剛改的順序覆蓋掉，上方導覽列就不會更新。
        _settingsService.InvalidateInitialDataCache();
        return Ok(new { success = true, message = "個人設定已儲存" });
    }
}

public class PersonalSettingDto
{
    [StringLength(50)]
    public string? MenuId { get; set; }
    public bool? IsHidden { get; set; }
    
    [StringLength(20)]
    public string? OpenTarget { get; set; }
    
    [StringLength(50)]
    public string? Icon { get; set; }
    
    public int? SortOrder { get; set; }
}
