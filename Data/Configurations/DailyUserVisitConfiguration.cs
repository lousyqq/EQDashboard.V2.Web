using EQDashboard.V2.Web.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace EQDashboard.V2.Web.Data.Configurations;

public class DailyUserVisitConfiguration : IEntityTypeConfiguration<DailyUserVisit>
{
    public void Configure(EntityTypeBuilder<DailyUserVisit> builder)
    {
        builder.ToTable("DailyUserVisits");
        builder.HasKey(x => new { x.VisitDate, x.EmpId });
        builder.Property(x => x.VisitDate).HasColumnType("date");
        builder.Property(x => x.EmpId).HasMaxLength(50);
        builder.Property(x => x.EmpName).HasMaxLength(100);
        builder.Property(x => x.Department).HasMaxLength(100);
        // 實體索引 IX_DailyUserVisits_Date_Dept 由 SchemaBootstrap.EnsureIndexesAsync 建立
    }
}
