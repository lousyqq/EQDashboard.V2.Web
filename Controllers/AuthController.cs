using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.Negotiate;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using EQDashboard.V2.Web.Models;
using EQDashboard.V2.Web.Models.Settings;
using EQDashboard.V2.Web.Services.Interfaces;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace EQDashboard.V2.Web.Controllers;

[Route("api/[controller]")]
[ApiController]
public class AuthController : ControllerBase
{
    private readonly IAuthService _authService;
    private readonly AuthSettings _authSettings;
    private readonly ILogger<AuthController> _logger;
    private readonly EQDashboard.V2.Web.Data.AppDbContext _context;
    private readonly IActivityLogger _activityLogger;

    public AuthController(
        IAuthService authService,
        IOptionsSnapshot<AuthSettings> authOptions,
        ILogger<AuthController> logger,
        EQDashboard.V2.Web.Data.AppDbContext context,
        IActivityLogger activityLogger)
    {
        _authService = authService;
        _authSettings = authOptions.Value;
        _logger = logger;
        _context = context;
        _activityLogger = activityLogger;
    }

    /// <summary>
    /// 給前端進入點：回前端「現在這個環境允許哪些登入方式」。允許匿名 — 因為登入頁本身要先知道才知道要不要藏掉手動 tab。
    /// </summary>
    [HttpGet("Config")]
    [AllowAnonymous]
    public IActionResult GetConfig()
    {
        Response.Headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
        return Ok(new
        {
            allowManualLogin = _authSettings.AllowManualLogin,
            openAccessMode = _authSettings.OpenAccessMode,
            simulatedAccount = _authSettings.SimulatedAccount
        });
    }

    /// <summary>
    /// 取得桌機目前 Windows 登入者的工號。支援 OpenAccessMode 自動加入與 SimulatedAccount 模擬帳號。
    /// </summary>
    [HttpGet("WhoAmI")]
    [Authorize(AuthenticationSchemes = NegotiateDefaults.AuthenticationScheme)]
    public async Task<IActionResult> WhoAmI()
    {
        Response.Headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
        string empId;
        string rawName;
        string loginSource = "windows";

        if (!string.IsNullOrWhiteSpace(_authSettings.SimulatedAccount))
        {
            empId = _authSettings.SimulatedAccount.Trim();
            rawName = empId;
            loginSource = "simulated";
            _logger.LogInformation("WhoAmI: 啟用模擬帳號 (SimulatedAccount) = {EmpId}", empId);
        }
        else
        {
            var stripPrefix = _authSettings.WindowsDomainStripPrefix ?? "UMC";
            rawName = User?.Identity?.Name ?? "";
            empId = rawName
                .Replace($"{stripPrefix}\\", "", StringComparison.OrdinalIgnoreCase)
                .Trim();
            var atIdx = empId.IndexOf('@');
            if (atIdx > 0) empId = empId[..atIdx];
        }

        if (string.IsNullOrWhiteSpace(empId))
        {
            await _activityLogger.LogLoginAsync(HttpContext, "(unknown)", null, loginSource, false,
                errorMessage: "未偵測到 Windows 登入身份", detail: $"{{\"rawName\":\"{rawName}\"}}");
            return Ok(new
            {
                success = false,
                authenticated = false,
                empId = (string?)null,
                rawName,
                message = "未偵測到 Windows 登入帳號"
            });
        }

        var isDefaultAdmin = _authSettings.DefaultAdmins?.Any(x => string.Equals(x, empId, StringComparison.OrdinalIgnoreCase)) == true;
        var account = await _authService.FindAccountAsync(empId);

        if (account == null)
        {
            var (lookupName, lookupDept) = await _authService.LookupPersonFromNotesAsync(empId);

            if (isDefaultAdmin)
            {
                account = new Account
                {
                    EmpId = empId,
                    Name = !string.IsNullOrWhiteSpace(lookupName) ? lookupName : empId,
                    Department = !string.IsNullOrWhiteSpace(lookupDept) ? lookupDept : "系統管理員",
                    RoleLevel = "admin",
                    CanEditOthers = true,
                    LoginCount = 0,
                    LastLoginTime = DateTime.UtcNow
                };
                _context.Accounts.Add(account);
                await _context.SaveChangesAsync();
                _logger.LogInformation("✅ WhoAmI 自動建立預設 Admin 帳號：{EmpId}", empId);
            }
            else if (_authSettings.OpenAccessMode)
            {
                account = new Account
                {
                    EmpId = empId,
                    Name = !string.IsNullOrWhiteSpace(lookupName) ? lookupName : empId,
                    Department = !string.IsNullOrWhiteSpace(lookupDept) ? lookupDept : "一般使用者",
                    RoleLevel = "user",
                    CanEditOthers = false,
                    LoginCount = 0,
                    LastLoginTime = DateTime.UtcNow
                };
                _context.Accounts.Add(account);

                // 賦予所有現有角色群組權限，使「可視廠區為所有廠區」；登入預設首頁不設定（為未設定，自動抓取第一個）
                var allRoleIds = await _context.Roles.AsNoTracking().Select(r => r.RoleId).ToListAsync();
                foreach (var rId in allRoleIds)
                {
                    _context.MapAccountRoles.Add(new MapAccountRole { EmpId = empId, RoleId = rId });
                }

                await _context.SaveChangesAsync();

                _logger.LogInformation("✅ WhoAmI (OpenAccessMode=true) 自動加入新帳號為 user，已配置所有廠區可視且首頁未設定：{EmpId}", empId);
            }
            else
            {
                _logger.LogWarning("WhoAmI: Windows 帳號 {EmpId} 不存在於 Accounts 表且 OpenAccessMode=false", empId);
                await _activityLogger.LogLoginAsync(HttpContext, empId, null, loginSource, false,
                    errorMessage: "工號不存在於 Accounts 表且未開啟 OpenAccessMode", detail: $"{{\"rawName\":\"{rawName}\"}}");
                return Ok(new
                {
                    success = false,
                    authenticated = true,
                    empId,
                    rawName,
                    source = loginSource,
                    message = $"[{empId}] 無瀏覽此網頁的權限"
                });
            }
        }
        else if (isDefaultAdmin && !string.Equals(account.RoleLevel, "admin", StringComparison.OrdinalIgnoreCase))
        {
            account.RoleLevel = "admin";
            account.CanEditOthers = true;
            await _context.SaveChangesAsync();
            _logger.LogInformation("✅ WhoAmI 自動升級預設 Admin 帳號為 admin：{EmpId}", empId);
        }
        else if (!isDefaultAdmin && _authSettings.OpenAccessMode && string.Equals(account.RoleLevel, "user", StringComparison.OrdinalIgnoreCase))
        {
            // 當開放瀏覽模式開啟且該使用者為 user，若未綁定任何角色（或曾由舊版自動建立），自動補齊所有角色並清除預設首頁設定，還原為「所有廠區可視 / 首頁未設定」
            var existingRolesCount = await _context.MapAccountRoles.CountAsync(m => m.EmpId == account.EmpId);
            if (existingRolesCount == 0)
            {
                var allRoleIds = await _context.Roles.AsNoTracking().Select(r => r.RoleId).ToListAsync();
                foreach (var rId in allRoleIds)
                {
                    _context.MapAccountRoles.Add(new MapAccountRole { EmpId = account.EmpId, RoleId = rId });
                }
                var oldDefaultPages = await _context.MapAccountDefaultPages.Where(m => m.EmpId == account.EmpId).ToListAsync();
                if (oldDefaultPages.Count > 0) _context.MapAccountDefaultPages.RemoveRange(oldDefaultPages);

                await _context.SaveChangesAsync();
                _logger.LogInformation("✅ WhoAmI (OpenAccessMode=true) 自動為既有 user 補齊角色權限並重設預設首頁：{EmpId}", account.EmpId);
            }
        }

        // 找到帳號 — 也順手發一張 Cookie，這樣 [Authorize] 的 API (例如 PersonalSettings) 後續才能用
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

        await _activityLogger.LogLoginAsync(HttpContext, account.EmpId, account.Name, loginSource, true,
            detail: $"{{\"rawName\":\"{rawName}\"}}");

        var assignedRoles = await _context.MapAccountRoles.AsNoTracking()
            .Where(m => m.EmpId == account.EmpId).Select(m => m.RoleId).ToListAsync();
        var defaultPages = await _context.MapAccountDefaultPages.AsNoTracking()
            .Where(m => m.EmpId == account.EmpId).ToDictionaryAsync(m => m.FabId, m => m.MenuId ?? "");

        return Ok(new
        {
            success = true,
            authenticated = true,
            empId = account.EmpId,
            rawName,
            source = loginSource,
            roleLevel = account.RoleLevel,
            account = new
            {
                empId = account.EmpId,
                name = account.Name ?? account.EmpId,
                department = account.Department ?? "",
                roleLevel = account.RoleLevel ?? "user",
                canEditOthers = account.CanEditOthers,
                assignedRoles = assignedRoles,
                manageableMenus = Array.Empty<string>(),
                defaultPages = defaultPages
            }
        });
    }

    [HttpGet("MyProfile")]
    [Authorize]
    public async Task<IActionResult> MyProfile()
    {
        Response.Headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
        // ⚠️ User.Identity?.Name 在我們的 Cookie scheme 下會回「姓名」(ClaimTypes.Name)；EmpId 放在 NameIdentifier。
        var empId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (string.IsNullOrEmpty(empId)) return Unauthorized();

        var a = await _context.Accounts
            .AsNoTracking()
            .Include(x => x.MapAccountRoles)
            .Include(x => x.MapAccountManageMenus)
            .Include(x => x.MapAccountDefaultPages)
            .Include(x => x.MapAccountExtraMenus)
            .Include(x => x.MapAccountDenyMenus)
            .AsSplitQuery() // 5 個 collection-Include 避免 cartesian 相乘
            .FirstOrDefaultAsync(x => x.EmpId == empId);

        if (a == null) return NotFound();

        return Ok(new
        {
            empId = a.EmpId,
            name = a.Name ?? a.EmpId,
            department = a.Department ?? "",
            loginCount = a.LoginCount ?? 0,
            lastLoginTime = a.LastLoginTime,
            // 自身的 roleLevel / canEditOthers：讓 MyProfile 成為「登入者權限」的自足來源，
            // 前端 delegated-admin UI 判定不再隱性依賴 GetInitialData 的自身列或 Login 回應（皆為自己的值，無資訊外洩）。
            roleLevel = a.RoleLevel ?? "user",
            canEditOthers = a.CanEditOthers,
            assignedRoles = a.MapAccountRoles?.Select(m => m.RoleId).ToList() ?? new List<string>(),
            manageableMenus = a.MapAccountManageMenus?.Select(m => m.MenuId).ToList() ?? new List<string>(),
            // per-fab：以 FabId 分組成 { fabId: [menuId,...] }
            extraMenus = GroupOverridesByFab(a.MapAccountExtraMenus?.Select(m => (m.FabId, m.MenuId))),
            denyMenus = GroupOverridesByFab(a.MapAccountDenyMenus?.Select(m => (m.FabId, m.MenuId))),
            defaultPages = a.MapAccountDefaultPages?.ToDictionary(m => m.FabId, m => m.MenuId ?? "") ?? new Dictionary<string, string>()
        });
    }

    /// <summary>把 per-fab 覆寫關聯列 [(FabId, MenuId)] 分組成 { fabId: [menuId,...] }（前端字典形狀）。</summary>
    private static Dictionary<string, List<string>> GroupOverridesByFab(IEnumerable<(string FabId, string MenuId)>? rows)
    {
        var dict = new Dictionary<string, List<string>>();
        if (rows == null) return dict;
        foreach (var (fabId, menuId) in rows)
        {
            var key = fabId ?? string.Empty;
            if (!dict.TryGetValue(key, out var list)) { list = new List<string>(); dict[key] = list; }
            if (!list.Contains(menuId)) list.Add(menuId);
        }
        return dict;
    }

    /// <summary>
    /// 手動登入：以工號 + 密碼向 AD LDAP 進行 bind 驗證，成功後寫入 Cookie。
    /// </summary>
    [HttpPost("Login")]
    [AllowAnonymous]
    [EnableRateLimiting("login-ip")]  // Round-3 P1 #4：每 IP 60 秒最多 10 次嘗試，擋暴力破解
    public async Task<IActionResult> Login([FromBody] LoginRequest req)
    {
        // 部署到正式環境後可把 appsettings.Auth.AllowManualLogin 設為 false，整個手動登入入口會被擋住、
        // 強制所有人走 Windows 自動偵測；前端 tab 也會藏起來。
        if (!_authSettings.AllowManualLogin)
        {
            await _activityLogger.LogLoginAsync(HttpContext, req.EmpId ?? "(empty)", null, "manual", false,
                errorMessage: "本環境已停用手動登入");
            return Unauthorized(new
            {
                success = false,
                message = "本環境已停用手動登入，請改用桌機 Windows 帳號自動登入。"
            });
        }

        if (string.IsNullOrWhiteSpace(req.EmpId))
        {
            await _activityLogger.LogLoginAsync(HttpContext, "(empty)", null, "manual", false,
                errorMessage: "工號為空");
            return BadRequest(new { success = false, message = "工號不得為空" });
        }

        var empId = req.EmpId.Trim();
        var password = req.Password ?? "";

        // 驗證優先序：
        //   1. TestAccounts 白名單（外部開發/測試帳號，appsettings 控制；密碼會比對）
        //   2. EnableEmergencyAdmin (admin 不檢密碼，純救援通道)
        //   3. AD LDAP bind
        var (testMatched, testFallback) = _authService.VerifyTestAccount(empId, password);

        var enableEmergency = _authSettings.EnableEmergencyAdmin;
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
            {
                await _activityLogger.LogLoginAsync(HttpContext, empId, null, "manual", false,
                    errorMessage: errMsg ?? "LDAP 驗證失敗");
                return Unauthorized(new { success = false, message = errMsg ?? "驗證失敗" });
            }
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
                var isDefaultAdmin = _authSettings.DefaultAdmins?.Any(x => string.Equals(x, empId, StringComparison.OrdinalIgnoreCase)) == true;
                if (isDefaultAdmin || _authSettings.OpenAccessMode)
                {
                    var (lookupName, lookupDept) = await _authService.LookupPersonFromNotesAsync(empId);

                    if (isDefaultAdmin)
                    {
                        account = new Models.Account
                        {
                            EmpId = empId,
                            Name = !string.IsNullOrWhiteSpace(lookupName) ? lookupName : empId,
                            Department = !string.IsNullOrWhiteSpace(lookupDept) ? lookupDept : "系統管理員",
                            RoleLevel = "admin",
                            CanEditOthers = true,
                            LoginCount = 0,
                            LastLoginTime = DateTime.UtcNow
                        };
                        _context.Accounts.Add(account);
                        await _context.SaveChangesAsync();
                        _logger.LogInformation("✅ Login 自動建立預設 Admin 帳號：{EmpId}", empId);
                    }
                    else if (_authSettings.OpenAccessMode)
                    {
                        account = new Models.Account
                        {
                            EmpId = empId,
                            Name = !string.IsNullOrWhiteSpace(lookupName) ? lookupName : empId,
                            Department = !string.IsNullOrWhiteSpace(lookupDept) ? lookupDept : "一般使用者",
                            RoleLevel = "user",
                            CanEditOthers = false,
                            LoginCount = 0,
                            LastLoginTime = DateTime.UtcNow
                        };
                        _context.Accounts.Add(account);

                        var allRoleIds = await _context.Roles.AsNoTracking().Select(r => r.RoleId).ToListAsync();
                        foreach (var rId in allRoleIds)
                        {
                            _context.MapAccountRoles.Add(new MapAccountRole { EmpId = empId, RoleId = rId });
                        }

                        await _context.SaveChangesAsync();
                        _logger.LogInformation("✅ Login (OpenAccessMode=true) 自動加入新帳號為 user：{EmpId}", empId);
                    }
                }
                else
                {
                    await _activityLogger.LogLoginAsync(HttpContext, empId, null, loginSource, false,
                        errorMessage: "工號通過密碼驗證但 Accounts 表內無此帳號且未開啟 OpenAccessMode");
                    return Unauthorized(new
                    {
                        success = false,
                        message = $"工號 [{empId}] 尚未建立帳號，請聯絡管理員。"
                    });
                }
            }
        }

        if (account == null)
        {
            return Unauthorized(new { success = false, message = $"工號 [{empId}] 帳號資訊驗證失敗。" });
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

        await _activityLogger.LogLoginAsync(HttpContext, account.EmpId, account.Name, loginSource, true);

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
        // 紀錄登出 — 先記再 SignOut，否則 ctx.User 會清空抓不到 EmpId
        var empId = User.FindFirstValue(ClaimTypes.NameIdentifier);
        var name = User.FindFirstValue(ClaimTypes.Name);
        if (!string.IsNullOrWhiteSpace(empId))
        {
            await _activityLogger.LogLogoutAsync(HttpContext, empId, name);
        }

        await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        return Ok(new { success = true });
    }
}

public class LoginRequest
{
    [Required(ErrorMessage = "工號不得為空")]
    [StringLength(50)]
    public string EmpId { get; set; } = string.Empty;

    [StringLength(100)]
    public string? Password { get; set; }
}
