using System.ComponentModel.DataAnnotations.Schema;

namespace EQDashboard.V2.Web.Models;

/// <summary>
/// 帳號層級「個別封鎖」可視 Menu（從 Role 繼承來的可視範圍中扣除）。
/// 權限計算：effective = role.allowedMenuIds ∪ extraMenus - denyMenus
/// </summary>
[Table("Map_Account_DenyMenu")]
public class MapAccountDenyMenu
{
    public string EmpId { get; set; } = string.Empty;
    public string MenuId { get; set; } = string.Empty;

    public Account? Account { get; set; }
    public Menu? Menu { get; set; }
}
