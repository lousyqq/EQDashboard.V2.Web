using EQDashboard.V2.Web.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace EQDashboard.V2.Web.Data.Configurations;

public class FabConfiguration : IEntityTypeConfiguration<Fab>
{
    public void Configure(EntityTypeBuilder<Fab> builder)
    {
        builder.HasKey(e => e.FabId);
        builder.Property(e => e.FabId).HasMaxLength(50);
    }
}
