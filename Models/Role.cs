using System.ComponentModel.DataAnnotations;

namespace EQDashboard.V2.Web.Models;

public class Role
{
    [Key]
    [MaxLength(50)]
    public string RoleId { get; set; } = null!;
    public string? GroupName { get; set; }

    public ICollection<MapRoleMenu>? MapRoleMenus { get; set; }
}
