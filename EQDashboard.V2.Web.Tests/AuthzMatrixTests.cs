using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Negotiate;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;
using Xunit;

namespace EQDashboard.V2.Web.Tests;

/// <summary>
/// 自訂測試工廠：強制以 <c>Development</c> 環境啟動被測 app，並快取「每帳號一個已登入 client」。
/// 為何要 Development：Program.cs 的 production guard 會在「非 Development 且連線字串含 Password=test」時 <c>throw</c>
///   拒絕啟動；且 TestAccounts(admin/user/subadmin_user/normal_user) 與 AllowManualLogin 皆以 Development 設定為準。
/// 為何要快取 client：登入端點有 <c>login-ip</c> 速率限制（每 IP 60 秒 10 次）；TestServer 下全部請求同一 IP 分區，
///   若每個測試各自重登會超限回 429。快取後整個 class 對每個帳號只登入一次（≤4 次），穩定低於上限。
/// 這些測試打真正的 Sariel / EQDashboardV2 DB（true integration — 與正式行為一致，無 mock）。
/// </summary>
public class EqDashboardWebAppFactory : WebApplicationFactory<Program>
{
    private readonly Dictionary<string, HttpClient> _authedClients = new(); // xUnit 同一 class 內測試循序執行 → 無需 concurrent

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Development");

        // ⚠️ TestServer（記憶體內）不支援 Negotiate（它需要 Kestrel 的 IConnectionItemsFeature）。
        //    Negotiate handler 是 IAuthenticationRequestHandler，會在「每個」請求初始化 → 一律丟
        //    NotSupportedException → 整站 500。整合測試走 Cookie / 手動登入即可（WhoAmI 不在測試範圍），
        //    故把 Negotiate 從「request handler schemes」剔除，純測試端處置、不動正式程式碼。
        builder.ConfigureTestServices(services =>
        {
            services.Replace(ServiceDescriptor.Singleton<IAuthenticationSchemeProvider, NoNegotiateSchemeProvider>());
        });
    }

    public HttpClient NewAnonymousClient() => CreateClient(new WebApplicationFactoryClientOptions
    {
        HandleCookies = true,       // 保留登入 / antiforgery cookie 於同一 client
        AllowAutoRedirect = false   // 讓 401/403/302 可被觀察、不被自動跟隨
    });

    /// <summary>取得（並快取）已登入指定帳號的 client。重複呼叫回同一實例，避免再次登入觸發速率限制。</summary>
    public async Task<HttpClient> GetAuthedClientAsync(string empId, string password)
    {
        if (_authedClients.TryGetValue(empId, out var cached)) return cached;

        var client = NewAnonymousClient();
        var resp = await client.PostAsJsonAsync("/api/Auth/Login", new { EmpId = empId, Password = password });
        if (resp.StatusCode != HttpStatusCode.OK)
            throw new InvalidOperationException($"登入 {empId} 失敗：HTTP {(int)resp.StatusCode} {resp.StatusCode}");
        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
        if (!doc.RootElement.GetProperty("success").GetBoolean())
            throw new InvalidOperationException($"登入 {empId} 回 success=false");

        _authedClients[empId] = client;
        return client;
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
            foreach (var c in _authedClients.Values) c.Dispose();
        base.Dispose(disposing);
    }
}

/// <summary>把 Negotiate 自 request-handler schemes 排除，避免 TestServer 上每請求初始化 Negotiate 而 500。</summary>
internal sealed class NoNegotiateSchemeProvider : AuthenticationSchemeProvider
{
    public NoNegotiateSchemeProvider(IOptions<AuthenticationOptions> options) : base(options) { }

    public override async Task<IEnumerable<AuthenticationScheme>> GetRequestHandlerSchemesAsync()
    {
        var all = await base.GetRequestHandlerSchemesAsync();
        return all.Where(s => s.Name != NegotiateDefaults.AuthenticationScheme);
    }
}

/// <summary>
/// 授權矩陣最小整合測試 —— 鎖住 #81(快取作廢攔截器) / #82(MenuService 抽離) 重構後仍須成立的對外行為。
/// 斷言刻意採「相對關係」而非脆弱的硬編碼數量：admin ⊋ subadmin ⊋ ∅(normal)、admin-only 403、CSRF 兩道防線、委派編輯閘門。
/// </summary>
public class AuthzMatrixTests : IClassFixture<EqDashboardWebAppFactory>
{
    private readonly EqDashboardWebAppFactory _factory;

    public AuthzMatrixTests(EqDashboardWebAppFactory factory) => _factory = factory;

    // === 測試帳號（appsettings.json: Auth.TestAccounts，Development 下 Enabled=true）===
    private const string AdminId = "admin", AdminPw = "admin";
    private const string SubadminId = "subadmin_user", SubadminPw = "123456"; // 委派管理 m_ze、CanEditOthers=true
    private const string NormalId = "normal_user", NormalPw = "123456";       // 無角色 → 中性空清單

    // ---------- helpers ----------

    /// <summary>GET /api/Auth/CsrfToken → 回 request token，並把對應 antiforgery cookie 寫入 client cookie 容器。</summary>
    private static async Task<string> GetCsrfTokenAsync(HttpClient client)
    {
        var resp = await client.GetAsync("/api/Auth/CsrfToken");
        resp.EnsureSuccessStatusCode();
        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
        return doc.RootElement.GetProperty("token").GetString()!;
    }

    /// <summary>GET /api/Menus → 後端已做可見性過濾；取回該使用者可見的 menu id 集合。</summary>
    private static async Task<HashSet<string>> GetVisibleMenuIdsAsync(HttpClient client)
    {
        var resp = await client.GetAsync("/api/Menus");
        resp.EnsureSuccessStatusCode();
        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
        var ids = new HashSet<string>();
        foreach (var el in doc.RootElement.EnumerateArray())
            ids.Add(el.GetProperty("id").GetString()!);
        return ids;
    }

    // ---------- tests ----------

    /// <summary>四個測試帳號皆能成功手動登入（GetAuthedClientAsync 在非 200 / success=false 時 throw）。</summary>
    [Fact]
    public async Task Login_AllTestAccounts_Succeed()
    {
        Assert.NotNull(await _factory.GetAuthedClientAsync(AdminId, AdminPw));
        Assert.NotNull(await _factory.GetAuthedClientAsync("user", "user"));
        Assert.NotNull(await _factory.GetAuthedClientAsync(SubadminId, SubadminPw));
        Assert.NotNull(await _factory.GetAuthedClientAsync(NormalId, NormalPw));
    }

    [Fact]
    public async Task GetMenus_RequiresAuthentication_401()
    {
        var anon = _factory.NewAnonymousClient();
        var resp = await anon.GetAsync("/api/Menus");
        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }

    /// <summary>可見性過濾：admin ⊋ subadmin ⊋ ∅(normal)。是 #82 MenuService.GetMenusAsync 過濾的對外契約。</summary>
    [Fact]
    public async Task GetMenus_VisibilityFiltered_AdminProperSupersetSubadminEmptyNormal()
    {
        var admin = await _factory.GetAuthedClientAsync(AdminId, AdminPw);
        var subadmin = await _factory.GetAuthedClientAsync(SubadminId, SubadminPw);
        var normal = await _factory.GetAuthedClientAsync(NormalId, NormalPw);

        var adminMenus = await GetVisibleMenuIdsAsync(admin);
        var subMenus = await GetVisibleMenuIdsAsync(subadmin);
        var normMenus = await GetVisibleMenuIdsAsync(normal);

        Assert.NotEmpty(adminMenus);                       // admin 看得到全部
        Assert.NotEmpty(subMenus);                         // subadmin 至少看得到 m_ze 子樹 + 12A role 選單
        Assert.Empty(normMenus);                           // 無角色帳號 → 中性空清單（非錯誤）
        Assert.ProperSuperset(subMenus, adminMenus);       // admin 嚴格涵蓋 subadmin 的可見集合且更多
    }

    /// <summary>admin-only 端點：subadmin / normal 皆 403，admin 200。AccountsController 為 [Authorize(Roles="admin")]。</summary>
    [Fact]
    public async Task AccountsEndpoint_AdminOnly_403ForNonAdmin()
    {
        var admin = await _factory.GetAuthedClientAsync(AdminId, AdminPw);
        var subadmin = await _factory.GetAuthedClientAsync(SubadminId, SubadminPw);
        var normal = await _factory.GetAuthedClientAsync(NormalId, NormalPw);

        Assert.Equal(HttpStatusCode.OK, (await admin.GetAsync("/api/Accounts")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await subadmin.GetAsync("/api/Accounts")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await normal.GetAsync("/api/Accounts")).StatusCode);
    }

    /// <summary>CSRF 第一道：寫入請求缺 X-Requested-With → 400（在進到 controller 前即被 middleware 攔下，無 DB 異動）。</summary>
    [Fact]
    public async Task Write_MissingXRequestedWith_Returns400()
    {
        var admin = await _factory.GetAuthedClientAsync(AdminId, AdminPw);
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/Menus")
        {
            Content = JsonContent.Create(new { id = "t_csrf_l1", name = "x", enabled = true })
        };
        var resp = await admin.SendAsync(req);
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        Assert.Contains("Missing X-Requested-With", await resp.Content.ReadAsStringAsync());
    }

    /// <summary>CSRF 第二道：有 X-Requested-With 但缺 antiforgery token → 400 Invalid Token（同樣攔在 controller 前）。</summary>
    [Fact]
    public async Task Write_WithXRequestedWith_NoAntiforgeryToken_Returns400()
    {
        var admin = await _factory.GetAuthedClientAsync(AdminId, AdminPw);
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/Menus")
        {
            Content = JsonContent.Create(new { id = "t_csrf_l2", name = "x", enabled = true })
        };
        req.Headers.Add("X-Requested-With", "XMLHttpRequest"); // 過第一道，但故意不帶 X-CSRF-TOKEN
        var resp = await admin.SendAsync(req);
        Assert.Equal(HttpStatusCode.BadRequest, resp.StatusCode);
        Assert.Contains("Invalid Token", await resp.Content.ReadAsStringAsync());
    }

    /// <summary>
    /// 委派編輯閘門：subadmin 帶齊 CSRF（過兩道）去 PUT 一個「自己看不到」的選單 → 403。
    /// 取 adminMenus∖subMenus 任一 id：不在可見集合 ⟹ 既非自己建立、也不在 m_ze 委派子樹 ⟹ CanEditOrDeleteMenu=false。
    /// 刻意不硬編碼某個 menu id，避免 seed 變動即脆裂。
    /// </summary>
    [Fact]
    public async Task Subadmin_EditNonVisibleMenu_Returns403_AfterPassingCsrf()
    {
        var admin = await _factory.GetAuthedClientAsync(AdminId, AdminPw);
        var subadmin = await _factory.GetAuthedClientAsync(SubadminId, SubadminPw);

        var adminMenus = await GetVisibleMenuIdsAsync(admin);
        var subMenus = await GetVisibleMenuIdsAsync(subadmin);
        var notVisibleToSub = adminMenus.Except(subMenus).ToList();
        Assert.NotEmpty(notVisibleToSub); // admin ⊋ subadmin 已保證
        var targetId = notVisibleToSub[0];

        var token = await GetCsrfTokenAsync(subadmin);
        var req = new HttpRequestMessage(HttpMethod.Put, $"/api/Menus/{targetId}")
        {
            Content = JsonContent.Create(new { id = targetId, name = "x", enabled = true })
        };
        req.Headers.Add("X-Requested-With", "XMLHttpRequest");
        req.Headers.Add("X-CSRF-TOKEN", token);

        var resp = await subadmin.SendAsync(req);
        Assert.Equal(HttpStatusCode.Forbidden, resp.StatusCode);
    }

    /// <summary>
    /// ETag 身分綁定回歸：GetInitialData 的回應 body 對非 admin 做列級過濾＝同一 URL 不同使用者內容不同，
    /// 故 ETag 必須摻入身分（admin 與 normal 必不相同）。否則共用瀏覽器 profile 換帳號時，瀏覽器帶上前一位
    /// 使用者的 If-None-Match → 伺服器只比字串 → 304 → 回放前一位的快取 body（admin 全量資料外洩給非 admin）。
    /// 驗三件事：①admin/normal 的 ETag 不相等；②normal 帶 admin 的 ETag 不得 304（強制 200 重抓）；
    /// ③normal 帶自己的 ETag 照常 304（同一使用者的快取優化仍生效）。
    /// 安全性：GET 不會 bump 全域 ETag；背景稽核寫的是 UserActivityLog（不在 InitialData 快取/interceptor 範圍）；
    /// xUnit 同 class 測試循序執行 → 兩次取自己 ETag 之間不會被其他測試的寫入插隊改變版本。
    /// </summary>
    [Fact]
    public async Task GetInitialData_ETagIdentityBound_NoCrossUser304()
    {
        var admin = await _factory.GetAuthedClientAsync(AdminId, AdminPw);
        var normal = await _factory.GetAuthedClientAsync(NormalId, NormalPw);

        var adminResp = await admin.GetAsync("/Settings/GetInitialData");
        adminResp.EnsureSuccessStatusCode();
        var adminETag = adminResp.Headers.TryGetValues("ETag", out var av) ? av.First() : "";
        Assert.False(string.IsNullOrEmpty(adminETag));

        var normalResp = await normal.GetAsync("/Settings/GetInitialData");
        normalResp.EnsureSuccessStatusCode();
        var normalETag = normalResp.Headers.TryGetValues("ETag", out var nv) ? nv.First() : "";
        Assert.False(string.IsNullOrEmpty(normalETag));

        // ① 身分不同 → ETag 不同
        Assert.NotEqual(adminETag, normalETag);

        // ② normal 帶 admin 的 ETag → 不得命中 304（防跨使用者快取回放）
        var crossReq = new HttpRequestMessage(HttpMethod.Get, "/Settings/GetInitialData");
        crossReq.Headers.TryAddWithoutValidation("If-None-Match", adminETag);
        var crossResp = await normal.SendAsync(crossReq);
        Assert.Equal(HttpStatusCode.OK, crossResp.StatusCode);

        // ③ normal 帶自己的 ETag → 照常 304
        var selfReq = new HttpRequestMessage(HttpMethod.Get, "/Settings/GetInitialData");
        selfReq.Headers.TryAddWithoutValidation("If-None-Match", normalETag);
        var selfResp = await normal.SendAsync(selfReq);
        Assert.Equal(HttpStatusCode.NotModified, selfResp.StatusCode);
    }
}
