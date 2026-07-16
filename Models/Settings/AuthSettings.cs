namespace EQDashboard.V2.Web.Models.Settings;

public class AuthSettings
{
    public string? WindowsDomainStripPrefix { get; set; }
    public bool OpenAccessMode { get; set; } = true;
    public string? SimulatedAccount { get; set; }
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
