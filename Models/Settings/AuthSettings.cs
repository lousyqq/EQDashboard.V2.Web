namespace EQDashboard.V2.Web.Models.Settings;

public class AuthSettings
{
    public string? WindowsDomainStripPrefix { get; set; }
    public bool OpenAccessMode { get; set; } = true;
    public string? SimulatedAccount { get; set; }

    /// <summary>
    /// 顯式放行「非 Development 環境仍使用 <see cref="SimulatedAccount"/>」。
    /// 預設 false —— Production guard 會因 SimulatedAccount 非空而拒絕啟動。
    /// 設為 true 時 guard 改為每次啟動印一則 Warning、不擋啟動，
    /// 供「掛在 IIS 上、但需要模擬他人帳號做測試」的測試站使用（2026-08-25 使用者需求）。
    /// ⚠️ 只放行這一項；TestAccounts / EnableEmergencyAdmin / 弱密碼 / LDAP placeholder 四項照擋。
    /// ⚠️ SimulatedAccount 是全域設定 —— 生效期間該站台**所有訪客**都會是那個帳號，正式站切勿開啟。
    /// </summary>
    public bool AllowSimulatedAccountInProduction { get; set; }
    public List<string> DefaultAdmins { get; set; } = new() { "yu-ting", "00058897", "admin" };
    public bool EnableEmergencyAdmin { get; set; }
    public bool AllowManualLogin { get; set; }
    public TestAccountsSettings TestAccounts { get; set; } = new();
    public LdapSettings Ldap { get; set; } = new();
}

public class TestAccountsSettings
{
    public bool Enabled { get; set; }
    public List<TestAccountInfo> Accounts { get; set; } = new();
}

public class TestAccountInfo
{
    public string EmpId { get; set; } = string.Empty;
    public string Password { get; set; } = string.Empty;
    public string RoleLevel { get; set; } = "user";
    public string Name { get; set; } = string.Empty;
    public string Department { get; set; } = string.Empty;
    public bool CanEditOthers { get; set; }
}

public class LdapSettings
{
    public bool Enabled { get; set; }
    public string Server { get; set; } = string.Empty;
    public int Port { get; set; }
    public bool UseSsl { get; set; }
    public string BindDomain { get; set; } = string.Empty;
    public string SearchBase { get; set; } = string.Empty;
    public string UserPrincipalSuffix { get; set; } = string.Empty;
}
