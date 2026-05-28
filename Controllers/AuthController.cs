using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using EQDashboard.V2.Web.Data;
using EQDashboard.V2.Web.Models;

namespace EQDashboard.V2.Web.Controllers;

[Route("api/[controller]")]
[ApiController]
public class AuthController : ControllerBase
{
    private readonly AppDbContext _context;

    public AuthController(AppDbContext context)
    {
        _context = context;
    }

    [HttpPost("Login")]
    public async Task<IActionResult> Login([FromBody] LoginRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.EmpId))
            return BadRequest(new { success = false, message = "工號不得為空" });

        var empId = req.EmpId.Trim().ToLower();
        var account = await _context.Accounts.FirstOrDefaultAsync(a => a.EmpId.ToLower() == empId);

        // 緊急後門
        if (account == null && empId == "admin")
        {
            account = new Account
            {
                EmpId = "admin",
                Name = "系統管理員(臨時)",
                Department = "系統救援",
                RoleLevel = "admin",
                CanEditOthers = true
            };
        }

        if (account == null)
            return Unauthorized(new { success = false, message = "找不到此帳號！請確認工號是否正確。" });

        // 建立 Claims
        var claims = new List<Claim>
        {
            new Claim(ClaimTypes.NameIdentifier, account.EmpId),
            new Claim(ClaimTypes.Name, account.Name ?? account.EmpId),
            new Claim(ClaimTypes.Role, (account.RoleLevel ?? "user").ToLower())
        };

        var claimsIdentity = new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme);

        // 寫入 Cookie
        await HttpContext.SignInAsync(
            CookieAuthenticationDefaults.AuthenticationScheme,
            new ClaimsPrincipal(claimsIdentity),
            new AuthenticationProperties
            {
                IsPersistent = true,
                ExpiresUtc = DateTimeOffset.UtcNow.AddHours(12)
            });

        return Ok(new { success = true, empId = account.EmpId, roleLevel = account.RoleLevel });
    }

    [HttpPost("Logout")]
    public async Task<IActionResult> Logout()
    {
        await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        return Ok(new { success = true });
    }
}

public class LoginRequest
{
    public string EmpId { get; set; } = string.Empty;
}
