using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.Negotiate;
using Microsoft.EntityFrameworkCore;
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
        options.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest; // HTTPS 時自動啟用 Secure 標記
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

var app = builder.Build();

// === Schema bootstrap (idempotent；每次啟動跑一次) ===
// 自動建立缺失的覆寫表 + 種入 TestAccounts 中尚未存在的工號
using (var scope = app.Services.CreateScope())
{
    var bootstrap = scope.ServiceProvider.GetRequiredService<ISchemaBootstrap>();
    await bootstrap.RunAsync();
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

// 註冊 API 路由 (讓前端 fetch 能對應到 Controller/Action)
app.MapControllerRoute(
    name: "default",
    pattern: "{controller=Home}/{action=Index}/{id?}");

app.Run();

