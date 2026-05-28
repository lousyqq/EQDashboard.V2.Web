using Microsoft.AspNetCore.Authentication.Cookies;
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
builder.Services.AddScoped<IAccountService, AccountService>();

// 註冊 Cookie 身分驗證機制
builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(options =>
    {
        options.Cookie.Name = "EQDashboard.Auth";
        options.ExpireTimeSpan = TimeSpan.FromHours(12);
        options.SlidingExpiration = true;
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
    });

var app = builder.Build();

app.UseHttpsRedirection();

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
