using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using EQDashboard.V2.Web.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace EQDashboard.V2.Web.Controllers;

[Route("api/[controller]")]
[ApiController]
public class AuthController : ControllerBase
{
    private readonly IAuthService _authService;
    private readonly IConfiguration _config;
    private readonly ILogger<AuthController> _logger;
    private readonly EQDashboard.V2.Web.Data.AppDbContext _context;

    public AuthController(IAuthService authService, IConfiguration config, ILogger<AuthController> logger, EQDashboard.V2.Web.Data.AppDbContext context)
    {
        _authService = authService;
        _config = config;
        _logger = logger;
        _context = context;
    }

    /// <summary>
    /// 嘗試讀取桌機目前 Windows 登入者的工號。
    /// 允許匿名：若瀏覽器有送 Windows 認證票證 (Negotiate/NTLM)，會回工號；否則 empId 為 null，前端就會落到手動登入。
    /// </summary>
    [HttpGet("WhoAmI")]
    [AllowAnonymous]
    public async Task<IActionResult> WhoAmI()
    {
        var identity = HttpContext.User?.Identity;
        var rawName = identity?.IsAuthenticated == true ? identity.Name : null;
        var empId = _authService.ExtractEmpIdFromWindowsIdentity(rawName);

        if (string.IsNullOrWhiteSpace(empId))
        {
            return Ok(new
            {
                success = true,
                authenticated = false,
                empId = (string?)null,
                source = (string?)null,
                message = "尚未偵測到 Windows 登入身份"
            });
        }

        // 檢查工號是否存在於 Accounts 表；不存在 → 拒絕，提示聯絡管理員（依使用者選擇的政策）
        var account = await _authService.FindAccountAsync(empId);
        if (account == null)
        {
            _logger.LogWarning("WhoAmI: Windows 帳號 {EmpId} 不存在於 Accounts 表", empId);
            return Ok(new
            {
                success = false,
                authenticated = true,
                empId,
                source = "windows",
                message = $"偵測到 Windows 帳號 [{empId}]，但系統內尚未建立此帳號，請聯絡管理員。"
            });
        }

        return Ok(new
        {
            success = true,
            authenticated = true,
            empId = account.EmpId,
            source = "windows",
            roleLevel = account.RoleLevel
        });
    }

    [HttpGet("MyProfile")]
    [Authorize]
    public async Task<IActionResult> MyProfile()
    {
        var empId = User.Identity?.Name;
        if (string.IsNullOrEmpty(empId)) return Unauthorized();

        var a = await _context.Accounts
            .Include(x => x.MapAccountRoles)
            .Include(x => x.MapAccountManageMenus)
            .Include(x => x.MapAccountDefaultPages)
            .Include(x => x.MapAccountExtraMenus)
            .Include(x => x.MapAccountDenyMenus)
            .FirstOrDefaultAsync(x => x.EmpId == empId);

        if (a == null) return NotFound();

        return Ok(new
        {
            empId = a.EmpId,
            assignedRoles = a.MapAccountRoles?.Select(m => m.RoleId).ToList() ?? new List<string>(),
            manageableMenus = a.MapAccountManageMenus?.Select(m => m.MenuId).ToList() ?? new List<string>(),
            extraMenus = a.MapAccountExtraMenus?.Select(m => m.MenuId).ToList() ?? new List<string>(),
            denyMenus = a.MapAccountDenyMenus?.Select(m => m.MenuId).ToList() ?? new List<string>(),
            defaultPages = a.MapAccountDefaultPages?.ToDictionary(m => m.FabId, m => m.MenuId) ?? new Dictionary<string, string>()
        });
    }

    /// <summary>
    /// 手動登入：以工號 + 密碼向 AD LDAP 進行 bind 驗證，成功後寫入 Cookie。
    /// </summary>
    [HttpPost("Login")]
    [AllowAnonymous]
    public async Task<IActionResult> Login([FromBody] LoginRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.EmpId))
            return BadRequest(new { success = false, message = "工號不得為空" });

        var empId = req.EmpId.Trim();
        var password = req.Password ?? "";

        // 驗證優先序：
        //   1. TestAccounts 白名單（外部開發/測試帳號，appsettings 控制；密碼會比對）
        //   2. EnableEmergencyAdmin (admin 不檢密碼，純救援通道)
        //   3. AD LDAP bind
        var (testMatched, testFallback) = _authService.VerifyTestAccount(empId, password);

        var enableEmergency = _config.GetValue<bool>("Auth:EnableEmergencyAdmin");
        var isEmergencyAdmin = !testMatched
            && enableEmergency
            && string.Equals(empId, "admin", StringComparison.OrdinalIgnoreCase);

        string loginSource;
        if (testMatched)
        {
            loginSource = "test";
        }
        else if (isEmergencyAdmin)
        {
            loginSource = "emergency";
        }
        else
        {
            // 走 LDAP 驗證
            var (ok, errMsg) = await _authService.VerifyLdapPasswordAsync(empId, password);
            if (!ok)
                return Unauthorized(new { success = false, message = errMsg ?? "驗證失敗" });
            loginSource = "manual";
        }

        // 取得帳號資訊：優先 DB Accounts，沒有就用 TestAccount/Emergency 的 fallback skeleton
        var account = await _authService.FindAccountAsync(empId);
        if (account == null)
        {
            if (testMatched && testFallback != null)
            {
                account = testFallback;
            }
            else if (isEmergencyAdmin)
            {
                account = new Models.Account
                {
                    EmpId = "admin",
                    Name = "系統管理員(臨時)",
                    Department = "系統救援",
                    RoleLevel = "admin",
                    CanEditOthers = true
                };
            }
            else
            {
                return Unauthorized(new
                {
                    success = false,
                    message = $"工號 [{empId}] 尚未建立帳號，請聯絡管理員。"
                });
            }
        }

        // 寫入 Cookie
        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, account.EmpId),
            new(ClaimTypes.Name, account.Name ?? account.EmpId),
            new(ClaimTypes.Role, (account.RoleLevel ?? "user").ToLower()),
            new("LoginSource", loginSource)
        };

        var claimsIdentity = new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme);

        await HttpContext.SignInAsync(
            CookieAuthenticationDefaults.AuthenticationScheme,
            new ClaimsPrincipal(claimsIdentity),
            new AuthenticationProperties
            {
                IsPersistent = true,
                ExpiresUtc = DateTimeOffset.UtcNow.AddHours(12)
            });

        return Ok(new
        {
            success = true,
            empId = account.EmpId,
            roleLevel = account.RoleLevel,
            source = loginSource,
            // 完整 account 物件作為 fallback：當 TestAccounts 用的 admin/user 沒有寫入 DB Accounts 表時，
            // 前端可以直接用這個物件，不必再回頭查 getAccounts()。
            account = new
            {
                empId = account.EmpId,
                name = account.Name ?? account.EmpId,
                department = account.Department ?? "",
                roleLevel = account.RoleLevel ?? "user",
                canEditOthers = account.CanEditOthers,
                assignedRoles = Array.Empty<string>(),
                manageableMenus = Array.Empty<string>(),
                defaultPages = new Dictionary<string, string>()
            }
        });
    }

    [HttpPost("Logout")]
    [AllowAnonymous]
    public async Task<IActionResult> Logout()
    {
        await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        return Ok(new { success = true });
    }
}

public class LoginRequest
{
    public string EmpId { get; set; } = string.Empty;
    public string? Password { get; set; }
}
