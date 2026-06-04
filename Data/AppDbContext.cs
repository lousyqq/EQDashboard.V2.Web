using Microsoft.EntityFrameworkCore;
using EQDashboard.V2.Web.Models;

namespace EQDashboard.V2.Web.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options)
    {
    }

    // 定義資料庫的實體映射表
    public DbSet<Account> Accounts { get; set; }
    public DbSet<Role> Roles { get; set; }
    public DbSet<Menu> Menus { get; set; }
    public DbSet<Fab> Fabs { get; set; }
    public DbSet<AppItem> Apps { get; set; }
    public DbSet<Request> Requests { get; set; }
    public DbSet<PersonalSetting> PersonalSettings { get; set; }
    
    // Mapping Tables
    public DbSet<MapFabRole> MapFabRoles { get; set; }
    public DbSet<MapAccountRole> MapAccountRoles { get; set; }
    public DbSet<MapAccountManageMenu> MapAccountManageMenus { get; set; }
    public DbSet<MapRoleMenu> MapRoleMenus { get; set; }
    public DbSet<MapMenuStructure> MapMenuStructures { get; set; }
    public DbSet<MapAccountDefaultPage> MapAccountDefaultPages { get; set; }
    public DbSet<MapAccountExtraMenu> MapAccountExtraMenus { get; set; }
    public DbSet<MapAccountDenyMenu> MapAccountDenyMenus { get; set; }
    public DbSet<MapMenuAllowAccount> MapMenuAllowAccounts { get; set; }
    public DbSet<MapMenuDenyAccount> MapMenuDenyAccounts { get; set; }

    // 操作紀錄
    public DbSet<UserActivityLog> UserActivityLogs { get; set; }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        // Fluent API 設定：明確定義 Primary Key 與 Table Mapping
        modelBuilder.Entity<Account>(entity =>
        {
            entity.HasKey(e => e.EmpId);
            entity.Property(e => e.EmpId).HasMaxLength(50);
        });

        modelBuilder.Entity<Menu>(entity =>
        {
            entity.HasKey(e => e.MenuId);
            entity.Property(e => e.MenuId).HasMaxLength(50);
        });

        modelBuilder.Entity<Fab>(entity =>
        {
            entity.HasKey(e => e.FabId);
            entity.Property(e => e.FabId).HasMaxLength(50);
        });

        modelBuilder.Entity<Role>(entity =>
        {
            entity.HasKey(e => e.RoleId);
            entity.Property(e => e.RoleId).HasMaxLength(50);
        });

        modelBuilder.Entity<AppItem>(entity =>
        {
            entity.HasKey(e => e.AppId);
            entity.Property(e => e.AppId).HasMaxLength(50);
        });

        modelBuilder.Entity<Request>(entity =>
        {
            entity.HasKey(e => e.RequestId);
            entity.Property(e => e.RequestId).HasMaxLength(50);
        });

        modelBuilder.Entity<PersonalSetting>(entity =>
        {
            entity.HasKey(e => new { e.EmpId, e.MenuId });
            entity.Property(e => e.EmpId).HasMaxLength(50);
            entity.Property(e => e.MenuId).HasMaxLength(50);
        });

        // Mapping Tables Configuration
        modelBuilder.Entity<MapFabRole>(entity =>
        {
            entity.HasKey(e => new { e.FabId, e.RoleId });
            entity.HasOne(e => e.Fab).WithMany(f => f.MapFabRoles).HasForeignKey(e => e.FabId);
            entity.HasOne(e => e.Role).WithMany().HasForeignKey(e => e.RoleId);
        });

        modelBuilder.Entity<MapAccountRole>(entity =>
        {
            entity.HasKey(e => new { e.EmpId, e.RoleId });
            entity.HasOne(e => e.Account).WithMany(a => a.MapAccountRoles).HasForeignKey(e => e.EmpId);
            entity.HasOne(e => e.Role).WithMany().HasForeignKey(e => e.RoleId);
        });

        modelBuilder.Entity<MapAccountManageMenu>(entity =>
        {
            entity.HasKey(e => new { e.EmpId, e.MenuId });
            entity.HasOne(e => e.Account).WithMany(a => a.MapAccountManageMenus).HasForeignKey(e => e.EmpId);
            entity.HasOne(e => e.Menu).WithMany().HasForeignKey(e => e.MenuId);
        });

        modelBuilder.Entity<MapRoleMenu>(entity =>
        {
            entity.HasKey(e => new { e.RoleId, e.MenuId });
            entity.HasOne(e => e.Role).WithMany(r => r.MapRoleMenus).HasForeignKey(e => e.RoleId);
            entity.HasOne(e => e.Menu).WithMany().HasForeignKey(e => e.MenuId);
        });

        modelBuilder.Entity<MapMenuStructure>(entity =>
        {
            entity.HasKey(e => new { e.ParentMenuId, e.ChildMenuId });
            entity.HasOne(e => e.ParentMenu).WithMany().HasForeignKey(e => e.ParentMenuId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(e => e.ChildMenu).WithMany(m => m.MapMenuStructuresChild).HasForeignKey(e => e.ChildMenuId).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<MapAccountDefaultPage>(entity =>
        {
            entity.HasKey(e => new { e.EmpId, e.FabId, e.MenuId });
            entity.HasOne(e => e.Account).WithMany(a => a.MapAccountDefaultPages).HasForeignKey(e => e.EmpId);
            entity.HasOne(e => e.Fab).WithMany().HasForeignKey(e => e.FabId);
            entity.HasOne(e => e.Menu).WithMany().HasForeignKey(e => e.MenuId);
        });

        modelBuilder.Entity<MapAccountExtraMenu>(entity =>
        {
            entity.HasKey(e => new { e.EmpId, e.MenuId });
            entity.HasOne(e => e.Account).WithMany(a => a.MapAccountExtraMenus).HasForeignKey(e => e.EmpId);
            entity.HasOne(e => e.Menu).WithMany().HasForeignKey(e => e.MenuId);
        });

        modelBuilder.Entity<MapAccountDenyMenu>(entity =>
        {
            entity.HasKey(e => new { e.EmpId, e.MenuId });
            entity.HasOne(e => e.Account).WithMany(a => a.MapAccountDenyMenus).HasForeignKey(e => e.EmpId);
            entity.HasOne(e => e.Menu).WithMany().HasForeignKey(e => e.MenuId);
        });

        // Menu-level ACL：PK 順序 (MenuId, EmpId)，主要查詢方向 = 從 menu 列出對應 emp
        modelBuilder.Entity<MapMenuAllowAccount>(entity =>
        {
            entity.HasKey(e => new { e.MenuId, e.EmpId });
            entity.HasOne(e => e.Menu).WithMany(m => m.MapMenuAllowAccounts).HasForeignKey(e => e.MenuId);
            entity.HasOne(e => e.Account).WithMany().HasForeignKey(e => e.EmpId);
        });

        modelBuilder.Entity<MapMenuDenyAccount>(entity =>
        {
            entity.HasKey(e => new { e.MenuId, e.EmpId });
            entity.HasOne(e => e.Menu).WithMany(m => m.MapMenuDenyAccounts).HasForeignKey(e => e.MenuId);
            entity.HasOne(e => e.Account).WithMany().HasForeignKey(e => e.EmpId);
        });
    }
}
