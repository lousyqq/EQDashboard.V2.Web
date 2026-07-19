using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace EQDashboard.V2.Web.Models;

/// <summary>
/// 每日帳號造訪活躍統計表 — 記錄個別同仁每日造訪人次與時段 (為 DAU/MAU/部門熱度分析之基礎數據)
/// 複合主鍵：(VisitDate, EmpId)
/// </summary>
public class DailyUserVisit
{
    [Key]
    [Column(Order = 0)]
    public DateTime VisitDate { get; set; }

    [Key]
    [Column(Order = 1)]
    [MaxLength(50)]
    public string EmpId { get; set; } = null!;

    [MaxLength(100)]
    public string? EmpName { get; set; }

    [MaxLength(100)]
    public string? Department { get; set; }

    public int VisitCount { get; set; } = 1;

    public DateTime FirstVisitTime { get; set; }

    public DateTime LastVisitTime { get; set; }
}
