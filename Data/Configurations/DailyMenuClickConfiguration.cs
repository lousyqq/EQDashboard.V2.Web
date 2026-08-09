using EQDashboard.V2.Web.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace EQDashboard.V2.Web.Data.Configurations;

public class DailyMenuClickConfiguration : IEntityTypeConfiguration<DailyMenuClick>
{
    public void Configure(EntityTypeBuilder<DailyMenuClick> builder)
    {
        builder.ToTable("DailyMenuClicks");
        builder.HasKey(x => new { x.ClickDate, x.MenuId, x.EmpId });
        builder.Property(x => x.ClickDate).HasColumnType("date");
        builder.Property(x => x.MenuId).HasMaxLength(50);
        builder.Property(x => x.EmpId).HasMaxLength(50);
        // 實體索引 IX_DailyMenuClicks_Date_MenuId 由 SchemaBootstrap.EnsureIndexesAsync 建立
    }
}
