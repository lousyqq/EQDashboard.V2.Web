using System.ComponentModel.DataAnnotations.Schema;

namespace EQDashboard.V2.Web.Models;

/// <summary>
/// 帳號層級「額外開放」可視 Menu（RBAC 之外的單一新增）。
/// 權限計算：effective = role.allowedMenuIds ∪ extraMenus - denyMenus
/// </summary>
[Table("Map_Account_ExtraMenu")]
public class MapAccountExtraMenu
{
    public string EmpId { get; set; } = string.Empty;
    public string MenuId { get; set; } = string.Empty;

    public Account? Account { get; set; }
    public Menu? Menu { get; set; }
}
