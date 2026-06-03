using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.Negotiate;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using System.Threading.RateLimiting;
using EQDashboard.V2.Web.Data;
using EQDashboard.V2.Web.Services;
using EQDashboard.V2.Web.Services.Interfaces;

var builder = WebApplication.CreateBuilder(args);

// 加入控制器支援 (供 SettingsController API 使用)
builder.Services.AddControllersWithViews();

// 註冊快取服務
builder.Services.AddMemoryCache();

// 註冊 AppDbContext
builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlServer(builder.Configuration.GetConnectionString("EQDashboard")));

// 註冊 Service 層（DI 依賴注入）
builder.Services.AddScoped<ISettingsService, SettingsService>();
builder.Services.AddScoped<IAuthService, AuthService>();
builder.Services.AddScoped<ISchemaBootstrap, SchemaBootstrap>();
builder.Services.AddScoped<IAccountService, AccountService>();
builder.Services.AddScoped<IMenuAuthService, MenuAuthService>();

// === 身份驗證：Cookies (主) + Negotiate (Windows 自動偵測) ===
// 預設 scheme 仍是 Cookies — 一般 API/頁面靠它識別；
// Negotiate 只在 /api/Auth/WhoAmI 時被瀏覽器以 401 → WWW-Authenticate: Negotiate 觸發。
builder.Services
    .AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(options =>
    {
        options.Cookie.Name = "EQDashboard.Auth";
        options.ExpireTimeSpan = TimeSpan.FromHours(12);
        options.SlidingExpiration = true;
        // ⭐️ 安全強化：Cookie 安全設定
        options.Cookie.SameSite = SameSiteMode.Lax;    // 防止 CSRF 跨站請求偽造
        options.Cookie.HttpOnly = true;                 // 防止 JS 讀取 Cookie (XSS 防護)
        // Round-3 P1 #5：
        //   - Development (本機 launch profile http://localhost:5242) → SameAsRequest，否則 http 環境 cookie 不會送回，登入直接壞
        //   - Production (含 Staging) → Always，避免「反向代理 HTTPS → 後端 HTTP」拓樸下 cookie 不帶 Secure 被內網 MITM
        options.Cookie.SecurePolicy = builder.Environment.IsDevelopment()
            ? CookieSecurePolicy.SameAsRequest
            : CookieSecurePolicy.Always;
        options.Events.OnRedirectToLogin = context =>
        {
            context.Response.StatusCode = 401;
            return Task.CompletedTask;
        };
        options.Events.OnRedirectToAccessDenied = context =>
        {
            context.Response.StatusCode = 403;
            return Task.CompletedTask;
        };
    })
    .AddNegotiate();

builder.Services.AddAuthorization(options =>
{
    // 預設不強制要求認證 — 保留與舊行為相容，每支 Controller/Action 個別決定。
    options.FallbackPolicy = null;
});

// === Rate Limiting (Round-3 P1 #4) ===
// 對 /api/Auth/Login 加 IP 粒度的速率限制，阻止離線暴力破解 TestAccounts / LDAP 密碼。
//   - 每個 IP 60 秒內最多 5 次嘗試 (含成功)，超過回 429 Too Many Requests
//   - QueueLimit=0：超出直接 reject、不排隊，避免攻擊者 batch 灌入
//   - 真實上線環境若有反向代理 (Nginx/IIS ARR)，需確認 RemoteIpAddress 是真實 client IP
//     (一般需設 ForwardedHeadersOptions 處理 X-Forwarded-For，已有 UseHttpsRedirection 配合)
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy("login-ip", context =>
    {
        var ip = context.Connection.RemoteIpAddress?.ToString() ?? "unknown";
        return RateLimitPartition.GetFixedWindowLimiter(ip, _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 5,
            Window = TimeSpan.FromSeconds(60),
            QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
            QueueLimit = 0,
            AutoReplenishment = true
        });
    });

    // 友善的拒絕回應 — 前端可以根據 Retry-After 提示使用者
    options.OnRejected = async (ctx, token) =>
    {
        ctx.HttpContext.Response.Headers["Retry-After"] = "60";
        ctx.HttpContext.Response.ContentType = "application/json";
        await ctx.HttpContext.Response.WriteAsync(
            "{\"success\":false,\"message\":\"嘗試次數過於頻繁，請等候 1 分鐘後再試。\"}", token);
    };
});

var app = builder.Build();

// === Schema bootstrap (idempotent；每次啟動跑一次) ===
// 自動建立缺失的覆寫表 + 種入 TestAccounts 中尚未存在的工號
using (var scope = app.Services.CreateScope())
{
    var bootstrap = scope.ServiceProvider.GetRequiredService<ISchemaBootstrap>();
    await bootstrap.RunAsync();
}

// === Production guard：啟動時驗證高風險設定 (Round-3 設定面 hardening) ===
//   非 Development 環境下，下列設定值若仍是「不安全的開發預設值」就直接拒絕啟動，
//   避免人為失誤把測試帳號 / placeholder LDAP / 緊急 admin 一路帶到正式環境。
//   Development 環境只 log warning、不擋啟動 (本機開發要保留 TestAccounts 才能離線測)。
{
    var logger = app.Services.GetRequiredService<ILogger<Program>>();
    var cfg = app.Configuration;
    var isProd = !app.Environment.IsDevelopment();

    var issues = new List<string>();

    if (cfg.GetValue<bool>("Auth:TestAccounts:Enabled"))
        issues.Add("Auth:TestAccounts:Enabled = true (測試帳號 admin/admin、user/user 等可直接登入)");
    if (cfg.GetValue<bool>("Auth:EnableEmergencyAdmin"))
        issues.Add("Auth:EnableEmergencyAdmin = true (admin 帳號可無密碼登入)");

    // LDAP placeholder：若 LDAP 已啟用，Server 必須是真實 hostname、不能是已知 placeholder
    if (cfg.GetValue<bool>("Auth:Ldap:Enabled"))
    {
        var server = cfg["Auth:Ldap:Server"] ?? "";
        var lower = server.ToLowerInvariant();
        bool isPlaceholder = string.IsNullOrWhiteSpace(server)
            || lower == "ldap.umc.com"
            || lower.Contains("replace")
            || lower.Contains("placeholder")
            || lower.Contains("todo")
            || lower.Contains("example");
        if (isPlaceholder)
            issues.Add($"Auth:Ldap:Server 仍是 placeholder \"{server}\"，請填實際 AD server");
    }

    // 連線字串明碼密碼：偵測 Password=test 之類弱密碼仍在 appsettings 內
    var connStr = cfg.GetConnectionString("EQDashboard") ?? "";
    if (connStr.Contains("Password=test", StringComparison.OrdinalIgnoreCase) ||
        connStr.Contains("Password=password", StringComparison.OrdinalIgnoreCase))
    {
        issues.Add("ConnectionStrings:EQDashboard 含弱密碼（請改用環境變數 ConnectionStrings__EQDashboard 或 User Secrets 注入）");
    }

    if (issues.Count > 0)
    {
        if (isProd)
        {
            logger.LogCritical("🚨 拒絕啟動：偵測到 {Count} 項不適合 Production 的設定值：\n  - {Issues}",
                issues.Count, string.Join("\n  - ", issues));
            throw new InvalidOperationException(
                "Production 環境偵測到不安全設定，已拒絕啟動。詳見 log。若確實要保留此設定，請改用 Development 環境執行。");
        }
        else
        {
            logger.LogWarning("⚠️ Development 環境偵測到 {Count} 項上線前需處理的設定：\n  - {Issues}",
                issues.Count, string.Join("\n  - ", issues));
        }
    }
}

// ⭐️ 全域例外處理：避免洩漏 Stack Trace 與內部路徑
app.UseExceptionHandler(errorApp =>
{
    errorApp.Run(async context =>
    {
        context.Response.StatusCode = 500;
        context.Response.ContentType = "application/json";
        await context.Response.WriteAsync(
            System.Text.Json.JsonSerializer.Serialize(new
            {
                success = false,
                message = "伺服器發生未預期的錯誤，請聯繫系統管理員。"
            }));
    });
});

app.UseHttpsRedirection();

// ⭐️ 安全標頭中介軟體：防止點擊劫持、MIME 嗅探等攻擊與 CSRF 防護
app.Use(async (context, next) =>
{
    var method = context.Request.Method;
    if (method == "POST" || method == "PUT" || method == "DELETE")
    {
        if (!context.Request.Headers.ContainsKey("X-Requested-With") || 
            context.Request.Headers["X-Requested-With"] != "XMLHttpRequest")
        {
            context.Response.StatusCode = 400;
            await context.Response.WriteAsync("CSRF validation failed.");
            return;
        }
    }

    context.Response.Headers["X-Content-Type-Options"] = "nosniff";
    context.Response.Headers["X-Frame-Options"] = "DENY";
    context.Response.Headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
    await next();
});

// ⭐️ 關鍵 1：設定預設檔案 (伺服器啟動時會自動去 wwwroot 尋找 index.html)
app.UseDefaultFiles();

// ⭐️ 關鍵 2：啟用靜態檔案 (允許瀏覽器讀取 wwwroot 裡面的 html, css, js)
app.UseStaticFiles();

app.UseRouting();
app.UseAuthentication();
app.UseAuthorization();
app.UseRateLimiter();  // 必須在 UseRouting 之後、MapControllerRoute 之前

// 註冊 API 路由 (讓前端 fetch 能對應到 Controller/Action)
app.MapControllerRoute(
    name: "default",
    pattern: "{controller=Home}/{action=Index}/{id?}");

app.Run();

