using System.Text.RegularExpressions;
using EQDashboard.V2.Web.Data;
using EQDashboard.V2.Web.Services.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace EQDashboard.V2.Web.Services;

/// <inheritdoc cref="IIconStorageService"/>
public class IconStorageService : IIconStorageService
{
    private readonly AppDbContext _context;
    private readonly IWebHostEnvironment _env;
    private readonly ILogger<IconStorageService> _logger;

    // 本站 icon 路徑的共同前綴（改為相對路徑無開頭斜線，相容 IIS 虛擬目錄部署）
    private const string IconUrlPrefix = "images/icons/";

    // MIME → 副檔名白名單。非白名單的 data: URI 一律丟棄（防 data:text/html 等怪內容寫進磁碟/DB）。
    private static readonly Dictionary<string, string> MimeToExt = new(StringComparer.OrdinalIgnoreCase)
    {
        ["image/jpeg"] = "jpg",
        ["image/jpg"] = "jpg",
        ["image/png"] = "png",
        ["image/gif"] = "gif",
        ["image/webp"] = "webp",
        ["image/svg+xml"] = "svg",
        ["image/bmp"] = "bmp",
        ["image/x-icon"] = "ico",
        ["image/vnd.microsoft.icon"] = "ico",
    };

    private static readonly Regex DataUriRegex =
        new(@"^data:(?<mime>[^;,]+);base64,(?<data>.+)$", RegexOptions.Singleline | RegexOptions.Compiled);

    public IconStorageService(AppDbContext context, IWebHostEnvironment env, ILogger<IconStorageService> logger)
    {
        _context = context;
        _env = env;
        _logger = logger;
    }

    public Task<string?> SaveAsync(string? icon)
    {
        if (string.IsNullOrWhiteSpace(icon)) return Task.FromResult(icon);
        var trimmed = icon.Trim();

        // 1) data: URI —— 驗證 base64 格式，直接存入 DB
        if (trimmed.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
        {
            var match = DataUriRegex.Match(trimmed);
            if (!match.Success) return Task.FromResult<string?>(null);
            var mime = match.Groups["mime"].Value.Trim();
            if (!MimeToExt.TryGetValue(mime, out _)) return Task.FromResult<string?>(null); // 白名單之外拒絕
            return Task.FromResult<string?>(trimmed); // 直接回傳完整的 data: URI 存入 DB
        }

        // 2) 既有本站 icon 路徑（相對或自我參照的絕對 URL）→ 正規化成相對路徑
        var normalized = TryNormalizeLocalPath(trimmed);
        if (normalized != null) return Task.FromResult<string?>(normalized);

        // 3) 其餘（FontAwesome class、外部 URL 等）→ 原值回傳
        //    ⚠️ 型別參數要顯式寫 <string?>：走到這裡 icon 已被上方的 IsNullOrWhiteSpace 檢查收斂成 string，
        //       讓編譯器推斷會得到 Task<string>，而 Task<T> 是不變的（invariant）→ 無法轉成宣告的 Task<string?>
        //       （CS8619，全專案唯一的建置警告，2026-08-16 修）。
        return Task.FromResult<string?>(icon);
    }

    public Task DeleteIfLocalUnreferencedAsync(string? oldIcon)
    {
        // 為了支援 Web Farm，圖示改存 DB，不再刪除實體檔案。
        // 此函式僅保留空殼以符合介面。
        return Task.CompletedTask;
    }

    public async Task<int> MigrateBase64IconsAsync()
    {
        int converted = 0;

        // 這次遷移是：讀取 DB 內的相對路徑（images/icons/xxx.ext），
        // 找到硬碟中的實體檔案，轉成 data: URI 回寫 DB。
        var menus = await _context.Menus
            .Where(m => m.Icon != null && m.Icon.Contains("images/icons/"))
            .ToListAsync();
        foreach (var m in menus)
        {
            var dataUri = await ConvertFileToDataUriAsync(m.Icon);
            if (dataUri != null) { m.Icon = dataUri; converted++; }
        }

        var apps = await _context.Apps
            .Where(a => a.IconBase64 != null && a.IconBase64.Contains("images/icons/"))
            .ToListAsync();
        foreach (var a in apps)
        {
            var dataUri = await ConvertFileToDataUriAsync(a.IconBase64);
            if (dataUri != null) { a.IconBase64 = dataUri; converted++; }
        }

        if (converted > 0)
        {
            await _context.SaveChangesAsync();
            _logger.LogInformation("✅ IconStorage 反向遷移：{Count} 筆實體檔 icon 已轉為 DB Base64", converted);
        }
        return converted;
    }

    /// <summary>把實體檔案讀出轉為 base64 data URI</summary>
    private async Task<string?> ConvertFileToDataUriAsync(string? iconPath)
    {
        if (string.IsNullOrWhiteSpace(iconPath)) return null;
        var normalized = TryNormalizeLocalPath(iconPath);
        if (normalized == null) return null;

        var fileName = Path.GetFileName(normalized);
        var ext = Path.GetExtension(fileName).TrimStart('.').ToLowerInvariant();
        var mime = MimeToExt.FirstOrDefault(x => x.Value == ext).Key ?? "image/png";

        var webRoot = !string.IsNullOrEmpty(_env.WebRootPath)
            ? _env.WebRootPath
            : Path.Combine(_env.ContentRootPath, "wwwroot");
        var path = Path.Combine(webRoot, "images", "icons", fileName);

        if (!File.Exists(path)) return null;

        try
        {
            var bytes = await File.ReadAllBytesAsync(path);
            var base64 = Convert.ToBase64String(bytes);
            return $"data:{mime};base64,{base64}";
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "讀取實體檔案轉為 Base64 失敗: {Path}", path);
            return null;
        }
    }

    /// <summary>
    /// 若 value 是本站 icon（相對 "images/icons/x" 或舊版 "/images/icons/x" 或絕對 "http://host/images/icons/x"），
    /// 取出檔名（擋掉 query/hash 與 ../）並回傳正規化的相對路徑 "images/icons/{file}"；否則回 null。
    /// </summary>
    private static string? TryNormalizeLocalPath(string value)
    {
        var idx = value.IndexOf("images/icons/", StringComparison.OrdinalIgnoreCase);
        if (idx < 0) return null;

        var fileName = value.Substring(idx + "images/icons/".Length);

        // 砍掉 query / hash
        var cut = fileName.IndexOfAny(new[] { '?', '#' });
        if (cut >= 0) fileName = fileName.Substring(0, cut);

        fileName = Path.GetFileName(fileName); // path traversal 防護（去掉任何路徑片段）
        if (string.IsNullOrWhiteSpace(fileName)) return null;

        return IconUrlPrefix + fileName;
    }
}
