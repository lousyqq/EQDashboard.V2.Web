using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace EQDashboard.V2.Web.Models;

/// <summary>
/// 每日看板點擊統計表 — 記錄個別同仁每日點擊特定看板的人次與時段 (為殭屍看板報表之基礎數據)
/// 複合主鍵：(ClickDate, MenuId, EmpId)
/// </summary>
public class DailyMenuClick
{
    [Key]
    [Column(Order = 0)]
    public DateTime ClickDate { get; set; }

    [Key]
    [Column(Order = 1)]
    [MaxLength(50)]
    public string MenuId { get; set; } = null!;

    [Key]
    [Column(Order = 2)]
    [MaxLength(50)]
    public string EmpId { get; set; } = null!;

    public int ClickCount { get; set; } = 1;

    public DateTime FirstClickTime { get; set; }

    public DateTime LastClickTime { get; set; }
}
