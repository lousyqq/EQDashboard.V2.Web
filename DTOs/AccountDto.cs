namespace EQDashboard.V2.Web.DTOs;

public class AccountDto
{
    public int Id { get; set; }
    public string EmpId { get; set; } = null!;
    public string Name { get; set; } = null!;
    public string? Email { get; set; }
    public int LoginCount { get; set; }
    public DateTime? LastLoginTime { get; set; }
    public bool IsActive { get; set; }
}
